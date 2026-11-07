// Pages for search engines: a plain-HTML rules page, robots.txt and sitemap.xml.
// The app itself is drawn by JavaScript; this gives Google real text to match searches like "12 pubs rules".
import * as G from "./game.js";

export const SITE = process.env.SITE_URL || "https://12pubs.ie";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Keep "drink faster / drink more" items off the public page
const publicOk = (x) => !(x.cat === "drinking" && x.int === 3);

const CAT_LABEL = { talking: "🗣️ Talking", drinking: "🍺 Drinking habits", social: "🤝 Social", brain: "🧠 Brain", silly: "🤪 Silly", physical: "💪 Physical", dares: "😈 Dares" };
const LEVELS = [
  [1, "Easy 12 Pubs rules", "Mild and silly. Good for a mixed group or your first 12 Pubs."],
  [2, "Classic 12 Pubs rules", "The proper ones. What most groups play."],
  [3, "Savage 12 Pubs rules", "Hard to keep up. Best saved for the later pubs."],
];

export const FAQ = [
  ["What are the rules of 12 Pubs?", "You visit 12 pubs in one night, usually around Christmas. Each pub has its own rule, like no swearing, no first names or left hand only. Break the rule and you get a forfeit. The 12 Pubs app picks the rules, keeps score and hands out the forfeits for you."],
  ["Do you have to drink at every pub?", "No. A half, a soft drink or a water all count. Most groups build in water and food stops (the app puts them at pubs 4 and 8), and anyone can skip anything."],
  ["What are good 12 Pubs rules?", `The classics are no swearing, no first names, left hand only, no pointing, accent pub, every sentence ends with 'lad', and third person only. Below are ${Math.floor(G.RULES.filter((r) => !(r.cat === "drinking" && r.int === 3)).length / 10) * 10}+ more, sorted from easy to savage.`],
  ["What happens if you break a 12 Pubs rule?", "You get a forfeit: something silly like 10 squats, a napkin hat until the next pub, or singing the opening line of a Christmas song. Forfeits work best when they're funny, not about drinking more."],
  ["Can you do 12 Pubs outside Dublin?", "Yes. The 12 Pubs app works in any town: type in your route, name the pubs as you go, or use the Dublin preset."],
  ["Is there an app for 12 Pubs?", "Yes, 12pubs.ie. One phone runs the night: a rule at every pub, surprise challenges, forfeits, secret missions and a recap to post the next day. It's free, and there's nothing to install."],
];

function page({ title, description, path, body, jsonld }) {
  return `<!DOCTYPE html>
<html lang="en-IE"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website"><meta property="og:site_name" content="12 Pubs">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#fff7e8">
<link rel="icon" type="image/png" href="/icons/favicon-48.png">
<link rel="stylesheet" href="/css/styles.css">
<style>
  .seo h1{font:700 40px/1.05 var(--display);margin:8px 0 10px}
  .seo h2{font:700 26px/1.1 var(--display);margin:30px 0 6px}
  .seo h3{font:700 19px var(--display);margin:18px 0 6px}
  .seo p{font-size:17px;line-height:1.5;margin:0 0 12px}
  .seo ol,.seo ul{padding-left:22px;margin:6px 0 12px} .seo li{margin:0 0 7px;font-size:16.5px;line-height:1.4}
  .seo .cta{display:block;margin:18px 0}
  .seo nav a{margin-right:14px;font:700 15px var(--display)}
  .seo details{border:var(--line);border-radius:16px;background:var(--white);padding:0 14px;margin:0 0 10px}
  .seo summary{font:700 17px var(--display);padding:12px 0;cursor:pointer}
  .seo .note{font-size:14px;color:var(--muted)}
</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
</head><body><main class="wrap seo">
<div class="topbar"><a class="minilogo" href="/" style="text-decoration:none"><span>12</span>PUBS</a></div>
${body}
<p class="note" style="margin-top:28px">18+ only. Nobody has to drink to play, and soft drinks always count. Look after each other, and never drink and drive. Emergency: 112 or 999.</p>
<nav style="margin:18px 0 0"><a href="/">Play 12 Pubs</a><a href="/rules">All the rules</a></nav>
</main></body></html>`;
}

export function rulesPage() {
  const rules = G.RULES.filter(publicOk), chall = G.CHALLENGES.filter(publicOk), forf = G.FORFEITS.filter(publicOk);
  const total = rules.length + chall.length + forf.length;
  const byLevel = LEVELS.map(([lvl, h, intro]) => {
    const list = rules.filter((r) => r.int === lvl);
    if (!list.length) return "";
    const cats = [...new Set(list.map((r) => r.cat))];
    return `<h2 id="level-${lvl}">${h}</h2><p>${intro}</p>` + cats.map((c) =>
      `<h3>${CAT_LABEL[c] || c}</h3><ul>${list.filter((r) => r.cat === c).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>`).join("");
  }).join("");
  const body = `
<h1>12 Pubs of Christmas Rules</h1>
<p><b>${rules.length} rules, ${chall.length} challenges and ${forf.length} forfeits</b> for your 12 Pubs, sorted from easy to savage. One rule per pub, and whoever breaks it gets a forfeit.</p>
<a class="btn pink big cta" href="/">Let the app run your 12 Pubs 🍻</a>

<h2>How to do the 12 Pubs</h2>
<ol>
  <li><b>Pick 12 pubs</b> close together. Plan the route, and check opening hours in December.</li>
  <li><b>Give every pub a rule.</b> It lasts until you leave. Mix easy and classic ones, and save the savage ones for later.</li>
  <li><b>Catch someone breaking it?</b> They get a forfeit. Make forfeits funny, not "drink more".</li>
  <li><b>Pub 4 is a water stop, pub 8 is a food stop.</b> Actually do them.</li>
  <li><b>Pub 12 is the finale.</b> All rules lifted. Toast whoever made it.</li>
</ol>
<p>The <a href="/">12 Pubs app</a> does all of this from one phone: it picks the rules, drops surprise challenges, rolls forfeits, hands out secret missions and makes a Wrapped-style recap at the end.</p>

${byLevel}

<h2 id="challenges">12 Pubs challenges</h2>
<p>One-off things to do at a pub, either when you arrive or as a surprise halfway through your drink.</p>
<ul>${chall.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>

<h2 id="forfeits">12 Pubs forfeits</h2>
<p>For whoever gets caught breaking the rule.</p>
<ul>${forf.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>

<h2 id="faq">12 Pubs FAQ</h2>
${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}

<h2>Look after each other</h2>
<p>If a mate's had too much, call it: water, food, a taxi home. Nobody walks home alone. This time of year is for fun, not A&amp;E.</p>
<a class="btn yellow big cta" href="/">Start your 12 Pubs night →</a>`;
  return page({
    title: `12 Pubs of Christmas Rules: ${Math.floor(rules.length / 10) * 10}+ rules, challenges & forfeits | 12 Pubs`,
    description: `The best 12 Pubs rules, sorted from easy to savage, plus ${chall.length} challenges and ${forf.length} forfeits. Free 12 Pubs of Christmas app runs the whole night from one phone.`,
    path: "/rules",
    body,
    jsonld: [
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      { "@context": "https://schema.org", "@type": "ItemList", name: "12 Pubs rules", numberOfItems: total,
        itemListElement: rules.slice(0, 30).map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.text })) },
    ],
  });
}

export const robotsTxt = () => `User-agent: *
Allow: /
Disallow: /stats
Disallow: /api/
Sitemap: ${SITE}/sitemap.xml
`;

export function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [["/", "1.0"], ["/rules", "0.9"]];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${p}</priority></url>`).join("\n")}
</urlset>
`;
}
