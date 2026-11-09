import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../server/game.js";
import { createRoomState, publicState, HOST_ACTIONS as H, claimPlayer, myMission, swapMission, revealDrop, addPlant, myPlants, removePlant, nextEventAt, revealDue, isHere, makeTakeover, useTakeover, selfJoin, reportCatch, ownForfeit } from "../server/room.js";

const settings = (o = {}) => ({ mode: "classic", cats: G.CATS.slice(), missions: true, surprise: true, drinkF: false, tokens: 2, ...o });
const room = (o = {}) => createRoomState("TEST", { settings: settings(o), players: ["Harry", "Aoife", "Cian", "Niamh"], pubs: [{ name: "The Crane Bar" }] });

test("content loaded", () => {
  assert.ok(G.RULES.length > 30);
  assert.ok(G.CHALLENGES.length > 30);
  assert.ok(G.FORFEITS.length > 20);
  assert.ok(G.MISSIONS.length >= 20);
  assert.deepEqual(Object.keys(G.SPECIALS).sort(), ["finale", "food", "water"]);
});

test("plan: 12 pubs, stops in the right places, no repeated rules", () => {
  for (const mode of Object.keys(G.MODES)) for (let k = 0; k < 50; k++) {
    const plan = G.buildPlan(settings({ mode }), Array.from({ length: 12 }, (_, i) => ({ name: "P" + i })));
    assert.equal(plan.length, 12);
    assert.equal(plan[3].type, "water"); assert.equal(plan[7].type, "food"); assert.equal(plan[11].type, "finale");
    const ids = plan.filter((p) => p.rule).map((p) => p.rule.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!plan[0].rule.id.startsWith("r042"), "seat swap never at pub 1");
    for (const p of plan) if (p.rule) assert.ok(G.MODES[mode].rw[p.rule.int] > 0, `${mode} picked a rule it shouldn't`);
  }
});

test("drinking forfeits only when switched on", () => {
  for (let k = 0; k < 300; k++) assert.ok(!G.pickForfeit(settings()).id.startsWith("f00"));
  const seen = new Set(Array.from({ length: 500 }, () => G.pickForfeit(settings({ mode: "hard", drinkF: true })).id));
  assert.ok([...seen].some((id) => id.startsWith("f00")));
});

test("forfeit re-roll is same intensity or harder", () => {
  for (let k = 0; k < 200; k++) {
    const f = G.pickForfeit(settings({ mode: "hard" }), 2, "f041");
    assert.ok(f.int >= 2); assert.notEqual(f.id, "f041");
  }
});

test("missions: everyone gets a different one, never about themselves", () => {
  const s = room();
  const bases = s.players.map((p) => p.mission.base);
  assert.equal(new Set(bases).size, bases.length);
  for (const p of s.players) assert.ok(!p.mission.text.includes(p.n));
});

test("room input is validated", () => {
  assert.throws(() => createRoomState("X", { players: [] }), /your name/);
  const solo = createRoomState("X", { settings: settings(), players: ["Solo"] });
  assert.throws(() => H.start(solo), /one more person/);
  const s = createRoomState("X", { settings: { mode: "nope", tokens: 9, cats: ["bogus"] }, players: ["A", "a", " B "] });
  assert.equal(s.settings.mode, "classic"); assert.equal(s.settings.tokens, 2); assert.deepEqual(s.settings.cats, G.CATS);
  assert.deepEqual(s.players.map((p) => p.n), ["A", "a 2", "B"]);
  assert.equal(s.plan[0].name, "Pub 1");
});

test("public state hides secrets", () => {
  const s = room();
  const pub = JSON.stringify(publicState(s));
  assert.ok(!pub.includes(s.hostToken));
  for (const p of s.players) assert.ok(!pub.includes(p.mission.text));
  for (const p of s.plan) if (p.arrive) assert.ok(!pub.includes(p.arrive.text), "challenge leaked before arriving");
});

test("a full night", () => {
  const s = room();
  H.start(s); assert.equal(s.phase, "missions");
  H.peek(s, { playerId: "p0" }); assert.ok(s.players[0].mission.seen);
  const tok = claimPlayer(s, "p1"); assert.ok(tok);
  assert.throws(() => claimPlayer(s, "p1"), /already/);
  assert.ok(myMission(s, "p1").mission);
  const sw = swapMission(s, "p1"); assert.equal(sw.swapped, true);
  assert.throws(() => swapMission(s, "p1"), /already swapped/);
  H.missionsDone(s); assert.equal(s.phase, "live"); assert.equal(s.pub, 0);

  H.caught(s, { playerId: "p2" });
  assert.equal(s.players[2].forf, 1); assert.equal(s.forfeits.length, 1);
  const id = s.forfeits[0].id;
  H.forfeit(s, { id, action: "reroll" });
  assert.throws(() => H.forfeit(s, { id, action: "reroll" }), /once/);
  H.forfeit(s, { id, action: "skip" });
  assert.equal(s.players[2].tokens, 1); assert.equal(s.forfeits.length, 0);

  H.editRule(s, { i: 0, text: "Talk like a sports commentator" });
  assert.equal(s.plan[0].rule.text, "Talk like a sports commentator");
  H.rename(s, { i: 1, name: "Grogan's" });

  for (let i = 1; i < 12; i++) {
    H.next(s);
    if (s.plan[i].drop) { assert.ok(publicState(s).plan[i].dropPending); revealDrop(s); assert.ok(publicState(s).plan[i].drop); }
    if (s.plan[i].type !== "rule") assert.throws(() => H.caught(s, { playerId: "p0" }), /No rules/);
  }
  assert.throws(() => H.next(s), /last pub/);
  H.finish(s); assert.equal(s.phase, "reveal");
  assert.ok(publicState(s).players[0].mission.text, "missions shown at the reveal");
  H.missionResult(s, { playerId: "p0", result: true });
  H.revealDone(s); assert.equal(s.phase, "recap");
});

test("savage mode stacks rules", () => {
  const s = room({ mode: "hard", missions: false });
  H.start(s); H.next(s); H.next(s);
  assert.equal(G.activeRules(s).length, 3);
  H.next(s); // water stop
  assert.equal(G.activeRules(s).length, 0);
});

test("dublin preset route", () => {
  const r = G.dublinRoute("classic", "trinity");
  assert.equal(r.route.length, 12);
  assert.equal(new Set(r.route.map((p) => p.name)).size, 12);
  assert.ok(r.km > 0 && r.km < 15);
});

test("recap: everyone gets a title, and they're varied", async () => {
  const { titles, nightStats } = await import("../public/js/recap.js");
  const mk = (n, forf, skips, chall, result) => ({ id: n, n, forf, skips, chall, mission: { result } });
  const S = { players: [mk("Harry", 1, 0, 5, true), mk("Aoife", 2, 0, 5, true), mk("Cian", 5, 0, 5, false), mk("Niamh", 1, 1, 5, false), mk("Seán", 0, 0, 5, true)],
    plan: [], settings: { missions: true }, startAt: 1000, endAt: 3601000 };
  const t = titles(S);
  assert.equal(Object.keys(t).length, 5);
  assert.equal(new Set(Object.values(t).map((x) => x.t)).size, 5);
  assert.equal(t.Cian.t, "Known to Gardaí");
  assert.equal(t["Seán"].t, "Airtight Alibi");
  assert.equal(nightStats(S).out, 3600000);
});

test("profile emoji: set at creation, changeable, only from the list", () => {
  const s = createRoomState("E", { players: [{ n: "Harry", emoji: "🦄" }, { n: "Aoife", emoji: "<script>" }, "Cian"] });
  assert.equal(s.players[0].emoji, "🦄");
  assert.equal(s.players[1].emoji, null);
  assert.equal(publicState(s).players[0].emoji, "🦄");
  H.setEmoji(s, { playerId: "p2", emoji: "☘️" });
  assert.equal(s.players[2].emoji, "☘️");
  assert.throws(() => H.setEmoji(s, { playerId: "p2", emoji: "nope" }), /list/);
});

test("stats: counts nights per day, never anything personal", async () => {
  const { Stats, dashboardHtml } = await import("../server/stats.js");
  const st = new Stats(null);
  const s = room({ mode: "hard" });
  st.bump("visits"); st.bump("visits");
  st.nightCreated(s, "dublin");
  H.start(s); st.bump("started");
  st.bump("joins");
  H.missionsDone(s); for (let i = 1; i < 12; i++) H.next(s);
  H.finish(s); st.nightFinished(s);
  const { total, series } = st.summary(7);
  assert.equal(total.visits, 2); assert.equal(total.created, 1); assert.equal(total.finished, 1); assert.equal(total.finishedAll, 1);
  assert.equal(total.players, 4); assert.equal(total.modes.hard, 1); assert.equal(total.sources.dublin, 1);
  assert.equal(series.length, 7); assert.equal(series[6].created, 1);
  const dump = JSON.stringify(st.days);
  for (const p of s.players) assert.ok(!dump.includes(p.n), "no names in stats");
  assert.ok(!dump.includes(s.code), "no room codes in stats");
  assert.ok(dashboardHtml(st.summary(30)).includes("Nights created"));
});

test("content: every item is well-formed", async () => {
  const fs = await import("node:fs");
  const items = JSON.parse(fs.readFileSync(new URL("../server/content/challenges.json", import.meta.url))).items;
  const ids = new Set();
  for (const it of items) {
    assert.ok(!ids.has(it.id), `duplicate id ${it.id}`); ids.add(it.id);
    assert.ok(typeof it.text === "string" && it.text.length > 5 && it.text.length <= 170, `${it.id}: text length`);
    assert.ok(!/guinness|murphy|heineken|jameson|baileys|tayto|budweiser|carlsberg|smithwick/i.test(it.text), `${it.id}: brand name`);
    if (it.kind === "special") continue;
    assert.ok(["rule", "challenge", "forfeit"].includes(it.kind), `${it.id}: kind`);
    assert.ok(G.CATS.includes(it.cat), `${it.id}: cat ${it.cat}`);
    assert.ok([1, 2, 3].includes(it.int), `${it.id}: int`);
    assert.equal(it.id[0], it.kind[0], `${it.id}: id prefix matches kind`);
    if (it.kind === "challenge") { assert.ok(["arrival", "drop"].includes(it.when), `${it.id}: when`); assert.equal(typeof it.group, "boolean"); }
    if (it.pick) assert.equal(it.kind, "rule");
  }
  for (const m of G.MISSIONS) assert.ok(!/\{(?!p\})/.test(m), `mission placeholder: ${m}`);
  assert.equal(new Set(G.MISSIONS).size, G.MISSIONS.length, "duplicate mission");
});

test("content: every mode has plenty to pick from", () => {
  for (const mode of Object.keys(G.MODES)) {
    const M = G.MODES[mode];
    assert.ok(G.RULES.filter((r) => M.rw[r.int] > 0).length >= 25, `${mode} rules`);
    for (const when of ["arrival", "drop"]) assert.ok(G.CHALLENGES.filter((c) => c.when === when && M.cw[c.int] > 0).length >= 15, `${mode} ${when} challenges`);
  }
  // a 12-player night with missions on never runs out of distinct missions
  const players = Array.from({ length: 12 }, (_, i) => ({ n: "P" + i, mission: null }));
  for (const p of players) p.mission = G.dealMission(players, p.n);
  assert.equal(new Set(players.map((p) => p.mission.base)).size, 12);
});

test("plant a surprise: secret until it pops up, approved blind, counts breaks", () => {
  const s = room({ missions: false });
  const a = addPlant(s, "p1", "rule", "Everyone has to call Harry 'Your Majesty'");
  const b = addPlant(s, "p1", "challenge", "Group photo with a stranger's dog");
  assert.throws(() => addPlant(s, "p1", "rule", "Third one"), /Max 2/);
  const c = addPlant(s, "p2", "rule", "No sitting");
  assert.ok(new Set([a.pub, b.pub, c.pub]).size === 3, "one surprise per pub");
  for (const x of [a, b, c]) assert.equal(s.plan[x.pub].type, "rule");

  // nobody sees the text, the host included; the author can see their own
  let pub = JSON.stringify(publicState(s));
  assert.ok(!pub.includes("Your Majesty") && !pub.includes("dog") && !pub.includes("No sitting"));
  assert.equal(publicState(s).plants.length, 3);
  assert.equal(myPlants(s, "p1").length, 2);
  assert.equal(H.plantPeek(s, { id: c.id }).result.text, "No sitting");

  H.plantDecide(s, { id: a.id, ok: true });
  H.plantDecide(s, { id: b.id, ok: true });
  H.plantDecide(s, { id: c.id, ok: false }); // binned
  removePlant(s, "p1", b.id);                // author changed their mind
  assert.equal(publicState(s).plants.length, 1);

  H.start(s);
  assert.throws(() => addPlant(s, "p3", "rule", "Too late"), /before the night/);
  while (s.pub < a.pub) H.next(s);
  assert.equal(publicState(s).plan[a.pub].plantPending, 1);
  assert.ok(nextEventAt(s) > Date.now() + 4 * 60000, "nothing pops up in the first few minutes");
  const at = s.plants.find((x) => x.id === a.id).revealAt;
  assert.ok(at >= s.plan[a.pub].arrivedAt + 5 * 60000 && at <= s.plan[a.pub].arrivedAt + 15 * 60000, "pops up 5-15 min in");
  if (s.plan[a.pub].drop) s.plan[a.pub].dropAt = at + 1; // keep the regular drop out of the way
  const buzz = revealDue(s, at);
  assert.deepEqual(buzz, [{ kind: "plant", byName: "Aoife" }]);
  assert.equal(s.plan[a.pub].rule.text, "Everyone has to call Harry 'Your Majesty'");
  assert.ok(JSON.stringify(publicState(s)).includes("Your Majesty"));

  H.caught(s, { playerId: "p0" }); H.caught(s, { playerId: "p2" });
  assert.equal(s.plants.find((x) => x.id === a.id).breaks, 2);
});

test("ending early: the recap counts only the pubs you reached", async () => {
  const { nightStats } = await import("../public/js/recap.js");
  const s = room({ missions: false });
  H.start(s); for (let i = 0; i < 5; i++) H.next(s);   // at pub 6
  H.finish(s);
  assert.equal(s.phase, "recap");
  const st = nightStats(publicState(s));
  assert.equal(st.visited, 6);
});

test("recap stays up for 24 hours after the night ends, then the room is gone", async () => {
  const { RoomStore } = await import("../server/store.js");
  const { RECAP_TTL } = await import("../server/room.js");
  const store = new RoomStore(null);
  const s = store.create({ players: ["Harry", "Aoife"], settings: { missions: false } });
  H.start(s); H.next(s); H.finish(s);
  assert.equal(s.phase, "recap");
  assert.ok(Math.abs(s.expiresAt - (s.endAt + RECAP_TTL)) < 5);
  assert.equal(publicState(s).expiresAt, s.expiresAt);
  assert.ok(store.get(s.code), "still there during the 24h");
  s.expiresAt = Date.now() - 1;
  assert.equal(store.get(s.code), undefined, "gone once it expires");
});

test("comings and goings: join late, head home, come back", () => {
  const s = room({ missions: true });
  H.start(s); H.missionsDone(s); H.next(s); H.next(s); // pub 3
  const late = H.addPlayer(s, { n: "Seán", emoji: "🦄" }).result;
  const sean = s.players.find((p) => p.id === late.id);
  assert.equal(sean.joinedPub, 2); assert.ok(sean.mission, "late joiners get a mission");
  assert.ok(isHere(s, sean));
  H.caught(s, { playerId: sean.id });
  H.leave(s, { playerId: "p3" });
  assert.equal(s.players[3].leftPub, 2);
  assert.throws(() => H.caught(s, { playerId: "p3" }), /headed home/);
  for (let k = 0; k < 30; k++) { H.next(s); if (s.pub >= 10) break; }
  for (const p of s.plan.slice(3)) if (p.arrive && !p.arrive.group) assert.notEqual(p.arrive.victim, "Niamh", "no challenges for people who left");
  H.back(s, { playerId: "p3" });
  assert.equal(s.players[3].leftPub, null);
  assert.throws(() => H.addPlayer(s, { n: "" }), /name/);
  assert.equal(H.addPlayer(s, { n: "Harry" }).result.id, "p5");
  assert.equal(s.players[5].n, "Harry 2");
});

test("host handover: take-over code works once and changes the host token", () => {
  const s = room();
  const old = s.hostToken;
  const t = makeTakeover(s);
  const fresh = useTakeover(s, t);
  assert.notEqual(fresh, old); assert.equal(s.hostToken, fresh);
  assert.throws(() => useTakeover(s, t), /expired/);
});

test("seo: rules page is real text, valid structured data, no 'drink faster' items", async () => {
  const { rulesPage, sitemapXml, robotsTxt } = await import("../server/seo.js");
  const html = rulesPage();
  assert.ok(html.includes("<h1>12 Pubs of Christmas Rules</h1>"));
  assert.ok(html.includes('<link rel="canonical" href="https://12pubs.ie/rules">'));
  for (const x of [...G.RULES, ...G.CHALLENGES, ...G.FORFEITS].filter((x) => x.cat === "drinking" && x.int === 3)) {
    const t = x.text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    assert.ok(!html.includes(t), `savage drinking item on public page: ${x.id}`);
  }
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(m[1]);
  assert.ok(sitemapXml().includes("<loc>https://12pubs.ie/rules</loc>"));
  assert.ok(robotsTxt().includes("Disallow: /stats"));
});

/* ---------- big groups, self-join and catches from your own phone ---------- */
const liveRoom = (n = 4) => {
  const s = createRoomState("TEST", { settings: settings({ missions: false }), players: Array.from({ length: n }, (_, i) => "P" + i), pubs: [{ name: "The Crane Bar" }] });
  H.start(s);
  while (s.phase !== "live" || s.pub < 0 || s.plan[s.pub].type !== "rule") H.next(s);
  return s;
};

test("big groups: up to 50 players, no more", () => {
  const names = Array.from({ length: 60 }, (_, i) => "P" + i);
  const s = createRoomState("TEST", { settings: settings(), players: names, pubs: [{ name: "The Crane Bar" }] });
  assert.equal(s.players.length, 50);
  assert.throws(() => selfJoin(s, "Late"), /50 players max/);
});

test("self-join: scan the code, type a name, you're in with your own phone", () => {
  const s = room();
  const pl = selfJoin(s, "Oisín");
  assert.equal(pl.n, "Oisín");
  assert.ok(pl.claimToken);
  assert.ok(pl.mission);
  assert.equal(selfJoin(s, "oisín").n, "oisín 2");
  assert.equal(publicState(s).players.find((p) => p.n === "Oisín").claimed, true);
});

test("reporting: anyone can catch anyone, and it says who", () => {
  const s = liveRoom();
  const { buzz } = reportCatch(s, "p0", "p1");
  assert.equal(buzz.playerId, "p1");
  assert.equal(s.players[1].forf, 1);
  assert.equal(s.forfeits[0].by, "P0");
  assert.equal(publicState(s).catches[0].by, "P0");
});

test("reporting: no spamming the same person, but the host can still add one", () => {
  const s = liveRoom();
  reportCatch(s, "p0", "p1");
  assert.throws(() => reportCatch(s, "p0", "p1"), /just been caught/);
  assert.throws(() => reportCatch(s, "p2", "p1"), /just been caught/);
  s.catches[0].at -= 20000;
  assert.throws(() => reportCatch(s, "p0", "p1"), /a minute ago/);
  reportCatch(s, "p2", "p1");
  s.catches.forEach((c) => (c.at -= 70000));
  reportCatch(s, "p0", "p1");
  assert.equal(s.players[1].forf, 3);
  H.caught(s, { playerId: "p1" });
  assert.equal(s.players[1].forf, 4);
});

test("removing a catch puts every count right, and a troll can't re-report at once", () => {
  const s = liveRoom();
  const here = s.plan[s.pub];
  here.rule = { id: "plant9", text: "x", plantId: 9 };
  s.plants.push({ id: 9, breaks: 0, by: "p0" });
  reportCatch(s, "p0", "p1");
  const c = s.catches[0], f = s.forfeits[0];
  assert.deepEqual([s.players[1].forf, here.forf, s.plants.at(-1).breaks], [1, 1, 1]);
  H.forfeit(s, { id: f.id, action: "skip" });
  assert.deepEqual([s.players[1].tokens, s.players[1].skips], [1, 1]);
  H.removeCatch(s, { id: c.id });
  assert.deepEqual([s.players[1].forf, here.forf, s.plants.at(-1).breaks, s.players[1].tokens, s.players[1].skips], [0, 0, 0, 2, 0]);
  assert.equal(publicState(s).catches.length, 0);
  assert.throws(() => H.removeCatch(s, { id: c.id }), /already gone/);
  assert.throws(() => reportCatch(s, "p0", "p1"), /a minute ago/);
});

test("your own forfeit is yours to handle, nobody else's", () => {
  const s = liveRoom();
  reportCatch(s, "p0", "p1");
  const id = s.forfeits[0].id;
  assert.throws(() => ownForfeit(s, "p2", id, "done"), /not your forfeit/);
  ownForfeit(s, "p1", id, "done");
  assert.equal(s.forfeits.length, 0);
  assert.equal(s.players[1].forf, 1);
});

test("awards: people who are level get called a tie, not whoever's first", async () => {
  const { awards } = await import("../public/js/recap.js");
  const mk = (n, forf) => ({ id: n, n, forf, skips: 0, chall: 0, joinedPub: 0, leftPub: null });
  const plan = [{ name: "A", arrivedAt: 1, forf: 4 }, { name: "B", arrivedAt: 2, forf: 4 }];
  const S = { players: [mk("Cian", 3), mk("Aoife", 3), mk("Niamh", 3), mk("Oisín", 1), mk("Seán", 1)], plan, settings: { missions: false } };
  const [most, clean, pub] = awards(S, false);
  assert.equal(most.n, "3-way tie");
  assert.match(most.d, /3 forfeits each: Cian, Aoife, Niamh/);
  assert.equal(clean.n, "Oisín & Seán");
  assert.equal(pub.n, "A & B");
  S.players[0].forf = 9;
  assert.equal(awards(S, false)[0].n, "Cian");
  assert.equal(awards(S, false)[0].d, "9 forfeits");
});

test("recap lines: every one fills in properly, and everyone sees the same line", async () => {
  const { TITLES, titleLine } = await import("../public/js/recap.js");
  const p = { id: "p3", forf: 1, skips: 2, chall: 1, leftPub: 11, joinedPub: 11 };
  for (const key of Object.keys(TITLES)) {
    assert.ok(TITLES[key].d.length >= 4, key);
    for (let i = 0; i < 50; i++) {
      const line = titleLine({ code: "R" + i }, { ...p, id: "p" + i }, key);
      assert.doesNotMatch(line, /[{}]|1 times|undefined|NaN/, line);
      assert.equal(line, titleLine({ code: "R" + i }, { ...p, id: "p" + i }, key));
    }
  }
});
