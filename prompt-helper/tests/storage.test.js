"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const STORAGE_PATH = path.join(__dirname, "..", "storage.js");
const { Storage, STORAGE_KEYS } = require(STORAGE_PATH);
const constants = require("../constants.js");

const KEYS = STORAGE_KEYS;

function clone(value) {
  return structuredClone(value);
}

function selectKeys(data, keys) {
  const selected = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      selected[key] = clone(data[key]);
    }
  }
  return selected;
}

function createChangeEvent() {
  const listeners = new Set();
  return {
    listeners,
    api: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
    emit(changes, areaName = "local") {
      for (const listener of [...listeners]) {
        listener(changes, areaName);
      }
    },
  };
}

function createChrome(initialData = {}) {
  const data = clone(initialData);
  const setCalls = [];
  const changeEvent = createChangeEvent();
  const chromeApi = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(selectKeys(data, keys));
        },
        set(items, callback) {
          setCalls.push(clone(items));
          Object.assign(data, clone(items));
          callback();
        },
      },
      onChanged: changeEvent.api,
    },
  };
  return { chromeApi, data, setCalls, changeEvent };
}

test("storage exports the shipped Storage constructor", () => {
  assert.equal(typeof Storage, "function");
  assert.equal(globalThis.PromptHelper.Storage, Storage);
  assert.equal(require(STORAGE_PATH).Storage, Storage);
});

test("missing ph_auto_select_bracket_placeholder normalizes to on", async () => {
  const fake = createChrome();
  const storage = new Storage(fake.chromeApi);
  const loaded = await storage.load();
  assert.equal(loaded.autoSelectBracketPlaceholder, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      fake.data,
      KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER,
    ),
    false,
  );
});

test("saving auto-select off then loading returns off", async () => {
  const fake = createChrome();
  const writer = new Storage(fake.chromeApi);
  await writer.load();
  assert.equal((await writer.load()).autoSelectBracketPlaceholder, true);

  await writer.saveAutoSelectBracketPlaceholder(false);
  assert.equal(
    fake.data[KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER],
    false,
  );

  const reader = new Storage(fake.chromeApi);
  const loaded = await reader.load();
  assert.equal(loaded.autoSelectBracketPlaceholder, false);
});

test("ph_prompts, ph_placeholder_history, and ph_button_pos still round-trip", async () => {
  const fake = createChrome();
  const storage = new Storage(fake.chromeApi);
  await storage.load();

  const prompts = [
    {
      id: "keep",
      name: "  First prompt  ",
      prompt: "line one\nline two",
      placeholder: "  <slot>  ",
    },
  ];
  await storage.savePrompts(prompts, ["  <slot>  ", "【光标】", "<slot>"]);
  await storage.saveButtonPosition({ left: 12.5, top: 24, extra: true });

  assert.deepEqual(fake.data[KEYS.PROMPTS], [
    {
      id: "keep",
      name: "First prompt",
      prompt: "line one\nline two",
      placeholder: "<slot>",
    },
  ]);
  assert.deepEqual(fake.data[KEYS.PLACEHOLDER_HISTORY], ["<slot>"]);
  assert.deepEqual(fake.data[KEYS.BUTTON_POSITION], { left: 12.5, top: 24 });

  const reader = new Storage(fake.chromeApi);
  const loaded = await reader.load();
  assert.deepEqual(loaded.prompts, [
    {
      id: "keep",
      name: "First prompt",
      prompt: "line one\nline two",
      placeholder: "<slot>",
    },
  ]);
  assert.deepEqual(loaded.placeholderHistory, ["<slot>"]);
  assert.deepEqual(loaded.buttonPosition, { left: 12.5, top: 24 });
  assert.equal(loaded.autoSelectBracketPlaceholder, true);
});

test("storage key names stay compatible with existing installs", () => {
  assert.equal(KEYS.PROMPTS, "ph_prompts");
  assert.equal(KEYS.PLACEHOLDER_HISTORY, "ph_placeholder_history");
  assert.equal(KEYS.BUTTON_POSITION, "ph_button_pos");
  assert.equal(
    KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER,
    "ph_auto_select_bracket_placeholder",
  );
  assert.deepEqual(constants.STORAGE_KEYS, KEYS);
});

test("subscribe relays local auto-select changes", () => {
  const fake = createChrome();
  const storage = new Storage(fake.chromeApi);
  const observed = [];
  const unsubscribe = storage.subscribe((changes, areaName) => {
    observed.push({ changes, areaName });
  });

  fake.changeEvent.emit(
    { [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: { oldValue: true, newValue: false } },
    "local",
  );
  fake.changeEvent.emit(
    { [KEYS.PROMPTS]: { oldValue: [], newValue: [] } },
    "sync",
  );

  assert.equal(observed.length, 1);
  assert.equal(observed[0].areaName, "local");
  assert.equal(
    observed[0].changes[KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER].newValue,
    false,
  );
  unsubscribe();
});
