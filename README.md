# 12 Pubs

A pub crawl game that runs on **one phone on the table**, in any town. You get a rule at every pub, surprise challenges, forfeits and secret missions. The phone keeps score, and there's a recap to post the next day.

The host's phone runs everything. Friends can **optionally** join with a 4-letter room code to follow along and see their own secret mission, so nobody has to pass the phone round.

## Run it

Needs Node 20.10+.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm test           # game logic tests
```

To try it with friends on the same Wi-Fi, open `http://<your-laptop-ip>:3000` on each phone.

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_FILE` | `data/rooms.json` | Where rooms are saved so a restart doesn't end anyone's night |
| `STATS_KEY` | (none) | Password for the `/stats` dashboard. Without it the dashboard is off. |
| `STATS_FILE` | `data/stats.json` | Where the usage counts are kept |

## Files

```
server/
  index.js        Express + Socket.IO: auth, validation, broadcasting, surprise-drop timers
  room.js         Everything that changes a room's state (host actions, missions, what phones may see)
  game.js         Pure game logic: picking rules/challenges/forfeits/missions, Dublin route
  store.js        In-memory rooms, saved to a JSON file, removed after 24h
  stats.js        Anonymous usage counts + the private /stats dashboard
  seo.js          The /rules page, robots.txt and sitemap.xml
  content/
    challenges.json   Rules, challenges, forfeits, stops (tagged: cat, int, group, when…)
    missions.json     Secret missions ({p} = another player's name)
    dublin.json       Dublin preset pubs + start points (approximate, hand-typed)
public/
  index.html
  manifest.webmanifest, sw.js, icons/   Installable app (PWA): add to home screen
  css/styles.css  Loud & playful look: cream background, a colour per pub, thick outlines
  fonts/          Fredoka + Nunito, self-hosted (SIL Open Font License), so no visitor data goes to Google
  js/api.js       Socket wrapper + saved session
  js/app.js       All screens (18+ check, setup, host, guest, recap, terms)
  js/recap.js     Awards + the 1080×1920 story image
test/
  game.test.js
deploy/           Lightsail setup: setup.sh, update.sh, Caddyfile, pm2 config
demo/api.js       In-page stand-in for the server (one-file preview)
scripts/build-demo.mjs
```

## How it works

- **The server is the source of truth.** Phones only show what it sends. The host's phone sends actions, the server applies them and broadcasts the new state to the room.
- **Secrets stay on the server.** Challenges are hidden until you reach that pub, surprise drops until they drop, and missions until the reveal. A mission is only ever sent to its owner's phone, or to the host's phone when someone is peeking in pass-the-phone mode.
- **Surprise drops are timed on the server** (10–20 min into a pub), so they fire even if every phone is locked.
- **Rejoining:** the host gets a secret token and players get one when they pick their name. Both are kept in `localStorage`, so reloading the page or losing signal drops you back in where you were.
- **No accounts.** Rooms are deleted 24 hours after the last activity.

### Socket events

All events reply with `{ ok: true, ... }` or `{ ok: false, error }`.

| Event | Who | Payload |
|---|---|---|
| `room:create` | anyone | `{ settings, players: [names], pubs: [{name, street?, lat?, lng?}] }` → `{ code, hostToken, state }` |
| `room:join` | anyone | `{ code, hostToken?, playerId?, playerToken? }` → `{ role, state }` |
| `player:claim` | watcher | `{ playerId }` → `{ playerToken }` |
| `mission:mine` / `mission:swap` | player | (none) → `{ mission, swapped }` |
| `host` | host | `{ action, args }`. The actions are `reroll`, `editRule`, `rename`, `start`, `missionsDone`, `peekMissions`, `next`, `dropNow`, `challenge`, `caught`, `forfeit`, `finish`, `missionResult`, `revealDone`, `peek`, `swap`, `setEmoji`, `addPlayer`, `leave`, `back`, `plantAdd`, `plantDecide`, `plantPeek` |
| `plant:add` / `plant:mine` / `plant:remove` | player | Plant a surprise before the night (`{ kind: "rule" or "challenge", text }`) |
| `player:emoji` / `player:leave` / `player:back` | player | Change your emoji, head home, come back |
| `host:handover` | host | `{ playerId }`: hand the night to someone in on their own phone |
| `host:takeover-code` | host | Returns a one-time code for a "scan to take over" link (15 minutes) |
| `room:takeover` | anyone | `{ code, token }` from that link: become the host |

The server pushes `state` (the public room state) and `buzz` (`{kind:"drop"}` or `{kind:"forfeit", playerId}`).

## Deploying to AWS Lightsail with 12pubs.ie

One small server runs everything. Caddy handles HTTPS and pm2 keeps the app running.

1. **Create the server.** In Lightsail, go to Create instance, then Linux, then **Ubuntu 24.04**. The smallest plan is plenty.
2. **Give it a fixed address.** Networking → Create static IP → attach it to the instance.
3. **Open HTTPS.** On the instance's Networking tab, add a firewall rule for **HTTPS (443)**. 22 and 80 are open already.
4. **Point the domain at it.** In your registrar's DNS settings for 12pubs.ie, add two **A records**: `@` and `www`, both pointing to the static IP. They can take a few minutes to an hour to work.
5. **Install.** Connect with Lightsail's browser SSH button, then run:
   ```bash
   git clone https://github.com/<you>/12pubs.git && cd 12pubs
   bash deploy/setup.sh 12pubs.ie
   ```
6. Open **https://12pubs.ie**. Caddy fetches the HTTPS certificate on the first visit.

**Updating:** push to GitHub, then on the server run `bash deploy/update.sh`. Nights in progress carry on.

**Handy commands:** `pm2 logs 12pubs` (logs), `pm2 status`, `curl localhost:3000/healthz`.

**Set a billing alert in AWS on day one.** Keep to **one instance**. Rooms live in memory (saved to `data/rooms.json`), so running several servers would need Redis and the Socket.IO Redis adapter.

## Search (SEO)

- **`/rules`** is a plain-HTML page with every rule, challenge and forfeit (minus the savage drinking ones), a how-to-play section and FAQs with structured data. It's built from `challenges.json`, so it updates whenever the content does. `/12-pubs-rules` and `/12-pubs-of-christmas-rules` redirect to it.
- The homepage has a proper title and description, a share image (`public/og-image.png`) for WhatsApp, Instagram and others, and app structured data.
- `robots.txt` and `sitemap.xml` are generated, and `/stats` is kept out of search.
- After launch, add 12pubs.ie to **Google Search Console** and submit `https://12pubs.ie/sitemap.xml`.

## Usage stats

Open **https://12pubs.ie/stats**, type any username, and use the password `setup.sh` printed (it's also saved in `~/.12pubs-stats-key` on the server). Locally: `STATS_KEY=pick-one npm start`, then open `localhost:3000/stats`.

It shows nights created, started and finished, how many got to all 12, visits, players and average group size, mates who joined on their own phone, recap downloads and shares, and the difficulty and pub-type split, plus a chart of nights per day. Raw numbers are at `/stats.json`.

It only counts things: totals per day. There are no names, room codes, IP addresses or cookies, so there's no cookie banner needed and nothing personal to protect. The counts are kept in `data/stats.json` and aren't deleted with rooms.

## One-file preview

`npm run build:demo` writes `dist/12pubs-preview.html`: the whole app in one file, no server needed. It runs the same game code in the page (`demo/api.js` stands in for the socket), with everything on one phone. It's handy for showing people the app or hosting a static demo.

## Before launch

- Change `CONTACT_EMAIL` at the top of `public/js/app.js` to an inbox you actually read. It's shown on the terms & privacy page.
- The terms & privacy text is a plain-English starting point, not legal advice. Have it checked before taking money from anyone (pubs, brands, paid packs).

## Next up

- The Imposter: one secret saboteur per pub with a target to hit.
- King of the pub: whoever wins the challenge sets a mini-rule for the next pub.
- OpenStreetMap "pubs near me" (`amenity=pub` via Overpass) as a fourth pub option.
- Web Push for surprise drops when phones are locked (the app is installable already; iOS needs it added to the Home Screen).
- A tip link on the recap the morning after.
