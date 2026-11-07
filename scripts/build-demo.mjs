// Builds dist/12pubs-preview.html: the whole app in one file, no server needed.
// Same screens and game logic; uses demo/api.js instead of the socket connection.
// Usage: npm run build:demo
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p) => path.join(ROOT, "public", p);

// Swap the real socket API for the in-page one
const useLocalApi = {
  name: "local-api",
  setup(build) {
    build.onResolve({ filter: /^\.\/api\.js$/ }, () => ({ path: path.join(ROOT, "demo", "api.js") }));
    build.onResolve({ filter: /^\/vendor\/qrcode\.mjs$/ }, () => ({ path: path.join(ROOT, "node_modules", "qrcode-generator", "dist", "qrcode.mjs") }));
  },
};

const js = await esbuild.build({
  entryPoints: [pub("js/app.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  plugins: [useLocalApi],
});

// Inline the fonts so the file is fully self-contained
let css = fs.readFileSync(pub("css/styles.css"), "utf8").replace(/url\("\/fonts\/([^"]+)"\)/g, (_, f) =>
  `url("data:font/woff2;base64,${fs.readFileSync(pub("fonts/" + f)).toString("base64")}")`);

// The preview's viewer blocks Web Share (downloads go through the artifact's downloads capability)
css += "\n/* preview only */\n#share, .seo-link { display: none; }\n";

const html = fs.readFileSync(pub("index.html"), "utf8")
  .replace(/<link rel="preload"[^>]*>\n/, "")
  // no service worker, manifest or icon files in the one-file preview
  .replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, "")
  .replace(/<meta name="apple-mobile-web-app-[^>]*>\n/g, "")
  .replace(/<link rel="canonical"[^>]*>\n/, "")
  .replace('<link rel="stylesheet" href="/css/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script src="/socket.io/socket.io.js"></script>\n', "")
  .replace('<script type="module" src="/js/app.js"></script>', () => `<script>\n${js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}\n</script>`);

fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const out = path.join(ROOT, "dist", "12pubs-preview.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(ROOT, out)} (${Math.round(html.length / 1024)} KB)`);
