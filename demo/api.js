// Drop-in replacement for public/js/api.js used by the one-file preview (npm run build:demo).
// Instead of a server, it runs the same game code (server/room.js + game.js) inside the page
// and keeps rooms in localStorage. Everything happens on one phone; joining from another
// phone needs the real server.
import * as G from "../server/game.js";
import { createRoomState, publicState, HOST_ACTIONS, nextEventAt, revealDue, GameError } from "../server/room.js";

/* ---------- storage ---------- */
const ROOMS_KEY = "12pubs-demo-rooms";
const SESSION_KEY = "12pubs-session";
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: keep going in memory */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const loadSession = () => store.get(SESSION_KEY);
export const saveSession = (s) => store.set(SESSION_KEY, s);
export const clearSession = () => store.del(SESSION_KEY);

const rooms = store.get(ROOMS_KEY) || {};
for (const [c, s] of Object.entries(rooms)) if (s.expiresAt ? Date.now() > s.expiresAt : Date.now() - s.updatedAt > 24 * 3600 * 1000) delete rooms[c];
const persist = () => store.set(ROOMS_KEY, rooms);

/* ---------- a fake socket with the same surface app.js uses ---------- */
const listeners = {};
const fire = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));
export const socket = {
  connected: true,
  on(ev, fn) { (listeners[ev] ||= []).push(fn); if (ev === "connect") setTimeout(fn, 0); },
  once(ev, fn) { this.on(ev, fn); },
};

/* ---------- the "server" ---------- */
let current = null;
let dropTimer = null;
const broadcast = (st) => fire("state", publicState(st));

function scheduleDrop(st) {
  clearTimeout(dropTimer);
  const at = nextEventAt(st);
  if (!at) return;
  dropTimer = setTimeout(() => {
    const buzz = revealDue(st);
    if (buzz.length) { st.updatedAt = Date.now(); persist(); broadcast(st); buzz.forEach((b) => fire("buzz", b)); }
    scheduleDrop(st);
  }, Math.max(1000, at - Date.now()));
}

function newCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(""); while (rooms[c]);
  return c;
}

const handlers = {
  "room:create"(input) {
    const st = createRoomState(newCode(), input);
    rooms[st.code] = st; persist(); current = st.code;
    return { code: st.code, hostToken: st.hostToken, role: "host", state: publicState(st) };
  },
  "room:join"({ code, hostToken }) {
    const st = rooms[String(code || "").toUpperCase().trim()];
    if (!st) throw new GameError("No room with that code. In this preview everything runs on one phone.");
    if (hostToken !== st.hostToken) throw new GameError("Joining from another phone needs the live site.");
    current = st.code; scheduleDrop(st);
    return { role: "host", state: publicState(st) };
  },
  host({ action, args }) {
    const st = rooms[current];
    if (!st) throw new GameError("Room not found");
    const fn = Object.hasOwn(HOST_ACTIONS, action) && HOST_ACTIONS[action];
    if (!fn) throw new GameError("Unknown action");
    const out = fn(st, args && typeof args === "object" ? args : {}) || {};
    st.updatedAt = Date.now(); persist();
    if (out.schedule) scheduleDrop(st);
    broadcast(st);
    [].concat(out.buzz || []).forEach((b) => fire("buzz", b));
    return out.result || {};
  },
};

export function call(event, payload = {}) {
  return new Promise((resolve, reject) => {
    try {
      const h = handlers[event];
      if (!h) throw new GameError("That needs the live site.");
      resolve({ ok: true, ...h(payload) });
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      reject(new Error(e instanceof GameError ? e.message : "Something went wrong"));
    }
  });
}
export const host = (action, args = {}) => call("host", { action, args });

export async function getJSON(url) {
  const [path, qs] = url.split("?");
  const q = new URLSearchParams(qs || "");
  if (path === "/api/meta") {
    return {
      modes: Object.fromEntries(Object.entries(G.MODES).map(([k, m]) => [k, m.label])),
      cats: G.CATS,
      emojis: G.EMOJIS,
      starts: Object.fromEntries(Object.entries(G.DUBLIN.starts).map(([k, s]) => [k, s.name])),
    };
  }
  if (path === "/api/dublin-route") {
    const mode = G.MODES[q.get("mode")] ? q.get("mode") : "classic";
    const start = G.DUBLIN.starts[q.get("start")] ? q.get("start") : "trinity";
    return G.dublinRoute(mode, start);
  }
  throw new Error("Not available in the preview");
}

// Saving the recap image in the preview: the artifact viewer only allows downloads
// through its own "downloads" capability (the viewer confirms each save).
let downloadsNs;
function getDownloads() {
  if (downloadsNs === undefined) {
    const c = globalThis.claude;
    downloadsNs = c && typeof c.use === "function" ? c.use("downloads").catch(() => null) : Promise.resolve(null);
  }
  return downloadsNs;
}
export const canDownload = async () => !!(await getDownloads());
export async function saveFile(filename, blob) {
  const dl = await getDownloads();
  if (!dl) throw new Error("Downloads aren't available here");
  try { await dl.save({ filename, data: blob }); return true; }
  catch (e) {
    if (e && e.code === "declined") return false;
    if (e && e.code === "rate_limited") throw new Error("One sec, try again");
    throw new Error("Couldn't save the image here");
  }
}
