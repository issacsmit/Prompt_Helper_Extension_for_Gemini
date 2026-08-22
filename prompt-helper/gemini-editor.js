(function exposeGeminiEditor(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;

  function getDocument(editor, fallback) {
    return (
      editor?.ownerDocument ||
      fallback ||
      globalObject.document ||
      null
    );
  }

  function getWindow(editor, fallback) {
    const doc = getDocument(editor);
    return (
      fallback ||
      doc?.defaultView ||
      globalObject.window ||
      globalObject
    );
  }

  function findGeminiEditor(root) {
    const scope = root || globalObject.document;
    if (!scope || typeof scope.querySelector !== "function") {
      return null;
    }
    return (
      scope.querySelector('[aria-label="Enter a prompt for Gemini"]') ||
      scope.querySelector('.ql-editor[contenteditable="true"]')
    );
  }

  function isElement(node) {
    return !!node && node.nodeType === ELEMENT_NODE;
  }

  function tagNameOf(node) {
    return String(node?.tagName || "").toUpperCase();
  }

  function childList(node) {
    if (!node) return [];
    if (Array.isArray(node.childNodes)) return node.childNodes;
    return Array.from(node.childNodes || []);
  }

  function getParagraphs(editor) {
    if (!editor) return [];
    if (typeof editor.querySelectorAll === "function") {
      try {
        const found = editor.querySelectorAll(":scope > p");
        if (found && found.length) return Array.from(found);
      } catch (_error) {
        // Fake documents may not implement :scope.
      }
    }
    return childList(editor).filter((node) => tagNameOf(node) === "P");
  }

  function collectTextNodes(root, output) {
    const nodes = output || [];
    if (!root) return nodes;
    if (root.nodeType === TEXT_NODE) {
      nodes.push(root);
      return nodes;
    }
    for (const child of childList(root)) {
      if (isElement(child) && tagNameOf(child) === "BR") continue;
      collectTextNodes(child, nodes);
    }
    return nodes;
  }

  function collectText(node) {
    if (!node) return "";
    if (node.nodeType === TEXT_NODE) return node.textContent || "";
    let text = "";
    for (const child of childList(node)) {
      if (isElement(child) && tagNameOf(child) === "BR") continue;
      text += collectText(child);
    }
    return text;
  }

  function getEditorPlainText(editor) {
    const paragraphs = getParagraphs(editor);
    if (!paragraphs.length) return collectText(editor);
    return paragraphs.map(collectText).join("\n");
  }

  function countNewlinesBefore(text, position) {
    let count = 0;
    const limit = Math.min(position, text.length);
    for (let i = 0; i < limit; i++) {
      if (text[i] === "\n") count += 1;
    }
    return count;
  }

  function stringOffsetToDomOffset(fullText, stringOffset) {
    const clamped = Math.max(0, Math.min(stringOffset, fullText.length));
    return clamped - countNewlinesBefore(fullText, clamped);
  }

  function rebuildEditor(editor, text) {
    const doc = getDocument(editor);
    if (!editor || !doc) return editor;

    while (editor.firstChild) {
      editor.removeChild(editor.firstChild);
    }

    String(text).split("\n").forEach((line) => {
      const p = doc.createElement("p");
      if (line) {
        if (typeof p.appendChild === "function" && typeof doc.createTextNode === "function") {
          p.appendChild(doc.createTextNode(line));
        } else {
          p.textContent = line;
        }
      } else if (typeof p.appendChild === "function") {
        p.appendChild(doc.createElement("br"));
      } else {
        p.innerHTML = "<br>";
      }
      editor.appendChild(p);
    });
    return editor;
  }

  function resolveDomPoint(editor, domOffset) {
    const paragraphs = getParagraphs(editor);
    const roots = paragraphs.length ? paragraphs : [editor];
    const nodes = [];
    for (const root of roots) collectTextNodes(root, nodes);

    let current = 0;
    for (const node of nodes) {
      const len = (node.textContent || "").length;
      if (current + len >= domOffset) {
        return { node, offset: Math.max(0, domOffset - current) };
      }
      current += len;
    }
    if (nodes.length) {
      const last = nodes[nodes.length - 1];
      return { node: last, offset: (last.textContent || "").length };
    }
    return { node: roots[0] || editor, offset: 0 };
  }

  function applyEditorSelection(editor, fullText, startOffset, endOffset, windowObj) {
    const doc = getDocument(editor);
    const win = getWindow(editor, windowObj);
    if (!editor || !doc || typeof doc.createRange !== "function") {
      return false;
    }

    const startDom = stringOffsetToDomOffset(fullText, startOffset);
    const endDom = stringOffsetToDomOffset(
      fullText,
      Number.isFinite(endOffset) ? endOffset : startOffset,
    );
    const start = resolveDomPoint(editor, startDom);
    const end = resolveDomPoint(editor, endDom);
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    if (endDom === startDom) {
      range.collapse(true);
    } else {
      range.setEnd(end.node, end.offset);
    }

    const sel =
      typeof win.getSelection === "function"
        ? win.getSelection()
        : typeof doc.getSelection === "function"
          ? doc.getSelection()
          : null;
    if (!sel || typeof sel.removeAllRanges !== "function") {
      return false;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function createBubblingEvent(windowObj, name) {
    const win = windowObj || globalObject;
    const preferred =
      name === "input"
        ? win.InputEvent || globalObject.InputEvent
        : name === "keyup"
          ? win.KeyboardEvent || globalObject.KeyboardEvent
          : null;
    const fallbacks = [preferred, win.Event, globalObject.Event].filter(Boolean);
    for (const Ctor of fallbacks) {
      try {
        return new Ctor(name, { bubbles: true });
      } catch (_error) {
        // Try the next constructor; Node tests may lack InputEvent/KeyboardEvent.
      }
    }
    return { type: name, bubbles: true };
  }

  function dispatchEditorEvents(editor, windowObj) {
    const win = getWindow(editor, windowObj);
    const inputEvent = createBubblingEvent(win, "input");
    const keyupEvent = createBubblingEvent(win, "keyup");
    if (typeof editor.dispatchEvent === "function") {
      editor.dispatchEvent(inputEvent);
      editor.dispatchEvent(keyupEvent);
    }
    return [inputEvent, keyupEvent];
  }

  function focusEditor(editor) {
    if (typeof editor?.focus === "function") {
      try {
        editor.focus({ preventScroll: true });
      } catch (_error) {
        editor.focus();
      }
    }
  }

  function insertPreparedText(editor, prepared, cursorOffset, options = {}) {
    if (!editor || !prepared || typeof prepared.text !== "string") {
      return { ok: false, code: "INVALID_INSERTION" };
    }

    const currentText = getEditorPlainText(editor);
    const insertionStart = Math.max(
      0,
      Math.min(
        Number.isFinite(cursorOffset) ? cursorOffset : currentText.length,
        currentText.length,
      ),
    );
    const inserted = prepared.text;
    const newText =
      currentText.slice(0, insertionStart) +
      inserted +
      currentText.slice(insertionStart);

    focusEditor(editor);
    rebuildEditor(editor, newText);
    const events = dispatchEditorEvents(editor, options.window);

    const caretInFull = insertionStart + Math.max(0, prepared.caretOffset || 0);
    const hasRange = Number.isFinite(prepared.selectionEndOffset);
    const selectionEndInFull = hasRange
      ? insertionStart + prepared.selectionEndOffset
      : caretInFull;

    applyEditorSelection(
      editor,
      newText,
      caretInFull,
      selectionEndInFull,
      options.window,
    );

    return {
      ok: true,
      code: "INSERTED",
      text: newText,
      insertionStart,
      caretOffset: caretInFull,
      selectionEndOffset: selectionEndInFull,
      collapsed: !hasRange || selectionEndInFull === caretInFull,
      events,
    };
  }

  function getCursorOffset(editor, windowObj) {
    const win = getWindow(editor, windowObj);
    const sel = typeof win.getSelection === "function" ? win.getSelection() : null;
    if (!sel || !sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return 0;

    let offset = 0;
    const paragraphs = getParagraphs(editor);
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      if (i > 0) offset += 1;
      const nodes = collectTextNodes(p);
      for (const node of nodes) {
        if (node === range.startContainer) return offset + range.startOffset;
        offset += (node.textContent || "").length;
      }
      if (p === range.startContainer) return offset;
    }
    return offset;
  }

  const api = {
    findGeminiEditor,
    getEditorPlainText,
    rebuildEditor,
    applyEditorSelection,
    insertPreparedText,
    getCursorOffset,
    dispatchEditorEvents,
  };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
