// Recap, Wrapped-style: stats, a title for everyone, and story-sized slides (1080×1920) drawn on canvas.
// Everything here comes from data the game already tracks, so nobody has to do anything extra on the night.
export const MODE_LABEL = { chill: "Chill", classic: "Classic", hard: "Savage" };

const PUB_COLORS = ["#ff8a3d", "#6ea8ff", "#ff7eb6", "#4ade80", "#b794f6", "#2dd4bf", "#ff6b6b", "#ffd23f"];
const STOP_COLORS = { water: "#9be7ff", food: "#ffd23f", finale: "#ff7eb6" };
const PLAYER_COLORS = ["#ff7eb6", "#6ea8ff", "#4ade80", "#ff8a3d", "#b794f6", "#ffd23f", "#2dd4bf", "#ff6b6b", "#9be7ff", "#f4a6ff", "#c4f25c", "#ffb38a"];
export const pubColor = (i, type) => STOP_COLORS[type] || PUB_COLORS[i % PUB_COLORS.length];
export const playerColor = (i) => PLAYER_COLORS[i % PLAYER_COLORS.length];

const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (t) => new Date(t || Date.now()).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const plural = (n, w) => `${n} ${n === 1 ? w : /(ch|sh|s|x)$/.test(w) ? w + "es" : w + "s"}`;
export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// How many pubs someone was actually out for (late joiners and early exits count fairly)
export function attended(S, p) {
  const visited = S.plan.filter((x) => x.arrivedAt).length;
  const start = p.joinedPub || 0, end = p.leftPub != null ? Math.min(p.leftPub, visited - 1) : visited - 1;
  return Math.max(0, end - start + 1);
}
export function comingsAndGoings(S, p) {
  const bits = [];
  if (p.joinedPub) bits.push(`Joined at pub ${p.joinedPub + 1}`);
  if (p.leftPub != null) bits.push(`Headed home after pub ${p.leftPub + 1}`);
  return bits.join(" · ");
}

export function displayName(S, n, hide) {
  return hide ? "Player " + (S.players.findIndex((p) => p.n === n) + 1) : n;
}

/* ---------------- numbers ---------------- */
// Nights made before challenges became optional always had them
export const challengesOn = (S) => S.settings.challenges ?? true;
// A catch with no other reason is someone breaking the rule (missions and busts have a reason)
const ruleCatches = (S) => (S.catches || []).filter((c) => !c.why);
// Every pub you got to that had a rule: what it was, how often it got broken, and who it got most
export function ruleBreaks(S) {
  const cs = ruleCatches(S);
  return S.plan.map((p, i) => ({ ...p, i })).filter((p) => p.arrivedAt && p.type === "rule" && p.rule).map((p) => {
    const here = cs.filter((c) => c.pub === p.i), count = {};
    for (const c of here) count[c.playerId] = (count[c.playerId] || 0) + 1;
    const most = Math.max(0, ...Object.values(count)), ids = Object.keys(count).filter((id) => count[id] === most);
    return { i: p.i, name: p.name, text: p.rule.text, by: p.rule.by || null, n: here.length,
      // only worth naming if they were caught more than once and it's not a crowd
      downfall: most >= 2 && ids.length <= 2 ? { ids, n: most } : null };
  });
}
export function nightStats(S) {
  const visited = S.plan.map((p, i) => ({ ...p, i })).filter((p) => p.arrivedAt);
  const end = S.endAt || Date.now();
  const stays = visited.map((p, k) => ({ name: p.name, ms: (k + 1 < visited.length ? visited[k + 1].arrivedAt : end) - p.arrivedAt }));
  const longest = stays.length > 1 ? stays.reduce((a, b) => (b.ms > a.ms ? b : a)) : null;
  const quickest = stays.length > 1 ? stays.slice(0, -1).reduce((a, b) => (b.ms < a.ms ? b : a)) : null; // the finale doesn't count
  const rules = ruleBreaks(S);
  const worst = rules.reduce((a, b) => (b.n > (a ? a.n : 0) ? b : a), null);
  let challenges = 0;
  for (const p of visited) for (const c of [p.arrive, p.drop]) if (c && c.state === "done") challenges++;
  const plants = (S.plants || []).filter((x) => x.status === "approved");
  // Peak chaos: the 10 minutes with the most forfeits (needs at least 3 to count as chaos)
  let peak = null;
  const ts = (S.catches || []).filter((c) => c.at).slice().sort((a, b) => a.at - b.at);
  for (let i = 0, j = 0; j < ts.length; j++) {
    while (ts[j].at - ts[i].at > 10 * 60000) i++;
    const n = j - i + 1;
    if (n >= 3 && (!peak || n > peak.n)) peak = { n, at: ts[i].at, pub: S.plan[ts[i].pub] ? S.plan[ts[i].pub].name : null };
  }
  return {
    visited: visited.length,
    lastPub: visited.length ? visited[visited.length - 1].name : null,
    plants,
    out: S.startAt ? end - S.startAt : 0,
    forfeits: S.players.reduce((a, p) => a + p.forf, 0),
    skips: S.players.reduce((a, p) => a + p.skips, 0),
    // one drink each per pub you were actually there for (a water at the water stop counts too)
    drinks: S.players.reduce((a, p) => a + attended(S, p), 0),
    challenges, longest, quickest, peak,
    rulesBroken: rules.reduce((a, r) => a + r.n, 0),
    caught: new Set(ruleCatches(S).map((c) => c.playerId)).size,
    ruleThatGotYou: worst && worst.n ? { text: worst.text, pub: worst.name, n: worst.n } : null,
  };
}

// When people are level, say so rather than naming whoever's first in the list
function winners(names, total, val, unit) {
  const k = names.length, stat = plural(val, unit);
  if (k === 1) return { n: names[0], d: stat };
  if (k === 2) return { n: names.join(" & "), d: `${stat} each` };
  return { n: k === total ? "Everyone" : `${k}-way tie`, d: k === total ? `${stat} each` : `${stat} each: ${names.join(", ")}` };
}
export function awards(S, hide) {
  const ps = S.players, label = (n) => displayName(S, n, hide);
  const level = (list, k, v) => list.filter((p) => p[k] === v);
  const topForf = Math.max(...ps.map((p) => p.forf));
  // cleanest record only counts people who were there for at least half the night
  const visited = S.plan.filter((x) => x.arrivedAt).length;
  const stayers = ps.filter((p) => attended(S, p) >= Math.ceil(visited / 2));
  const pool = stayers.length ? stayers : ps, lowForf = Math.min(...pool.map((p) => p.forf));
  const topSkips = Math.max(...ps.map((p) => p.skips));
  const topPub = Math.max(...S.plan.map((p) => p.forf || 0)), messy = S.plan.filter((p) => (p.forf || 0) === topPub);
  const namesOf = (list) => list.map((p) => label(p.n));
  const worst = winners(namesOf(level(ps, "forf", topForf)), ps.length, topForf, "forfeit");
  const cleanest = winners(namesOf(level(pool, "forf", lowForf)), pool.length, lowForf, "forfeit");
  const pubs = winners(messy.map((p) => p.name), S.plan.length, topPub, "forfeit");
  const list = [
    { t: "Most forfeits", ...(topForf ? worst : { n: "Nobody", d: "A clean night?!" }) },
    { t: "Cleanest record", ...cleanest },
    { t: "Messiest pub", ...(topPub ? (messy.length === 1 ? { n: messy[0].name, d: plural(topPub, "forfeit") + " handed out" } : pubs) : { n: "None", d: "Saints, all of you" }) },
  ];
  if (S.settings.missions) {
    const done = ps.filter((p) => p.mission && p.mission.result === true).map((p) => label(p.n));
    list.push({ t: "Secret agents",
      n: done.length ? (done.length <= 2 ? done.join(" & ") : `${done.length} of ${ps.length}`) : "Nobody",
      d: done.length > 2 ? done.join(", ") : done.length ? `${done.length} of ${ps.length} missions done` : "Every mission failed" });
  } else {
    list.push({ t: "Escape artist", ...(topSkips ? winners(namesOf(level(ps, "skips", topSkips)), ps.length, topSkips, "skip token") : { n: "Nobody", d: "Nobody bottled it" }) });
  }
  return list;
}

/* ---------------- who did what to who ---------------- */
// Your nemesis caught you most; your victim is who you caught most. Needs 2+ so it means something.
export function rivals(S, p) {
  const top = (pairs) => {
    const count = {};
    for (const id of pairs) count[id] = (count[id] || 0) + 1;
    const best = Math.max(0, ...Object.values(count));
    const ids = Object.keys(count).filter((id) => count[id] === best);
    return best >= 2 && ids.length <= 2 ? { ids, n: best } : null;
  };
  const cs = (S.catches || []).filter((c) => c.byId && c.byId !== c.playerId && c.why !== "wrong");
  return { nemesis: top(cs.filter((c) => c.playerId === p.id).map((c) => c.byId)), victim: top(cs.filter((c) => c.byId === p.id).map((c) => c.playerId)) };
}
const nameOf = (S, id, hide) => { const p = S.players.find((x) => x.id === id); return p ? displayName(S, p.n, hide) : "?"; };
// The receipts: the most personal lines we can say about someone's night
export function receipts(S, p, hide) {
  const out = [], r = rivals(S, p), names = (x) => x.ids.map((id) => nameOf(S, id, hide)).join(" & ");
  if (r.nemesis) out.push(`😈 Nemesis: ${names(r.nemesis)}, caught you ${r.nemesis.n}×`);
  if (r.victim) out.push(`🎯 Favourite victim: ${names(r.victim)}, ${r.victim.n}×`);
  const m = p.mission;
  if (m && m.text) out.push(`🤫 “${m.text}” ${m.result === true ? "✅" : m.busted ? `🚨 busted by ${hide ? "someone" : m.bustedBy}` : m.result === false ? "❌" : "(never even tried)"}`);
  const planted = (S.plants || []).filter((x) => x.by === p.id && x.status === "approved" && x.revealed);
  if (planted.length) { const x = planted[0]; out.push(`🎁 Planted “${x.text}”${x.kind === "rule" && x.breaks ? `, ${plural(x.breaks, "catch")}` : ""}`); }
  const cg = comingsAndGoings(S, p); if (cg) out.push(cg);
  return out;
}

/* ---------------- a title for everyone ---------------- */
export const TITLES = {
  menace:  { em: "🚨", t: "Known to Gardaí", d: [
    "Caught more than anyone. Investigations are ongoing.",
    "{caught}. A tribunal will report back in 2041.",
    "{caught}. Still cost the taxpayer less than the bike shed.",
    "{caught}. Still more accountable than the Dáil.",
    "{caught}. Gardaí appealed for witnesses. Nobody came forward.",
  ] },
  escape:  { em: "🏝️", t: "The Tax Exile", d: [
    "Burned the most skip tokens. Contributed nothing.",
    "{skips} used. Effective forfeit rate: 12.5%.",
    "Has a letterbox in Luxembourg and no forfeits.",
    "Paid nothing, owes nothing, lives in Monaco now.",
    "Dodged more than a Revenue audit.",
  ] },
  game:    { em: "👍", t: "Yes Man", d: [
    "Did the most challenges. Couldn't say no.",
    "{chall}. Would've signed off the Children's Hospital budget too.",
    "{chall}. Says yes like a councillor at a planning meeting.",
    "{chall} done, unpaid. Should've joined a union.",
    "Never once said no. Someone check on this person.",
  ] },
  saint:   { em: "😇", t: "Airtight Alibi", d: [
    "Not caught once all night. Suspicious, honestly.",
    "Caught 0 times. Either a saint or has a very good PR firm.",
    "Caught 0 times. An internal review found no wrongdoing.",
    "Caught 0 times. Cleared by an inquiry they set up themselves.",
    "Caught 0 times. The files were lost in a flood.",
  ] },
  early:   { em: "🧳", t: "The Emigrant", d: [
    "Left after pub {pub}. Still talked about.",
    "Left after pub {pub}. Couldn't afford the rent here either.",
    "Left after pub {pub}. Living in Sydney now and won't shut up about it.",
    "Left after pub {pub}. Their mam is devastated.",
    "Gone after pub {pub}. Back at Christmas to complain about the prices.",
  ] },
  late:    { em: "✈️", t: "The Returned Yank", d: [
    "Turned up at pub {pub}, acting like they never left.",
    "Landed at pub {pub}. Asked where the leprechauns were.",
    "Turned up at pub {pub}. Great-grandmother was from here, apparently.",
    "Arrived at pub {pub}. Tried to tip the barman and caused an incident.",
  ] },
  mastermind: { em: "🌱", t: "Green Fingers", d: [
    "Planted the surprise that caught the most people.",
    "Planted the evidence. Nobody can prove it.",
    "Planted it, watered it, denied all knowledge.",
    "Planted a surprise. Planning permission pending since 2019.",
  ] },
  agent:   { em: "🕵️", t: "Keyser Söze", d: [
    "Pulled off the secret mission. And like that, gone.",
    "Pulled off the secret mission. Would make a great Special Adviser.",
    "Mission complete. No paper trail, no receipts, no comment.",
    "Mission complete. Has declined to come before the committee.",
  ] },
  chaos:   { em: "🕺", t: "Uncle at a Wedding", d: [
    "Caught more than most. Someone find them a chair.",
    "{caught}. Has opinions on the government and will share them.",
    "{caught}. Gave a speech nobody asked for.",
    "{caught}. Currently explaining the housing crisis to a stranger.",
  ] },
  steady:  { em: "🦺", t: "The Designated Adult", d: [
    "Kept the head. Mostly.",
    "Kept the head. In this economy.",
    "Kept the head. Somebody has to, the government won't.",
    "Knows where everyone's coat is. Deserves a State funeral.",
    "Minded everyone all night, unpaid, like a student nurse.",
  ] },
  wild:    { em: "🌦️", t: "Irish Weather", d: [
    "Four seasons in one night. Kept everyone guessing.",
    "Went Status Orange without warning.",
    "Forecast said dry. Forecast was wrong.",
    "Bright spells, scattered showers, one incident outside a chipper.",
    "Caused more cancellations than Dublin Bus.",
  ] },
  main:    { em: "🎩", t: "Mayor of the Smoking Area", d: [
    "Knew everyone out there by the end of the night.",
    "Knew everyone out there. Has promised them all a house.",
    "Elected by acclaim. Promised to fix the queue for the jacks. Didn't.",
    "Ran on a platform of 'lend us a lighter'.",
    "Not one of their promises will survive till morning.",
  ] },
  legend:  { em: "🦪", t: "Molly Malone", d: [
    "Made it the whole way. Alive, alive-oh.",
    "Made it the whole way, like a HSE waiting list.",
    "Made it the whole way. Faster than the Luas to Finglas.",
    "Survived all of it. The Children's Hospital still isn't finished.",
  ] },
};
// Same line on everyone's phone and every redraw, but different from night to night
export function titleLine(S, p, key) {
  const lines = TITLES[key].d;
  let h = 0;
  for (const c of `${S.code || ""}|${p.id}|${key}`) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return lines[h % lines.length]
    .replace("{caught}", `Caught ${plural(p.forf, "time")}`)
    .replace("{skips}", plural(p.skips, "skip token"))
    .replace("{chall}", plural(p.chall, "challenge"))
    .replace("{pub}", String((key === "early" ? p.leftPub : p.joinedPub) + 1));
}
// Everyone gets a title. Each person takes the first one that fits them and that nobody has yet,
// so a group of 5 usually gets 5 different titles.
export function titles(S) {
  const ps = S.players, used = new Set(), out = {};
  const uniqueMax = (k) => { const m = Math.max(...ps.map((p) => p[k])); const top = ps.filter((p) => p[k] === m); return m > 0 && top.length === 1 ? top[0].id : null; };
  const avg = ps.reduce((a, p) => a + p.forf, 0) / ps.length;
  const menace = uniqueMax("forf"), escape = uniqueMax("skips"), game = uniqueMax("chall");
  // whose planted surprises caught the most people (unique winner, at least one catch)
  const caughtBy = {};
  for (const x of S.plants || []) if (x.revealed && x.breaks) caughtBy[x.by] = (caughtBy[x.by] || 0) + x.breaks;
  const topCaught = Math.max(0, ...Object.values(caughtBy));
  const masterIds = Object.keys(caughtBy).filter((id) => caughtBy[id] === topCaught);
  const mastermind = topCaught > 0 && masterIds.length === 1 ? masterIds[0] : null;
  const fits = (p) => [
    menace === p.id && "menace", mastermind === p.id && "mastermind", p.leftPub != null && "early", p.joinedPub > 0 && "late",
    escape === p.id && "escape", game === p.id && "game",
    p.forf === 0 && "saint", p.mission && p.mission.result === true && "agent",
    p.forf > avg && "chaos", p.forf <= avg && "steady", "wild", "main", "legend",
  ].filter(Boolean);
  // people with a standout stat pick first
  const order = ps.slice().sort((a, b) => [menace, mastermind, escape, game].includes(b.id) - [menace, mastermind, escape, game].includes(a.id));
  for (const p of order) {
    const opts = fits(p), pick = opts.find((k) => !used.has(k)) || opts[0];
    used.add(pick);
    out[p.id] = { ...TITLES[pick], d: titleLine(S, p, pick) };
  }
  return out;
}

export function recapText(S, hide) {
  const st = nightStats(S), tt = titles(S);
  const lines = [`🍻 ${S.settings.crew ? S.settings.crew + " · " : ""}12 Pubs · ${MODE_LABEL[S.settings.mode]} · ${duration(st.out)} out`, ""];
  const rb = Object.fromEntries(ruleBreaks(S).map((r) => [r.i, r]));
  S.plan.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}${p.arrivedAt ? ` (${time(p.arrivedAt)})` : ""}`);
    const r = rb[i];
    if (r) lines.push(`   📜 ${r.by ? `${displayName(S, r.by, hide)}'s rule: ` : ""}${r.text} · ${r.n ? `broken ${r.n}×` : "nobody broke it"}`);
  });
  lines.push("", ...awards(S, hide).map((a) => `🏆 ${a.t}: ${a.n} (${a.d})`));
  lines.push("", ...S.players.map((p) => `${tt[p.id].em} ${displayName(S, p.n, hide)}: ${tt[p.id].t}${comingsAndGoings(S, p) ? ` (${comingsAndGoings(S, p).toLowerCase()})` : ""}`));
  if (S.settings.missions) {
    lines.push("", "🤫 Secret missions");
    S.players.forEach((p) => { if (p.mission) lines.push(`${p.mission.result === true ? "✅" : p.mission.result === false ? "❌" : "–"} ${displayName(S, p.n, hide)}: ${p.mission.text}`); });
  }
  const planted = (S.plants || []).filter((x) => x.status === "approved");
  if (planted.length) {
    lines.push("", "🎁 Planted surprises");
    planted.forEach((x) => lines.push(`${displayName(S, x.byName, hide)}'s ${x.kind} (pub ${x.pub + 1}): ${x.text}${!x.revealed ? " (never got its moment)" : x.kind === "rule" ? ` · caught ${x.breaks}` : ""}`));
  }
  for (const q of S.quotes || []) lines.push("", `💬 “${q.text}”`);
  lines.push("", "Play yours at 12pubs.ie");
  return lines.join("\n");
}

/* ---------------- drawing ---------------- */
const BIG_GROUP = 12; // above this the recap only shows the extremes
const W = 1080, H = 1920, INK = "#17171a", CREAM = "#fff7e8", WHITE = "#ffffff";
const F = (w, s, fam = "Fredoka") => `${w} ${s}px ${fam}, "Arial Rounded MT Bold", system-ui, sans-serif`;

export async function loadFonts() {
  try { await Promise.all(["700 60px Fredoka", "800 30px Nunito", "700 30px Nunito"].map((f) => document.fonts.load(f))); } catch { /* system fonts */ }
}

function canvas(bg) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const rr = (X, Y, w, h, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
  const g = {
    c, x, rr,
    box(X, Y, w, h, r, fill, sh = 10) {
      if (sh) { x.fillStyle = INK; rr(X + sh, Y + sh, w, h, r); x.fill(); }
      x.fillStyle = fill; rr(X, Y, w, h, r); x.fill();
      x.lineWidth = 6; x.strokeStyle = INK; rr(X, Y, w, h, r); x.stroke();
    },
    text(t, X, Y, font, color = INK, align = "left") { x.font = font; x.fillStyle = color; x.textAlign = align; x.fillText(t, X, Y); x.textAlign = "left"; },
    fit(t, font, max) { x.font = font; if (x.measureText(t).width <= max) return t; while (t.length && x.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; },
    wrap(t, font, max, maxLines = 3) {
      x.font = font; const words = String(t).split(/\s+/); const lines = []; let line = "";
      for (const w of words) { const test = line ? line + " " + w : w; if (x.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test; }
      if (line) lines.push(line);
      if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = g.fit(lines[maxLines - 1] + "…", font, max); }
      return lines;
    },
    sticker(t, X, Y, fill = INK, color = WHITE) {
      x.font = F(700, 30); const w = x.measureText(t).width + 44;
      x.save(); x.translate(X, Y); x.rotate(-0.03);
      x.fillStyle = fill; rr(0, 0, w, 60, 30); x.fill();
      if (fill !== INK) { x.lineWidth = 5; x.strokeStyle = INK; rr(0, 0, w, 60, 30); x.stroke(); }
      x.fillStyle = color; x.fillText(t, 22, 41); x.restore();
    },
    logo(X, Y, s = 1) {
      x.save(); x.translate(X, Y); x.scale(s, s); x.rotate(-0.05);
      x.fillStyle = INK; x.beginPath(); x.arc(78, 78, 72, 0, 7); x.fill();
      x.fillStyle = "#ffd23f"; x.beginPath(); x.arc(70, 70, 72, 0, 7); x.fill(); x.lineWidth = 6; x.strokeStyle = INK; x.stroke();
      x.fillStyle = INK; x.font = F(700, 76); x.textAlign = "center"; x.fillText("12", 70, 96); x.textAlign = "left";
      g.box(160, 18, 250, 110, 22, "#ff7eb6", 8);
      x.fillStyle = INK; x.font = F(700, 78); x.fillText("PUBS", 180, 102);
      x.restore();
    },
    // face: { img } (a photo from this phone), { emoji } or { letter }
    avatar(X, Y, r, color, face) {
      x.fillStyle = INK; x.beginPath(); x.arc(X + r * 0.1, Y + r * 0.1, r, 0, 7); x.fill();
      x.fillStyle = color; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill();
      if (face.img) { x.save(); x.beginPath(); x.arc(X, Y, r, 0, 7); x.clip(); x.drawImage(face.img, X - r, Y - r, r * 2, r * 2); x.restore(); }
      else if (face.emoji) g.text(face.emoji, X, Y + r * 0.38, F(400, r * 1.05, "system-ui"), INK, "center");
      else g.text(face.letter, X, Y + r * 0.36, F(700, r), INK, "center");
      x.lineWidth = 6; x.strokeStyle = INK; x.beginPath(); x.arc(X, Y, r, 0, 7); x.stroke();
    },
    // Scattered confetti shapes for background interest — seeded so slides look identical every render
    confetti(colors, density = 50, seed = 0) {
      let s = (seed * 1664525 + 1013904223) | 0;
      const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
      for (let i = 0; i < density; i++) {
        const px = rng() * W, py = rng() * H, size = 10 + rng() * 22, angle = rng() * Math.PI * 2;
        const type = i % 3; // circle, wide rect, tall rect
        x.save(); x.globalAlpha = 0.11 + rng() * 0.11;
        x.fillStyle = colors[Math.floor(rng() * colors.length)];
        x.translate(px, py); x.rotate(angle);
        if (type === 0) { x.beginPath(); x.arc(0, 0, size / 2, 0, Math.PI * 2); x.fill(); }
        else if (type === 1) { x.fillRect(-size / 2, -size / 4, size, size / 2); }
        else { x.fillRect(-size / 4, -size / 2, size / 2, size); }
        x.restore();
      }
    },
    // Every image carries the address, so anyone who sees a story knows where to go
    footer(t = "12pubs.ie") {
      x.font = F(700, 40); const w = x.measureText(t).width + 60;
      g.box(W / 2 - w / 2, H - 132, w, 70, 35, WHITE, 6);
      g.text(t, W / 2, H - 83, F(700, 40), INK, "center");
    },
  };
  return g;
}

// What to draw in someone's circle. Hiding names hides faces too.
let FACES = {};
const faceOf = (S, p, i, hide) => hide ? { letter: String(i + 1) } : FACES[p.id] ? { img: FACES[p.id] } : p.emoji ? { emoji: p.emoji } : { letter: p.n[0].toUpperCase() };

function slideCover(S, hide) {
  const st = nightStats(S), g = canvas("#ff7eb6");
  g.confetti([WHITE, "#ffd23f", "#6ea8ff", INK], 60, 1);
  g.logo(80, 90);
  const done = st.visited >= 12;
  const big = (t, y) => { let size = 150; while (size > 80) { g.x.font = F(700, size); if (g.x.measureText(t).width <= 920) break; size -= 6; } g.text(t, 80, y, F(700, size)); };
  const crew = (S.settings.crew || "").trim();
  if (crew) g.text(g.fit(crew, F(700, 64), 920), 82, done ? 590 : 570, F(700, 64), WHITE);
  if (done) { big("We made it!", 720); g.text(day(S.startAt), 82, 810, F(700, 40, "Nunito")); }
  else {
    big(`We did ${st.visited} pubs!`, 700);
    g.text(g.fit(`Called it at ${st.lastPub || "the pub"}. Still counts.`, F(700, 40, "Nunito"), 920), 82, 780, F(700, 40, "Nunito"));
    g.text(day(S.startAt), 82, 840, F(700, 36, "Nunito"));
  }
  // the gang
  const n = S.players.length, r = n > 8 ? 52 : n > 5 ? 64 : 80, gap = r * 2 + 26, perRow = Math.floor((W - 160) / gap);
  const faces = n > 14 ? 13 : n; // two rows is all that fits; the rest become "+36"
  S.players.slice(0, faces).forEach((p, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const col_ = playerColor(i) === "#ff7eb6" ? WHITE : playerColor(i); // don't vanish into the pink cover
    g.avatar(80 + r + col * gap, 1040 + row * (gap + 10), r, col_, faceOf(S, p, i, hide));
  });
  if (faces < n) g.avatar(80 + r + (faces % perRow) * gap, 1040 + Math.floor(faces / perRow) * (gap + 10), r, WHITE, { letter: `+${n - faces}` });
  g.box(80, 1460, 920, 240, 32, WHITE);
  g.text(duration(st.out), 130, 1580, F(700, 90));
  g.text(`out · ${n} of you · ${MODE_LABEL[S.settings.mode]}`, 130, 1645, F(700, 36, "Nunito"));
  g.footer();
  return g.c;
}

function slideRoute(S) {
  const g = canvas(CREAM);
  g.confetti([INK, "#ff7eb6", "#ffd23f", "#6ea8ff"], 50, 4);
  g.sticker("THE ROUTE", 80, 90);
  const reached = S.plan.filter((p) => p.arrivedAt).length;
  g.text(reached >= 12 ? "12 pubs." : `${reached} of 12.`, 80, 280, F(700, 110));
  const top = 360, rowH = 92, gap = 18;
  S.plan.forEach((p, i) => {
    const y = top + i * (rowH + gap), ok = !!p.arrivedAt;
    g.x.globalAlpha = ok ? 1 : 0.35;
    g.box(80, y, 920, rowH, 24, pubColor(i, p.type), 6);
    g.text(String(i + 1), 128, y + 62, F(700, 40), INK, "center");
    g.text(g.fit(p.name, F(700, 40), 600), 180, y + 62, F(700, 40));
    g.text(ok ? time(p.arrivedAt) : "–", 970, y + 60, F(700, 32, "Nunito"), INK, "right");
    g.x.globalAlpha = 1;
  });
  g.footer();
  return g.c;
}

function slideRules(S, hide) {
  const list = ruleBreaks(S), total = list.reduce((a, r) => a + r.n, 0), most = Math.max(0, ...list.map((r) => r.n));
  const g = canvas("#4ade80");
  g.confetti([WHITE, "#ffd23f", INK, "#ff7eb6"], 50, 8);
  g.sticker("📜 THE RULES", 80, 90);
  const head = total ? `${plural(total, "rule")} broken.` : "Not one rule broken.";
  let size = 96; g.x.font = F(700, size);
  while (size > 60 && g.x.measureText(head).width > 920) { size -= 4; g.x.font = F(700, size); }
  g.text(head, 80, 270, F(700, size));
  // Rows fit their text; a long night falls back to equal rows so all nine fit
  const top = 340, gap = 18, avail = H - top - 170;
  const layout = (tall) => {
    const nameSize = tall ? 36 : 30, ruleSize = tall ? 32 : 26, lh = Math.round(ruleSize * 1.25), ruleF = F(700, ruleSize, "Nunito");
    const nameAt = nameSize + (tall ? 20 : 16), ruleAt = nameAt + ruleSize + (tall ? 18 : 16); // baselines from the top of the row
    return list.map((r) => {
      const text = `${r.by ? `🎁 ${displayName(S, r.by, hide)}'s: ` : ""}“${r.text}”`;
      const lines = g.wrap(text, ruleF, 720, tall ? 3 : 2);
      return { r, lines, nameSize, ruleF, lh, nameAt, ruleAt, h: ruleAt + (lines.length - 1) * lh + (tall ? 34 : 22) };
    });
  };
  const stack = (rows) => rows.reduce((a, x) => a + x.h, 0) + gap * (rows.length - 1);
  let rows = layout(true);
  if (stack(rows) > avail) rows = layout(false);
  if (stack(rows) > avail) { const h = (avail - gap * (rows.length - 1)) / rows.length; rows.forEach((x) => { x.h = h; x.lines = x.lines.slice(0, Math.max(1, Math.floor((h - x.ruleAt - 12) / x.lh) + 1)); }); }
  let y = top;
  for (const { r, lines, nameSize, ruleF, lh, nameAt, ruleAt, h } of rows) {
    g.box(80, y, 920, h, 26, r.n && r.n === most ? "#ffd23f" : WHITE, 6); // the one that got you is yellow
    const who = r.downfall ? ` · ${r.downfall.ids.map((id) => nameOf(S, id, hide)).join(" & ")}'s downfall` : "";
    const nameF = F(700, nameSize);
    g.text(g.fit(`${r.i + 1} · ${r.name}${who}`, nameF, 740), 120, y + nameAt, nameF);
    lines.forEach((l, j) => g.text(l, 120, y + ruleAt + j * lh, ruleF));
    g.text(r.n ? `${r.n}×` : "0", 960, y + h / 2 + 22, F(700, nameSize > 30 ? 68 : 56), r.n ? INK : "#7a7a7a", "right");
    y += h + gap;
  }
  g.footer();
  return g.c;
}

function slideNumbers(S) {
  const st = nightStats(S), g = canvas("#6ea8ff");
  g.confetti([WHITE, "#ffd23f", "#ff7eb6", INK], 50, 2);
  g.sticker("THE NUMBERS", 80, 90);
  g.text("The damage.", 80, 280, F(700, 110));
  const tiles = [
    [duration(st.out), "out"],
    [String(st.rulesBroken), st.rulesBroken === 1 ? "rule broken" : "rules broken"],
    challengesOn(S) ? [String(st.challenges), "challenges done"] : [`${st.caught} of ${S.players.length}`, "got caught"],
    [String(st.drinks), "drinks, give or take"],
  ];
  tiles.forEach(([big, small], k) => {
    const X = 80 + (k % 2) * 470, Y = 360 + Math.floor(k / 2) * 290;
    g.box(X, Y, 440, 250, 30, WHITE);
    g.text(g.fit(big, F(700, 96), 380), X + 34, Y + 140, F(700, 96));
    g.text(small, X + 36, Y + 200, F(700, 34, "Nunito"));
  });
  let y = 960;
  const wide = (label, main, sub, maxLines = 2) => {
    // shrink long text before cutting it off, so the punchline survives
    let size = 50;
    while (size > 34 && g.wrap(main, F(700, size), 840, 99).length > maxLines) size -= 4;
    const font = F(700, size), lh = Math.round(size * 1.24);
    const lines = g.wrap(main, font, 840, maxLines), h = 120 + lines.length * lh + (sub ? 50 : 0);
    g.box(80, y, 920, h, 30, "#ffd23f");
    g.text(label, 120, y + 66, F(700, 30));
    lines.forEach((l, i) => g.text(l, 120, y + 136 + i * lh, font));
    if (sub) g.text(sub, 120, y + 136 + lines.length * lh + 4, F(700, 32, "Nunito"));
    y += h + 30;
  };
  if (st.ruleThatGotYou) wide("THE RULE THAT GOT YOU", `“${st.ruleThatGotYou.text}”`, `${plural(st.ruleThatGotYou.n, "catch")} at ${st.ruleThatGotYou.pub}`, 3);
  if (st.peak && y < 1500) wide("PEAK CHAOS", `${time(st.peak.at)}${st.peak.pub ? ` at ${st.peak.pub}` : ""}`, `${st.peak.n} forfeits in 10 minutes`);
  if (st.longest && y < 1500) wide("LONGEST STAY", st.longest.name, duration(st.longest.ms));
  if (st.quickest && y < 1500) wide("QUICKEST PINT", st.quickest.name, duration(st.quickest.ms));
  g.footer();
  return g.c;
}

function slideAwards(S, hide) {
  const g = canvas("#ffd23f");
  g.confetti([WHITE, "#ff7eb6", "#6ea8ff", INK], 50, 3);
  g.sticker("THE AWARDS", 80, 90);
  g.text("And the winners…", 80, 280, F(700, 96));
  const colors = ["#ff7eb6", "#4ade80", "#ff8a3d", "#6ea8ff"];
  awards(S, hide).forEach((w, k) => {
    const Y = 360 + k * 360;
    g.box(80, Y, 920, 320, 34, colors[k]);
    g.text(w.t.toUpperCase(), 130, Y + 78, F(700, 34));
    g.text(g.fit(w.n, F(700, 100), 820), 130, Y + 200, F(700, 100));
    g.text(g.fit(w.d, F(700, 36, "Nunito"), 820), 130, Y + 262, F(700, 36, "Nunito"));
  });
  g.footer();
  return g.c;
}

function slideMissions(S, hide) {
  const g = canvas("#b794f6");
  g.confetti([WHITE, "#ffd23f", INK, "#ff7eb6"], 50, 5);
  g.sticker("🤫 SECRET MISSIONS", 80, 90);
  const done = S.players.filter((p) => p.mission && p.mission.result === true).length;
  g.text(`${done} of ${S.players.length} pulled it off.`, 80, 270, F(700, done >= 10 ? 76 : 86));
  // a big group only shows the ones who pulled it off
  const rows = S.players.length > BIG_GROUP ? S.players.filter((p) => p.mission && p.mission.result === true).slice(0, 8) : S.players;
  const n = rows.length, top = 340, avail = H - top - 160, gap = 18, rowH = Math.min(260, (avail - gap * (n - 1)) / n);
  const big = rowH > 170;
  rows.forEach((p, i) => {
    const y = top + i * (rowH + gap);
    g.box(80, y, 920, rowH, 26, WHITE, 6);
    const res = p.mission && p.mission.result === true ? "✅" : p.mission && p.mission.busted ? "🚨" : p.mission && p.mission.result === false ? "❌" : "–";
    g.text(res, 950, y + (big ? 80 : rowH / 2 + 16), F(700, big ? 56 : 40), INK, "right");
    const setBy = p.mission && p.mission.byName && !hide ? ` · set by ${p.mission.byName}` : "";
    g.text(g.fit(displayName(S, p.n, hide) + setBy, F(700, big ? 44 : 34), 720), 120, y + (big ? 70 : rowH / 2 - 4), F(700, big ? 44 : 34));
    const font = F(700, big ? 34 : 26, "Nunito");
    const lines = g.wrap(p.mission ? p.mission.text : "", font, big ? 780 : 760, big ? 3 : 1);
    lines.forEach((l, k) => g.text(l, 120, y + (big ? 124 : rowH / 2 + 32) + k * (big ? 42 : 30), font));
  });
  g.footer();
  return g.c;
}

function slideSurprises(S, hide) {
  const list = (S.plants || []).filter((x) => x.status === "approved"), g = canvas("#ff8a3d");
  g.confetti([WHITE, "#ffd23f", INK, "#6ea8ff"], 50, 6);
  g.sticker("🎁 PLANTED SURPRISES", 80, 90);
  const caught = list.reduce((a, x) => a + (x.breaks || 0), 0);
  g.text(caught ? `${plural(caught, "catch")}.` : "Sneaky.", 80, 270, F(700, 96));
  const rows = list.length > 5 ? list.slice().sort((a, b) => (b.breaks || 0) - (a.breaks || 0)).slice(0, 5) : list; // the five that did the most damage
  const n = rows.length, top = 330, gap = 22, rowH = Math.min(300, (H - top - 170 - gap * (n - 1)) / n);
  rows.forEach((x, k) => {
    const y = top + k * (rowH + gap);
    const who = hide ? "Player " + (S.players.findIndex((p) => p.id === x.by) + 1) : x.byName;
    g.box(80, y, 920, rowH, 28, WHITE, 6);
    g.text(g.fit(`${who}'s ${x.kind} · Pub ${x.pub + 1}`, F(700, 34), 820), 120, y + 56, F(700, 34));
    const lines = g.wrap(`“${x.text}”`, F(700, rowH > 220 ? 38 : 30, "Nunito"), 840, rowH > 220 ? 3 : 2);
    lines.forEach((l, j) => g.text(l, 120, y + 106 + j * (rowH > 220 ? 46 : 36), F(700, rowH > 220 ? 38 : 30, "Nunito")));
    const res = !x.revealed ? "Never got its moment 😢" : x.kind === "rule" ? (x.breaks ? `${plural(x.breaks, "catch")} 😈` : "Nobody got caught 😇") : x.state === "done" ? "Done ✅" : "Dodged 🫣";
    g.text(res, 120, y + rowH - 30, F(700, 30), "#a8322d");
  });
  g.footer();
  return g.c;
}

function slideQuotes(S, hide) {
  const qs = (S.quotes || []).slice(-3).reverse(), g = canvas("#2dd4bf");
  g.confetti([WHITE, "#ffd23f", INK, "#ff7eb6"], 50, 7);
  g.sticker("💬 QUOTE OF THE NIGHT", 80, 90);
  g.text(qs.length > 1 ? "Overheard." : "Said out loud.", 80, 270, F(700, 96));
  const one = qs.length === 1, size = one ? 76 : 50, lh = Math.round(size * 1.2);
  let y = 340;
  qs.forEach((q) => {
    const lines = g.wrap(`“${q.text}”`, F(700, size), 820, one ? 6 : 3);
    const h = 90 + lines.length * lh + 40;
    g.box(80, y, 920, h, 32, WHITE);
    lines.forEach((l, k) => g.text(l, 130, y + 50 + lh + k * lh - 10, F(700, size)));
    g.text(hide ? "" : `added by ${q.byName}`, 130, y + h - 36, F(700, 30, "Nunito"), "#555");
    y += h + 30;
  });
  g.footer();
  return g.c;
}

function slidePlayer(S, p, i, hide) {
  const tt = titles(S)[p.id], name = displayName(S, p.n, hide), g = canvas(playerColor(i));
  const rank = 1 + S.players.filter((x) => x.forf > p.forf).length; // ties share a rank
  g.confetti([WHITE, INK, "#ffd23f"], 45, i + 10);
  g.logo(80, 80, 0.62);
  const tag = g.fit((S.settings.crew || "MY 12 PUBS").toUpperCase(), F(700, 30), 420);
  g.x.font = F(700, 30); g.sticker(tag, W - 80 - (g.x.measureText(tag).width + 44), 108, WHITE, INK);
  g.avatar(W / 2, 470, 150, WHITE, faceOf(S, p, i, hide));
  g.text(g.fit(name, F(700, 120), 920), W / 2, 760, F(700, 120), INK, "center");
  // the title
  g.box(80, 820, 920, 400, 36, WHITE);
  g.text(tt.em, W / 2, 960, F(700, 110), INK, "center");
  let titleSize = 84;
  g.x.font = F(700, titleSize);
  while (titleSize > 52 && g.x.measureText(tt.t).width > 840) { titleSize -= 4; g.x.font = F(700, titleSize); }
  g.text(g.fit(tt.t, F(700, titleSize), 840), W / 2, 1060, F(700, titleSize), INK, "center");
  g.wrap(tt.d, F(700, 36, "Nunito"), 820, 2).forEach((l, k) => g.text(l, W / 2, 1120 + k * 46, F(700, 36, "Nunito"), INK, "center"));
  // stats
  const mission = S.settings.missions && p.mission ? (p.mission.result === true ? "✅" : p.mission.result === false ? "❌" : "–") : null;
  const pubs = attended(S, p);
  const tiles = [[String(p.forf), p.forf === 1 ? "forfeit" : "forfeits"]];
  if (challengesOn(S)) tiles.push([String(p.chall), p.chall === 1 ? "challenge" : "challenges"]);
  tiles.push([String(pubs), pubs === 1 ? "pub" : "pubs"]);
  tiles.push(mission ? [mission, "mission"] : [String(p.skips), "skips used"]);
  const tw = (920 - 24 * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([big, small], k) => {
    const X = 80 + k * (tw + 24);
    g.box(X, 1280, tw, 230, 28, "#fff7e8", 8);
    g.text(big, X + tw / 2, 1410, F(700, 96), INK, "center");
    g.text(small, X + tw / 2, 1470, F(700, 30, "Nunito"), INK, "center");
  });
  const joint = S.players.filter((x) => x.forf === p.forf).length > 1;
  g.text(p.forf ? `${joint ? "Joint " : ""}#${rank} most caught of ${S.players.length}` : "Never caught. Not once.", W / 2, 1584, F(700, 44), INK, "center");
  const lines = receipts(S, p, hide).slice(0, 3);
  if (!lines.length) lines.push(day(S.startAt));
  lines.forEach((l, k) => g.text(g.fit(l, F(700, 32, "Nunito"), 900), W / 2, 1642 + k * 44, F(700, 32, "Nunito"), INK, "center"));
  g.footer("Get yours at 12pubs.ie");
  return g.c;
}

// Every slide, in order. Players see their own card first.
export async function buildSlides(S, hide, myId, photos = {}) {
  await loadFonts();
  FACES = {};
  await Promise.all(Object.entries(photos).map(([id, url]) => new Promise((res) => {
    const im = new Image(); im.onload = () => { FACES[id] = im; res(); }; im.onerror = res; im.src = url;
  })));
  const group = [
    { key: "night", label: "The night", draw: () => slideCover(S, hide) },
    { key: "route", label: "The route", draw: () => slideRoute(S) },
    ...(ruleBreaks(S).length ? [{ key: "rules", label: "The rules", draw: () => slideRules(S, hide) }] : []),
    { key: "numbers", label: "The numbers", draw: () => slideNumbers(S) },
    { key: "awards", label: "The awards", draw: () => slideAwards(S, hide) },
    ...(S.settings.missions ? [{ key: "missions", label: "Secret missions", draw: () => slideMissions(S, hide) }] : []),
    ...((S.plants || []).some((x) => x.status === "approved") ? [{ key: "surprises", label: "Planted surprises", draw: () => slideSurprises(S, hide) }] : []),
    ...((S.quotes || []).length ? [{ key: "quotes", label: "Quote of the night", draw: () => slideQuotes(S, hide) }] : []),
  ];
  const people = S.players.map((p, i) => ({
    key: hide ? `player-${i + 1}` : p.n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: p.id === myId ? "Your card" : `${displayName(S, p.n, hide)}'s card`,
    draw: () => slidePlayer(S, p, i, hide),
    mine: p.id === myId,
  }));
  // A big group gets your own card plus the extremes, not 49 cards
  let shown = people;
  if (S.players.length > BIG_GROUP) {
    // a clear winner gets a card; a ten-way tie isn't an extreme
    const top = (k) => { const m = Math.max(...S.players.map((p) => p[k])), t = S.players.filter((p) => p[k] === m); return m > 0 && t.length <= 3 ? t.map((p) => p.id) : []; };
    const stars = new Set([...top("forf"), ...top("chall"), ...top("skips")]);
    shown = people.filter((x, i) => x.mine || stars.has(S.players[i].id));
  }
  const mine = shown.filter((x) => x.mine), rest = shown.filter((x) => !x.mine);
  return [...mine, ...group, ...rest];
}
