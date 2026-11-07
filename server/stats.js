// Usage counts. Numbers only: no names, no room codes, no IP addresses, no cookies.
// Kept per day (Irish time) in data/stats.json, separately from rooms, so they outlive the 24h room cleanup.
import fs from "node:fs";
import path from "node:path";

const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" }); // YYYY-MM-DD
const blankDay = () => ({ visits: 0, created: 0, started: 0, finished: 0, finishedAll: 0, players: 0, joins: 0, pubs: 0, downloads: 0, shares: 0, missionsOn: 0, plants: 0, plantsPlayed: 0, lateJoins: 0, leftEarly: 0, handovers: 0, modes: {}, sources: {} });

export class Stats {
  constructor(file) {
    this.file = file;
    this.days = {};
    this.timer = null;
    if (file) {
      try { this.days = JSON.parse(fs.readFileSync(file, "utf8")).days || {}; }
      catch (e) { if (e.code !== "ENOENT") console.error("Couldn't read stats:", e.message); }
    }
  }
  day(t) { const k = dayKey(t); return (this.days[k] ||= blankDay()); }
  bump(field, n = 1, t) { const d = this.day(t); d[field] = (d[field] || 0) + n; this.save(); }
  tally(field, value, t) { const d = this.day(t); d[field][value] = (d[field][value] || 0) + 1; this.save(); }

  // What happened, in one place, called from the server's socket handlers
  nightCreated(state, pubSource, t) {
    const d = this.day(t);
    d.created++; d.players += state.players.length;
    d.modes[state.settings.mode] = (d.modes[state.settings.mode] || 0) + 1;
    d.sources[pubSource] = (d.sources[pubSource] || 0) + 1;
    if (state.settings.missions) d.missionsOn++;
    this.save();
  }
  nightFinished(state, t) {
    const d = this.day(t), reached = state.plan.filter((p) => p.arrivedAt).length;
    d.finished++; d.pubs += reached;
    if (reached >= 12) d.finishedAll++;
    this.save();
  }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + ".tmp", JSON.stringify({ days: this.days }));
        fs.renameSync(this.file + ".tmp", this.file);
      } catch (e) { console.error("Couldn't save stats:", e.message); }
    }, 2000);
  }

  summary(days = 30, now = Date.now()) {
    const keys = Array.from({ length: days }, (_, i) => dayKey(now - (days - 1 - i) * 86400000));
    const series = keys.map((k) => ({ day: k, ...blankDay(), ...(this.days[k] || {}) }));
    const total = blankDay();
    for (const d of Object.values(this.days)) {
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === "number") total[k] = (total[k] || 0) + v;
        else for (const [kk, vv] of Object.entries(v)) total[k][kk] = (total[k][kk] || 0) + vv;
      }
    }
    return { total, series, since: Object.keys(this.days).sort()[0] || null };
  }
}

/* ---------------- the dashboard page ---------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");

export function dashboardHtml({ total: T, series, since }) {
  const avgGroup = T.created ? (T.players / T.created).toFixed(1) : "–";
  const max = Math.max(1, ...series.map((d) => d.created));
  const bars = series.map((d, i) => `<div class="b" title="${d.day}: ${d.created} nights, ${d.visits} visits"><i style="height:${(d.created / max) * 100}%"></i><span>${i % 5 === 0 || i === series.length - 1 ? d.day.slice(8) : "&nbsp;"}</span></div>`).join("");
  const split = (obj, labels) => {
    const sum = Object.values(obj).reduce((a, b) => a + b, 0);
    return Object.entries(labels).map(([k, l]) => `<div class="mrow"><b>${l}</b><span class="res">${obj[k] || 0} · ${pct(obj[k] || 0, sum)}</span></div>`).join("");
  };
  const tile = (n, l, c) => `<div class="award" style="background:var(--${c})"><span class="label">${l}</span><b>${n}</b></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>12 Pubs · stats</title><link rel="stylesheet" href="/css/styles.css">
<style>.chart{display:flex;align-items:flex-end;gap:3px;height:160px;margin-top:8px;overflow:hidden}.b{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}
.b i{display:block;width:100%;min-height:2px;background:var(--pink);border:2px solid var(--ink);border-radius:6px 6px 0 0}.b span{font:700 10px var(--display);white-space:nowrap}
.funnel .mrow b{flex:1}</style></head><body><div class="wrap" style="padding-bottom:40px">
<div class="topbar"><div class="minilogo"><span>12</span>PUBS</div><span class="codechip">STATS</span></div>
<h2>How it's going</h2><p class="muted" style="margin:6px 0 18px">${since ? `Counting since ${esc(since)}.` : "Nothing yet. Go play a night!"} Numbers only, nothing personal.</p>
<div class="awards" style="margin-bottom:16px">
  ${tile(T.created, "Nights created", "pink")}${tile(T.finished, "Nights finished", "green")}
  ${tile(T.players, "Players", "blue")}${tile(T.visits, "Visits", "yellow")}
</div>
<div class="card"><h3 style="font-size:20px">Nights per day · last ${series.length} days</h3><div class="chart">${bars}</div></div>
<div class="card funnel"><h3 style="font-size:20px;margin-bottom:8px">Funnel</h3>
  <div class="mrow"><b>Visited the site</b><span class="res">${T.visits}</span></div>
  <div class="mrow"><b>Created a night</b><span class="res">${T.created} · ${pct(T.created, T.visits)}</span></div>
  <div class="mrow"><b>Started it</b><span class="res">${T.started} · ${pct(T.started, T.created)}</span></div>
  <div class="mrow"><b>Got to the recap</b><span class="res">${T.finished} · ${pct(T.finished, T.started)}</span></div>
  <div class="mrow"><b>Did all 12 pubs</b><span class="res">${T.finishedAll} · ${pct(T.finishedAll, T.finished)}</span></div>
  <div class="mrow"><b>Downloaded a recap image</b><span class="res">${T.downloads} images · ${T.shares} shares</span></div>
</div>
<div class="card"><h3 style="font-size:20px;margin-bottom:8px">Groups</h3>
  <div class="mrow"><b>Average group</b><span class="res">${avgGroup} people</span></div>
  <div class="mrow"><b>Mates who joined on their own phone</b><span class="res">${T.joins} · ${pct(T.joins, T.players)} of players</span></div>
  <div class="mrow"><b>Secret missions on</b><span class="res">${pct(T.missionsOn, T.created)} of nights</span></div>
  <div class="mrow"><b>Surprises planted</b><span class="res">${T.plants} · ${T.plantsPlayed} popped up</span></div>
  <div class="mrow"><b>Comings and goings</b><span class="res">${T.lateJoins} joined late · ${T.leftEarly} left early · ${T.handovers} host swaps</span></div>
  <div class="mrow"><b>Average pubs reached</b><span class="res">${T.finished ? (T.pubs / T.finished).toFixed(1) : "–"}</span></div>
</div>
<div class="card"><h3 style="font-size:20px;margin-bottom:8px">Difficulty</h3>${split(T.modes, { chill: "😇 Chill", classic: "🍺 Classic", hard: "😈 Savage" })}</div>
<div class="card"><h3 style="font-size:20px;margin-bottom:8px">Pubs</h3>${split(T.sources, { go: "🎲 Named as they went", type: "✍️ Typed their route", dublin: "🇮🇪 Dublin preset" })}</div>
<p class="center small muted">Raw numbers: <a href="/stats.json">/stats.json</a></p>
</div></body></html>`;
}
