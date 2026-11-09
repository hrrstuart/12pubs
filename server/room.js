// One night = one room. All state changes go through the functions here.
// The server is the source of truth; phones only display what publicState() returns.
import * as G from "./game.js";

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };
// Web Crypto works in both Node 20+ and browsers
// Once a night ends, its recap stays up for this long, then the room is deleted
export const RECAP_TTL = 24 * 60 * 60 * 1000;
export const newToken = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const validEmoji = (e) => (G.EMOJIS.includes(e) ? e : null);
const MAX_FEED = 80;
export const MAX_PLAYERS = 50;
const SAME_REPORTER_MS = 60000; // one person can only report the same person once a minute
const JUST_CAUGHT_MS = 10000;   // two mates tapping at once only counts once

/* ---------- creating a room ---------- */
export function createRoomState(code, input = {}, rng = Math.random) {
  const s = input.settings || {};
  const settings = {
    mode: G.MODES[s.mode] ? s.mode : "classic",
    cats: Array.isArray(s.cats) ? s.cats.filter((c) => G.CATS.includes(c)) : [],
    missions: s.missions !== false,
    surprise: s.surprise !== false,
    drinkF: s.drinkF === true,
    tokens: [0, 1, 2].includes(s.tokens) ? s.tokens : 2,
  };
  if (!settings.cats.length) settings.cats = G.CATS.slice();

  // Players: the host to start with, then everyone joins with the code (MAX_PLAYERS at most)
  // Each player is a name, or { n, emoji }
  const seen = {};
  const people = (Array.isArray(input.players) ? input.players : [])
    .map((p) => (typeof p === "string" ? { n: p } : p && typeof p === "object" ? p : {}))
    .map((p) => ({ n: clean(p.n, 14), emoji: validEmoji(p.emoji) }))
    .filter((p) => p.n).slice(0, MAX_PLAYERS)
    .map((p) => { const k = p.n.toLowerCase(); seen[k] = (seen[k] || 0) + 1; return seen[k] > 1 ? { ...p, n: `${p.n} ${seen[k]}` } : p; });
  if (people.length < 1) fail("Add your name");
  const players = people.map((p, i) => ({ id: "p" + i, n: p.n, emoji: p.emoji, c: G.COLORS[i % G.COLORS.length], tokens: settings.tokens, forf: 0, skips: 0, chall: 0, claimToken: null, mission: null, joinedPub: 0, leftPub: null }));

  // Pubs: up to 12 given, the rest are "Pub n" to be named on the night
  const given = Array.isArray(input.pubs) ? input.pubs.slice(0, 12) : [];
  const pubs = Array.from({ length: 12 }, (_, i) => {
    const p = given[i] || {};
    const name = clean(p.name, 60);
    return name ? { name, street: clean(p.street, 60), lat: num(p.lat), lng: num(p.lng) } : { name: `Pub ${i + 1}`, generic: true };
  });

  const now = Date.now();
  const state = {
    code, hostToken: newToken(), createdAt: now, updatedAt: now,
    phase: "plan", settings, players, plan: G.buildPlan(settings, pubs, rng),
    pub: -1, forfeits: [], catches: [], feed: [], startAt: null, endAt: null, nextId: 1,
    plants: [], // surprises people plant before the night (see "Plant a surprise" below)
  };
  if (settings.missions) players.forEach((p) => (p.mission = G.dealMission(players, p.n, null, rng)));
  return state;
}

/* ---------- what phones are allowed to see ---------- */
export function publicState(state) {
  const showMissions = state.phase === "reveal" || state.phase === "recap";
  return {
    code: state.code, phase: state.phase, settings: state.settings, pub: state.pub, expiresAt: state.expiresAt || null,
    startAt: state.startAt, endAt: state.endAt, feed: state.feed, forfeits: state.forfeits,
    catches: (state.catches || []).filter((c) => !c.removed).slice(0, 30).map((c) => ({ id: c.id, playerId: c.playerId, n: c.n, by: c.by, pub: c.pub })),
    players: state.players.map((p) => ({
      id: p.id, n: p.n, c: p.c, emoji: p.emoji || null, tokens: p.tokens, forf: p.forf, skips: p.skips, chall: p.chall,
      claimed: !!p.claimToken, missionSeen: !!(p.mission && p.mission.seen),
      joinedPub: p.joinedPub || 0, leftPub: p.leftPub ?? null,
      mission: showMissions && p.mission ? { text: p.mission.text, result: p.mission.result } : null,
    })),
    plan: state.plan.map((p, i) => ({
      name: p.name, street: p.street, lat: p.lat, lng: p.lng, generic: p.generic, type: p.type, rule: p.rule,
      picked: p.picked, arrivedAt: p.arrivedAt, forf: p.forf,
      // challenges stay secret until you get there; surprise drops until they drop
      arrive: i <= state.pub ? p.arrive : null,
      drop: i <= state.pub && p.dropShown ? p.drop : null,
      dropPending: i === state.pub && !!p.drop && !p.dropShown,
      plantPending: i === state.pub ? (state.plants || []).filter((x) => x.pub === i && x.status === "approved" && !x.revealed).length : 0,
    })),
    // Planted surprises: everyone sees who planted one and where, never what it says until it pops up.
    // At the reveal/recap, the ones that never got played are shown too.
    plants: (state.plants || [])
      .filter((x) => x.status !== "rejected" && (!showMissions || x.status === "approved"))
      .map((x) => ({ id: x.id, by: x.by, byName: x.byName, kind: x.kind, pub: x.pub, status: x.status, revealed: x.revealed,
        text: x.revealed || showMissions ? x.text : null, breaks: x.breaks, state: x.state })),
  };
}

/* ---------- helpers ---------- */
const player = (state, id) => state.players.find((p) => p.id === id) || fail("Unknown player");
// Who's actually here right now (late joiners count from their first pub; people who headed home don't)
export const isHere = (state, p) => (p.joinedPub || 0) <= Math.max(state.pub, 0) && p.leftPub == null;
const names = (state) => { const here = state.players.filter((p) => isHere(state, p)).map((p) => p.n); return here.length ? here : state.players.map((p) => p.n); };
export function feed(state, who, text) {
  state.feed.unshift({ t: Date.now(), who, text });
  if (state.feed.length > MAX_FEED) state.feed.length = MAX_FEED;
}
const needPhase = (state, ...ph) => { if (!ph.includes(state.phase)) fail("Not right now"); };
const pubIndex = (state, i) => { if (!Number.isInteger(i) || i < 0 || i > 11) fail("Bad pub"); return i; };
const current = (state) => state.plan[state.pub];

export function arrive(state, i, rng = Math.random) {
  state.pub = i;
  state.forfeits = [];
  const p = state.plan[i], ns = names(state);
  p.arrivedAt = Date.now();
  if (p.rule && p.rule.pick) p.picked = G.rnd(ns, rng);
  if (p.arrive && !p.arrive.group) p.arrive.victim = G.rnd(ns, rng);
  if (p.drop) {
    if (!p.drop.group) p.drop.victim = G.rnd(ns, rng);
    p.dropAt = p.arrivedAt + (10 + rng() * 10) * 60000; // 10-20 min in
  }
  for (const x of state.plants || []) if (x.pub === i && x.status === "approved" && !x.revealed) x.revealAt = p.arrivedAt + (5 + rng() * 10) * 60000; // 5-15 min in
  feed(state, null, `Arrived at ${p.name}`);
}

/* ---------- timed surprises (drops and planted ones) ---------- */
// When the next timed thing at the current pub is due, or null
export function nextEventAt(state) {
  if (state.phase !== "live") return null;
  const p = current(state); if (!p) return null;
  const times = [];
  if (p.drop && !p.dropShown && p.dropAt) times.push(p.dropAt);
  for (const x of state.plants || []) if (x.pub === state.pub && x.status === "approved" && !x.revealed && x.revealAt) times.push(x.revealAt);
  return times.length ? Math.min(...times) : null;
}
// Reveal whatever is due. Returns the buzz events to send to phones.
export function revealDue(state, now = Date.now()) {
  if (state.phase !== "live") return [];
  const buzz = [], p = current(state);
  if (p && p.drop && !p.dropShown && p.dropAt && p.dropAt <= now && revealDrop(state)) buzz.push({ kind: "drop" });
  for (const x of state.plants || []) if (x.pub === state.pub && x.status === "approved" && !x.revealed && x.revealAt && x.revealAt <= now) { revealPlant(state, x); buzz.push({ kind: "plant", byName: x.byName }); }
  return buzz;
}
function revealPlant(state, x) {
  x.revealed = true;
  const p = state.plan[x.pub];
  if (x.kind === "rule") {
    x.replaced = p.rule ? p.rule.text : null;
    p.rule = { id: "plant" + x.id, text: x.text, cat: "planted", int: 2, pick: null, by: x.byName, plantId: x.id };
    p.picked = null;
    feed(state, x.byName, `🎁 planted a new rule: ${x.text}`);
  } else feed(state, x.byName, `🎁 planted a challenge: ${x.text}`);
}

export function revealDrop(state) {
  const p = current(state);
  if (!p || !p.drop || p.dropShown) return false;
  p.dropShown = true;
  feed(state, null, `⚡ Surprise drop at ${p.name}`);
  return true;
}

/* ---------- host actions ----------
   Each returns an object: { result?, buzz?, schedule? }
   result goes back to the host only; buzz is sent to all phones; schedule means re-arm the drop timer. */
export const HOST_ACTIONS = {
  reroll(state, { i }) {
    pubIndex(state, i);
    if (state.plan[i].type !== "rule" || i < state.pub) fail("Can't change that one");
    G.rerollRule(state, i);
    if (i === state.pub) feed(state, null, `📜 New rule: ${state.plan[i].rule.text}`);
    return {};
  },
  editRule(state, { i, text }) {
    pubIndex(state, i);
    const t = clean(text, 140);
    if (!t) fail("Write the rule first");
    const p = state.plan[i];
    if (p.type !== "rule" || i < state.pub) fail("Can't change that one");
    p.rule = { id: "custom" + i, text: t, cat: "custom", int: p.rule.int, pick: null };
    p.picked = null;
    if (i === state.pub) feed(state, null, `📜 Rule changed: ${t}`);
    return {};
  },
  rename(state, { i, name }) {
    pubIndex(state, i);
    const n = clean(name, 60);
    if (!n) fail("Give it a name");
    Object.assign(state.plan[i], { name: n, generic: false, street: "", lat: null, lng: null });
    return {};
  },
  start(state) {
    needPhase(state, "plan");
    if (state.players.length < 2) fail("Wait for at least one more person to join");
    state.startAt = Date.now();
    if (state.settings.missions) { state.phase = "missions"; return {}; }
    state.phase = "live"; arrive(state, 0); return { schedule: true };
  },
  missionsDone(state) {
    needPhase(state, "missions");
    state.phase = "live";
    if (state.pub < 0) arrive(state, 0);
    return { schedule: true };
  },
  peekMissions(state) {
    needPhase(state, "live");
    state.phase = "missions";
    return {};
  },
  next(state) {
    needPhase(state, "live");
    if (state.pub >= 11) fail("That was the last pub");
    arrive(state, state.pub + 1);
    return { schedule: true };
  },
  // "Drop it now": bring forward the next timed surprise at this pub
  dropNow(state) {
    needPhase(state, "live");
    const t = nextEventAt(state);
    return t ? { buzz: revealDue(state, t), schedule: true } : {};
  },
  challenge(state, { kind, action, id }) {
    needPhase(state, "live");
    const p = current(state);
    const c = kind === "plant" ? (state.plants || []).find((x) => x.id === id && x.kind === "challenge" && x.revealed && x.pub === state.pub)
      : kind === "drop" ? (p.dropShown ? p.drop : null) : p.arrive;
    if (!c || c.state !== "open") fail("No open challenge");
    if (action === "done") {
      c.state = "done";
      if (c.group) { state.players.filter((x) => isHere(state, x)).forEach((x) => x.chall++); feed(state, null, "Group challenge done ✅"); }
      else { state.players.find((x) => x.n === c.victim).chall++; feed(state, c.victim, "did the challenge ✅"); }
    } else if (action === "skip") {
      const v = !c.group && state.players.find((x) => x.n === c.victim);
      if (!v || v.tokens < 1) fail("No skip tokens left");
      v.tokens--; v.skips++; c.state = "skipped";
      feed(state, v.n, "skipped the challenge 🎟");
    } else if (action === "new") {
      if (c.group) fail("It's a group one");
      const others = names(state).filter((n) => n !== c.victim);
      c.victim = G.rnd(others.length ? others : names(state));
    } else fail("Unknown action");
    return {};
  },
  caught(state, { playerId }) {
    return recordCatch(state, playerId, null);
  },
  // A catch was wrong, or someone was messing: take it back and put every count right
  removeCatch(state, { id }) {
    needPhase(state, "live", "reveal");
    const c = (state.catches || []).find((x) => x.id === id && !x.removed) || fail("That one's already gone");
    const pl = player(state, c.playerId);
    c.removed = true;
    pl.forf = Math.max(0, pl.forf - 1);
    state.plan[c.pub].forf = Math.max(0, (state.plan[c.pub].forf || 0) - 1);
    if (c.plantId) { const x = state.plants.find((y) => y.id === c.plantId); if (x) x.breaks = Math.max(0, x.breaks - 1); }
    if (c.skipped) { pl.tokens++; pl.skips = Math.max(0, pl.skips - 1); }
    state.forfeits = state.forfeits.filter((f) => f.catchId !== c.id);
    feed(state, pl.n, "had a forfeit taken back ↩️");
    return {};
  },
  forfeit(state, { id, action }) {
    applyForfeit(state, id, action);
    return {};
  },
  finish(state) {
    needPhase(state, "live", "missions");
    state.endAt = Date.now(); state.forfeits = [];
    state.phase = state.settings.missions ? "reveal" : "recap";
    if (state.phase === "recap") state.expiresAt = state.endAt + RECAP_TTL;
    return { schedule: true }; // clears the drop timer
  },
  missionResult(state, { playerId, result }) {
    needPhase(state, "reveal");
    const pl = player(state, playerId);
    if (!pl.mission) fail("No mission");
    pl.mission.result = result === true ? true : result === false ? false : null;
    return {};
  },
  revealDone(state) { needPhase(state, "reveal"); state.phase = "recap"; state.expiresAt = Date.now() + RECAP_TTL; return {}; },
  // Pass-the-phone mode: the host's phone shows one person's mission
  peek(state, { playerId }) {
    const pl = player(state, playerId);
    if (!pl.mission) fail("Missions are off");
    pl.mission.seen = true;
    return { result: { mission: pl.mission.text, swapped: pl.mission.swapped } };
  },
  swap(state, { playerId }) { return { result: swapMission(state, playerId) }; },
  setEmoji(state, { playerId, emoji }) { setEmoji(state, playerId, emoji); return {}; },
  // Comings and goings
  addPlayer(state, { n, emoji }) { const pl = addPlayer(state, n, emoji); return { result: { id: pl.id } }; },
  leave(state, { playerId }) { leavePlayer(state, playerId); return {}; },
  back(state, { playerId }) { comeBack(state, playerId); return {}; },
  // Planting on the host's phone (pass-the-phone): the host hands it over and doesn't look
  plantAdd(state, { playerId, kind, text }) { const x = addPlant(state, playerId, kind, text); return { result: { id: x.id, pub: x.pub } }; },
  // The host OKs or bins a surprise without seeing it...
  plantDecide(state, { id, ok }) {
    needPhase(state, "plan", "missions");
    const x = plantById(state, id);
    if (state.pub >= 0 && x.pub <= state.pub) fail("Too late to change that one");
    x.status = ok ? "approved" : "rejected";
    return {};
  },
  // ...unless they really want to peek, which spoils it for them
  plantPeek(state, { id }) { const x = plantById(state, id); return { result: { text: x.text, kind: x.kind } }; },
};

/* ---------- Plant a surprise ----------
   Before the night, anyone can plant up to 2 surprise rules or challenges. Each lands on a random pub.
   The host OKs them blind. At that pub, 5-15 min in, it pops up on everyone's phone. */
export const PLANT_LIMIT = 2;
const plantById = (state, id) => (state.plants || []).find((x) => x.id === id) || fail("That surprise is gone");
export function addPlant(state, playerId, kind, text, rng = Math.random) {
  if (state.pub >= 0 || !["plan", "missions"].includes(state.phase)) fail("Surprises are planted before the night starts");
  const pl = player(state, playerId);
  if (kind !== "rule" && kind !== "challenge") fail("Pick a rule or a challenge");
  const t = clean(text, 140);
  if (t.length < 3) fail("Write your surprise first");
  state.plants ||= [];
  const live = state.plants.filter((x) => x.status !== "rejected");
  if (live.filter((x) => x.by === pl.id).length >= PLANT_LIMIT) fail(`Max ${PLANT_LIMIT} surprises each`);
  const taken = new Set(live.map((x) => x.pub));
  const free = state.plan.map((p, i) => i).filter((i) => state.plan[i].type === "rule" && !taken.has(i));
  if (!free.length) fail("Every pub already has a surprise");
  const x = { id: state.nextId++, by: pl.id, byName: pl.n, kind, text: t, pub: G.rnd(free, rng), group: kind === "challenge", status: "pending", revealed: false, revealAt: null, breaks: 0, state: "open" };
  state.plants.push(x);
  feed(state, pl.n, "planted a surprise 🎁");
  return x;
}
export function myPlants(state, playerId) {
  return (state.plants || []).filter((x) => x.by === playerId && x.status !== "rejected").map((x) => ({ id: x.id, kind: x.kind, text: x.text, pub: x.pub, status: x.status }));
}
export function removePlant(state, playerId, id) {
  const x = plantById(state, id);
  if (x.by !== playerId) fail("That's not yours");
  if (state.pub >= 0) fail("Too late, the night's started");
  state.plants = state.plants.filter((y) => y.id !== id);
}

/* ---------- player (own phone) actions ---------- */
export function claimPlayer(state, playerId) {
  const pl = player(state, playerId);
  if (pl.claimToken) fail(`Someone's already on ${pl.n}'s phone`);
  pl.claimToken = newToken();
  return pl.claimToken;
}
export function myMission(state, playerId) {
  const pl = player(state, playerId);
  if (!pl.mission) fail("Missions are off");
  if (state.phase === "plan") fail("Missions unlock when the night starts");
  pl.mission.seen = true;
  return { mission: pl.mission.text, swapped: pl.mission.swapped };
}
export function swapMission(state, playerId) {
  const pl = player(state, playerId);
  if (!pl.mission) fail("Missions are off");
  if (pl.mission.swapped) fail("You've already swapped once");
  if (!["missions", "live"].includes(state.phase)) fail("Not right now");
  pl.mission = { ...G.dealMission(state.players, pl.n, pl.mission.base), seen: true, swapped: true };
  return { mission: pl.mission.text, swapped: true };
}

export function setEmoji(state, playerId, emoji) {
  const pl = player(state, playerId);
  if (emoji !== null && !G.EMOJIS.includes(emoji)) fail("Pick one from the list");
  pl.emoji = emoji;
}

/* ---------- catches ---------- */
function recordCatch(state, playerId, by) {
  needPhase(state, "live");
  if (current(state).type !== "rule") fail("No rules at this stop 🙂");
  const pl = player(state, playerId);
  if (!isHere(state, pl)) fail(`${pl.n} has headed home`);
  pl.forf++; current(state).forf++;
  const r = current(state).rule;
  let plantId = null;
  if (r && r.plantId) { const x = state.plants.find((y) => y.id === r.plantId); if (x) { x.breaks++; plantId = x.id; } } // counts for whoever planted it
  const f = G.pickForfeit(state.settings);
  const c = { id: state.nextId++, playerId: pl.id, n: pl.n, by: by ? by.n : null, byId: by ? by.id : null, pub: state.pub, plantId, at: Date.now(), removed: false, skipped: false };
  (state.catches ||= []).unshift(c);
  state.forfeits.unshift({ id: state.nextId++, catchId: c.id, playerId: pl.id, n: pl.n, by: c.by, text: f.text, int: f.int, fid: f.id, rerolled: false });
  feed(state, pl.n, by && by.id !== pl.id ? `got caught by ${by.n}: ${f.text}` : `got caught: ${f.text}`);
  return { buzz: { kind: "forfeit", playerId: pl.id } };
}
// Anyone playing can report a catch from their own phone
export function reportCatch(state, reporterId, playerId) {
  const by = player(state, reporterId), pl = player(state, playerId), now = Date.now();
  if (!isHere(state, by)) fail("You've headed home");
  for (const c of state.catches || []) {
    if (c.playerId !== pl.id) continue;
    if (!c.removed && now - c.at < JUST_CAUGHT_MS) fail(`${pl.n} has just been caught`);
    if (c.byId === by.id && now - c.at < SAME_REPORTER_MS) fail(`You only caught ${pl.n} a minute ago`);
  }
  return recordCatch(state, playerId, by);
}
function applyForfeit(state, id, action) {
  needPhase(state, "live");
  const k = state.forfeits.findIndex((f) => f.id === id);
  if (k < 0) fail("That forfeit's gone");
  const f = state.forfeits[k], pl = player(state, f.playerId);
  if (action === "done") { state.forfeits.splice(k, 1); feed(state, pl.n, "did the forfeit ✅"); }
  else if (action === "skip") {
    if (pl.tokens < 1) fail("No skip tokens left");
    pl.tokens--; pl.skips++; state.forfeits.splice(k, 1); feed(state, pl.n, "used a skip token 🎟");
    const c = (state.catches || []).find((x) => x.id === f.catchId); if (c) c.skipped = true;
  } else if (action === "reroll") {
    if (f.rerolled) fail("Already re-rolled once");
    const nf = G.pickForfeit(state.settings, f.int, f.fid); // same intensity or harder
    Object.assign(f, { text: nf.text, int: nf.int, fid: nf.id, rerolled: true });
    feed(state, null, `🎲 Re-rolled ${pl.n}'s forfeit: ${nf.text}`);
  } else fail("Unknown action");
}
// People handle their own forfeits from their own phone
export function ownForfeit(state, playerId, id, action) {
  const f = state.forfeits.find((x) => x.id === id) || fail("That forfeit's gone");
  if (f.playerId !== playerId) fail("That's not your forfeit");
  applyForfeit(state, id, action);
}

/* ---------- comings and goings ---------- */
export function selfJoin(state, name) {
  const pl = addPlayer(state, name, null);
  pl.claimToken = newToken();
  return pl;
}
export function addPlayer(state, name, emoji) {
  if (!["plan", "missions", "live"].includes(state.phase)) fail("Not right now");
  if (state.players.length >= MAX_PLAYERS) fail(`${MAX_PLAYERS} players max`);
  let n = clean(name, 14);
  if (!n) fail("Give them a name");
  const taken = new Set(state.players.map((p) => p.n.toLowerCase()));
  for (let k = 2; taken.has(n.toLowerCase()); k++) n = `${clean(name, 12)} ${k}`;
  const i = state.players.length;
  const pl = { id: "p" + i, n, emoji: G.EMOJIS.includes(emoji) ? emoji : null, c: G.COLORS[i % G.COLORS.length],
    tokens: state.settings.tokens, forf: 0, skips: 0, chall: 0, claimToken: null, mission: null, joinedPub: Math.max(state.pub, 0), leftPub: null };
  if (state.settings.missions) pl.mission = G.dealMission(state.players.concat(pl), n);
  state.players.push(pl);
  if (state.pub >= 0) feed(state, n, `joined at pub ${state.pub + 1} 👋`);
  return pl;
}
export function leavePlayer(state, playerId) {
  if (state.phase !== "live") fail("Not right now");
  const pl = player(state, playerId);
  if (pl.leftPub != null) fail(`${pl.n} has already gone home`);
  if (state.players.filter((p) => isHere(state, p)).length <= 1) fail("Someone has to stay! Use End the night instead.");
  pl.leftPub = state.pub;
  state.forfeits = state.forfeits.filter((f) => f.playerId !== pl.id); // no forfeits for people who've left
  feed(state, pl.n, `headed home after ${state.plan[state.pub].name} 🛌`);
}
export function comeBack(state, playerId) {
  if (state.phase !== "live") fail("Not right now");
  const pl = player(state, playerId);
  if (pl.leftPub == null) fail(`${pl.n} never left`);
  pl.leftPub = null;
  feed(state, pl.n, "is back! 🎉");
}

/* ---------- handing over the host role ----------
   The host's phone runs the night. To pass it on, either pick someone who's in on their own phone,
   or show a one-time "take over" QR. Either way the host token changes, so the old phone can't keep running it. */
export function rotateHost(state) { state.hostToken = newToken(); state.takeover = null; return state.hostToken; }
export function makeTakeover(state) {
  if (!["plan", "missions", "live", "reveal"].includes(state.phase)) fail("The night's over");
  state.takeover = { token: newToken().slice(0, 16), exp: Date.now() + 15 * 60000 };
  return state.takeover.token;
}
export function useTakeover(state, token) {
  const t = state.takeover;
  if (!t || t.token !== token || Date.now() > t.exp) fail("That take-over code has expired. Ask the host for a new one.");
  return rotateHost(state);
}
