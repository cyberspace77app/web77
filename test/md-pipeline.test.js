/**
 * Pipeline checks for HiveMd.renderMarkdown after marked is removed.
 * Run: node test/md-pipeline.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function loadPair(includeParser) {
  const sandbox = {
    console: console,
    window: {},
    URL: URL,
    document: undefined,
    DOMPurify: {
      sanitize: function (html) {
        return String(html || "");
      },
      addHook: function () {},
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.DOMPurify = sandbox.DOMPurify;
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  if (includeParser) {
    const parser = path.join(root, "js", "md-render.js");
    vm.runInContext(fs.readFileSync(parser, "utf8"), sandbox, { filename: parser });
  }
  const md = path.join(root, "js", "md.js");
  vm.runInContext(fs.readFileSync(md, "utf8"), sandbox, { filename: md });
  return sandbox.window;
}

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL " + message);
    process.exitCode = 1;
    return false;
  }
  console.log("ok " + message);
  return true;
}

const win = loadPair(true);
const renderMd = win.HiveMd && win.HiveMd.renderMarkdown;
const render = win.Markdown && win.Markdown.render;
if (typeof renderMd !== "function" || typeof render !== "function") {
  console.error("renderMarkdown or Markdown.render is missing");
  process.exit(1);
}
assert(win.HiveMd.markdownReady() === true, "parser and sanitizer count as ready");

assert(
  renderMd("*italic*").indexOf("<em>italic</em>") !== -1,
  "renderMarkdown italic"
);
const lumen = renderMd("---\n*Posted via Lumen*");
assert(lumen.indexOf("<hr>") !== -1 && lumen.indexOf("<em>Posted via Lumen</em>") !== -1, "hr then italic");

const bare = render("https://youtu.be/abcdefghijk");
assert(
  bare.indexOf("https://youtu.be/abcdefghijk") !== -1 && bare.indexOf("<a") === -1,
  "bare youtube url stays text in the parser"
);
assert(render("@alice").indexOf("@alice") !== -1 && render("@alice").indexOf("mention") === -1, "mention stays text");
assert(
  win.HiveMd.extractImage({ body: "![PINGU [C__Users_Victor]](https://example.com/a.jpg)" }) === "https://example.com/a.jpg",
  "bracketed image alt still yields the url"
);

const linked = renderMd("hello @alice see https://example.com/a and #hive.");
assert(linked.indexOf('class="mention"') !== -1 && linked.indexOf(">@alice</a>") !== -1, "pipeline mention");
assert(linked.indexOf('href="https://example.com/a"') !== -1, "pipeline bare url");
assert(linked.indexOf('class="hashtag"') !== -1 && linked.indexOf(">#hive</a>") !== -1, "pipeline hashtag");
const coded = renderMd("`@alice` https://example.com");
assert(coded.indexOf("<code>@alice</code>") !== -1, "mention inside code stays text");
assert(coded.indexOf('href="https://example.com"') !== -1, "url beside code is linked");
const yt = renderMd("@bob https://youtu.be/abcdefghijk");
assert(yt.indexOf('class="mention"') !== -1 && yt.indexOf(">@bob</a>") !== -1, "mention beside youtube");
assert(yt.indexOf("youtube.com/embed/abcdefghijk") !== -1, "pipeline youtube embed");
assert(yt.indexOf(">https://youtu.be/abcdefghijk</a>") === -1, "youtube url is not a leftover link");

const fenced = render("```\n<script>alert(1)</script>\n```");
assert(
  fenced.indexOf("<code>") !== -1 && fenced.indexOf("<script>") === -1,
  "script inside a fence is escaped text"
);

const bareWin = loadPair(false);
assert(bareWin.HiveMd.markdownReady() === false, "missing parser is not ready");
let fallback = "";
let threw = false;
try {
  fallback = bareWin.HiveMd.renderMarkdown("*italic*");
} catch (err) {
  threw = true;
  console.error("FAIL missing parser threw " + err);
  process.exitCode = 1;
}
if (!threw) {
  assert(
    fallback.indexOf("<em>") === -1 && fallback.indexOf("*italic*") !== -1,
    "missing Markdown escapes instead of throwing"
  );
}

if (process.exitCode) {
  console.error("pipeline tests failed");
  process.exit(process.exitCode);
}
console.log("pipeline tests passed");
