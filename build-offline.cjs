const fs = require("node:fs");
const path = require("node:path");

const distributionDirectory = path.join(__dirname, "dist");
const readDistributionFile = (filename) =>
  fs.readFileSync(path.join(distributionDirectory, filename), "utf8");
const escapeScriptEndTags = (source) =>
  source.replace(/<\/script/gi, "<\\/script");

function replaceRequired(source, pattern, replacement, description) {
  if (!pattern.test(source)) {
    throw Error(`Could not find ${description} in dist/index.html.`);
  }
  return source.replace(pattern, replacement);
}

const workerSource =
  readDistributionFile("vendor/fzstd.js") +
  "\n;\n" +
  readDistributionFile("engine.js") +
  "\n;\n" +
  readDistributionFile("worker.js").replace(
    /^importScripts\(["']vendor\/fzstd\.js["'],\s*["']engine\.js["']\);\s*/,
    "",
  );

let html = replaceRequired(
  readDistributionFile("index.html"),
  /<link rel="stylesheet" href="style\.css"\s*\/?>/,
  `<style>${readDistributionFile("style.css")}</style>`,
  "stylesheet link",
);
html = replaceRequired(
  html,
  /<script src="engine\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  "<script>" +
    escapeScriptEndTags(readDistributionFile("engine.js")) +
    "</script><script>window.PSX_WORKER_SOURCE=" +
    JSON.stringify(workerSource).replace(/</g, "\\u003c") +
    ";</script><script>" +
    escapeScriptEndTags(readDistributionFile("app.js")) +
    "</script>",
  "application scripts",
);
html = replaceRequired(
  html,
  /<head>/,
  "<head><!-- Third-party component: fzstd 0.1.1\n" +
    readDistributionFile("vendor/fzstd-LICENSE.txt") +
    "\n-->",
  "head element",
);

const outputPath = path.join(distributionDirectory, "PSX-Frame-Lab.html");
fs.writeFileSync(outputPath, html);
console.log(`Built standalone HTML, ${Buffer.byteLength(html)} bytes.`);
