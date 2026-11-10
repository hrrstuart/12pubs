// 12 Pubs front end. The server owns the game state; this file draws it and sends actions.
// Roles: "host" (the phone on the table, runs everything), "player" (optional: follows along
// and sees their own secret mission), "watcher" (joined, hasn't picked a name).
import { socket, call, host, loadSession, saveSession, clearSession, getJSON, canDownload, saveFile } from "./api.js";
import { buildSlides, titles, recapText, nightStats, duration, MODE_LABEL, displayName, pubColor, playerColor, comingsAndGoings } from "./recap.js";
import qrcode from "/vendor/qrcode.mjs";
import { getPhoto, setPhoto, removePhoto, prunePhotos, fileToAvatar } from "./photos.js";

// Change this before launch: shown on the terms & privacy page
const CONTACT_EMAIL = "hello@12pubs.ie";

/* ---------- constants & helpers ---------- */
const CATS = [["drinking", "🍺 Drinking"], ["talking", "🗣️ Talking"], ["social", "🤝 Social"], ["dares", "😈 Dares"], ["physical", "💪 Physical"], ["brain", "🧠 Brain"], ["silly", "🤪 Silly"]];
const MODES = [["chill", "😇", "Chill", "mild & silly"], ["classic", "🍺", "Classic", "proper rules"], ["hard", "😈", "Savage", "rules stack"]];
const SPECIAL = {
  water: { em: "💧", tag: "Water stop", text: "Everyone has a water or soft drink before anything else." },
  food: { em: "🍟", tag: "Food stop", text: "Chips, a toastie, anything. Nobody skips." },
  finale: { em: "🎉", tag: "The finale", text: "All rules lifted. Toast whoever made it." },
};
const EMOJI_FALLBACK = ["🍺", "🍻", "🥃", "🍷", "🥂", "😎", "🤠", "🥳", "😈", "😇", "🤡", "👻", "👽", "🤖", "💀", "🦄", "🐸", "🐶", "🐱", "🦊", "🐻", "🐼", "🐙", "🦖", "🔥", "⚡", "🌈", "⭐", "💅", "🕺", "💃", "🎸", "⚽", "🏀", "☘️", "🎄"];
const STOP_TAG = ["", "", "", "💧 water", "", "", "", "🍟 food", "", "", "", "🎉 finale"];

const app = document.getElementById("app");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (t) => new Date(t || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dots = (n) => "●".repeat(n) + "○".repeat(3 - n);
const mapsSearch = (p) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.street ? `${p.name}, ${p.street}` : p.name);
function mapsDir(o, pts) {
  const ll = (p) => `${p.lat},${p.lng}`, dest = pts[pts.length - 1], way = pts.slice(0, -1).map(ll).join("|");
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${ll(o)}&destination=${ll(dest)}` + (way ? `&waypoints=${encodeURIComponent(way)}` : "");
}
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const d = document.createElement("div"); d.className = "toast"; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}
function vibrate() { try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch { /* not supported */ } }
async function copyText(txt, ok) {
  try { await navigator.clipboard.writeText(txt); toast(ok); } catch { toast("Couldn't copy. Long-press to select instead."); }
}
// Run a server call; show errors as a toast instead of throwing
async function act(promise) { try { return await promise; } catch (e) { toast(e.message); return null; } }
const H = (action, args) => act(host(action, args));

/* ---------- app state ---------- */
let S = null;               // public state from the server
let ME = loadSession();     // { code, role, hostToken?, playerId?, playerToken? }
let view = "home";          // local screens before you're in a room: home | setup
let D = null;               // setup draft
let META = null;            // labels from /api/meta
let hideNames = false, watchOnly = false, pending = false, logOpen = false;

const pIndex = (n) => S.players.findIndex((p) => p.n === n);
// Avatar: a photo if one was added on this phone, else their emoji, else their initial
const av = (n, small) => {
  const i = S ? pIndex(n) : -1, p = i >= 0 ? S.players[i] : null;
  const bg = i >= 0 ? playerColor(i) : "var(--yellow)", cls = `av ${small ? "s" : ""}`;
  const photo = p && getPhoto(S.code, p.id);
  if (photo) return `<span class="${cls} photo" style="background-color:${bg};background-image:url('${photo}')"></span>`;
  if (p && p.emoji) return `<span class="${cls} emoji" style="background:${bg}">${p.emoji}</span>`;
  return `<span class="${cls}" style="background:${bg}">${n ? esc(n[0].toUpperCase()) : "🍻"}</span>`;
};

/* ---------- picture picker: emoji (shared with everyone) or a photo (stays on this phone) ---------- */
function pictureSheet({ title, emoji, photo, note, onEmoji, onPhoto, onRemove }) {
  const list = (META && META.emojis) || EMOJI_FALLBACK;
  const ov = openOverlay(`<div class="card">
    <h3 style="font-size:22px;margin-bottom:12px">${esc(title)}</h3>
    <div class="emojigrid">${list.map((e) => `<button data-e="${e}" aria-pressed="${e === emoji}">${e}</button>`).join("")}</div>
    <label class="btn blue" style="margin:16px 0 10px">📷 ${photo ? "Change photo" : "Add a photo"}<input type="file" accept="image/*" id="pfile" hidden></label>
    ${photo ? `<button class="btn" id="prm" style="margin-bottom:10px">Remove photo</button>` : ""}
    <p class="small muted" style="margin:0 0 12px">${note}</p>
    <button class="btn ghost" id="pclose" style="margin:0">Done</button></div>`, true);
  ov.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { closeOverlay(); onEmoji(b.dataset.e === emoji ? null : b.dataset.e); }));
  ov.querySelector("#pfile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const url = await fileToAvatar(f); closeOverlay(); onPhoto(url); } catch (err) { toast(err.message); }
  };
  const rm = ov.querySelector("#prm"); if (rm) rm.onclick = () => { closeOverlay(); onRemove(); };
  ov.querySelector("#pclose").onclick = closeOverlay;
}
const PHOTO_NOTE_HOST = "Photos stay on this phone and are never uploaded. Mates who join see the emoji.";
const PHOTO_NOTE_ME = "Your photo stays on your phone and is never uploaded. Everyone else sees your emoji.";
function editPlayerPicture(p) { // host, after the room exists
  pictureSheet({ title: `${p.n}'s picture`, emoji: p.emoji, photo: getPhoto(S.code, p.id), note: PHOTO_NOTE_HOST,
    onEmoji: (e) => H("setEmoji", { playerId: p.id, emoji: e }),
    onPhoto: (url) => { setPhoto(S.code, p.id, url); render(); },
    onRemove: () => { removePhoto(S.code, p.id); render(); } });
}
function editMyPicture() { // a player on their own phone
  const me = S.players.find((x) => x.id === ME.playerId); if (!me) return;
  pictureSheet({ title: "Your picture", emoji: me.emoji, photo: getPhoto(S.code, me.id), note: PHOTO_NOTE_ME,
    onEmoji: (e) => act(call("player:emoji", { emoji: e })),
    onPhoto: (url) => { setPhoto(S.code, me.id, url); render(); },
    onRemove: () => { removePhoto(S.code, me.id); render(); } });
}
const isHost = () => ME && ME.role === "host";
const bar = (html) => `<div class="bar"><div class="inner">${html}</div></div>`;

/* ---------- rendering ---------- */
// Don't redraw under someone's thumbs: wait until they leave the text box.
const MAX_PLAYERS = 50;
const canSelfJoin = () => ["plan", "missions", "live"].includes(S.phase) && S.players.length < MAX_PLAYERS;
const typing = () => { const a = document.activeElement; return a && app.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"); };
document.addEventListener("focusout", () => setTimeout(() => { if (pending && !typing()) render(); }, 0));

function render() {
  if (typing()) { pending = true; return; }
  pending = false;
  const log = app.querySelector("details.log"); if (log) logOpen = log.open;
  if (!ageOk()) return gateScreen();
  if (!S) return view === "setup" ? setupScreen() : homeScreen();
  if (isHost()) return ({ plan: planScreen, missions: missionsHost, live: liveHost, reveal: revealHost, recap: recapScreen })[S.phase]();
  if (ME.role === "watcher" && !watchOnly && (S.players.some((p) => !p.claimed) || canSelfJoin())) return claimScreen();
  ({ plan: waitScreen, missions: guestLive, live: guestLive, reveal: revealGuest, recap: recapScreen })[S.phase]();
  maybeLookAfter();
}

function leaveRoom() { clearSession(); ME = null; S = null; view = "home"; closeOverlay(); render(); window.scrollTo(0, 0); }

/* ---------- connection ---------- */
const banner = document.createElement("div");
banner.className = "conn"; banner.textContent = "Reconnecting…"; banner.hidden = true;
document.body.appendChild(banner);

socket.on("connect", () => { banner.hidden = true; if (ME && ME.code) rejoin(); });
socket.on("disconnect", () => { banner.hidden = false; });
socket.on("state", (st) => {
  if (!ME || st.code !== ME.code) return;
  const moved = S && st.pub !== S.pub;
  S = st; render();
  if (moved) window.scrollTo({ top: 0, behavior: "smooth" });
});
// Host handover: this phone becomes (or stops being) the one running the night
socket.on("promoted", ({ hostToken }) => {
  if (!ME) return;
  Object.assign(ME, { role: "host", hostToken }); saveSession(ME);
  closeOverlay(); vibrate(); toast("👑 You're running the night now"); render();
});
socket.on("demoted", () => {
  if (!ME) return;
  delete ME.hostToken; ME.role = ME.playerId ? "player" : "watcher"; watchOnly = false; saveSession(ME);
  closeOverlay(); toast("Handed over 👋 Pick your name if you're playing"); render();
});
socket.on("buzz", (b) => {
  if (b.kind === "drop") { vibrate(); toast("⚡ Surprise drop!"); }
  if (b.kind === "plant") { vibrate(); toast(`🎁 ${b.byName}'s surprise!`); }
  if (b.kind === "forfeit" && ME && b.playerId === ME.playerId) { vibrate(); toast("📣 You got caught!"); }
});

async function rejoin() {
  try {
    const r = await call("room:join", { code: ME.code, hostToken: ME.hostToken, playerId: ME.playerId, playerToken: ME.playerToken });
    ME.role = r.role; saveSession(ME); S = r.state; render();
  } catch (e) {
    if (/No room/.test(e.message)) { toast("That night has ended"); leaveRoom(); }
  }
}

async function joinRoom(code) {
  code = String(code || "").trim().toUpperCase();
  if (code.length !== 4) { toast("Room codes are 4 letters"); return; }
  const r = await act(call("room:join", { code }));
  if (!r) return;
  ME = { code: r.state.code, role: r.role }; saveSession(ME);
  prunePhotos(r.state.code);
  S = r.state; watchOnly = false; render();
}

/* ================= 18+ GATE & PLAY RESPONSIBLY ================= */
const AGE_KEY = "12pubs-18plus";
let ageMem = false, underage = false;
function ageOk() { if (ageMem) return true; try { return localStorage.getItem(AGE_KEY) === "yes"; } catch { return false; } }
function setAgeOk() { ageMem = true; try { localStorage.setItem(AGE_KEY, "yes"); } catch { /* remember for this visit only */ } }

/* ---------- "Look after each other": shown to everyone, in big writing, before the night starts ---------- */
const LOOK_AFTER = [
  ["🛑", "If a mate's had too much, call it.", "Water, food, a taxi home. That's the move, not one more."],
  ["🫂", "Nobody gets left behind.", "Nobody walks home alone. Nobody gets left in a pub."],
  ["🥤", "Nobody has to drink.", "Soft drinks count. Skip anything, no questions asked."],
  ["🎄", "This time of year is for fun, not A&E.", "The best nights are the ones everyone remembers."],
];
const pledgeKey = () => `12pubs-pledge-${S.code}`;
const pledged = () => { try { return localStorage.getItem(pledgeKey()) === "1"; } catch { return !!lookAfterSeen[S.code]; } };
const lookAfterSeen = {};
function markPledged() { lookAfterSeen[S.code] = true; try { localStorage.setItem(pledgeKey(), "1"); } catch { /* fine */ } }
function lookAfterScreen(onGo, label) {
  const ov = openOverlay(`<div class="card lookafter">
    <span class="sticker">Before you go</span>
    <h2 style="margin:12px 0 4px;font-size:34px">Look after each other 🫂</h2>
    ${LOOK_AFTER.map(([em, big, small]) => `<div class="la"><span class="em">${em}</span><div><b>${big}</b><span>${small}</span></div></div>`).join("")}
    <div class="sos"><b>🚑 Emergency?</b> Call <a href="tel:112">112</a> or <a href="tel:999">999</a>. Free from any phone.</div>
    <button class="btn pink big" id="lago" style="margin:16px 0 0">${label}</button></div>`);
  ov.onclick = null; // has to be tapped through, not dismissed by accident
  ov.querySelector("#lago").onclick = () => { markPledged(); closeOverlay(); onGo && onGo(); };
}
// Everyone else sees it once, the moment the night starts on their phone
function maybeLookAfter() {
  if (!S || isHost() || ovEl || pledged() || !["missions", "live"].includes(S.phase)) return;
  lookAfterScreen(null, "Got it 🍻");
}

const PLAY_SAFE = [
  ["🥤", "Nobody has to drink to play.", "Soft drinks and halves always count."],
  ["💧", "Do the water and food stops.", "Pubs 4 and 8. Actually do them."],
  ["🎟", "Skip anything you're not up for.", "No questions asked."],
  ["🫂", "Look after each other.", "Nobody walks home alone."],
  ["🚗", "Never drink and drive.", "Plan your way home before you start."],
  ["🚑", "Emergency? Call 112 or 999.", "Free from any phone in Ireland."],
];
const playSafeList = () => `<div class="safe">${PLAY_SAFE.map(([em, b, t]) => `<div class="saferow"><span class="em">${em}</span><span><b>${b}</b> ${t}</span></div>`).join("")}</div>`;

function gateScreen() {
  if (underage) {
    app.innerHTML = `<div class="hero"><div style="font-size:64px">🧃</div><h2 style="margin-top:8px">Sorry, 12 Pubs is for over-18s only.</h2><p class="lead">Come back when you're 18.</p></div>
      <button class="btn" id="back">← Back</button>`;
    $("back").onclick = () => { underage = false; render(); };
    return;
  }
  app.innerHTML = `
  <div class="hero" style="padding-bottom:14px"><div class="logo"><span class="n">12</span><span class="w">PUBS</span></div></div>
  <div class="card center" style="background:var(--yellow)">
    <h2>Are you 18 or over?</h2>
    <p style="margin:8px 0 16px">12 Pubs is a game for adults out on a pub crawl.</p>
    <button class="btn pink big" id="yes">Yes, I'm 18+</button>
    <button class="btn ghost" id="no" style="margin:0">No</button>
  </div>
  <div class="card"><h3 style="font-size:20px;margin-bottom:10px">Play it sound 🍻</h3>${playSafeList()}
    <p class="small muted" style="margin:12px 0 0">Advice and support: <a href="https://www.drinkaware.ie" target="_blank" rel="noopener">drinkaware.ie</a></p></div>
  <p class="center small muted">By continuing you agree to the <button class="linkbtn small" id="terms">terms & privacy</button>.</p>
  <p class="center small seo-link" style="margin-top:4px"><a href="/rules">Just want the 12 Pubs rules list? →</a></p>`;
  $("yes").onclick = () => { setAgeOk(); render(); window.scrollTo(0, 0); };
  $("no").onclick = () => { underage = true; render(); };
  $("terms").onclick = legalSheet;
}

/* ---------- What's what: on the home page, and in the ⋯ menu during a night ---------- */
// `on` = the night's settings, to leave out what's switched off. Without it, everything shows (home page).
function whatsWhat(on) {
  const all = !on, ch = all || on.challenges !== false, mi = all || on.missions;
  const opt = all ? ` <span class="small" style="font:700 12px var(--display);background:var(--yellow);border:2px solid var(--ink);border-radius:20px;padding:1px 8px;margin-left:4px">optional</span>` : "";
  const items = [
    ["📜", "The rule", "Every pub gets one daft rule, like no first names or no pointing. It lasts till you leave that pub." + (all || on.mode === "hard" ? " On Savage, each rule sticks around for 3 pubs, so they pile up." : "")],
    ["🙈", "Getting caught", "Spot someone breaking the rule? Tap who got caught on any phone. They get a forfeit."],
    ["🎲", "Forfeits", `Something daft the app picks for whoever got caught. You get one re-roll.${all || !on.drinkF ? " Forfeits never mean drinking more unless the host turns drinking forfeits on." : ""}`],
    ["🎟", "Skip tokens", all ? "The host gives everyone 0, 1 or 2. Spend one to dodge a forfeit or a challenge." : `Everyone has ${on.tokens}. Spend one to dodge a forfeit${ch ? " or a challenge" : ""}.`],
    ["💧", "The stops", "Pub 4 is a water stop, pub 8 is a food stop, and pub 12 is the finale: all rules lifted."],
    ["🎁", "Planted surprises", `Before the first pub, anyone can plant up to 2 secret rules${ch ? " or challenges" : ""}. Each lands on a random pub and pops up 5 to 15 minutes in. Every catch under your rule counts for you.`],
    ["💬", "Quote of the night", "Someone says something you'll never let them forget? Add it from the ⋯ menu, or on the recap at the end. One each, and your latest replaces your last. It goes on its own recap slide, and the host can bin any that cross a line."],
    ...(ch ? [["🎯", "Challenges" + opt, "A dare when you walk in, for one person or the whole group, and surprise ones dropped 10 to 20 minutes into some pubs. Do it, or spend a skip token."]] : []),
    ...(mi ? [["🤫", "Secret missions" + opt, "Everyone gets a secret job for the night. Pull it off and you give anyone a forfeit. With 5 or more of you, everyone writes one for someone else, and the writer gets 2 guesses to bust whoever has it. Guess wrong and the forfeit's yours."]] : []),
  ];
  return items.map(([em, t, d]) => `<div class="mrow" style="align-items:flex-start"><span style="font-size:24px;flex:0 0 34px">${em}</span><div><b>${t}</b><div class="small">${d}</div></div></div>`).join("");
}
function howSheet() {
  const p = S.plan[S.pub], rules = activeRules();
  const now = S.phase !== "live" || !p ? ""
    : p.type !== "rule" ? `<div class="rule special" style="margin-bottom:14px"><div class="label">${SPECIAL[p.type].em} ${SPECIAL[p.type].tag}</div><p>${esc(SPECIAL[p.type].text)}</p></div>`
    : `<div class="rule" style="margin-bottom:14px"><span class="label">📜 ${rules.length > 1 ? "Rules right now" : "The rule right now"}</span>${rules.map((r) => `<p>${esc(r)}</p>`).join("")}</div>`;
  const mode = { chill: "Chill", classic: "Classic", hard: "Savage" }[S.settings.mode];
  const ov = openOverlay(`<div class="card">
    <h2 style="margin-bottom:4px">How it works</h2>
    <p class="small muted" style="margin:0 0 14px">Tonight: ${mode} · challenges ${S.settings.challenges !== false ? "on" : "off"} · secret missions ${S.settings.missions ? "on" : "off"}</p>
    ${now}${whatsWhat(S.settings)}
    <button class="btn ghost" id="close" style="margin:14px 0 0">Back to the night</button></div>`, true);
  ov.querySelector("#close").onclick = closeOverlay;
}

function legalSheet() {
  const ov = openOverlay(`<div class="card legal">
    <h2>Terms & privacy</h2>
    <p class="small muted">Plain-English version. Last updated November 2026.</p>
    <h3>The game</h3>
    <ul>
      <li>12 Pubs is for people aged 18 and over.</li>
      <li>It's a game for fun. Every rule, challenge, forfeit and mission is a suggestion. You decide what you do, and you can always skip.</li>
      <li>Nobody has to drink alcohol to play. Soft drinks always count.</li>
      <li>You play at your own risk. Respect the pub, the staff and the people around you, and follow the law. Staff can refuse to serve anyone who's had too much.</li>
      <li>Don't use it to embarrass or pressure anyone who isn't up for it.</li>
    </ul>
    <h3>Your data</h3>
    <ul>
      <li>We store what you type for the night: player names, pub names and rules, plus the game's progress. That's needed to run the game.</li>
      <li>A night's data is deleted 24 hours after it ends (or 24 hours after it was last used, if it never finishes).</li>
      <li>No accounts, no ads, no tracking cookies, and we don't sell or share anything.</li>
      <li>We count how the app is used (like how many nights were played and how many pubs people reached). Just totals per day. Nothing that identifies you, and no IP addresses.</li>
      <li>Your phone keeps a small key in its storage so you can rejoin your night after a reload. Clearing your browser data removes it.</li>
      <li>Profile photos stay on the phone they were added on and are never uploaded. They're cleared when that phone starts or joins its next night.</li>
      <li>Questions, or want something removed sooner? Email <b>${esc(CONTACT_EMAIL)}</b>.</li>
    </ul>
    <h3>Play it sound</h3>${playSafeList()}
    <p class="small" style="margin:12px 0 16px">Advice and support: <a href="https://www.drinkaware.ie" target="_blank" rel="noopener">drinkaware.ie</a></p>
    <button class="btn ink" id="closelegal" style="margin:0">Close</button></div>`);
  ov.querySelector("#closelegal").onclick = closeOverlay;
}

/* ---------- QR invite ---------- */
function qrSvg(text) { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 1, scalable: true }); }
function inviteBlock(line) {
  return `<div class="qr">${qrSvg(joinLink())}</div>
    <b class="display" style="font-size:22px">Scan to join</b>
    <p class="small" style="margin:4px 0 12px">${line}</p>
    <div class="row"><span class="codechip big">${esc(S.code)}</span><button class="btn sm" data-copyinvite>Copy link</button></div>`;
}
const inviteLine = () => "Or go to 12pubs.ie and type the code.";
function wireCopyInvite(root = document) {
  root.querySelectorAll("[data-copyinvite]").forEach((b) => (b.onclick = () => copyText(`🍻 12 Pubs tonight. Join here: ${joinLink()} (code ${S.code})`, "Invite copied")));
}
function inviteSheet() {
  const ov = openOverlay(`<div class="card center">${inviteBlock(inviteLine())}<button class="btn ghost" id="closeqr" style="margin:12px 0 0">Close</button></div>`);
  wireCopyInvite(ov); ov.querySelector("#closeqr").onclick = closeOverlay;
}

/* ================= HOME ================= */
function homeScreen() {
  app.innerHTML = `
  <div class="hero">
    <div class="logo"><span class="n">12</span><span class="w">PUBS</span></div>
    <p class="lead">The pub crawl game. One code and everyone's in.</p>
  </div>
  ${ME && ME.code ? `<button class="btn yellow" id="resume">Back to room ${esc(ME.code)} →</button>` : ""}
  <button class="btn pink big" id="start">Start a night 🍻</button>
  <div class="card tight">
    <div class="label" style="margin-bottom:8px">Got a code from a mate?</div>
    <div class="row"><input class="input code" id="code" maxlength="4" placeholder="K7Q2" autocomplete="off" autocapitalize="characters"><button class="btn ink sm" id="join" style="flex:0 0 90px">Join</button></div>
  </div>
  <div class="feats">
    <div class="feat" style="background:var(--orange)"><span class="em">📜</span>A rule at every pub</div>
    <div class="feat" style="background:var(--blue)"><span class="em">⚡</span>Surprise challenges</div>
    <div class="feat" style="background:var(--green)"><span class="em">🤫</span>Secret missions</div>
    <div class="feat" style="background:var(--purple)"><span class="em">📸</span>A recap to post</div>
  </div>
  <h2 style="margin:26px 0 6px">New to the 12 Pubs?</h2>
  <p style="margin:0 0 16px">It's an Irish Christmas tradition. You and your mates do 12 pubs in one night, with a daft rule in every pub. Break the rule and you get a forfeit.</p>
  <div class="card">
    <h3 style="font-size:22px;margin-bottom:12px">How it works</h3>
    ${[["One person starts a night", "Pick how savage you want it. Takes a couple of minutes."],
       ["Everyone else scans the code", "No app and no sign-up. Just type your name."],
       ["Go to the pub", "Every pub gets a new rule. Catch someone breaking it and they get a forfeit. Want more? Turn on challenges and secret missions."],
       ["Get your recap", "At the end, everyone gets a card to post. Stop whenever you like, it still counts."]]
      .map(([t, d], i) => `<div class="step" style="margin-bottom:2px"><span class="num">${i + 1}</span><h3>${t}</h3></div><p class="small" style="margin:0 0 14px">${d}</p>`).join("")}
  </div>
  <div class="card">
    <h3 style="font-size:22px;margin-bottom:8px">What's what</h3>
    ${whatsWhat()}
  </div>
  <div class="card" style="background:var(--yellow)">
    <b class="display" style="font-size:20px">⏰ Start it on the day</b>
    <p style="margin:6px 0 0">Open this when you're all together, like at pre-drinks or the first pub. A room closes after 24 hours of nothing happening, so there's no setting it up weeks ahead.</p>
  </div>
  ${ME && ME.code ? `<p class="center"><button class="linkbtn" id="forget">Forget room ${esc(ME.code)}</button></p>` : ""}
  <p class="center small seo-link" style="margin-top:18px"><a href="/rules">📜 Browse all 200+ rules, challenges & forfeits</a></p>
  <p class="center small muted" style="margin-top:10px">18+ only · Play it sound · <button class="linkbtn small" id="terms">Terms & privacy</button></p>`;
  $("terms").onclick = legalSheet;
  if ($("resume")) { $("resume").onclick = rejoin; $("forget").onclick = leaveRoom; }
  $("start").onclick = () => { view = "setup"; render(); window.scrollTo(0, 0); };
  $("join").onclick = () => joinRoom($("code").value);
  $("code").onkeydown = (e) => { if (e.key === "Enter") joinRoom($("code").value); };
}

/* ================= SETUP (local until "create") ================= */
async function loadRoute() {
  try { D.route = await getJSON(`/api/dublin-route?mode=${D.mode}&start=${D.start}`); }
  catch (e) { toast(e.message); D.pubMode = "go"; }
  setupScreen();
}
function setupScreen() {
  D = D || { crew: "", players: [""], emojis: [], photos: [], mode: "classic", cats: CATS.map((c) => c[0]), missions: false, challenges: false, drinkF: false, tokens: 2, pubMode: "go", typed: Array(12).fill(""), start: "trinity", route: null };
  const d = D;
  const sw = (k) => `<button class="switch" data-sw="${k}" aria-pressed="${d[k]}" aria-label="${k}"></button>`;
  const step = (n, t) => `<div class="step"><span class="num">${n}</span><h3>${t}</h3></div>`;
  let pubs = "";
  if (d.pubMode === "go") pubs = `<p class="muted small" style="margin:12px 0 0">Pubs start as "Pub 1", "Pub 2"… Name each one as you walk in. Works anywhere.</p>`;
  if (d.pubMode === "type") pubs = `<div class="typed" style="margin-top:12px">${d.typed.map((v, i) => `<label><span class="n">${i + 1}</span><input class="input" data-ty="${i}" maxlength="60" value="${esc(v)}" placeholder="${i === 0 ? "The Crane Bar" : "Pub " + (i + 1)}">${STOP_TAG[i] ? `<span class="tag">${STOP_TAG[i]}</span>` : ""}</label>`).join("")}</div>`;
  if (d.pubMode === "dublin") {
    const starts = META ? META.starts : { trinity: "Trinity Front Gate" };
    if (!d.route) { pubs = `<p class="muted" style="margin-top:12px">Finding a route…</p>`; loadRoute(); }
    else pubs = `<select class="input" id="startsel" style="margin-top:12px">${Object.entries(starts).map(([k, v]) => `<option value="${k}" ${k === d.start ? "selected" : ""}>Start: ${esc(v)}</option>`).join("")}</select>
      <p class="small" style="margin:10px 0 0"><b>~${d.route.km} km</b> · about <b>${d.route.mins} min</b> walking</p>
      <ol class="routelist">${d.route.route.map((p, i) => `<li><b>${i + 1}</b>${esc(p.name)}<small>${esc(p.street)}</small></li>`).join("")}</ol>
      <div class="row" style="margin-top:12px"><button class="btn sm" id="reshuffle">🔀 New route</button><a class="btn sm" href="${mapsDir(d.route.start, d.route.route.slice(0, 6))}" target="_blank" rel="noopener">Map 1–6</a><a class="btn sm" href="${mapsDir(d.route.route[5], d.route.route.slice(6))}" target="_blank" rel="noopener">Map 7–12</a></div>`;
  }
  app.innerHTML = `
  <button class="back" id="back">← Back</button>
  <h2 style="margin-bottom:18px">Right, set it up</h2>

  <div class="card">${step(1, "Who's in charge? (God help us)")}
    <div class="namelist">${d.players.slice(0, 1).map((v, i) => `<div class="namerow"><button class="dot ${d.photos[i] ? "photo" : ""}" data-pic="${i}" aria-label="Pick a picture" style="background-color:${playerColor(i)};${d.photos[i] ? `background-image:url('${d.photos[i]}')` : ""}">${d.photos[i] ? "" : d.emojis[i] || esc((v.trim()[0] || "").toUpperCase()) || "+"}</button><input class="input" data-pl="${i}" maxlength="14" value="${esc(v)}" placeholder="${i === 0 ? "Your name" : "Name"}"></div>`).join("")}</div>
    <p class="small muted" style="margin:10px 0 0">Tap the circle to pick an emoji or add a photo. Your mates join with a code on the next screen.</p>
    <div class="label" style="margin:16px 0 8px">Name the crew (optional)</div>
    <input class="input" id="crew" maxlength="30" value="${esc(d.crew || "")}" placeholder="Sinéad's 30th, The Accounts Lads…">
  </div>

  <div class="card">${step(2, "How bad do you want it?")}
    <div class="tiles">${MODES.map(([k, em, l, sub]) => `<button class="tile" data-mode="${k}" aria-pressed="${d.mode === k}"><span class="em">${em}</span>${l}<small>${sub}</small></button>`).join("")}</div>
    <div class="label" style="margin:16px 0 8px">Rule types</div>
    <div class="chips">${CATS.map(([k, l]) => `<button class="chip" data-cat="${k}" aria-pressed="${d.cats.includes(k)}">${l}</button>`).join("")}</div>
  </div>

  <div class="card">${step(3, "Extras (optional)")}
    <p class="small muted" style="margin:0 0 10px">The proper 12 Pubs is a rule and a forfeit at every pub. That's the night. Turn these on if you want more going on.</p>
    <div class="toggle"><span><b>🎯 Challenges</b><small>A dare when you walk in, and surprise ones dropped mid-pint</small></span>${sw("challenges")}</div>
    <div class="toggle"><span><b>🤫 Secret missions</b><small>Everyone gets one, revealed at the end</small></span>${sw("missions")}</div>
    <div class="toggle"><span><b>🍺 Drinking forfeits</b><small>Off = forfeits never mean drinking more</small></span>${sw("drinkF")}</div>
    <div class="toggle"><span><b>🎟 Skip tokens each</b><small>Dodge one forfeit or challenge</small></span><div class="stepper">${[0, 1, 2].map((n) => `<button data-tok="${n}" aria-pressed="${d.tokens === n}">${n}</button>`).join("")}</div></div>
  </div>

  <div class="card">${step(4, "The pubs")}
    <div class="tiles">
      <button class="tile" data-pm="go" aria-pressed="${d.pubMode === "go"}"><span class="em">🎲</span>As you go</button>
      <button class="tile" data-pm="type" aria-pressed="${d.pubMode === "type"}"><span class="em">✍️</span>Type them</button>
      <button class="tile" data-pm="dublin" aria-pressed="${d.pubMode === "dublin"}"><span class="em">🇮🇪</span>Dublin</button>
    </div>${pubs}
  </div>
  ${bar(`<button class="btn pink big" id="create">Open the doors →</button>`)}`;

  $("back").onclick = () => { view = "home"; render(); };
  app.querySelectorAll("[data-pl]").forEach((i) => (i.oninput = () => {
    const k = +i.dataset.pl; d.players[k] = i.value;
    if (!d.photos[k] && !d.emojis[k]) i.previousElementSibling.textContent = (i.value.trim()[0] || "+").toUpperCase();
  }));
  $("crew").oninput = (e) => (d.crew = e.target.value);
  app.querySelectorAll("[data-pic]").forEach((b) => (b.onclick = () => {
    const k = +b.dataset.pic;
    pictureSheet({ title: `${d.players[k].trim() || "Player " + (k + 1)}'s picture`, emoji: d.emojis[k], photo: d.photos[k], note: PHOTO_NOTE_HOST,
      onEmoji: (e) => { d.emojis[k] = e; setupScreen(); },
      onPhoto: (url) => { d.photos[k] = url; setupScreen(); },
      onRemove: () => { d.photos[k] = null; setupScreen(); } });
  }));
  app.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { d.mode = b.dataset.mode; d.route = null; setupScreen(); }));
  app.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.cat;
    if (d.cats.includes(k)) { if (d.cats.length > 1) d.cats = d.cats.filter((x) => x !== k); else toast("Keep at least one"); }
    else d.cats.push(k);
    setupScreen();
  }));
  app.querySelectorAll("[data-sw]").forEach((b) => (b.onclick = () => { d[b.dataset.sw] = !d[b.dataset.sw]; setupScreen(); }));
  app.querySelectorAll("[data-tok]").forEach((b) => (b.onclick = () => { d.tokens = +b.dataset.tok; setupScreen(); }));
  app.querySelectorAll("[data-pm]").forEach((b) => (b.onclick = () => { d.pubMode = b.dataset.pm; setupScreen(); }));
  app.querySelectorAll("[data-ty]").forEach((i) => (i.oninput = () => (d.typed[+i.dataset.ty] = i.value)));
  if ($("startsel")) $("startsel").onchange = (e) => { d.start = e.target.value; d.route = null; setupScreen(); };
  if ($("reshuffle")) $("reshuffle").onclick = () => { d.route = null; setupScreen(); };
  $("create").onclick = createNight;
}

async function createNight() {
  const d = D;
  const people = d.players.map((s, i) => ({ n: s.trim(), emoji: d.emojis[i] || null, photo: d.photos[i] || null })).filter((p) => p.n);
  if (people.length < 1) { toast("Put in your name"); return; }
  const players = people.map(({ n, emoji }) => ({ n, emoji })); // photos never leave this phone
  const pubs = d.pubMode === "dublin" && d.route ? d.route.route
    : d.pubMode === "type" ? d.typed.map((name) => ({ name: name.trim() })) : [];
  const btn = $("create"); btn.disabled = true;
  const r = await act(call("room:create", { settings: { mode: d.mode, cats: d.cats, missions: d.missions, challenges: d.challenges, drinkF: d.drinkF, tokens: d.tokens, crew: (d.crew || "").trim() }, players, pubs }));
  btn.disabled = false;
  if (!r) return;
  ME = { code: r.code, role: "host", hostToken: r.hostToken, playerId: r.playerId, playerToken: r.playerToken }; saveSession(ME);
  prunePhotos(r.code);
  people.forEach((p, k) => { if (p.photo && r.state.players[k]) setPhoto(r.code, r.state.players[k].id, p.photo); });
  D.photos = []; // keep names and emoji for next time, not photos
  S = r.state; render(); window.scrollTo(0, 0);
}

/* ================= shared pieces ================= */
function topBar(menu = true) {
  return `<div class="topbar"><div class="minilogo"><span>12</span>PUBS</div><span class="codechip">${esc(S.code)}</span>${menu ? `<button class="iconbtn" id="menu" aria-label="Menu">⋯</button>` : ""}</div>`;
}
const joinLink = () => `${location.origin}/#join-${S.code}`;

function ruleList(editable) {
  return `<ul class="plan">${S.plan.map((p, i) => {
    const sp = p.type !== "rule";
    const gifts = (S.plants || []).filter((x) => x.pub === i).map((x) => `<span class="gift">🎁 ${esc(x.byName)}'s ${x.kind}${x.status === "pending" ? " · needs OK" : ""}</span>`).join("");
    return `<li><span class="n" style="--c:${pubColor(i, p.type)}">${i + 1}</span><div class="body"><b>${esc(p.name)}</b><div class="r" id="pr${i}">${sp ? `${SPECIAL[p.type].em} ${SPECIAL[p.type].tag}` : esc(p.rule.text)}</div>${gifts}</div>
      ${editable && !sp ? `<div class="acts"><button data-rr="${i}" aria-label="New rule">🎲</button><button data-ed="${i}" aria-label="Edit">✏️</button></div>` : ""}</li>`;
  }).join("")}</ul>`;
}
function wireRuleList() {
  app.querySelectorAll("[data-rr]").forEach((b) => (b.onclick = () => H("reroll", { i: +b.dataset.rr })));
  app.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => editRuleInline(+b.dataset.ed, $("pr" + b.dataset.ed))));
}
function editRuleInline(i, box) {
  box.innerHTML = `<div class="editbox"><input class="input" id="ei" maxlength="140" value="${esc(S.plan[i].rule.text)}"><div class="row"><button class="btn sm green" id="es">Save</button><button class="btn sm" id="ec">Cancel</button></div></div>`;
  const inp = $("ei"); inp.focus();
  const done = () => { inp.blur(); render(); };
  const save = async () => { const v = inp.value.trim(); if (v && v !== S.plan[i].rule.text) await H("editRule", { i, text: v }); done(); };
  $("es").onclick = save; $("ec").onclick = done;
  inp.onkeydown = (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") done(); };
}

function activeRules() {
  const i = S.pub, p = S.plan[i];
  if (!p || p.type !== "rule") return [];
  const out = [p.rule.text];
  if (S.settings.mode === "hard") for (let j = i - 1; j >= Math.max(0, i - 2); j--) if (S.plan[j].type === "rule") out.push(S.plan[j].rule.text);
  return out;
}

function pubCard(editable) {
  const i = S.pub, p = S.plan[i], sp = p.type !== "rule";
  let inner;
  if (sp) inner = `<div class="rule special"><div class="em">${SPECIAL[p.type].em}</div><div class="label" style="margin-top:8px">${SPECIAL[p.type].tag}</div><p>${esc(SPECIAL[p.type].text)}</p></div>`;
  else {
    const stack = activeRules().slice(1);
    inner = `<div class="rule ${p.rule.plantId ? "planted" : ""}"><div class="top"><span class="label">${p.rule.plantId ? `🎁 ${esc(p.rule.by)}'s surprise rule` : `📜 The rule${p.rule.cat === "custom" ? " · edited" : ""}`}</span>${editable ? `<button class="linkbtn" id="editrule">edit</button>` : ""}</div>
      <div id="rulebody"><p>${esc(p.rule.text)}</p></div>${p.picked ? `<div class="picked">${esc(p.rule.pick)}: <b>${esc(p.picked)}</b></div>` : ""}</div>
      ${stack.length ? `<div class="stack"><b>Still on from before:</b> ${stack.map(esc).join(" · ")}</div>` : ""}`;
  }
  return `<section class="pub" style="--c:${pubColor(i, p.type)}">
    <div class="pubtop"><span class="sticker">Pub ${i + 1} of 12</span><span class="t">${p.arrivedAt ? time(p.arrivedAt) : ""}</span></div>
    <div class="pubname" id="pn"><h1>${esc(p.name)}</h1>${editable ? `<button class="iconbtn" id="rename" aria-label="Rename">✏️</button>` : ""}</div>
    ${p.generic ? "" : `<a class="maplink" href="${mapsSearch(p)}" target="_blank" rel="noopener">📍 ${esc(p.street || "Open in Maps")}</a>`}
    <div class="dots">${S.plan.map((_, j) => `<i class="${j < i ? "on" : j === i ? "now" : ""}"></i>`).join("")}</div>
    ${inner}
    ${(() => { const n = surprisesToCome(); return n ? `<div class="coming">🎁 ${n} planted surpris${n === 1 ? "e" : "es"} still to come</div>` : ""; })()}
  </section>`;
}
const surprisesToCome = () => (S.plants || []).filter((x) => x.status === "approved" && !x.revealed && x.pub >= S.pub).length;

// Planted challenges that have popped up at this pub
function plantedCards(editable) {
  return (S.plants || []).filter((x) => x.kind === "challenge" && x.revealed && x.pub === S.pub).map((x) => `
    <div class="chal drop ${x.state !== "open" ? "done" : ""}">
      <div class="top"><span class="sticker">🎁 ${esc(x.byName)}'s surprise</span></div>
      <p>${esc(x.text)}</p>
      <div class="who">👯 Whole group${x.state === "done" ? " · ✅ Done" : ""}</div>
      ${editable && x.state === "open" ? `<div class="acts"><button class="btn sm green" data-pch="${x.id}">Done ✓</button></div>` : ""}
    </div>`).join("");
}
function pendingLine(p, editable) {
  const n = (p.dropPending ? 1 : 0) + (p.plantPending || 0);
  if (!n) return "";
  return editable
    ? `<button class="pending" id="dropnow">⚡ ${n === 1 ? "A surprise is" : n + " surprises are"} coming at this pub · <u>drop one now</u></button>`
    : `<div class="pending">⚡ A surprise could drop any minute…</div>`;
}

function challengeCard(c, kind, editable) {
  const v = c.group ? null : S.players.find((x) => x.n === c.victim);
  const isMe = ME.playerId && v && v.id === ME.playerId;
  const status = c.state === "done" ? "✅ Done" : c.state === "skipped" ? "🎟 Skipped" : "";
  return `<div class="chal ${kind === "drop" ? "drop" : ""} ${c.state !== "open" ? "done" : ""}">
    <div class="top"><span class="sticker ${kind === "drop" ? "" : "light"}">${kind === "drop" ? "⚡ Surprise!" : "🎯 Challenge"}</span><span class="int">${dots(c.int)}</span></div>
    <p>${esc(c.text)}</p>
    <div class="who">${c.group ? "👯 Whole group" : `${av(c.victim, true)} <b>${esc(c.victim)}</b>${isMe ? " (that's you!)" : ""}`}${status ? ` · ${status}` : ""}</div>
    ${editable && c.state === "open" ? `<div class="acts"><button class="btn sm green" data-ch="${kind}" data-a="done">Done ✓</button>${v && v.tokens > 0 ? `<button class="btn sm" data-ch="${kind}" data-a="skip">Skip 🎟</button>` : ""}${v ? `<button class="btn sm dice" data-ch="${kind}" data-a="new" aria-label="Pick someone else">🎲</button>` : ""}</div>` : ""}
  </div>`;
}

function forfeitCards(editable) {
  // in a big group, your phone only shows your own; the host still sees them all
  const list = !editable && S.players.length > 12 ? S.forfeits.filter((f) => f.playerId === ME.playerId) : S.forfeits;
  return list.map((f) => {
    const pl = S.players.find((p) => p.id === f.playerId);
    const mine = ME.playerId === f.playerId;
    return `<div class="chal forfeit ${mine ? "mine" : ""}">
      <div class="top"><span class="sticker">📣 ${f.by && f.by !== f.n ? `${esc(f.by)} caught ${mine ? "you" : esc(f.n)}` : mine ? "You got caught" : esc(f.n) + " got caught"}</span><span class="int">${dots(f.int)}</span></div>
      <p>${esc(f.text)}</p>
      ${editable || mine ? `<div class="acts"><button class="btn sm" data-f="done" data-id="${f.id}">Done ✓</button>${pl.tokens > 0 ? `<button class="btn sm" data-f="skip" data-id="${f.id}">Skip 🎟${pl.tokens}</button>` : ""}${!f.rerolled ? `<button class="btn sm" data-f="reroll" data-id="${f.id}">🎲 Re-roll</button>` : ""}</div>` : f.rerolled ? `<div class="small">Re-rolled. No more changes.</div>` : ""}
    </div>`;
  }).join("");
}

// Who's out tonight right now: late joiners count from their first pub, people who headed home don't
const isHere = (p) => (p.joinedPub || 0) <= Math.max(S.pub, 0) && p.leftPub == null;
const here = () => S.players.filter(isHere);
function scores() {
  const sorted = S.players.slice().sort((a, b) => b.forf - a.forf);
  const big = sorted.length > 12, top = big ? sorted.filter((p, i) => i < 10 || p.id === ME.playerId) : sorted;
  return `<div class="scores">${top.map((p) =>
    `<span class="score ${ME.playerId === p.id ? "mine" : ""} ${p.leftPub != null ? "gone" : ""}">${av(p.n, true)}${esc(p.n)} · ${p.forf}${p.leftPub != null ? " 🛌" : `<span class="tk">${"🎟".repeat(p.tokens)}</span>`}</span>`).join("")}${big ? `<span class="score">+${sorted.length - top.length} more</span>` : ""}</div>`;
}

/* ---------- who got caught (host or anyone with their own phone) ---------- */
function caughtBlock() {
  const list = here();
  return `<h3 class="h" style="margin-top:4px">Caught someone? 🫵</h3>
  ${list.length > 12 ? `<button class="btn pink" id="pickcaught" style="margin-bottom:22px">🫵 Someone got caught</button>`
    : `<div class="faces" style="margin-bottom:22px">${list.map((x) => `<button class="face" data-caught="${x.id}">${av(x.n)}${esc(x.n)}</button>`).join("")}</div>`}`;
}
function wireCaught(report) {
  app.querySelectorAll("[data-caught]").forEach((b) => (b.onclick = () => report(b.dataset.caught)));
  if ($("pickcaught")) $("pickcaught").onclick = () => pickPerson("🫵 Who got caught?", here(), report);
}
function removeCatchSheet() {
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:6px">↩️ Take back a forfeit</h3>
    <p class="small muted" style="margin:0 0 12px">Wrong person, or someone messing? It comes off their total.</p>
    ${S.catches.length ? S.catches.map((c) => `<div class="row" style="margin-bottom:8px"><span style="flex:1;min-width:0"><b>${esc(c.n)}</b><br><small class="muted">Pub ${c.pub + 1}${c.by ? ` · reported by ${esc(c.by)}` : ""}</small></span><button class="btn sm" data-rm="${c.id}" style="flex:0 0 auto;width:auto;margin:0">Remove</button></div>`).join("") : `<p class="muted">Nobody's been caught yet. Suspicious.</p>`}
    <button class="btn ghost" id="rmx" style="margin:16px 0 0">Close</button></div>`, true);
  ov.querySelector("#rmx").onclick = closeOverlay;
  ov.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (await H("removeCatch", { id: +b.dataset.rm })) { closeOverlay(); toast("Taken back ↩️"); } }));
}

/* ---------- comings and goings (host) ---------- */
function addPlayerSheet() {
  let emoji = null;
  const list = (META && META.emojis) || EMOJI_FALLBACK;
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:12px">👋 Who's joining?</h3>
    <input class="input" id="np" maxlength="14" placeholder="Their name">
    <div class="emojigrid" style="margin-top:12px">${list.map((e) => `<button data-e="${e}" aria-pressed="false">${e}</button>`).join("")}</div>
    <p class="small muted" style="margin:10px 0 12px">${S.pub >= 0 ? `They'll get ${S.settings.tokens} skip token${S.settings.tokens === 1 ? "" : "s"}${S.settings.missions ? " and a secret mission" : ""}, and can join on their own phone with code ${esc(S.code)}.` : "Add them now and they're in from the start."}</p>
    <button class="btn green" id="npadd">Add them</button><button class="btn ghost" id="npx" style="margin:0">Cancel</button></div>`, true);
  ov.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { emoji = b.dataset.e === emoji ? null : b.dataset.e; ov.querySelectorAll("[data-e]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.e === emoji)); }));
  ov.querySelector("#npx").onclick = closeOverlay;
  ov.querySelector("#npadd").onclick = async () => {
    const n = ov.querySelector("#np").value.trim(); if (!n) { toast("Give them a name"); return; }
    if (await H("addPlayer", { n, emoji })) { closeOverlay(); toast(`${n} is in 👋`); }
  };
  ov.querySelector("#np").focus();
}
function leaveSheet() {
  const gone = S.players.filter((p) => p.leftPub != null);
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:6px">🛌 Who's heading home?</h3>
    <p class="small muted" style="margin:0 0 12px">They'll drop out of catches and challenges. Their card will say when they left.</p>
    <div class="faces">${here().map((p) => `<button class="face" data-go="${p.id}">${av(p.n)}${esc(p.n)}</button>`).join("")}</div>
    ${gone.length ? `<h3 style="font-size:18px;margin:16px 0 8px">Came back?</h3><div class="chips">${gone.map((p) => `<button class="chip" data-back="${p.id}">↩ ${esc(p.n)}</button>`).join("")}</div>` : ""}
    <button class="btn ghost" id="lx" style="margin:16px 0 0">Close</button></div>`, true);
  ov.querySelector("#lx").onclick = closeOverlay;
  ov.querySelectorAll("[data-go]").forEach((b) => (b.onclick = async () => {
    const p = S.players.find((x) => x.id === b.dataset.go);
    if (await H("leave", { playerId: p.id })) { closeOverlay(); toast(`Night night, ${p.n} 🛌`); }
  }));
  ov.querySelectorAll("[data-back]").forEach((b) => (b.onclick = async () => { if (await H("back", { playerId: b.dataset.back })) closeOverlay(); }));
}
function handoverSheet() {
  const onPhones = here().filter((p) => p.claimed);
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:6px">👑 Hand over hosting</h3>
    <p class="small muted" style="margin:0 0 12px">Their phone runs the night from now on. Yours goes back to being a normal phone.</p>
    ${onPhones.length ? `<div class="faces">${onPhones.map((p) => `<button class="face" data-to="${p.id}">${av(p.n)}${esc(p.n)}<small>📱 on their phone</small></button>`).join("")}</div>` : `<p class="small" style="margin:0 0 4px">Nobody's in on their own phone yet.</p>`}
    <button class="btn blue" id="hqr" style="margin-top:14px">Or let them scan to take over</button>
    <button class="btn ghost" id="hx" style="margin:0">Cancel</button></div>`, true);
  ov.querySelector("#hx").onclick = closeOverlay;
  ov.querySelectorAll("[data-to]").forEach((b) => (b.onclick = () => {
    const p = S.players.find((x) => x.id === b.dataset.to);
    if (b.dataset.armed) { act(call("host:handover", { playerId: p.id })); return; }
    b.dataset.armed = "1"; b.querySelector("small").textContent = "tap again to hand over";
  }));
  ov.querySelector("#hqr").onclick = async () => {
    const r = await act(call("host:takeover-code"));
    if (!r) return;
    const link = `${location.origin}/#takeover-${S.code}-${r.token}`;
    const q = openOverlay(`<div class="card center"><div class="qr" data-link="${esc(link)}">${qrSvg(link)}</div><b class="display" style="font-size:22px">Scan to take over</b>
      <p class="small" style="margin:4px 0 14px">Works once, for 15 minutes. Whoever opens it runs the night.</p>
      <button class="btn sm" id="qcopy" style="margin-bottom:10px">Copy link instead</button>
      <button class="btn ghost" id="qx" style="margin:0">Close</button></div>`);
    q.querySelector("#qcopy").onclick = () => copyText(link, "Link copied. Send it to them.");
    q.querySelector("#qx").onclick = closeOverlay;
  };
}
function feedLog() {
  return `<details class="log" ${logOpen ? "open" : ""}><summary>Tonight so far</summary><ul class="feed">${S.feed.slice(0, 30).map((f) =>
    `<li>${av(f.who, true)}<span>${f.who ? `<b>${esc(f.who)}</b> ` : ""}${esc(f.text)}</span><span class="tm">${time(f.t)}</span></li>`).join("")}</ul></details>`;
}

/* ---------- overlays (outside #app so server updates don't close them) ---------- */
let ovEl = null;
function openOverlay(html, sheet) {
  closeOverlay();
  ovEl = document.createElement("div"); ovEl.className = "overlay" + (sheet ? " sheet" : ""); ovEl.innerHTML = html;
  ovEl.onclick = (e) => { if (e.target === ovEl) closeOverlay(); };
  document.body.appendChild(ovEl);
  return ovEl;
}
function closeOverlay() { if (ovEl) { ovEl.remove(); ovEl = null; } }

function missionCard(title, mission, swapped, onSwap) {
  const ov = openOverlay(`<div class="card" style="background:var(--purple)"><span class="sticker">🤫 ${esc(title)}</span>
    <div class="bigmission">${esc(mission)}</div>
    <p class="small" style="margin:0 0 16px">Pull it off before the finale. If someone guesses it first, it fails.</p>
    <button class="btn ink" id="hide">Got it, hide it</button>
    ${!swapped ? `<button class="btn ghost" id="swap" style="margin:0">Impossible? Swap it (once)</button>` : ""}</div>`);
  ov.querySelector("#hide").onclick = closeOverlay;
  const sw = ov.querySelector("#swap");
  if (sw) sw.onclick = async () => { const r = await act(onSwap()); if (r) missionCard(title, r.mission, true, onSwap); };
}

let endArmed = false;
function menuSheet(items) {
  const ov = openOverlay(`<div class="card">${items.map((it, k) => `<button class="btn ${it.cls || ""}" data-k="${k}">${it.label}</button>`).join("")}<button class="btn ghost" id="close" style="margin:0">Close</button></div>`, true);
  ov.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => items[+b.dataset.k].fn(b)));
  ov.querySelector("#close").onclick = closeOverlay;
}

/* ---------- Plant a surprise ---------- */
function plantForm(who, onSubmit) {
  let kind = "rule";
  const both = S.settings.challenges !== false; // with challenges off you can only plant a rule
  const ov = openOverlay(`<div class="card" style="background:var(--orange)">
    <span class="sticker">🎁 Plant a ${both ? "surprise" : "secret rule"}${who ? ` · ${esc(who)}` : ""}</span>
    ${both ? `<div class="tiles" style="grid-template-columns:1fr 1fr;margin:16px 0 12px">
      <button class="tile" data-k="rule" aria-pressed="true"><span class="em">📜</span>A rule</button>
      <button class="tile" data-k="challenge" aria-pressed="false"><span class="em">🎯</span>A challenge</button>
    </div>` : `<div style="height:14px"></div>`}
    <textarea class="input" id="ptext" rows="3" maxlength="140" placeholder="e.g. Everyone has to call Cian 'Your Majesty'"></textarea>
    <p class="small" style="margin:10px 0 14px">It lands on a random pub and pops up mid-pint. The host OKs it without seeing it. Keep it fun, not mean.</p>
    <button class="btn ink" id="psend">Plant it 🎁</button>
    <button class="btn ghost" id="pcancel" style="margin:0">Cancel</button></div>`);
  const ph = { rule: "e.g. Everyone has to call Cian 'Your Majesty'", challenge: "e.g. Get the whole pub to sing happy birthday to Niamh" };
  ov.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.k; ov.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", x === b)); ov.querySelector("#ptext").placeholder = ph[kind];
  }));
  ov.querySelector("#pcancel").onclick = closeOverlay;
  ov.querySelector("#psend").onclick = async () => {
    const text = ov.querySelector("#ptext").value.trim();
    if (text.length < 3) { toast("Write your surprise first"); return; }
    const r = await onSubmit(kind, text);
    if (r) { closeOverlay(); toast("Planted 🎁 Nobody knows where."); }
  };
  ov.querySelector("#ptext").focus();
}
// Host phone: hand it to someone to plant theirs in secret
function hostPlant() {
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:12px">Who's planting?</h3>
    <div class="faces">${S.players.map((p) => `<button class="face" data-who="${p.id}">${av(p.n)}${esc(p.n)}</button>`).join("")}</div>
    <button class="btn ghost" id="wclose" style="margin:14px 0 0">Cancel</button></div>`, true);
  ov.querySelector("#wclose").onclick = closeOverlay;
  ov.querySelectorAll("[data-who]").forEach((b) => (b.onclick = () => {
    const p = S.players.find((x) => x.id === b.dataset.who);
    const cov = openOverlay(`<div class="card center" style="background:var(--yellow)">${av(p.n)}
      <h2 style="margin:12px 0 6px">Only ${esc(p.n)} looks 👀</h2>
      <p class="small" style="margin:0 0 16px">Host, hand the phone over and look away.</p>
      <button class="btn ink" id="go2">I'm ${esc(p.n)}, let me plant</button>
      <button class="btn ghost" id="no2" style="margin:0">Cancel</button></div>`);
    cov.querySelector("#no2").onclick = closeOverlay;
    cov.querySelector("#go2").onclick = () => plantForm(p.n, (kind, text) => H("plantAdd", { playerId: p.id, kind, text }));
  }));
}
function peekPlant(x) {
  const ov = openOverlay(`<div class="card center"><div style="font-size:48px">👀</div><h2 style="margin:6px 0">Peek at ${esc(x.byName)}'s ${x.kind}?</h2>
    <p style="margin:0 0 16px">It won't be a surprise for you anymore.</p>
    <button class="btn pink" id="pk">Show me</button><button class="btn ghost" id="pkno" style="margin:0">Keep the surprise</button></div>`);
  ov.querySelector("#pkno").onclick = closeOverlay;
  ov.querySelector("#pk").onclick = async () => {
    const r = await H("plantPeek", { id: x.id });
    if (r) openOverlay(`<div class="card" style="background:var(--orange)"><span class="sticker">🎁 ${esc(x.byName)}'s ${x.kind} · Pub ${x.pub + 1}</span><div class="bigmission">${esc(r.text)}</div><button class="btn ink" id="pkok" style="margin:0">Close</button></div>`).querySelector("#pkok").onclick = closeOverlay;
  };
}
function surprisesCard() {
  const list = S.plants || [], waiting = list.filter((x) => x.status === "pending").length;
  return `<div class="card" style="background:var(--orange)">
    <div class="row" style="align-items:flex-start"><div><h3 style="font-size:21px">🎁 Planted surprises</h3>
      <p class="small" style="margin:4px 0 0">Mates plant secret rules and challenges that pop up mid-pint. You OK them without seeing them. ${waiting ? `<b>${waiting} waiting for your OK.</b>` : ""}</p></div></div>
    ${list.length ? `<div class="card tight" style="margin:12px 0 0;box-shadow:none">${list.map((x) => `<div class="mrow" style="align-items:center">${av(x.byName, true)}<div style="flex:1"><b>${esc(x.byName)}'s ${x.kind}</b><div class="small">Pub ${x.pub + 1}${x.status === "approved" ? " · ✓ OK'd" : ""}</div></div>
      <div class="plantacts">${x.status === "pending" ? `<button data-ok="${x.id}" aria-label="OK">✓</button><button data-no="${x.id}" aria-label="Bin it">✗</button>` : ""}<button data-peek="${x.id}" aria-label="Peek">👀</button></div></div>`).join("")}</div>` : ""}
    <button class="btn sm" id="plantit" style="margin-top:12px">+ Plant one on this phone</button>
  </div>`;
}
function wireSurprises() {
  if ($("plantit")) $("plantit").onclick = hostPlant;
  app.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => H("plantDecide", { id: +b.dataset.ok, ok: true })));
  app.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => H("plantDecide", { id: +b.dataset.no, ok: false })));
  app.querySelectorAll("[data-peek]").forEach((b) => (b.onclick = () => peekPlant(S.plants.find((x) => x.id === +b.dataset.peek))));
}
// Guests: plant from your own phone, before the night
function myPlantsBlock() {
  if (ME.role !== "player" || S.pub >= 0) return "";
  const mine = (S.plants || []).filter((x) => x.by === ME.playerId);
  return `<div class="card" style="background:var(--orange)"><h3 style="font-size:21px">🎁 Plant a surprise</h3>
    <p class="small" style="margin:4px 0 12px">A secret ${S.settings.challenges !== false ? "rule or challenge" : "rule"} that pops up at a random pub. Up to 2.</p>
    ${mine.map((x) => `<div class="mrow" style="align-items:center"><div style="flex:1"><b>Your ${x.kind}</b><div class="small">Pub ${x.pub + 1} · ${x.status === "approved" ? "✓ OK'd" : "waiting for the host"}</div></div><button class="linkbtn" data-unplant="${x.id}">remove</button></div>`).join("")}
    ${mine.length < 2 ? `<button class="btn ink sm" id="myplant" style="margin-top:${mine.length ? 10 : 0}px">🎁 Plant one</button>` : ""}</div>`;
}
function wireMyPlants() {
  if ($("myplant")) $("myplant").onclick = () => plantForm(null, (kind, text) => act(call("plant:add", { kind, text })));
  app.querySelectorAll("[data-unplant]").forEach((b) => (b.onclick = () => act(call("plant:remove", { id: +b.dataset.unplant }))));
}

/* ================= HOST: PLAN ================= */
function planScreen() {
  app.innerHTML = `
  <button class="back" id="cancel">← Cancel</button>
  <div class="card center" style="background:var(--blue)">${inviteBlock(inviteLine())}</div>
  <h3 class="h">${S.players.length} in so far</h3>
  <div class="pics">${S.players.map((p) => `<button class="pic" data-pp="${p.id}">${av(p.n)}<small>${esc(p.n)}</small></button>`).join("")}${S.players.length < MAX_PLAYERS ? `<button class="pic" id="addlate"><span class="av" style="background:var(--white)">＋</span><small>No phone?</small></button>` : ""}</div>
  ${writeMissionBlock()}
  <h2 style="margin-top:22px">Tonight's rules</h2>
  <p class="muted" style="margin:6px 0 16px">${MODE_LABEL[S.settings.mode]}${S.settings.mode === "hard" ? " · each rule lasts 3 pubs" : ""}. Don't like one? 🎲 it. Nobody will know.</p>
  <div class="card">${ruleList(true)}</div>
  ${surprisesCard()}
  ${bar(S.players.length < 2 ? `<button class="btn big" disabled>Waiting on your mates… any minute now</button>` : `<button class="btn pink big" id="go">Start the night with ${S.players.length} 🍻</button>`)}`;
  wireRuleList();
  $("cancel").onclick = leaveRoom;
  wireCopyInvite(app);
  app.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => editPlayerPicture(S.players.find((p) => p.id === b.dataset.pp))));
  if ($("addlate")) $("addlate").onclick = addPlayerSheet;
  wireSurprises();
  wireWriteMission();
  if ($("go")) $("go").onclick = () => lookAfterScreen(() => H("start"), "We're sound. Let's go 🍻");
}

/* ================= HOST: MISSIONS (pass the phone) ================= */
function missionsHost() {
  const pre = S.pub < 0, left = S.players.filter((p) => !p.missionSeen).length;
  app.innerHTML = `
  <h2>🤫 Secret missions</h2>
  <p class="muted" style="margin:6px 0 18px">Everyone's mission is on their own phone. ${S.players.length - left} of ${S.players.length} have looked. Tap your name to see yours.</p>
  <button class="btn sm blue" id="scan" style="margin-bottom:18px">📱 Show the code again</button>
  <div class="faces">${S.players.filter((p) => !p.claimed || p.id === ME.playerId).map((p) => `<button class="face" data-id="${p.id}">${av(p.n)}${esc(p.n)}<small>${p.id === ME.playerId ? "that's you" : p.missionSeen ? "✓ seen" : "no phone, tap me"}</small></button>`).join("")}</div>
  ${pre ? `<div style="height:18px"></div>${surprisesCard()}` : ""}
  ${bar(`<button class="btn ${pre ? "pink big" : "yellow"}" id="done">${pre ? (left ? `Start the night (${left} still to look)` : "Everyone's seen theirs. Go! 🍻") : "← Back to the pub"}</button>`)}`;
  app.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => passPhone(b.dataset.id)));
  wireSurprises();
  $("scan").onclick = inviteSheet;
  $("done").onclick = () => H("missionsDone");
}
function passPhone(id) {
  const p = S.players.find((x) => x.id === id);
  const ov = openOverlay(`<div class="card center" style="background:var(--yellow)">${av(p.n)}
    <h2 style="margin:12px 0 6px">Only ${esc(p.n)} looks 👀</h2>
    <p class="small" style="margin:0 0 16px">Everyone else, eyes off the phone.</p>
    <button class="btn ink" id="show">Show my mission</button>
    <button class="btn ghost" id="notme" style="margin:0">Not me</button></div>`);
  ov.querySelector("#notme").onclick = closeOverlay;
  ov.querySelector("#show").onclick = async () => {
    const r = await H("peek", { playerId: id });
    if (r) missionCard(`${p.n}'s mission`, r.mission, r.swapped, () => host("swap", { playerId: id }));
  };
}

/* ================= HOST: LIVE ================= */
function liveHost() {
  const p = S.plan[S.pub], last = S.pub >= 11, isRule = p.type === "rule";
  app.innerHTML = `${topBar()}
  ${myMissionButton()}
  ${pubCard(true)}
  ${forfeitCards(true)}
  ${isRule ? caughtBlock() : ""}
  ${p.arrive ? challengeCard(p.arrive, "arrive", true) : ""}
  ${p.drop ? challengeCard(p.drop, "drop", true) : ""}
  ${plantedCards(true)}
  ${pendingLine(p, true)}
  <h3 class="h">The hall of shame</h3>
  ${scores()}
  ${feedLog()}
  ${last ? "" : `<button class="btn ghost" id="endhere" style="margin-top:18px">${endArmed ? `Tap again to end at ${esc(p.name)}` : `🏁 Calling it? End the night here`}</button>`}
  ${bar(`<button class="btn yellow big" id="next">${last ? "Finish the night 🎉" : "Next pub →"}</button>`)}`;

  if ($("rename")) $("rename").onclick = () => {
    $("pn").innerHTML = `<input class="input" id="rn" maxlength="60" value="${p.generic ? "" : esc(p.name)}" placeholder="Pub name"><button class="btn sm ink" id="rns" style="flex:0 0 auto">Save</button>`;
    const inp = $("rn"); inp.focus();
    const save = async () => { const v = inp.value.trim(); inp.blur(); if (v) await H("rename", { i: S.pub, name: v }); render(); };
    $("rns").onclick = save; inp.onkeydown = (e) => { if (e.key === "Enter") save(); };
  };
  if ($("editrule")) $("editrule").onclick = () => editRuleInline(S.pub, $("rulebody"));
  if ($("dropnow")) $("dropnow").onclick = () => H("dropNow");
  app.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => H("challenge", { kind: b.dataset.ch, action: b.dataset.a })));
  app.querySelectorAll("[data-pch]").forEach((b) => (b.onclick = () => H("challenge", { kind: "plant", id: +b.dataset.pch, action: "done" })));
  if ($("endhere")) $("endhere").onclick = () => {
    if (endArmed) { endArmed = false; H("finish"); return; }
    endArmed = true; render(); setTimeout(() => { if (endArmed) { endArmed = false; if (S && S.phase === "live") render(); } }, 3500);
  };
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => H("forfeit", { id: +b.dataset.id, action: b.dataset.f })));
  wireCaught(async (playerId) => {
    if (await H("caught", { playerId })) { vibrate(); window.scrollTo({ top: app.querySelector(".forfeit")?.offsetTop - 12 || 0, behavior: "smooth" }); }
  });
  $("next").onclick = () => H(last ? "finish" : "next");
  wireMyMission();
  $("menu").onclick = () => menuSheet([
    { label: "📜 How it works", cls: "", fn: howSheet },
    { label: `📱 Invite mates (code ${esc(S.code)})`, cls: "blue", fn: inviteSheet },
    ...(S.players.length < MAX_PLAYERS ? [{ label: "👋 Someone's joined", cls: "green", fn: addPlayerSheet }] : []),
    { label: "🛌 Someone's heading home", cls: "", fn: leaveSheet },
    { label: "↩️ Take back a forfeit", cls: "", fn: () => { closeOverlay(); removeCatchSheet(); } },
    ...(ME.playerId ? [{ label: "💬 Quote of the night", cls: "yellow", fn: () => { closeOverlay(); quoteSheet(); } }] : []),
    { label: "👑 Hand over hosting", cls: "yellow", fn: handoverSheet },
    ...(S.settings.missions ? [{ label: "🤫 Peek at a secret mission", cls: "purple", fn: () => { closeOverlay(); H("peekMissions"); } }] : []),
    { label: "🏁 End the night early", cls: "", fn: (b) => {
      if (endArmed) { endArmed = false; closeOverlay(); H("finish"); return; }
      endArmed = true; b.textContent = "Tap again to end it"; b.classList.add("pink");
      setTimeout(() => { endArmed = false; }, 3000);
    } },
    { label: "🫂 Look after each other", cls: "", fn: () => lookAfterScreen(null, "Back to the night") },
    { label: "📄 Terms & privacy", cls: "", fn: legalSheet },
  ]);
}

/* ================= HOST: REVEAL ================= */
function revealHost() {
  app.innerHTML = `
  <h2>🤫 The reveal</h2>
  <p class="muted" style="margin:6px 0 18px">Results came in during the night. Read them out, fix any that are wrong, then on to the recap.</p>
  ${S.players.map((p, i) => `<div class="card" style="background:${playerColor(i)}">
    <div class="row" style="justify-content:flex-start"><span style="flex:0">${av(p.n)}</span><b class="display" style="font-size:22px">${esc(p.n)}</b></div>
    <p style="font:800 19px/1.3 var(--body);margin:12px 0 0">${esc(p.mission ? p.mission.text : "")}</p>${missionBy(p)}
    <div class="verdict"><button class="btn yes" data-id="${p.id}" data-r="1" aria-pressed="${p.mission && p.mission.result === true}">✓ Nailed it</button><button class="btn no" data-id="${p.id}" data-r="0" aria-pressed="${p.mission && p.mission.result === false}">✗ Failed</button></div></div>`).join("")}
  ${bar(`<button class="btn pink big" id="torecap">See the recap →</button>`)}`;
  app.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => H("missionResult", { playerId: b.dataset.id, result: b.dataset.r === "1" })));
  $("torecap").onclick = () => H("revealDone");
}

const missionBy = (p) => p.mission && (p.mission.byName || p.mission.busted) ? `<p class="small" style="margin:6px 0 0">${p.mission.byName ? `Set by ${esc(p.mission.byName)}` : ""}${p.mission.busted ? `${p.mission.byName ? " · " : ""}🚨 busted by ${esc(p.mission.bustedBy)}` : ""}</p>` : "";

/* ================= GUESTS ================= */
function claimScreen() {
  const names = S.phase === "recap" ? S.players : S.players.filter((p) => !p.claimed);
  app.innerHTML = `
  <button class="back" id="leave">← Leave</button>
  <h2>${S.phase === "recap" ? "Which one are you?" : "What's your name?"}</h2>
  ${S.phase === "recap" ? `<p class="muted" style="margin:6px 0 18px">Room ${esc(S.code)}. The night's over. Pick your name to see your card first.</p>` : `<p class="muted" style="margin:6px 0 0">Room ${esc(S.code)}. Type your name and you're in.</p>`}
  ${selfJoinBlock()}
  ${names.length ? `${S.phase === "recap" ? "" : `<h3 class="h" style="margin-top:18px">Or did the host add you?</h3>`}
  <div class="faces">${names.map((p) => `<button class="face" data-id="${p.id}" ${p.claimed ? "disabled" : ""}>${av(p.n)}${esc(p.n)}<small>${p.claimed ? "taken" : ""}</small></button>`).join("")}</div>` : ""}
  <p class="center" style="margin-top:20px"><button class="linkbtn" id="watch">${S.phase === "recap" ? "Just show me the recap" : "Just here to watch"}</button></p>`;
  $("leave").onclick = leaveRoom;
  $("watch").onclick = () => { watchOnly = true; render(); };
  if ($("selfgo")) {
    const go = async () => {
      const name = $("selfname").value.trim(); if (!name) { toast("Type your name"); return; }
      const r = await act(call("player:selfJoin", { name }));
      if (!r) return;
      if (document.activeElement) document.activeElement.blur(); // the screen may already have redrawn
      Object.assign(ME, { role: "player", playerId: r.playerId, playerToken: r.playerToken }); saveSession(ME); render();
    };
    $("selfgo").onclick = go;
    $("selfname").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }
  app.querySelectorAll("[data-id]:not([disabled])").forEach((b) => (b.onclick = async () => {
    const r = await act(call("player:claim", { playerId: b.dataset.id }));
    if (!r) return;
    Object.assign(ME, { role: "player", playerId: r.playerId, playerToken: r.playerToken }); saveSession(ME); render();
  }));
}

function selfJoinBlock() {
  if (!canSelfJoin()) return "";
  return `<div class="card" style="background:var(--green);margin-top:16px"><div class="row"><input class="input" id="selfname" maxlength="14" placeholder="Your name" autocomplete="off" style="flex:1;min-width:0"><button class="btn sm ink" id="selfgo" style="flex:0 0 auto;width:auto;margin:0">I'm in</button></div></div>`;
}

function myMissionButton(big) {
  if (!S.settings.missions || !ME.playerId) return "";
  const me = S.players.find((p) => p.id === ME.playerId);
  const label = me && me.missionDone === true ? "✅ Mission done. Legend." : me && me.missionDone === false ? "🚨 Busted. Tragic." : "🤫 My secret mission";
  return `<button class="btn purple ${big ? "big" : ""}" id="mymission">${label}</button>`;
}
function wireMyMission() {
  const b = $("mymission");
  if (b) b.onclick = async () => { const r = await act(call("mission:mine")); if (r) missionSheet(r); };
}
// Your mission, plus the one you wrote for someone else
function missionSheet(m) {
  const live = S.phase === "live";
  const status = m.result === true ? `<p style="margin:0 0 14px"><b>✅ Done.</b> You handed out a forfeit. Unreal.</p>`
    : m.result === false ? `<p style="margin:0 0 14px"><b>🚨 Busted.</b> Should've been sneakier.</p>` : "";
  const wrote = !m.wrote ? "" : `<div class="card tight" style="margin:16px 0 0;box-shadow:none;background:var(--white)">
    <div class="label" style="margin-bottom:6px">The one you wrote</div><b>${esc(m.wrote)}</b>
    <p class="small" style="margin:8px 0 0">${m.wroteLive ? `Someone's got it. Catch them at it and they get a forfeit. Wrong guess and you get one. ${m.bustsLeft} guess${m.bustsLeft === 1 ? "" : "es"} left.`
      : m.wroteDone === true ? "They pulled it off. You've been played." : m.wroteDone === false ? "Busted. Justice." : "It got swapped out. Coward."}</p>
    ${live && m.wroteLive && m.bustsLeft > 0 ? `<button class="btn pink sm" id="bust" style="margin:10px 0 0">🚨 Caught someone doing mine</button>` : ""}</div>`;
  const ov = openOverlay(`<div class="card" style="background:var(--purple)"><span class="sticker">🤫 Your mission</span>
    <div class="bigmission">${esc(m.mission || "")}</div>
    ${m.written ? `<p class="small" style="margin:0 0 10px">Written by someone here 👀 They're watching.</p>` : ""}
    ${status || `<p class="small" style="margin:0 0 16px">Pull it off and you hand someone a forfeit. Get caught by whoever wrote it and you take one.</p>`}
    ${live && m.result === null ? `<button class="btn yellow" id="did">🎉 I pulled it off</button>` : ""}
    <button class="btn ink" id="hide">Hide it</button>
    ${!m.swapped && m.result === null ? `<button class="btn ghost" id="swap" style="margin:0">Impossible? Swap it (once)</button>` : ""}
    ${wrote}</div>`);
  ov.querySelector("#hide").onclick = closeOverlay;
  const sw = ov.querySelector("#swap");
  if (sw) sw.onclick = async () => { const r = await act(call("mission:swap")); if (r) missionSheet(r); };
  const did = ov.querySelector("#did");
  if (did) did.onclick = () => pickPerson("Who gets your forfeit? 😈", here().filter((p) => p.id !== ME.playerId), async (id) => {
    if (await act(call("mission:done", { giveTo: id }))) { vibrate(); toast("Mission done 🎉"); }
  });
  const bust = ov.querySelector("#bust");
  if (bust) bust.onclick = () => pickPerson("Who was doing your mission? 🚨", here().filter((p) => p.id !== ME.playerId), async (id) => {
    const r = await act(call("mission:bust", { playerId: id }));
    if (r) { vibrate(); toast(r.right ? "Busted them 🚨" : "Wrong. Forfeit for you 🙈"); }
  });
}
// Before the night: write a mission for someone else
function writeMissionBlock() {
  if (!S.settings.missions || !ME.playerId || S.phase !== "plan") return "";
  const me = S.players.find((p) => p.id === ME.playerId), n = S.players.length, w = S.writers || 0;
  const small = n < 5;
  return `<div class="card" style="background:var(--purple)"><h3 style="font-size:21px">🤫 Write a secret mission</h3>
    <p class="small" style="margin:4px 0 12px">${small ? "Once there's 5 of you, the missions you write get shuffled round the group. Nobody gets their own." : "They get shuffled round the group. Nobody gets their own, and you can bust whoever gets yours."} ${w} of ${n} written.</p>
    ${me && me.wrote && !writingAgain ? `<div class="row"><b style="flex:1">✓ Yours is in. Someone's in trouble.</b><button class="btn sm" id="rewrite" style="flex:0 0 auto;width:auto;margin:0">Rewrite</button></div>`
      : `<textarea class="input" id="wm" maxlength="140" rows="2" placeholder="Get the barman to call you 'boss'"></textarea><button class="btn ink sm" id="wmsave" style="margin-top:10px">Save it</button>`}</div>`;
}
let writingAgain = false;
function wireWriteMission() {
  if ($("rewrite")) $("rewrite").onclick = () => { writingAgain = true; render(); };
  if ($("wmsave")) $("wmsave").onclick = async () => {
    const text = $("wm").value.trim(); if (!text) { toast("Write something first"); return; }
    const r = await act(call("mission:write", { text }));
    if (r) { writingAgain = false; if (document.activeElement) document.activeElement.blur(); toast("Mission saved 🤫"); render(); }
  };
}
// Pick someone from a list (searchable when there's loads of you)
function pickPerson(title, list, onPick) {
  const ov = openOverlay(`<div class="card"><h3 style="font-size:22px;margin-bottom:12px">${title}</h3>
    ${list.length > 12 ? `<input class="input" id="ppq" maxlength="14" placeholder="Search names" autocomplete="off" style="margin-bottom:12px">` : ""}
    <div class="faces">${list.map((x) => `<button class="face" data-pp="${x.id}" data-name="${esc(x.n.toLowerCase())}">${av(x.n)}${esc(x.n)}</button>`).join("")}</div>
    <button class="btn ghost" id="ppx" style="margin:16px 0 0">Cancel</button></div>`, true);
  ov.querySelector("#ppx").onclick = closeOverlay;
  const q = ov.querySelector("#ppq");
  if (q) q.oninput = (e) => { const v = e.target.value.trim().toLowerCase(); ov.querySelectorAll("[data-pp]").forEach((b) => { b.style.display = b.dataset.name.includes(v) ? "" : "none"; }); };
  ov.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => { closeOverlay(); onPick(b.dataset.pp); }));
}
// Quote of the night: anyone can add one, the host can bin the messers
function quoteSheet() {
  const qs = S.quotes || [];
  const ov = openOverlay(`<div class="card" style="background:var(--yellow)"><h3 style="font-size:22px;margin-bottom:6px">💬 Quote of the night</h3>
    <p class="small" style="margin:0 0 12px">Someone said something they'll regret? Get it on the recap.</p>
    <input class="input" id="qt" maxlength="120" placeholder="I'm not even drunk, I'm just Irish">
    <button class="btn ink" id="qsave" style="margin-top:10px">Put it on the recap</button>
    ${qs.length ? `<div style="margin-top:14px">${qs.map((q) => `<div class="row" style="margin-bottom:8px"><span style="flex:1;min-width:0">“${esc(q.text)}”<br><small class="muted">added by ${esc(q.byName)}</small></span>${isHost() ? `<button class="btn sm" data-rq="${q.id}" style="flex:0 0 auto;width:auto;margin:0">Bin it</button>` : ""}</div>`).join("")}</div>` : ""}
    <button class="btn ghost" id="qx" style="margin:12px 0 0">Close</button></div>`, true);
  ov.querySelector("#qx").onclick = closeOverlay;
  ov.querySelector("#qsave").onclick = async () => {
    const text = ov.querySelector("#qt").value.trim(); if (!text) { toast("Type what they said"); return; }
    if (await act(call("quote:add", { text }))) { closeOverlay(); toast("On the recap 💬"); }
  };
  ov.querySelectorAll("[data-rq]").forEach((b) => (b.onclick = async () => { if (await H("quoteRemove", { id: +b.dataset.rq })) closeOverlay(); }));
}
function wireGuest() {
  wireMyMission();
  const m = $("menu");
  if (m) m.onclick = () => menuSheet([
    ...(ME.role === "watcher" && (S.players.some((p) => !p.claimed) || canSelfJoin()) ? [{ label: "🙋 Join in", cls: "yellow", fn: () => { closeOverlay(); watchOnly = false; render(); } }] : []),
    ...(ME.role === "player" ? [{ label: "🖼 Change my picture", cls: "green", fn: () => { closeOverlay(); editMyPicture(); } }] : []),
    ...(ME.role === "player" && S.phase === "live" ? (() => {
      const me = S.players.find((p) => p.id === ME.playerId);
      if (!me) return [];
      if (me.leftPub != null) return [{ label: "🎉 I'm back!", cls: "yellow", fn: () => { closeOverlay(); act(call("player:back")); } }];
      return [{ label: "🛌 I'm heading home", cls: "", fn: (b) => {
        if (b.dataset.armed) { closeOverlay(); act(call("player:leave")).then((r) => r && toast("Get home safe 🛌")); return; }
        b.dataset.armed = "1"; b.textContent = "Tap again: I'm heading home"; b.classList.add("pink");
      } }];
    })() : []),
    ...(S.phase !== "recap" ? [{ label: "📜 How it works", cls: "", fn: howSheet }] : []),
    ...(S.phase === "live" && ME.playerId ? [{ label: "💬 Quote of the night", cls: "yellow", fn: () => { closeOverlay(); quoteSheet(); } }] : []),
    ...(S.phase === "live" ? [{ label: "🫂 Look after each other", cls: "", fn: () => lookAfterScreen(null, "Back to the night") }] : []),
    { label: "📄 Terms & privacy", cls: "", fn: legalSheet },
    { label: "👋 Leave room", cls: "", fn: leaveRoom },
  ]);
}

function waitScreen() {
  const me = ME.playerId && S.players.find((p) => p.id === ME.playerId);
  app.innerHTML = `${topBar()}
  <div class="card center" style="background:var(--green)">
    <div style="font-size:54px">🍻</div>
    <h2 style="margin:6px 0">${me ? `You're in, ${esc(me.n)}!` : "You're in!"}</h2>
    <p style="margin:0">The host is picking tonight's rules. Get a round in, this updates by itself.</p>
  </div>
  ${me ? `<button class="btn yellow" id="mypic">${av(me.n, true)} Pick your emoji or photo</button>` : ""}
  ${writeMissionBlock()}
  ${myPlantsBlock()}
  <div class="faces">${S.players.map((p) => `<div class="face">${av(p.n)}${esc(p.n)}<small>${p.claimed ? "📱 here" : ""}</small></div>`).join("")}</div>`;
  if ($("mypic")) $("mypic").onclick = editMyPicture;
  wireWriteMission();
  wireMyPlants();
  wireGuest();
}

function guestLive() {
  if (S.pub < 0) {
    app.innerHTML = `${topBar()}<div class="card center" style="background:var(--purple)"><div style="font-size:54px">🤫</div><h2 style="margin:6px 0">Missions time</h2><p style="margin:0 0 16px">The night starts once everyone's seen theirs.</p>${myMissionButton(true)}</div>${myPlantsBlock()}`;
    wireMyPlants(); wireGuest(); return;
  }
  const p = S.plan[S.pub];
  const meGone = ME.playerId && S.players.find((x) => x.id === ME.playerId && x.leftPub != null);
  app.innerHTML = `${topBar()}
  ${meGone ? `<div class="card center" style="background:var(--blue)"><b class="display" style="font-size:20px">🛌 You headed home after pub ${meGone.leftPub + 1}</b><p class="small" style="margin:4px 0 12px">Get home safe. You can still follow along, and you're on the recap.</p><button class="btn sm" id="imback">🎉 Actually, I'm back</button></div>` : ""}
  ${myMissionButton()}
  ${pubCard(false)}
  ${forfeitCards(false)}
  ${p.type === "rule" && ME.role === "player" && !meGone ? caughtBlock() : ""}
  ${p.arrive ? challengeCard(p.arrive, "arrive", false) : ""}
  ${p.drop ? challengeCard(p.drop, "drop", false) : ""}
  ${plantedCards(false)}
  ${pendingLine(p, false)}
  <h3 class="h">The hall of shame</h3>
  ${scores()}
  ${feedLog()}`;
  if ($("imback")) $("imback").onclick = () => act(call("player:back"));
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => act(call("player:forfeit", { id: +b.dataset.id, action: b.dataset.f }))));
  wireCaught(async (playerId) => { if (await act(call("player:caught", { playerId }))) { vibrate(); toast("Reported 🫵"); } });
  wireGuest();
}

function revealGuest() {
  app.innerHTML = `${topBar()}
  <h2>🤫 The reveal</h2><p class="muted" style="margin:6px 0 18px">Who pulled it off, who got busted, who never even tried.</p>
  ${S.players.map((p, i) => `<div class="card" style="background:${playerColor(i)}"><div class="row" style="justify-content:flex-start"><span style="flex:0">${av(p.n)}</span><b class="display" style="font-size:20px">${esc(p.n)}</b><span style="flex:0;font-size:26px">${p.mission && p.mission.result === true ? "✅" : p.mission && p.mission.result === false ? "❌" : "⏳"}</span></div>
    <p style="font:800 17px/1.3 var(--body);margin:10px 0 0">${esc(p.mission ? p.mission.text : "")}</p>${missionBy(p)}</div>`).join("")}`;
  wireGuest();
}

/* ================= RECAP (everyone): Wrapped-style slides ================= */
// The recap stays up for 24 hours after the night ends, then the room is deleted
let expiryTimer = null;
function tickExpiry() {
  clearInterval(expiryTimer);
  const draw = () => {
    const el = $("expiry");
    if (!el || !S || !S.expiresAt) { clearInterval(expiryTimer); return; }
    const ms = S.expiresAt - Date.now();
    if (ms <= 0) { el.innerHTML = "🕒 This recap has been deleted. Hope you saved your images!"; clearInterval(expiryTimer); return; }
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
    el.innerHTML = `🕒 Deleted in <b>${h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(sec).padStart(2, "0")}s`}</b> · mates can still join with code <b>${esc(S.code)}</b>`;
  };
  draw();
  expiryTimer = setInterval(draw, 1000);
}
let slides = [], slideIdx = 0, slidesKey = "";
function recapScreen() {
  const st = nightStats(S), tt = titles(S), myId = ME.playerId || null;
  const photos = Object.fromEntries(S.players.map((p) => [p.id, getPhoto(S.code, p.id)]).filter(([, u]) => u));
  const key = JSON.stringify([S.code, hideNames, S.players.map((p) => [p.forf, p.skips, p.chall, p.emoji, p.mission && p.mission.result, (photos[p.id] || "").length]), (S.plants || []).length, S.players.map((p) => [p.joinedPub, p.leftPub]), (S.quotes || []).map((q) => q.id), (S.catches || []).length, S.settings.crew]);
  app.innerHTML = `
  <div class="center" style="padding:4px 0 14px"><h2>${st.visited >= 12 ? "You made it! 🏆" : `${st.visited} pubs! 🍻`}</h2>
    ${st.visited < 12 && st.lastPub ? `<p class="muted" style="margin:6px 0 0">Called it at ${esc(st.lastPub)}. Still counts.</p>` : ""}
    <p class="muted" style="margin:6px 0 0">${duration(st.out)} out · ${st.forfeits} forfeit${st.forfeits === 1 ? "" : "s"} · swipe through your night</p></div>
  ${S.expiresAt ? `<div class="expiry" id="expiry"></div>` : ""}
  <div class="slides" id="slides"><div class="slide loading">Making your recap…</div></div>
  <div class="sdots" id="sdots"></div>
  <p class="center display" id="slabel" style="font-size:18px;margin:4px 0 14px"></p>
  <button class="btn pink big" id="download" hidden>⬇️ Download this one</button>
  <div class="row" id="morebtns">
    <button class="btn sm" id="downloadall" hidden>Download all</button>
    ${navigator.share ? `<button class="btn sm" id="share">Share</button>` : ""}
  </div>
  <h3 class="h">Everyone's title</h3>
  <div class="card">${S.players.map((p) => `<div class="mrow">${av(p.n, true)}<div><b>${esc(displayName(S, p.n, hideNames))}</b><div class="small">${tt[p.id].em} ${esc(tt[p.id].t)}${comingsAndGoings(S, p) ? ` · ${esc(comingsAndGoings(S, p))}` : ""}</div></div></div>`).join("")}</div>
  <div class="card tight"><div class="toggle"><span><b>Hide names</b><small>Shows Player 1, 2, 3… on the images</small></span><button class="switch" id="hide" aria-pressed="${hideNames}"></button></div></div>
  ${ME.playerId ? `<button class="btn yellow" id="addquote">💬 ${(S.quotes || []).length ? "Add another quote" : "Add the quote of the night"}</button>` : ""}
  <button class="btn ghost" id="copyr">Copy as text</button>
  ${bar(`<button class="btn yellow big" id="again">${isHost() ? "Start another night" : "Done 👋"}</button>`)}`;

  tickExpiry();
  $("hide").onclick = () => { hideNames = !hideNames; render(); };
  $("copyr").onclick = () => copyText(recapText(S, hideNames), "Recap copied");
  if ($("addquote")) $("addquote").onclick = quoteSheet;
  $("again").onclick = () => { const wasHost = isHost(); leaveRoom(); if (wasHost) { view = "setup"; render(); } };

  const date = new Date(S.startAt || Date.now()).toISOString().slice(0, 10);
  const fileOf = (sl) => `12-pubs-${date}-${sl.key}.png`;
  const blobOf = (sl) => new Promise((r) => sl.canvas.toBlob(r, "image/png"));

  const show = () => {
    const box = $("slides"); if (!box) return;
    box.innerHTML = slides.map((sl, k) => `<div class="slide" data-k="${k}"><img src="${sl.url}" alt="${esc(sl.label)}"></div>`).join("");
    $("sdots").innerHTML = slides.map((_, k) => `<i class="${k === slideIdx ? "on" : ""}"></i>`).join("");
    const setIdx = (k) => { slideIdx = k; $("slabel").textContent = slides[k].label; $("sdots").querySelectorAll("i").forEach((d, j) => d.classList.toggle("on", j === k)); };
    box.onscroll = () => {
      const mid = box.scrollLeft + box.clientWidth / 2;
      let best = 0, bd = Infinity;
      box.querySelectorAll(".slide").forEach((el, k) => { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = k; } });
      if (best !== slideIdx) setIdx(best);
    };
    const el = box.querySelector(`[data-k="${slideIdx}"]`);
    if (el) box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    setIdx(Math.min(slideIdx, slides.length - 1));
  };

  if (key === slidesKey && slides.length) show();
  else {
    slidesKey = key; slideIdx = 0;
    buildSlides(S, hideNames, myId, photos).then((list) => {
      if (slidesKey !== key) return;
      slides = list.map((sl) => { const canvas = sl.draw(); return { ...sl, canvas, url: canvas.toDataURL("image/png") }; });
      show();
    });
  }

  canDownload().then((ok) => { if (ok && $("download")) { $("download").hidden = false; $("downloadall").hidden = false; } });
  $("download").onclick = async () => {
    const sl = slides[slideIdx]; if (!sl) return;
    const btn = $("download"); btn.disabled = true;
    try { if (await saveFile(fileOf(sl), await blobOf(sl))) { toast("Saved 🎉"); countEvent("download"); } } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  };
  $("downloadall").onclick = async () => {
    const btn = $("downloadall"); btn.disabled = true;
    try {
      let n = 0;
      for (const sl of slides) { if (await saveFile(fileOf(sl), await blobOf(sl))) { n++; countEvent("download"); } else break; }
      if (n) toast(`Saved ${n} image${n === 1 ? "" : "s"} 🎉`);
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  };
  if ($("share")) $("share").onclick = async () => {
    const sl = slides[slideIdx]; if (!sl) return;
    const file = new File([await blobOf(sl)], fileOf(sl), { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: "12 Pubs 🍻" });
      else await navigator.share({ text: recapText(S, hideNames) });
      countEvent("share");
    } catch (e) { if (e.name !== "AbortError") toast("Couldn't share. Use Download instead."); }
  };
}
// Anonymous usage count (no names, nothing about you); silently does nothing in the preview
const countEvent = (type) => call("stats:event", { type }).catch(() => {});

/* ---------- boot ---------- */
getJSON("/api/meta").then((m) => { META = m; if (view === "setup" && !S) render(); }).catch(() => {});
// Join and take-over links (#join-K7Q2, #takeover-K7Q2-…). Also handled when the app is already open in this tab.
function handleHash() {
  const join = (location.hash.match(/^#join-([A-Za-z0-9]{4})$/) || [])[1];
  const take = location.hash.match(/^#takeover-([A-Za-z0-9]{4})-([a-f0-9]{16})$/);
  if (!join && !take) return;
  history.replaceState(null, "", location.pathname);
  const whenConnected = (fn) => (socket.connected ? fn() : socket.once("connect", () => setTimeout(fn, 50)));
  if (take) whenConnected(async () => {
    const [, code, token] = take;
    const same = ME && ME.code === code.toUpperCase();
    const r = await act(call("room:takeover", { code, token, playerId: same ? ME.playerId : undefined, playerToken: same ? ME.playerToken : undefined }));
    if (!r) return;
    ME = { code: r.state.code, role: "host", hostToken: r.hostToken, ...(r.playerId ? { playerId: r.playerId, playerToken: ME && ME.playerToken } : {}) };
    saveSession(ME); S = r.state; closeOverlay(); toast("👑 You're running the night now"); render();
  });
  else if (!(ME && ME.code === join.toUpperCase())) whenConnected(() => joinRoom(join));
}
window.addEventListener("hashchange", handleHash);
render();
handleHash();
