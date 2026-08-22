"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const EDITOR_PATH = path.join(__dirname, "..", "gemini-editor.js");
const { insertPreparedText, getEditorPlainText } = require(EDITOR_PATH);
const { prepareInsertion } = require("../prompt-engine.js");
const { DEFAULT_PLACEHOLDER } = require("../constants.js");

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
  }
}

class FakeNode {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (String(value) && this.ownerDocument) {
      this.appendChild(this.ownerDocument.createTextNode(String(value)));
    }
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    node.ownerDocument = this.nodeType === 9 ? this : this.ownerDocument;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error("Node is not a child");
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
}

class FakeText extends FakeNode {
  constructor(data, ownerDocument) {
    super(3, ownerDocument);
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, ownerDocument) {
    super(1, ownerDocument);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.dispatchedEvents = [];
    this.focused = false;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelectorAll(selector) {
    if (selector === ":scope > p" || selector === "p") {
      return this.childNodes.filter((child) => child.tagName === "P");
    }
    return [];
  }

  querySelector(selector) {
    if (selector.includes("Enter a prompt for Gemini")) {
      return this.getAttribute("aria-label") === "Enter a prompt for Gemini"
        ? this
        : null;
    }
    return null;
  }

  focus() {
    this.focused = true;
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push(event);
    return true;
  }
}

class FakeRange {
  constructor() {
    this.startContainer = null;
    this.startOffset = 0;
    this.endContainer = null;
    this.endOffset = 0;
    this.collapsed = true;
  }

  setStart(node, offset) {
    this.startContainer = node;
    this.startOffset = offset;
    this.collapsed =
      this.endContainer === this.startContainer &&
      this.endOffset === this.startOffset;
  }

  setEnd(node, offset) {
    this.endContainer = node;
    this.endOffset = offset;
    this.collapsed =
      this.endContainer === this.startContainer &&
      this.endOffset === this.startOffset;
  }

  collapse(toStart) {
    if (toStart !== false) {
      this.endContainer = this.startContainer;
      this.endOffset = this.startOffset;
    } else {
      this.startContainer = this.endContainer;
      this.startOffset = this.endOffset;
    }
    this.collapsed = true;
  }
}

class FakeSelection {
  constructor() {
    this.ranges = [];
  }

  get rangeCount() {
    return this.ranges.length;
  }

  getRangeAt(index) {
    return this.ranges[index];
  }

  removeAllRanges() {
    this.ranges = [];
  }

  addRange(range) {
    this.ranges.push(range);
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9, null);
    this.ownerDocument = this;
    this.defaultView = null;
    this.body = new FakeElement("body", this);
    this.appendChild(this.body);
    this.selection = new FakeSelection();
    this.Event = FakeEvent;
    this.InputEvent = FakeEvent;
    this.KeyboardEvent = FakeEvent;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createTextNode(data) {
    return new FakeText(data, this);
  }

  createRange() {
    return new FakeRange();
  }

  getSelection() {
    return this.selection;
  }
}

function createEditor(initialText) {
  const documentObject = new FakeDocument();
  const windowObject = {
    getSelection: () => documentObject.selection,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
  };
  documentObject.defaultView = windowObject;

  const editor = documentObject.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("aria-label", "Enter a prompt for Gemini");
  editor.className = "ql-editor";
  documentObject.body.appendChild(editor);

  if (initialText != null) {
    insertPreparedText(
      editor,
      { text: initialText, caretOffset: initialText.length },
      0,
      { window: windowObject },
    );
    editor.dispatchedEvents = [];
  }

  return { documentObject, windowObject, editor };
}

function selectedText(selection) {
  const range = selection.getRangeAt(0);
  if (!range) return "";
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
    return range.startContainer.textContent.slice(range.startOffset, range.endOffset);
  }
  return "";
}

test("gemini-editor exports the shipped insertPreparedText", () => {
  assert.equal(typeof insertPreparedText, "function");
  assert.equal(globalThis.PromptHelper.insertPreparedText, insertPreparedText);
  assert.equal(require(EDITOR_PATH).insertPreparedText, insertPreparedText);
});

test("inserting 【主题】 leaves the token in the DOM and selects it", () => {
  const { editor, windowObject, documentObject } = createEditor("已有");
  const prepared = prepareInsertion({ prompt: "请把【主题】写成【风格】。" }, []);

  const result = insertPreparedText(editor, prepared, 2, { window: windowObject });

  assert.equal(result.ok, true);
  assert.equal(getEditorPlainText(editor), "已有请把【主题】写成【风格】。");
  assert.match(getEditorPlainText(editor), /【主题】/);
  assert.match(getEditorPlainText(editor), /【风格】/);

  const range = documentObject.selection.getRangeAt(0);
  assert.ok(range);
  assert.equal(range.collapsed, false);
  assert.equal(selectedText(documentObject.selection), "【主题】");
  assert.notEqual(range.startOffset, range.endOffset);
});

test("inserting 【光标】 removes the marker and collapses the caret", () => {
  const { editor, windowObject, documentObject } = createEditor("");
  const prepared = prepareInsertion({
    prompt: `你好${DEFAULT_PLACEHOLDER}世界`,
  });

  const result = insertPreparedText(editor, prepared, 0, { window: windowObject });

  assert.equal(result.ok, true);
  assert.equal(getEditorPlainText(editor), "你好世界");
  assert.equal(getEditorPlainText(editor).includes(DEFAULT_PLACEHOLDER), false);

  const range = documentObject.selection.getRangeAt(0);
  assert.ok(range);
  assert.equal(range.collapsed, true);
  assert.equal(range.startOffset, range.endOffset);
  assert.equal(range.startContainer.nodeType, 3);
  assert.equal(range.startOffset, "你好".length);
});

test("insert path dispatches bubbling input and keyup", () => {
  const { editor, windowObject } = createEditor("前");
  const prepared = prepareInsertion({ prompt: "插入" }, []);
  insertPreparedText(editor, prepared, 1, { window: windowObject });

  const types = editor.dispatchedEvents.map((event) => event.type);
  assert.deepEqual(types, ["input", "keyup"]);
  assert.equal(editor.dispatchedEvents[0].bubbles, true);
  assert.equal(editor.dispatchedEvents[1].bubbles, true);
});

test("insert does not overwrite existing editor text", () => {
  const { editor, windowObject } = createEditor("AB");
  const prepared = prepareInsertion({ prompt: "X" }, []);
  insertPreparedText(editor, prepared, 1, { window: windowObject });
  assert.equal(getEditorPlainText(editor), "AXB");
});
