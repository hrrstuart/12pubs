// Pure game logic: no sockets, no storage. Everything here is easy to unit test.
// Content is imported as JSON so this file works in Node and can also be bundled for the browser preview.
import challengesJson from "./content/challenges.json" with { type: "json" };
import missionsJson from "./content/missions.json" with { type: "json" };
import dublinJson from "./content/dublin.json" with { type: "json" };

const CONTENT = challengesJson.items;
export const RULES = CONTENT.filter((x) => x.kind === "rule");
export const CHALLENGES = CONTENT.filter((x) => x.kind === "challenge");
export const FORFEITS = CONTENT.filter((x) => x.kind === "forfeit");
export const SPECIALS = Object.fromEntries(CONTENT.filter((x) => x.kind === "special").map((x) => [x.type, x.text]));
export const MISSIONS = missionsJson.missions;
export const DUBLIN = dublinJson;

export const CATS = ["drinking", "talking", "social", "dares", "physical", "brain", "silly"];

// Weights per intensity (1 mild, 2 classic, 3 savage). 0 = never picked in that mode.
export const MODES = {
  chill:   { label: "Chill",   rw: { 1: 6, 2: 1, 3: 0 }, cw: { 1: 4, 2: 1, 3: 0 }, fw: { 1: 5, 2: 1, 3: 0 }, arrive: 0.5,  drop: 0.35 },
  classic: { label: "Classic", rw: { 1: 1, 2: 4, 3: 0 }, cw: { 1: 2, 2: 3, 3: 0 }, fw: { 1: 2, 2: 3, 3: 0 }, arrive: 0.65, drop: 0.5 },
  hard:    { label: "Savage",  rw: { 1: 0, 2: 2, 3: 4 }, cw: { 1: 1, 2: 2, 3: 3 }, fw: { 1: 1, 2: 3, 3: 3 }, arrive: 0.75, drop: 0.6 },
};

// Profile emoji people can pick. Only these are accepted, so nothing odd gets broadcast.
export const EMOJIS = ["🍺", "🍻", "🥃", "🍷", "🥂", "😎", "🤠", "🥳", "😈", "😇", "🤡", "👻", "👽", "🤖", "💀", "🦄", "🐸", "🐶", "🐱", "🦊", "🐻", "🐼", "🐙", "🦖", "🔥", "⚡", "🌈", "⭐", "💅", "🕺", "💃", "🎸", "⚽", "🏀", "☘️", "🎄"];

export const COLORS = ["#a8322d", "#3b7d6b", "#5b5fb0", "#b0702e", "#7a4f9a", "#2f7fa0", "#9a4f6b", "#6b8a2e", "#c0603a", "#4f6b9a", "#8a6a1c", "#3a8a7a"];

/* ---------- random helpers (rng injectable for tests) ---------- */
export const rnd = (a, rng = Math.random) => a[Math.floor(rng() * a.length)];
export function shuffle(a, rng = Math.random) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function wpick(list, wf, rng = Math.random) {
  const ws = list.map(wf), t = ws.reduce((a, b) => a + b, 0);
  if (t <= 0) return null;
  let r = rng() * t;
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/* ---------- pubs ---------- */
export const typeFor = (i) => (i === 3 ? "water" : i === 7 ? "food" : i === 11 ? "finale" : "rule");

function dist(a, b) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLen = (s, ps) => ps.reduce((d, p, i) => d + dist(i ? ps[i - 1] : s, p), 0);

// Nearest neighbour, then 2-opt, on an open path with a fixed start.
function orderRoute(start, ps) {
  let left = ps.slice(), cur = start, out = [];
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = dist(cur, p); if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0]; out.push(cur);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < out.length - 1; i++) for (let k = i + 1; k < out.length; k++) {
      const c = out.slice(0, i).concat(out.slice(i, k + 1).reverse(), out.slice(k + 1));
      if (pathLen(start, c) + 0.5 < pathLen(start, out)) { out = c; improved = true; }
    }
  }
  return out;
}

export function dublinRoute(mode, startKey, rng = Math.random) {
  const start = DUBLIN.starts[startKey] || DUBLIN.starts.trinity;
  const byDist = DUBLIN.pubs.slice().sort((a, b) => dist(start, a) - dist(start, b));
  const pool = { chill: 16, classic: 24, hard: byDist.length }[mode] || 24;
  const route = orderRoute(start, shuffle(byDist.slice(0, pool), rng).slice(0, 12));
  const meters = pathLen(start, route) * 1.35; // street-grid fudge factor
  return { start, route, km: +(meters / 1000).toFixed(1), mins: Math.round(meters / 75) };
}

/* ---------- content picking ---------- */
export function pickRule(settings, i, used, prevCat, rng = Math.random) {
  const M = MODES[settings.mode];
  const base = RULES.filter((r) => !used.has(r.id) && !(r.notFirst && i === 0) && M.rw[r.int] > 0);
  let c = base.filter((r) => settings.cats.includes(r.cat));
  if (c.length < 3) c = base;
  const r = wpick(c, (x) => M.rw[x.int] * (x.cat === prevCat ? 0.3 : 1), rng);
  return r ? { id: r.id, text: r.text, cat: r.cat, int: r.int, pick: r.pick || null } : { id: "fallback", text: "No swearing.", cat: "talking", int: 1, pick: null };
}

export function pickChallenge(settings, i, when, used, rng = Math.random) {
  const M = MODES[settings.mode];
  const base = CHALLENGES.filter((c) =>
    c.when === when && !used.has(c.id) && !(c.notFirst && i === 0) && !(c.mid && !(i === 5 || i === 6)) &&
    M.cw[c.int] > 0 && (settings.drinkF || c.cat !== "drinking" || c.int < 3));
  let c = base.filter((x) => settings.cats.includes(x.cat));
  if (!c.length) c = base;
  const x = wpick(c, (y) => M.cw[y.int], rng);
  if (!x) return null;
  used.add(x.id);
  return { id: x.id, text: x.text, cat: x.cat, int: x.int, group: x.group, state: "open", victim: null };
}

export function pickForfeit(settings, minInt = 0, avoidId = null, rng = Math.random) {
  const M = MODES[settings.mode];
  const base = FORFEITS.filter((f) => (settings.drinkF || f.cat !== "drinking") && f.id !== avoidId);
  const f = minInt
    ? wpick(base, (x) => (x.int >= minInt ? 1 : 0), rng) || wpick(base, () => 1, rng)
    : wpick(base, (x) => M.fw[x.int], rng);
  return { id: f.id, text: f.text, int: f.int };
}

export function buildPlan(settings, pubs, rng = Math.random) {
  const usedR = new Set(), usedC = new Set(), M = MODES[settings.mode];
  let prev = null;
  return pubs.map((p, i) => {
    const type = typeFor(i);
    const o = { name: p.name, street: p.street || "", lat: p.lat ?? null, lng: p.lng ?? null, generic: !!p.generic,
      type, rule: null, arrive: null, drop: null, arrivedAt: null, dropAt: null, dropShown: false, picked: null, forf: 0 };
    if (type === "rule") {
      o.rule = pickRule(settings, i, usedR, prev, rng); usedR.add(o.rule.id); prev = o.rule.cat;
      if (settings.challenges && rng() < M.arrive) o.arrive = pickChallenge(settings, i, "arrival", usedC, rng);
      if (settings.challenges && rng() < M.drop) o.drop = pickChallenge(settings, i, "drop", usedC, rng);
    }
    return o;
  });
}

export function rerollRule(state, i, rng = Math.random) {
  const used = new Set(state.plan.filter((p) => p.rule).map((p) => p.rule.id));
  const prev = i > 0 && state.plan[i - 1].rule ? state.plan[i - 1].rule.cat : null;
  state.plan[i].rule = pickRule(state.settings, i, used, prev, rng);
  state.plan[i].picked = null;
}

export function dealMission(players, name, avoid = null, rng = Math.random) {
  const others = players.map((p) => p.n).filter((x) => x !== name);
  const taken = new Set(players.filter((p) => p.mission && p.n !== name).map((p) => p.mission.base));
  const pool = MISSIONS.filter((m) => m !== avoid && !taken.has(m) && (others.length || !m.includes("{p}")));
  const base = rnd(pool.length ? pool : MISSIONS, rng);
  return { base, text: base.replace("{p}", rnd(others, rng) || "someone"), seen: false, swapped: false, result: null };
}

// Rules in force right now. On Savage each rule lasts its pub and the next two.
export function activeRules(state) {
  const i = state.pub, p = state.plan[i];
  if (!p || p.type !== "rule") return [];
  const out = [p.rule.text];
  if (state.settings.mode === "hard")
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) if (state.plan[j].type === "rule") out.push(state.plan[j].rule.text);
  return out;
}
