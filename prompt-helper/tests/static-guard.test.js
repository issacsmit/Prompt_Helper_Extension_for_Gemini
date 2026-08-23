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

test("manifest registers update-check with the GitHub API host permission", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.match(JSON.stringify(manifest.host_permissions || []), /api\.github\.com/u);
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const contentIndex = scripts.indexOf("content.js");
  const updateIndex = scripts.indexOf("update-check.js");
  assert.ok(updateIndex >= 0, "update-check.js must be a content script");
  assert.ok(contentIndex > updateIndex, "update-check.js must load before content.js");
});

test("prompt list supports drag and keyboard reordering", () => {
  const content = read("content.js");
  assert.match(content, /ph-entry-drag/u);
  assert.match(content, /commitPromptOrder/u);
  assert.match(content, /moveIds/u);
  assert.match(content, /ArrowUp/u);
  assert.match(content, /ArrowDown/u);
  assert.match(content, /reorderFailed|调整顺序失败/u);
  assert.match(content, /if\s*\(\s*listDrag\s*\)\s*return/u);
  assert.match(content, /bindListDragWindowListeners/u);

  const css = read("content.css");
  assert.match(css, /\.ph-entry-drag/u);
  assert.match(css, /ph-dragging-card/u);
  assert.match(css, /\.ph-list-reordering/u);
});

test("SPA remount restores in-memory panel state and does not leak window listeners", () => {
  const content = read("content.js");
  assert.match(content, /let panelIsOpen/u);
  assert.match(content, /panelIsOpen = panel\.classList\.toggle/u);
  assert.match(content, /clearListDrag\(false\)/u);
  assert.match(content, /dismissSessionOverlays/u);
  assert.match(content, /bindButtonWindowListeners/u);
  assert.match(content, /buttonWindowListenersBound/u);
  assert.match(content, /clampButtonToViewport\(\)/u);
  assert.match(content, /window\.addEventListener\(\s*["']mousemove["'],\s*handleButtonMouseMove/u);
});

test("dark theme component colors come from CSS variables, not copied selector forks", () => {
  const css = read("content.css");
  assert.match(css, /html\.dark/u);
  assert.match(css, /--ph-add-bg/u);
  assert.doesNotMatch(css, /html\.dark \.ph-settings-btn/u);
  assert.doesNotMatch(
    css,
    /html:not\(\.light\):not\(\[data-theme=["']light["']\]\) \.ph-settings-btn/u
  );
});

test("settings dialog exposes an update check backed by PromptHelper.checkForUpdate", () => {
  const content = read("content.js");
  assert.match(content, /checkForUpdate/u);
  assert.match(content, /runUpdateCheck/u);
  assert.match(content, /检查更新/u);
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
