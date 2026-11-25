// Every internal href/src in the built site must resolve to a file in dist/.
import fs from "node:fs";
import path from "node:path";
const dist = path.resolve(process.argv[2] || "dist");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const exists = (urlPath) => {
  const p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  const f = path.join(dist, p);
  return [f, path.join(f, "index.html"), f + ".html"].some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};
const redirects = fs.existsSync(path.join(dist, "_redirects")) ? fs.readFileSync(path.join(dist, "_redirects"), "utf8").split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean) : [];
const bad = new Set();
for (const file of walk(dist).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(file, "utf8");
  const base = "/" + path.relative(dist, path.dirname(file)).split(path.sep).join("/") + "/";
  for (const m of html.matchAll(/\s(?:href|src)="([^"#][^"]*)"/g)) {
    let u = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(u) || u.includes("${")) continue;
    if (!u.startsWith("/")) u = path.posix.normalize(base + u);
    if (redirects.includes(u.replace(/\/$/, "")) || redirects.includes(u)) continue;
    if (!exists(u)) bad.add(`${path.relative(dist, file)} -> ${m[1]}`);
  }
}
if (bad.size) { console.error([...bad].join("\n")); console.error(`\nlinkcheck: ${bad.size} broken`); process.exit(1); }
console.log("linkcheck: OK");
