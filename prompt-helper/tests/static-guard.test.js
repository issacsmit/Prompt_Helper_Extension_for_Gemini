"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("manifest still targets Gemini, not ChatGPT", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.match(JSON.stringify(manifest.host_permissions || []), /gemini\.google\.com/u);
  assert.doesNotMatch(JSON.stringify(manifest), /chatgpt\.com/u);
  const matches = manifest.content_scripts.flatMap((entry) => entry.matches || []);
  assert.ok(matches.includes("https://gemini.google.com/*"));
  assert.equal(matches.some((value) => value.includes("chatgpt.com")), false);

  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.ok(scripts.includes("constants.js"));
  assert.ok(scripts.includes("prompt-engine.js"));
  assert.ok(scripts.includes("storage.js"));
  assert.ok(scripts.includes("gemini-editor.js"));
  assert.ok(scripts.includes("content.js"));
  assert.equal(scripts.includes("chatgpt-editor.js"), false);
});

test("panel markup includes 插入设置 bound to the auto-select flag", () => {
  const content = read("content.js");
  assert.match(content, /插入设置/u);
  assert.match(content, /ph_auto_select_bracket_placeholder|autoSelectBracketPlaceholder/u);
  assert.match(content, /openSettings/u);
  assert.match(content, /saveAutoSelectBracketPlaceholder/u);
});

test("content script subscribes to chrome.storage.onChanged", () => {
  const storage = read("storage.js");
  const content = read("content.js");
  assert.match(storage, /storage\?\.onChanged/u);
  assert.match(storage, /addListener/u);
  assert.match(content, /\.subscribe\(/u);
});

test("a status node is created and positioned relative to the floating button", () => {
  const content = read("content.js");
  const css = read("content.css");
  assert.match(content, /ph-status/u);
  assert.match(content, /role["']:\s*["']status|setAttribute\(\s*["']role["'],\s*["']status["']/u);
  assert.match(content, /updateStatusPosition/u);
  assert.match(content, /getElementById\(BTN_ID\)|floating-btn/u);
  assert.match(css, /\.ph-status/u);
});

test("coarse pointers keep card edit/delete visible", () => {
  const css = read("content.css");
  assert.match(css, /@media\s*\((?:hover:\s*none|pointer:\s*coarse)/u);
  assert.match(css, /pointer:\s*coarse/u);
  const coarseIndex = css.search(/@media[^{]*pointer:\s*coarse/u);
  assert.ok(coarseIndex >= 0);
  const coarseBlock = css.slice(coarseIndex, coarseIndex + 800);
  assert.match(coarseBlock, /ph-entry-actions/u);
  assert.match(coarseBlock, /opacity:\s*1/u);
});

test("content script uses shipped prepareInsertion and insertPreparedText", () => {
  const content = read("content.js");
  assert.match(content, /prepareInsertion/u);
  assert.match(content, /insertPreparedText/u);
  assert.doesNotMatch(content, /auto-send|chatgpt\.com/u);
});
