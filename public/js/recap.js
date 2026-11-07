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
function dist(a, b) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nightStats(S) {
  const visited = S.plan.map((p, i) => ({ ...p, i })).filter((p) => p.arrivedAt);
  const end = S.endAt || Date.now();
  const stays = visited.map((p, k) => ({ name: p.name, ms: (k + 1 < visited.length ? visited[k + 1].arrivedAt : end) - p.arrivedAt }));
  const longest = stays.length > 1 ? stays.reduce((a, b) => (b.ms > a.ms ? b : a)) : null;
  const quickest = stays.length > 1 ? stays.slice(0, -1).reduce((a, b) => (b.ms < a.ms ? b : a)) : null; // the finale doesn't count
  const rulePubs = visited.filter((p) => p.type === "rule");
  const worst = rulePubs.reduce((a, b) => ((b.forf || 0) > (a ? a.forf || 0 : 0) ? b : a), null);
  let challenges = 0;
  for (const p of visited) for (const c of [p.arrive, p.drop]) if (c && c.state === "done") challenges++;
  let km = null;
  if (visited.length > 1 && visited.every((p) => typeof p.lat === "number" && typeof p.lng === "number")) {
    let m = 0;
    for (let k = 1; k < visited.length; k++) m += dist(visited[k - 1], visited[k]);
    km = +((m * 1.35) / 1000).toFixed(1);
  }
  const plants = (S.plants || []).filter((x) => x.status === "approved");
  return {
    visited: visited.length,
    lastPub: visited.length ? visited[visited.length - 1].name : null,
    plants,
    out: S.startAt ? end - S.startAt : 0,
    forfeits: S.players.reduce((a, p) => a + p.forf, 0),
    skips: S.players.reduce((a, p) => a + p.skips, 0),
    challenges, km, longest, quickest,
    ruleThatGotYou: worst && worst.forf ? { text: worst.rule.text, pub: worst.name, n: worst.forf } : null,
  };
}

export function awards(S, hide) {
  const ps = S.players, label = (n) => displayName(S, n, hide);
  const most = ps.slice().sort((a, b) => b.forf - a.forf)[0];
  // cleanest record only counts people who were there for at least half the night
  const visited = S.plan.filter((x) => x.arrivedAt).length;
  const stayers = ps.filter((p) => attended(S, p) >= Math.ceil(visited / 2));
  const clean = (stayers.length ? stayers : ps).slice().sort((a, b) => a.forf - b.forf)[0];
  const skipper = ps.slice().sort((a, b) => b.skips - a.skips)[0];
  const messy = S.plan.slice().sort((a, b) => (b.forf || 0) - (a.forf || 0))[0];
  const list = [
    { t: "Most forfeits", n: most.forf ? label(most.n) : "Nobody", d: most.forf ? plural(most.forf, "forfeit") : "A clean night?!" },
    { t: "Cleanest record", n: label(clean.n), d: plural(clean.forf, "forfeit") },
    { t: "Messiest pub", n: messy.forf ? messy.name : "None", d: messy.forf ? plural(messy.forf, "forfeit") + " handed out" : "Saints, all of you" },
  ];
  if (S.settings.missions) {
    const done = ps.filter((p) => p.mission && p.mission.result === true).map((p) => label(p.n));
    list.push({ t: "Secret agents",
      n: done.length ? (done.length <= 2 ? done.join(" & ") : `${done.length} of ${ps.length}`) : "Nobody",
      d: done.length > 2 ? done.join(", ") : done.length ? `${done.length} of ${ps.length} missions done` : "Every mission failed" });
  } else {
    list.push({ t: "Escape artist", n: skipper.skips ? label(skipper.n) : "Nobody", d: skipper.skips ? plural(skipper.skips, "skip token") + " used" : "Nobody bottled it" });
  }
  return list;
}

/* ---------------- a title for everyone ---------------- */
const TITLES = {
  menace:  { em: "😈", t: "The Menace", d: "Caught more than anyone. Rules were more of a suggestion." },
  escape:  { em: "🎟", t: "The Escape Artist", d: "Burned the most skip tokens. Slippery." },
  game:    { em: "🎯", t: "Up For Anything", d: "Did the most challenges. Absolute legend." },
  saint:   { em: "😇", t: "The Saint", d: "Not caught once all night. Suspicious, honestly." },
  early:   { em: "🛌", t: "The Early Exit", d: "Tapped out early. Respect." },
  late:    { em: "⏰", t: "The Late Arrival", d: "Turned up late and still made it count." },
  mastermind: { em: "🎁", t: "The Mastermind", d: "Planted the surprise that caught the most people. Evil." },
  agent:   { em: "🕵️", t: "Secret Agent", d: "Pulled off the secret mission without getting rumbled." },
  chaos:   { em: "🌪️", t: "Chaos Merchant", d: "Caught more than most. Kept the night interesting." },
  steady:  { em: "🧘", t: "Steady Hand", d: "Kept the head. Mostly." },
  wild:    { em: "🃏", t: "The Wildcard", d: "Impossible to predict. Kept everyone guessing." },
  main:    { em: "🌟", t: "Main Character", d: "The night revolved around you. Obviously." },
  legend:  { em: "🍻", t: "The Legend", d: "Made it the whole way. Respect." },
};
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
    out[p.id] = pick === "early" ? { ...TITLES.early, d: `Tapped out after pub ${p.leftPub + 1}. Respect.` }
      : pick === "late" ? { ...TITLES.late, d: `Turned up at pub ${p.joinedPub + 1} and still made it count.` } : TITLES[pick];
  }
  return out;
}

export function recapText(S, hide) {
  const st = nightStats(S), tt = titles(S);
  const lines = [`🍻 12 Pubs · ${MODE_LABEL[S.settings.mode]} · ${duration(st.out)} out`, ""];
  S.plan.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.arrivedAt ? ` (${time(p.arrivedAt)})` : ""}`));
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
  lines.push("", "Play yours at 12pubs.ie");
  return lines.join("\n");
}

/* ---------------- drawing ---------------- */
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
  g.logo(80, 90);
  const done = st.visited >= 12;
  const big = (t, y) => { let size = 150; while (size > 80) { g.x.font = F(700, size); if (g.x.measureText(t).width <= 920) break; size -= 6; } g.text(t, 80, y, F(700, size)); };
  if (done) { big("We made it!", 720); g.text(day(S.startAt), 82, 810, F(700, 40, "Nunito")); }
  else {
    big(`We did ${st.visited} pubs!`, 700);
    g.text(g.fit(`Called it at ${st.lastPub || "the pub"}. Still counts.`, F(700, 40, "Nunito"), 920), 82, 780, F(700, 40, "Nunito"));
    g.text(day(S.startAt), 82, 840, F(700, 36, "Nunito"));
  }
  // the gang
  const n = S.players.length, r = n > 8 ? 52 : n > 5 ? 64 : 80, gap = r * 2 + 26, perRow = Math.floor((W - 160) / gap);
  S.players.forEach((p, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const col_ = playerColor(i) === "#ff7eb6" ? WHITE : playerColor(i); // don't vanish into the pink cover
    g.avatar(80 + r + col * gap, 1040 + row * (gap + 10), r, col_, faceOf(S, p, i, hide));
  });
  g.box(80, 1460, 920, 240, 32, WHITE);
  g.text(duration(st.out), 130, 1580, F(700, 90));
  g.text(`out · ${n} of you · ${MODE_LABEL[S.settings.mode]}`, 130, 1645, F(700, 36, "Nunito"));
  g.footer();
  return g.c;
}

function slideRoute(S) {
  const g = canvas(CREAM);
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

function slideNumbers(S) {
  const st = nightStats(S), g = canvas("#6ea8ff");
  g.sticker("THE NUMBERS", 80, 90);
  g.text("The damage.", 80, 280, F(700, 110));
  const tiles = [
    [duration(st.out), "out"],
    [String(st.forfeits), "forfeits"],
    [String(st.challenges), "challenges done"],
    [st.km != null ? `${st.km} km` : String(st.skips), st.km != null ? "walked" : "skip tokens used"],
  ];
  tiles.forEach(([big, small], k) => {
    const X = 80 + (k % 2) * 470, Y = 360 + Math.floor(k / 2) * 290;
    g.box(X, Y, 440, 250, 30, WHITE);
    g.text(g.fit(big, F(700, 96), 380), X + 34, Y + 140, F(700, 96));
    g.text(small, X + 36, Y + 200, F(700, 34, "Nunito"));
  });
  let y = 960;
  const wide = (label, main, sub) => {
    const lines = g.wrap(main, F(700, 50), 840, 2), h = 120 + lines.length * 62 + (sub ? 50 : 0);
    g.box(80, y, 920, h, 30, "#ffd23f");
    g.text(label, 120, y + 66, F(700, 30));
    lines.forEach((l, i) => g.text(l, 120, y + 136 + i * 62, F(700, 50)));
    if (sub) g.text(sub, 120, y + 136 + lines.length * 62 + 4, F(700, 32, "Nunito"));
    y += h + 30;
  };
  if (st.ruleThatGotYou) wide("THE RULE THAT GOT YOU", `“${st.ruleThatGotYou.text}”`, `${plural(st.ruleThatGotYou.n, "catch")} at ${st.ruleThatGotYou.pub}`);
  if (st.longest && y < 1500) wide("LONGEST STAY", st.longest.name, duration(st.longest.ms));
  if (st.quickest && y < 1500) wide("QUICKEST PINT", st.quickest.name, duration(st.quickest.ms));
  g.footer();
  return g.c;
}

function slideAwards(S, hide) {
  const g = canvas("#ffd23f");
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
  g.sticker("🤫 SECRET MISSIONS", 80, 90);
  const done = S.players.filter((p) => p.mission && p.mission.result === true).length;
  g.text(`${done} of ${S.players.length} pulled it off.`, 80, 270, F(700, done >= 10 ? 76 : 86));
  const n = S.players.length, top = 340, avail = H - top - 160, gap = 18, rowH = Math.min(260, (avail - gap * (n - 1)) / n);
  const big = rowH > 170;
  S.players.forEach((p, i) => {
    const y = top + i * (rowH + gap);
    g.box(80, y, 920, rowH, 26, WHITE, 6);
    const res = p.mission && p.mission.result === true ? "✅" : p.mission && p.mission.result === false ? "❌" : "–";
    g.text(res, 950, y + (big ? 80 : rowH / 2 + 16), F(700, big ? 56 : 40), INK, "right");
    g.text(g.fit(displayName(S, p.n, hide), F(700, big ? 44 : 34), 720), 120, y + (big ? 70 : rowH / 2 - 4), F(700, big ? 44 : 34));
    const font = F(700, big ? 34 : 26, "Nunito");
    const lines = g.wrap(p.mission ? p.mission.text : "", font, big ? 780 : 760, big ? 3 : 1);
    lines.forEach((l, k) => g.text(l, 120, y + (big ? 124 : rowH / 2 + 32) + k * (big ? 42 : 30), font));
  });
  g.footer();
  return g.c;
}

function slideSurprises(S, hide) {
  const list = (S.plants || []).filter((x) => x.status === "approved"), g = canvas("#ff8a3d");
  g.sticker("🎁 PLANTED SURPRISES", 80, 90);
  const caught = list.reduce((a, x) => a + (x.breaks || 0), 0);
  g.text(caught ? `They caught ${caught}.` : "Sneaky.", 80, 270, F(700, 96));
  const n = list.length, top = 330, gap = 22, rowH = Math.min(300, (H - top - 170 - gap * (n - 1)) / n);
  list.forEach((x, k) => {
    const y = top + k * (rowH + gap);
    const who = hide ? "Player " + (S.players.findIndex((p) => p.id === x.by) + 1) : x.byName;
    g.box(80, y, 920, rowH, 28, WHITE, 6);
    g.text(g.fit(`${who}'s ${x.kind} · Pub ${x.pub + 1}`, F(700, 34), 820), 120, y + 56, F(700, 34));
    const lines = g.wrap(`“${x.text}”`, F(700, rowH > 220 ? 38 : 30, "Nunito"), 840, rowH > 220 ? 3 : 2);
    lines.forEach((l, j) => g.text(l, 120, y + 106 + j * (rowH > 220 ? 46 : 36), F(700, rowH > 220 ? 38 : 30, "Nunito")));
    const res = !x.revealed ? "Never got its moment 😢" : x.kind === "rule" ? (x.breaks ? `Caught ${x.breaks} ${x.breaks === 1 ? "person" : "people"} 😈` : "Nobody got caught 😇") : x.state === "done" ? "Done ✅" : "Dodged 🫣";
    g.text(res, 120, y + rowH - 30, F(700, 30), "#a8322d");
  });
  g.footer();
  return g.c;
}

function slidePlayer(S, p, i, hide) {
  const tt = titles(S)[p.id], name = displayName(S, p.n, hide), g = canvas(playerColor(i));
  const rank = 1 + S.players.filter((x) => x.forf > p.forf).length; // ties share a rank
  g.logo(80, 80, 0.62);
  g.sticker("MY 12 PUBS", 760 - 60, 108, WHITE, INK);
  g.avatar(W / 2, 470, 150, WHITE, faceOf(S, p, i, hide));
  g.text(g.fit(name, F(700, 120), 920), W / 2, 760, F(700, 120), INK, "center");
  // the title
  g.box(80, 820, 920, 400, 36, WHITE);
  g.text(tt.em, W / 2, 960, F(700, 110), INK, "center");
  g.text(g.fit(tt.t, F(700, 84), 840), W / 2, 1060, F(700, 84), INK, "center");
  g.wrap(tt.d, F(700, 36, "Nunito"), 820, 2).forEach((l, k) => g.text(l, W / 2, 1120 + k * 46, F(700, 36, "Nunito"), INK, "center"));
  // stats
  const mission = S.settings.missions && p.mission ? (p.mission.result === true ? "✅" : p.mission.result === false ? "❌" : "–") : null;
  const pubs = attended(S, p);
  const tiles = [[String(p.forf), p.forf === 1 ? "forfeit" : "forfeits"], [String(p.chall), p.chall === 1 ? "challenge" : "challenges"], [String(pubs), pubs === 1 ? "pub" : "pubs"]];
  tiles.push(mission ? [mission, "mission"] : [String(p.skips), "skips used"]);
  const tw = (920 - 24 * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([big, small], k) => {
    const X = 80 + k * (tw + 24);
    g.box(X, 1280, tw, 230, 28, "#fff7e8", 8);
    g.text(big, X + tw / 2, 1410, F(700, 96), INK, "center");
    g.text(small, X + tw / 2, 1470, F(700, 30, "Nunito"), INK, "center");
  });
  const joint = S.players.filter((x) => x.forf === p.forf).length > 1;
  g.text(p.forf ? `${joint ? "Joint " : ""}#${rank} most caught of ${S.players.length}` : "Never caught. Not once.", W / 2, 1610, F(700, 44), INK, "center");
  g.text(comingsAndGoings(S, p) || day(S.startAt), W / 2, 1666, F(700, 32, "Nunito"), INK, "center");
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
    { key: "numbers", label: "The numbers", draw: () => slideNumbers(S) },
    { key: "awards", label: "The awards", draw: () => slideAwards(S, hide) },
    ...(S.settings.missions ? [{ key: "missions", label: "Secret missions", draw: () => slideMissions(S, hide) }] : []),
    ...((S.plants || []).some((x) => x.status === "approved") ? [{ key: "surprises", label: "Planted surprises", draw: () => slideSurprises(S, hide) }] : []),
  ];
  const people = S.players.map((p, i) => ({
    key: hide ? `player-${i + 1}` : p.n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: p.id === myId ? "Your card" : `${displayName(S, p.n, hide)}'s card`,
    draw: () => slidePlayer(S, p, i, hide),
    mine: p.id === myId,
  }));
  const mine = people.filter((x) => x.mine), rest = people.filter((x) => !x.mine);
  return [...mine, ...group, ...rest];
}
