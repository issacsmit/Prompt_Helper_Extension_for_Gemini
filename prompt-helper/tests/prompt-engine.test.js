"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ENGINE_PATH = path.join(__dirname, "..", "prompt-engine.js");
const engine = require(ENGINE_PATH);
const { prepareInsertion, updatePlaceholderHistory } = engine;
const { DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER } = require("../constants.js");

test("prompt-engine exports the shipped prepareInsertion used by the content script", () => {
  assert.equal(typeof prepareInsertion, "function");
  assert.equal(typeof updatePlaceholderHistory, "function");
  assert.equal(globalThis.PromptHelper.prepareInsertion, prepareInsertion);
  assert.equal(require(ENGINE_PATH).prepareInsertion, prepareInsertion);
});

test("custom cursor wins over earlier 【光标】, [光标], and history", () => {
  const content = [
    DEFAULT_PLACEHOLDER,
    LEGACY_PLACEHOLDER,
    "<past>",
    "before<record>after",
  ].join("|");

  assert.deepEqual(
    prepareInsertion({ prompt: content, placeholder: "<record>" }, ["<past>"]),
    {
      text: content.replace("<record>", ""),
      caretOffset: content.indexOf("<record>"),
      matchedPlaceholder: "<record>",
    },
  );
});

test("unused custom cursor does not block later 【…】 auto-select", () => {
  const content = "请把【主题】写成【风格】。";

  assert.deepEqual(
    prepareInsertion({ prompt: content, placeholder: "<missing>" }, ["<past>"]),
    {
      text: content,
      caretOffset: content.indexOf("【主题】"),
      selectionEndOffset: content.indexOf("【主题】") + "【主题】".length,
      matchedPlaceholder: "【主题】",
    },
  );
});

test("first 【主题】 stays in text and is selected; later 【风格】 is untouched", () => {
  const content = "请把【主题】写成【风格】。";
  const prepared = prepareInsertion({ prompt: content }, []);

  assert.equal(prepared.text, content);
  assert.equal(prepared.text.includes("【风格】"), true);
  assert.equal(prepared.caretOffset, content.indexOf("【主题】"));
  assert.equal(
    prepared.selectionEndOffset,
    content.indexOf("【主题】") + "【主题】".length,
  );
  assert.equal(prepared.matchedPlaceholder, "【主题】");
  assert.equal(
    prepared.text.slice(prepared.caretOffset, prepared.selectionEndOffset),
    "【主题】",
  );
  assert.equal(prepared.text.includes("【风格】"), true);
  assert.notEqual(prepared.matchedPlaceholder, "【风格】");
});

test("auto-select off leaves 【主题】 in text with collapsed caret at end unless history hits", () => {
  const content = "请填写【主题】";

  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      [],
      { autoSelectBracketPlaceholder: false },
    ),
    {
      text: content,
      caretOffset: content.length,
      matchedPlaceholder: null,
    },
  );
});

test("history still applies after auto-select is off", () => {
  const content = "【主题】后接<旧位置>";

  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      ["<旧位置>"],
      { autoSelectBracketPlaceholder: false },
    ),
    {
      text: "【主题】后接",
      caretOffset: content.indexOf("<旧位置>"),
      matchedPlaceholder: "<旧位置>",
    },
  );
});

test("cursor markers 【光标】 and [光标] are removed at the first match only", () => {
  const withDefault = `A${DEFAULT_PLACEHOLDER}B${DEFAULT_PLACEHOLDER}C`;
  assert.deepEqual(prepareInsertion({ prompt: withDefault }), {
    text: `AB${DEFAULT_PLACEHOLDER}C`,
    caretOffset: 1,
    matchedPlaceholder: DEFAULT_PLACEHOLDER,
  });

  const withLegacy = `before${LEGACY_PLACEHOLDER}after${LEGACY_PLACEHOLDER}`;
  assert.deepEqual(prepareInsertion({ prompt: withLegacy }), {
    text: `beforeafter${LEGACY_PLACEHOLDER}`,
    caretOffset: 6,
    matchedPlaceholder: LEGACY_PLACEHOLDER,
  });
});

test("default placeholder wins over legacy and history candidates", () => {
  const content = `<past>|${LEGACY_PLACEHOLDER}|before${DEFAULT_PLACEHOLDER}after`;

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<past>"]), {
    text: content.replace(DEFAULT_PLACEHOLDER, ""),
    caretOffset: content.indexOf(DEFAULT_PLACEHOLDER),
    matchedPlaceholder: DEFAULT_PLACEHOLDER,
  });
});

test("updatePlaceholderHistory keeps newest custom first and drops built-ins", () => {
  assert.deepEqual(
    updatePlaceholderHistory(["<one>", "<two>", "<one>"], "<two>"),
    ["<two>", "<one>"],
  );
  assert.deepEqual(
    updatePlaceholderHistory(
      ["  <one>  ", DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER, "<two>"],
      "  <new>  ",
    ),
    ["<new>", "<one>", "<two>"],
  );
  assert.deepEqual(
    updatePlaceholderHistory(
      ["<one>", "<two>", "<three>", "<four>", "<five>"],
      "<six>",
    ),
    ["<six>", "<one>", "<two>", "<three>", "<four>"],
  );
});
