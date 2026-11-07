// HTTP + WebSocket server. Thin layer: auth, validation, broadcasting.
// Game rules live in game.js, state changes in room.js.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import * as G from "./game.js";
import { RoomStore } from "./store.js";
import { Stats, dashboardHtml } from "./stats.js";
import { rulesPage, robotsTxt, sitemapXml } from "./seo.js";
import { GameError, HOST_ACTIONS, publicState, nextEventAt, revealDue, claimPlayer, myMission, swapMission, setEmoji, addPlant, myPlants, removePlant,
  feed, leavePlayer, comeBack, rotateHost, makeTakeover, useTakeover } from "./room.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, "..", "data", "rooms.json");
const STATS_FILE = process.env.STATS_FILE || path.join(path.dirname(DATA_FILE), "stats.json");
const STATS_KEY = process.env.STATS_KEY || ""; // password for /stats; the dashboard is off without one

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
const store = new RoomStore(DATA_FILE);
const stats = new Stats(STATS_FILE);

app.disable("x-powered-by");

// Count page loads of the app itself (a number per day, nothing else)
app.get("/", (_req, _res, next) => { stats.bump("visits"); next(); });

// Private stats dashboard: https://your-site/stats (any username, password = STATS_KEY)
function statsAuth(req, res, next) {
  if (!STATS_KEY) return res.status(404).send("Stats are off. Set STATS_KEY to turn them on.");
  const [, b64 = ""] = (req.headers.authorization || "").split(" ");
  const pass = Buffer.from(b64, "base64").toString().split(":").slice(1).join(":");
  if (pass === STATS_KEY) return next();
  res.set("WWW-Authenticate", 'Basic realm="12 Pubs stats"').status(401).send("Password needed");
}
app.get("/stats", statsAuth, (_req, res) => res.set("Cache-Control", "no-store").send(dashboardHtml(stats.summary(30))));
app.get("/stats.json", statsAuth, (_req, res) => res.set("Cache-Control", "no-store").json(stats.summary(90)));
// The service worker must always be fresh so updates roll out
app.get("/sw.js", (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(ROOT, "..", "public", "sw.js")));
app.get("/vendor/qrcode.mjs", (_req, res) => res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(ROOT, "..", "node_modules", "qrcode-generator", "dist", "qrcode.mjs")));
app.use(express.static(path.join(ROOT, "..", "public"), { maxAge: "10m" }));

// For search engines: a plain-HTML rules page, robots.txt, sitemap.xml
const RULES_HTML = rulesPage();
app.get("/rules", (_req, res) => res.set("Cache-Control", "public, max-age=3600").type("html").send(RULES_HTML));
app.get(["/12-pubs-rules", "/12-pubs-of-christmas-rules"], (_req, res) => res.redirect(301, "/rules"));
app.get("/robots.txt", (_req, res) => res.type("text/plain").send(robotsTxt()));
app.get("/sitemap.xml", (_req, res) => res.type("application/xml").send(sitemapXml()));

app.get("/healthz", (_req, res) => res.json({ ok: true, rooms: store.rooms.size }));

// Labels the setup screen needs
app.get("/api/meta", (_req, res) => {
  res.json({
    modes: Object.fromEntries(Object.entries(G.MODES).map(([k, m]) => [k, m.label])),
    cats: G.CATS,
    emojis: G.EMOJIS,
    starts: Object.fromEntries(Object.entries(G.DUBLIN.starts).map(([k, s]) => [k, s.name])),
  });
});

// Dublin preset route preview
app.get("/api/dublin-route", (req, res) => {
  const mode = G.MODES[req.query.mode] ? req.query.mode : "classic";
  const start = G.DUBLIN.starts[req.query.start] ? req.query.start : "trinity";
  res.json(G.dublinRoute(mode, start));
});

/* ---------- timers for surprise drops and planted surprises ----------
   Server-side, so they fire even if every phone is locked. One timer per room, for the next thing due. */
const timers = new Map();
function scheduleDrop(state) {
  clearTimeout(timers.get(state.code));
  timers.delete(state.code);
  const at = nextEventAt(state);
  if (!at) return;
  const t = setTimeout(() => {
    timers.delete(state.code);
    const buzz = revealDue(state);
    if (buzz.length) {
      store.touch(state); broadcast(state);
      for (const b of buzz) { io.to(state.code).emit("buzz", b); if (b.kind === "plant") stats.bump("plantsPlayed"); }
    }
    scheduleDrop(state); // the next one, if any
  }, Math.max(1000, at - Date.now()));
  t.unref?.();
  timers.set(state.code, t);
}
for (const s of store.rooms.values()) scheduleDrop(s);

const broadcast = (state) => io.to(state.code).emit("state", publicState(state));

/* ---------- sockets ---------- */
io.on("connection", (socket) => {
  // Wrap every handler: errors become { ok:false, error } on the ack instead of crashing
  const on = (event, fn) => socket.on(event, (payload, cb) => {
    if (typeof payload === "function") { cb = payload; payload = {}; }
    const reply = typeof cb === "function" ? cb : () => {};
    try { reply({ ok: true, ...(fn(payload || {}) || {}) }); }
    catch (e) {
      if (!(e instanceof GameError)) console.error(event, e);
      reply({ ok: false, error: e instanceof GameError ? e.message : "Something went wrong" });
    }
  });
  const room = () => store.get(socket.data.code) || (() => { throw new GameError("Room not found"); })();
  const enter = (state, role, playerId = null) => {
    if (socket.data.code && socket.data.code !== state.code) socket.leave(socket.data.code);
    Object.assign(socket.data, { code: state.code, role, playerId });
    socket.join(state.code);
  };

  on("room:create", (input) => {
    const state = store.create(input);
    const pubs = Array.isArray(input && input.pubs) ? input.pubs.filter((p) => p && p.name) : [];
    stats.nightCreated(state, pubs.some((p) => typeof p.lat === "number") ? "dublin" : pubs.length ? "type" : "go");
    enter(state, "host");
    return { code: state.code, hostToken: state.hostToken, role: "host", state: publicState(state) };
  });

  // Join or rejoin. Host token → host; player token → that player; otherwise a watcher.
  on("room:join", ({ code, hostToken, playerId, playerToken }) => {
    const state = store.get(code);
    if (!state) throw new GameError("No room with that code");
    if (hostToken && hostToken === state.hostToken) { enter(state, "host"); return { role: "host", state: publicState(state) }; }
    const pl = state.players.find((p) => p.id === playerId);
    if (pl && playerToken && pl.claimToken === playerToken) { enter(state, "player", pl.id); return { role: "player", playerId: pl.id, state: publicState(state) }; }
    enter(state, "watcher");
    return { role: "watcher", state: publicState(state) };
  });

  on("player:claim", ({ playerId }) => {
    const state = room();
    const token = claimPlayer(state, playerId);
    stats.bump("joins");
    socket.data.role = "player"; socket.data.playerId = playerId;
    store.touch(state); broadcast(state);
    return { playerId, playerToken: token };
  });

  on("mission:mine", () => {
    const state = room();
    if (socket.data.role !== "player") throw new GameError("Pick your name first");
    const r = myMission(state, socket.data.playerId);
    store.touch(state); broadcast(state);
    return r;
  });

  on("mission:swap", () => {
    const state = room();
    if (socket.data.role !== "player") throw new GameError("Pick your name first");
    const r = swapMission(state, socket.data.playerId);
    store.touch(state);
    return r;
  });

  on("player:emoji", ({ emoji }) => {
    const state = room();
    if (socket.data.role !== "player") throw new GameError("Pick your name first");
    setEmoji(state, socket.data.playerId, emoji ?? null);
    store.touch(state); broadcast(state);
    return {};
  });

  // Plant a surprise from your own phone
  const needPlayer = () => { if (socket.data.role !== "player") throw new GameError("Pick your name first"); };
  on("plant:add", ({ kind, text }) => {
    const state = room(); needPlayer();
    const x = addPlant(state, socket.data.playerId, kind, text);
    stats.bump("plants"); store.touch(state); broadcast(state);
    return { id: x.id, pub: x.pub };
  });
  on("plant:mine", () => { const state = room(); needPlayer(); return { plants: myPlants(state, socket.data.playerId) }; });
  on("plant:remove", ({ id }) => {
    const state = room(); needPlayer();
    removePlant(state, socket.data.playerId, id);
    store.touch(state); broadcast(state);
    return {};
  });

  // Heading home / coming back, from your own phone
  on("player:leave", () => { const state = room(); needPlayer(); leavePlayer(state, socket.data.playerId); stats.bump("leftEarly"); store.touch(state); broadcast(state); return {}; });
  on("player:back", () => { const state = room(); needPlayer(); comeBack(state, socket.data.playerId); store.touch(state); broadcast(state); return {}; });

  // Hand the host role to someone who's in the room on their own phone
  const promote = (state, sock, who) => {
    const token = rotateHost(state);
    for (const s of io.sockets.sockets.values()) {
      if (s.data.code === state.code && s.data.role === "host") { s.data.role = s.data.playerId ? "player" : "watcher"; s.emit("demoted"); }
    }
    sock.data.role = "host";
    feed(state, who, who ? "is running the night now 👑" : "Someone new is running the night 👑");
    stats.bump("handovers"); store.touch(state); broadcast(state);
    return token;
  };
  on("host:handover", ({ playerId }) => {
    const state = room();
    if (socket.data.role !== "host") throw new GameError("Only the host's phone can do that");
    const target = [...io.sockets.sockets.values()].find((s) => s.data.code === state.code && s.data.role === "player" && s.data.playerId === playerId);
    if (!target) throw new GameError("They need to be in the room on their own phone");
    const pl = state.players.find((p) => p.id === playerId);
    const token = promote(state, target, pl && pl.n);
    target.emit("promoted", { hostToken: token });
    return {};
  });
  on("host:takeover-code", () => {
    const state = room();
    if (socket.data.role !== "host") throw new GameError("Only the host's phone can do that");
    const token = makeTakeover(state); store.touch(state);
    return { token };
  });
  // Scanning the take-over QR
  on("room:takeover", ({ code, token, playerId, playerToken }) => {
    const state = store.get(code);
    if (!state) throw new GameError("No room with that code");
    useTakeover(state, token); // throws if it's wrong or expired
    const pl = state.players.find((p) => p.id === playerId && p.claimToken && p.claimToken === playerToken);
    enter(state, "player", pl ? pl.id : null);
    const hostToken = promote(state, socket, pl ? pl.n : null);
    return { role: "host", hostToken, playerId: pl ? pl.id : null, state: publicState(state) };
  });

  // Recap downloads and shares happen on the phone, so the phone tells us (just the count)
  on("stats:event", ({ type }) => {
    if (type === "download") stats.bump("downloads");
    else if (type === "share") stats.bump("shares");
    return {};
  });

  // Everything the host's phone does goes through here
  on("host", ({ action, args }) => {
    const state = room();
    if (socket.data.role !== "host") throw new GameError("Only the host's phone can do that");
    const fn = Object.hasOwn(HOST_ACTIONS, action) && HOST_ACTIONS[action];
    if (!fn) throw new GameError("Unknown action");
    const before = state.phase;
    const out = fn(state, args && typeof args === "object" ? args : {}) || {};
    if (action === "start") stats.bump("started");
    if (action === "finish" && before !== state.phase) stats.nightFinished(state);
    store.touch(state);
    if (action === "plantAdd") stats.bump("plants");
    if (action === "addPlayer" && state.pub >= 0) stats.bump("lateJoins");
    if (action === "leave") stats.bump("leftEarly");
    if (out.schedule) scheduleDrop(state);
    broadcast(state);
    for (const b of [].concat(out.buzz || [])) { io.to(state.code).emit("buzz", b); if (b.kind === "plant") stats.bump("plantsPlayed"); }
    return out.result || {};
  });
});

server.listen(PORT, () => console.log(`12 Pubs running on http://localhost:${PORT}`));
