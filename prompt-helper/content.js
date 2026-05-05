(function () {
  "use strict";

  const PANEL_ID = "ph-prompt-helper-panel";
  const BTN_ID = "ph-prompt-helper-btn";
  const MODAL_ID = "ph-modal-overlay";
  const CONFIRM_ID = "ph-confirm-overlay";

  const DEFAULT_PLACEHOLDER = "【光标】";
  const LEGACY_PLACEHOLDER = "[光标]";
  const MAX_PLACEHOLDER_HISTORY = 5;
  const DEBUG = false;
  const TRANSITION_MS_FALLBACK = 180;
  const STORAGE_TIMEOUT_MS = 3000;

  const UI_TEXT = {
    toolName: "提示词工具",
    floatingButton: "✦",
    addPrompt: "添加提示词",
    editPrompt: "编辑提示词",
    save: "保存",
    add: "添加",
    cancel: "取消",
    delete: "删除",
    emptyList: "暂无提示词，点击下方 + 添加",
    unnamed: "未命名",
    name: "名称",
    namePlaceholder: "例如：写作助手",
    prompt: "提示词",
    promptPlaceholder: "输入提示词内容，可包含占位符",
    placeholder: "占位符",
    placeholderTagTitle: "点击填充，右键删除",
    hint: "在需要定位光标的位置输入占位符（如 {0}），注入后会自动移除并将光标定位到该位置。",
    deleteConfirm: "确定要删除 “{0}” 吗？",
    noEditor: "未找到 Gemini 输入框",
  };

  let promptsData = [];
  let placeholderHistory = [];
  let lastEditorCursorOffset = 0;
  let activeContextMenu = null;
  let lastActiveTrigger = null;
  let currentModalOverlay = null;
  let currentConfirmOverlay = null;
  const overlayRemovalTimers = new WeakMap();

  function log(...args) {
    if (DEBUG) console.log("[Prompt Helper]", ...args);
  }

  function warn(...args) {
    if (DEBUG) console.warn("[Prompt Helper]", ...args);
  }

  function t(template, value) {
    return template.replace("{0}", value);
  }

  function canUseChromeStorage() {
    try {
      return typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.local && !!chrome.runtime && !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  }

  function isContextInvalidatedError(error) {
    return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
  }

  function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(
      container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function trapFocus(container, event) {
    if (event.key !== "Tab") return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function getTransitionMs() {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const mid = rootStyle.getPropertyValue("--ph-mid").trim();
    if (!mid) return TRANSITION_MS_FALLBACK;
    const numeric = parseFloat(mid);
    if (!Number.isFinite(numeric)) return TRANSITION_MS_FALLBACK;
    return mid.endsWith("s") ? Math.round(numeric * 1000) : Math.round(numeric);
  }

  function clearOverlayRemovalTimer(overlay) {
    const timerId = overlayRemovalTimers.get(overlay);
    if (timerId) {
      clearTimeout(timerId);
      overlayRemovalTimers.delete(overlay);
    }
  }

  function clearOverlayRef(overlay) {
    if (currentModalOverlay === overlay) currentModalOverlay = null;
    if (currentConfirmOverlay === overlay) currentConfirmOverlay = null;
  }

  function restoreTriggerFocus(trigger) {
    if (!trigger || typeof trigger.focus !== "function" || !document.contains(trigger)) return;
    trigger.focus();
  }

  function removeOverlayNode(overlay, triggerToFocus = null) {
    if (!overlay) return;
    clearOverlayRemovalTimer(overlay);
    clearOverlayRef(overlay);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    restoreTriggerFocus(triggerToFocus);
  }

  function cleanupOverlayGroup(selector) {
    document.querySelectorAll(selector).forEach((overlay) => removeOverlayNode(overlay));
  }

  function closeOverlay(overlay, openClass, triggerToFocus = null) {
    if (!overlay) return;
    if (overlay.dataset.phClosing === "true") return;

    overlay.dataset.phClosing = "true";
    overlay.classList.remove(openClass);
    overlay.style.pointerEvents = "none";

    const timerId = window.setTimeout(() => {
      removeOverlayNode(overlay, triggerToFocus);
    }, getTransitionMs());

    overlayRemovalTimers.set(overlay, timerId);
  }

  // Module: Core utils
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Module: Storage
  function loadData() {
    return new Promise((resolve) => {
      if (canUseChromeStorage()) {
        chrome.storage.local.get(["ph_prompts", "ph_placeholder_history", "ph_button_pos"], (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            console.error("[Prompt Helper] load failed:", runtimeError.message);
            resolve({ prompts: [], history: [], buttonPos: null });
            return;
          }
          promptsData = Array.isArray(result.ph_prompts) ? result.ph_prompts : [];
          placeholderHistory = Array.isArray(result.ph_placeholder_history) ? result.ph_placeholder_history : [];
          resolve({ prompts: promptsData, history: placeholderHistory, buttonPos: result.ph_button_pos || null });
        });
      } else {
        promptsData = [];
        placeholderHistory = [];
        resolve({ prompts: [], history: [], buttonPos: null });
      }
    });
  }

  function saveData() {
    return new Promise((resolve, reject) => {
      if (canUseChromeStorage()) {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("chrome.storage.local.set timed out"));
        }, STORAGE_TIMEOUT_MS);

        try {
          chrome.storage.local.set(
            { ph_prompts: promptsData, ph_placeholder_history: placeholderHistory },
            () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeoutId);

              const runtimeError = chrome.runtime && chrome.runtime.lastError;
              if (runtimeError) {
                if (isContextInvalidatedError(runtimeError)) {
                  resolve();
                  return;
                }
                reject(new Error(runtimeError.message));
                return;
              }

              resolve();
            }
          );
        } catch (error) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (isContextInvalidatedError(error)) {
            resolve();
            return;
          }
          reject(error);
        }
      } else {
        resolve();
      }
    });
  }

  function saveButtonPosition(pos) {
    if (canUseChromeStorage()) {
      try {
        chrome.storage.local.set({ ph_button_pos: pos });
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          console.error("[Prompt Helper] save button position failed:", error);
        }
      }
    }
  }

  // Module: Gemini editor bridge
  function findGeminiEditor() {
    return (
      document.querySelector('[aria-label="Enter a prompt for Gemini"]') ||
      document.querySelector('.ql-editor[contenteditable="true"]')
    );
  }

  function getEditorPlainText(editor) {
    let text = "";
    const paragraphs = editor.querySelectorAll(":scope > p");
    paragraphs.forEach((p, idx) => {
      if (idx > 0) text += "\n";
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) text += node.textContent;
    });
    return text;
  }

  function getCursorOffset(editor) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return 0;

    let offset = 0;
    const paragraphs = editor.querySelectorAll(":scope > p");
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      if (i > 0) offset += 1;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node === range.startContainer) return offset + range.startOffset;
        offset += node.textContent.length;
      }
      if (p === range.startContainer) return offset;
      if (!p.contains(range.startContainer) && (p.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
        return Math.max(0, offset - (i > 0 ? 1 : 0));
      }
    }
    return offset;
  }

  function rebuildEditor(editor, text) {
    editor.innerHTML = "";
    text.split("\n").forEach((line) => {
      const p = document.createElement("p");
      if (line) p.textContent = line;
      else p.innerHTML = "<br>";
      editor.appendChild(p);
    });
  }

  function setCursorAtPosition(container, position) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let currentPos = 0;
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (currentPos + len >= position) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, position - currentPos));
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      currentPos += len;
    }
    return false;
  }

  function countNewlinesBefore(text, position) {
    let count = 0;
    for (let i = 0; i < position && i < text.length; i++) if (text[i] === "\n") count++;
    return count;
  }

  function trackEditorCursor() {
    const editor = findGeminiEditor();
    if (!editor) return;
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) lastEditorCursorOffset = getCursorOffset(editor);
  }

  // Module: Context menu
  function closeContextMenu() {
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }
  }

  function showPlaceholderContextMenu(x, y, ph, tag, historyContainer) {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "ph-context-menu";
    menu.setAttribute("role", "menu");

    const deleteItem = document.createElement("div");
    deleteItem.className = "ph-context-menu-item";
    deleteItem.textContent = UI_TEXT.delete;
    deleteItem.setAttribute("role", "menuitem");
    deleteItem.addEventListener("click", async () => {
      const previousHistory = placeholderHistory.slice();
      placeholderHistory = placeholderHistory.filter((p) => p !== ph);
      try {
        await saveData();
        tag.remove();
        if (historyContainer.children.length === 0) historyContainer.style.display = "none";
        closeContextMenu();
      } catch (error) {
        placeholderHistory = previousHistory;
        console.error("[Prompt Helper] delete placeholder history failed:", error);
        closeContextMenu();
      }
    });

    const cancelItem = document.createElement("div");
    cancelItem.className = "ph-context-menu-item ph-context-menu-item-secondary";
    cancelItem.textContent = UI_TEXT.cancel;
    cancelItem.setAttribute("role", "menuitem");
    cancelItem.addEventListener("click", closeContextMenu);

    menu.appendChild(deleteItem);
    menu.appendChild(cancelItem);
    document.body.appendChild(menu);
    activeContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  }

  // Module: Panel shell
  function createFloatingButton(savedPos) {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.className = "ph-floating-btn";
    btn.type = "button";
    btn.textContent = UI_TEXT.floatingButton;
    btn.title = UI_TEXT.toolName;
    btn.setAttribute("aria-label", UI_TEXT.toolName);

    if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
      btn.style.left = `${savedPos.left}px`;
      btn.style.top = `${savedPos.top}px`;
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    }

    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    btn.addEventListener("mousedown", (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = btn.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      btn.classList.add("ph-dragging");
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      btn.style.left = `${startLeft + dx}px`;
      btn.style.top = `${startTop + dy}px`;
      btn.style.right = "auto";
      btn.style.bottom = "auto";
      updatePanelPosition();
    });

    window.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      btn.classList.remove("ph-dragging");
      if (hasMoved) {
        const rect = btn.getBoundingClientRect();
        saveButtonPosition({ left: rect.left, top: rect.top });
      }
    });

    btn.addEventListener("click", (e) => {
      if (hasMoved) {
        hasMoved = false;
        return;
      }
      e.stopPropagation();
      togglePanel();
    });

    document.body.appendChild(btn);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "ph-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", UI_TEXT.toolName);

    const header = document.createElement("div");
    header.className = "ph-panel-header";
    header.textContent = UI_TEXT.toolName;

    const list = document.createElement("div");
    list.id = "ph-panel-list";
    list.className = "ph-panel-list";

    const footer = document.createElement("div");
    footer.className = "ph-panel-footer";

    const addBtn = document.createElement("button");
    addBtn.className = "ph-add-btn";
    addBtn.type = "button";
    const icon = document.createElement("span");
    icon.className = "ph-add-icon";
    icon.textContent = "+";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = UI_TEXT.addPrompt;
    addBtn.appendChild(icon);
    addBtn.appendChild(text);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openModal();
    });

    footer.appendChild(addBtn);
    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(footer);
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(panel);
  }

  function updatePanelPosition() {
    const panel = document.getElementById(PANEL_ID);
    const btn = document.getElementById(BTN_ID);
    if (!panel || !btn) return;

    const btnRect = btn.getBoundingClientRect();
    const panelWidth = 336;
    const panelHeight = 520;
    const margin = 12;

    let left = btnRect.left + btnRect.width / 2 - panelWidth;
    if (left < margin) left = margin;
    if (left + panelWidth > window.innerWidth - margin) left = window.innerWidth - panelWidth - margin;

    const topSpace = btnRect.top;
    const bottomSpace = window.innerHeight - btnRect.bottom;

    if (topSpace >= panelHeight + margin) {
      panel.style.bottom = `${window.innerHeight - btnRect.top + margin}px`;
      panel.style.top = "auto";
    } else if (bottomSpace >= panelHeight + margin) {
      panel.style.top = `${btnRect.bottom + margin}px`;
      panel.style.bottom = "auto";
    } else {
      panel.style.bottom = `${margin}px`;
      panel.style.top = "auto";
      panel.style.maxHeight = `${Math.max(220, window.innerHeight - margin * 2)}px`;
    }

    panel.style.right = "auto";
    panel.style.left = `${left}px`;
  }

  function togglePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const isOpen = panel.classList.toggle("ph-panel-open");
    if (isOpen) updatePanelPosition();
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.remove("ph-panel-open");
  }

  // Module: Prompt list and CRUD UI
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function renderList() {
    const list = document.getElementById("ph-panel-list");
    if (!list) return;
    list.innerHTML = "";

    if (promptsData.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ph-panel-empty";
      empty.textContent = UI_TEXT.emptyList;
      list.appendChild(empty);
      return;
    }

    promptsData.forEach((item) => {
      const entry = document.createElement("div");
      entry.className = "ph-entry";
      entry.setAttribute("tabindex", "0");

      const content = document.createElement("div");
      content.className = "ph-entry-content";
      const title = document.createElement("div");
      title.className = "ph-entry-title";
      title.textContent = item.name || UI_TEXT.unnamed;

      const preview = document.createElement("div");
      preview.className = "ph-entry-preview";
      const rawText = item.prompt || "";
      const placeholder = item.placeholder || DEFAULT_PLACEHOLDER;
      const cleaned = rawText.replace(new RegExp(escapeRegExp(placeholder), "g"), "");
      preview.textContent = cleaned.slice(0, 40) + (cleaned.length > 40 ? "…" : "");
      content.appendChild(title);
      content.appendChild(preview);

      const actions = document.createElement("div");
      actions.className = "ph-entry-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "ph-action-btn ph-action-edit";
      editBtn.type = "button";
      editBtn.title = UI_TEXT.editPrompt;
      editBtn.textContent = UI_TEXT.editPrompt;
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal(item);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ph-action-btn ph-action-delete";
      deleteBtn.type = "button";
      deleteBtn.title = UI_TEXT.delete;
      deleteBtn.textContent = UI_TEXT.delete;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openConfirm(item);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      entry.appendChild(content);
      entry.appendChild(actions);
      entry.addEventListener("click", () => insertPrompt(item));
      entry.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          insertPrompt(item);
        }
      });
      list.appendChild(entry);
    });
  }

  function updatePlaceholderHistory(placeholder) {
    if (!placeholder || placeholder === DEFAULT_PLACEHOLDER) return;
    placeholderHistory = placeholderHistory.filter((p) => p !== placeholder);
    placeholderHistory.unshift(placeholder);
    if (placeholderHistory.length > MAX_PLACEHOLDER_HISTORY) placeholderHistory.pop();
  }

  function openModal(item = null) {
    cleanupOverlayGroup(`#${MODAL_ID}, .ph-modal-overlay`);
    cleanupOverlayGroup(`#${CONFIRM_ID}, .ph-confirm-overlay`);
    lastActiveTrigger = document.activeElement;

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.className = "ph-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", item ? UI_TEXT.editPrompt : UI_TEXT.addPrompt);

    const box = document.createElement("div");
    box.className = "ph-modal-box";
    const isEdit = !!item;

    const header = document.createElement("div");
    header.className = "ph-modal-header";
    header.textContent = isEdit ? UI_TEXT.editPrompt : UI_TEXT.addPrompt;

    const body = document.createElement("div");
    body.className = "ph-modal-body";

    const nameLabel = document.createElement("label");
    nameLabel.className = "ph-form-label";
    nameLabel.textContent = UI_TEXT.name;
    const nameInput = document.createElement("input");
    nameInput.className = "ph-form-input";
    nameInput.type = "text";
    nameInput.placeholder = UI_TEXT.namePlaceholder;
    nameInput.value = isEdit ? (item.name || "") : "";

    const promptLabel = document.createElement("label");
    promptLabel.className = "ph-form-label";
    promptLabel.textContent = UI_TEXT.prompt;
    const promptTextarea = document.createElement("textarea");
    promptTextarea.className = "ph-form-textarea";
    promptTextarea.placeholder = UI_TEXT.promptPlaceholder;
    promptTextarea.value = isEdit ? (item.prompt || "") : "";

    const placeholderLabel = document.createElement("label");
    placeholderLabel.className = "ph-form-label";
    placeholderLabel.textContent = UI_TEXT.placeholder;
    const placeholderInput = document.createElement("input");
    placeholderInput.className = "ph-form-input";
    placeholderInput.type = "text";
    placeholderInput.placeholder = DEFAULT_PLACEHOLDER;
    placeholderInput.value = isEdit ? (item.placeholder || DEFAULT_PLACEHOLDER) : DEFAULT_PLACEHOLDER;

    body.appendChild(nameLabel);
    body.appendChild(nameInput);
    body.appendChild(promptLabel);
    body.appendChild(promptTextarea);
    body.appendChild(placeholderLabel);
    body.appendChild(placeholderInput);

    if (placeholderHistory.length > 0) {
      const historyContainer = document.createElement("div");
      historyContainer.className = "ph-placeholder-history";
      placeholderHistory.forEach((ph) => {
        const tag = document.createElement("span");
        tag.className = "ph-placeholder-tag";
        tag.textContent = ph;
        tag.title = UI_TEXT.placeholderTagTitle;
        tag.addEventListener("click", () => {
          placeholderInput.value = ph;
        });
        tag.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showPlaceholderContextMenu(e.clientX, e.clientY, ph, tag, historyContainer);
        });
        historyContainer.appendChild(tag);
      });
      body.appendChild(historyContainer);
    }

    const hint = document.createElement("div");
    hint.className = "ph-form-hint";
    hint.innerHTML = t(UI_TEXT.hint, `<code>${DEFAULT_PLACEHOLDER}</code>`);
    body.appendChild(hint);

    const errorMsg = document.createElement("div");
    errorMsg.className = "ph-form-hint";
    errorMsg.style.color = "#dc2626";
    errorMsg.style.display = "none";
    errorMsg.textContent = "保存失败，请重试。";
    body.appendChild(errorMsg);

    const footer = document.createElement("div");
    footer.className = "ph-modal-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ph-btn ph-btn-secondary";
    cancelBtn.type = "button";
    cancelBtn.textContent = UI_TEXT.cancel;
    cancelBtn.addEventListener("click", closeModal);
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "ph-btn ph-btn-primary";
    confirmBtn.type = "button";
    confirmBtn.textContent = isEdit ? UI_TEXT.save : UI_TEXT.add;
    let isSaving = false;
    confirmBtn.addEventListener("click", async () => {
      if (isSaving) return;
      const name = nameInput.value.trim();
      const prompt = promptTextarea.value;
      const placeholder = placeholderInput.value.trim() || DEFAULT_PLACEHOLDER;
      if (!name) {
        nameInput.style.borderColor = "#dc2626";
        setTimeout(() => { nameInput.style.borderColor = ""; }, 1200);
        return;
      }
      const previousPrompts = promptsData.slice();
      const previousHistory = placeholderHistory.slice();
      const originalText = confirmBtn.textContent;
      isSaving = true;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      errorMsg.style.display = "none";
      confirmBtn.textContent = "保存中...";

      try {
        if (isEdit) {
          const idx = promptsData.findIndex((p) => p.id === item.id);
          if (idx !== -1) promptsData[idx] = { ...promptsData[idx], name, prompt, placeholder };
        } else {
          promptsData.push({ id: generateId(), name, prompt, placeholder });
        }
        updatePlaceholderHistory(placeholder);
        await saveData();
        renderList();
        closeModal();
      } catch (error) {
        promptsData = previousPrompts;
        placeholderHistory = previousHistory;
        console.error("[Prompt Helper] save prompt failed:", error);
        errorMsg.style.display = "";
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.textContent = originalText;
        isSaving = false;
      }
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        return;
      }
      trapFocus(box, e);
    });
    document.body.appendChild(overlay);
    currentModalOverlay = overlay;
    requestAnimationFrame(() => {
      overlay.classList.add("ph-modal-open");
      nameInput.focus();
    });
  }

  function closeModal() {
    const overlay = currentModalOverlay || document.querySelector(".ph-modal-overlay.ph-modal-open") || document.getElementById(MODAL_ID);
    closeOverlay(overlay, "ph-modal-open", lastActiveTrigger);
  }

  function openConfirm(item) {
    cleanupOverlayGroup(`#${CONFIRM_ID}, .ph-confirm-overlay`);
    cleanupOverlayGroup(`#${MODAL_ID}, .ph-modal-overlay`);
    lastActiveTrigger = document.activeElement;

    const overlay = document.createElement("div");
    overlay.id = CONFIRM_ID;
    overlay.className = "ph-confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", UI_TEXT.delete);

    const box = document.createElement("div");
    box.className = "ph-confirm-box";
    const msg = document.createElement("div");
    msg.className = "ph-confirm-msg";
    msg.textContent = t(UI_TEXT.deleteConfirm, item.name);

    const footer = document.createElement("div");
    footer.className = "ph-confirm-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ph-btn ph-btn-secondary";
    cancelBtn.type = "button";
    cancelBtn.textContent = UI_TEXT.cancel;
    cancelBtn.addEventListener("click", closeConfirm);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ph-btn ph-btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = UI_TEXT.delete;
    let isDeleting = false;
    deleteBtn.addEventListener("click", async () => {
      if (isDeleting) return;
      const previousPrompts = promptsData.slice();
      const originalText = deleteBtn.textContent;
      isDeleting = true;
      deleteBtn.disabled = true;
      cancelBtn.disabled = true;
      deleteBtn.textContent = "删除中...";

      try {
        promptsData = promptsData.filter((p) => p.id !== item.id);
        await saveData();
        renderList();
        closeConfirm();
      } catch (error) {
        promptsData = previousPrompts;
        console.error("[Prompt Helper] delete prompt failed:", error);
        msg.textContent = "删除失败，请重试。";
        deleteBtn.disabled = false;
        cancelBtn.disabled = false;
        deleteBtn.textContent = originalText;
        isDeleting = false;
      }
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(deleteBtn);
    box.appendChild(msg);
    box.appendChild(footer);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeConfirm(); });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeConfirm();
        return;
      }
      trapFocus(box, e);
    });
    document.body.appendChild(overlay);
    currentConfirmOverlay = overlay;
    requestAnimationFrame(() => {
      overlay.classList.add("ph-confirm-open");
      cancelBtn.focus();
    });
  }

  function closeConfirm() {
    const overlay =
      currentConfirmOverlay || document.querySelector(".ph-confirm-overlay.ph-confirm-open") || document.getElementById(CONFIRM_ID);
    closeOverlay(overlay, "ph-confirm-open", lastActiveTrigger);
  }

  // Module: Prompt insertion
  function insertPrompt(item) {
    const editor = findGeminiEditor();
    if (!editor) {
      warn(UI_TEXT.noEditor);
      return;
    }

    const promptText = item.prompt || "";
    let placeholder = item.placeholder || DEFAULT_PLACEHOLDER;
    let placeholderIndex = promptText.indexOf(placeholder);
    let cleanText = promptText;

    if (placeholderIndex !== -1) {
      cleanText = promptText.replace(placeholder, "");
    } else if (placeholder === DEFAULT_PLACEHOLDER) {
      placeholderIndex = promptText.indexOf(LEGACY_PLACEHOLDER);
      if (placeholderIndex !== -1) cleanText = promptText.replace(LEGACY_PLACEHOLDER, "");
    }

    if (placeholderIndex === -1) {
      for (const ph of [DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER, ...placeholderHistory]) {
        if (promptText.includes(ph)) {
          placeholderIndex = promptText.indexOf(ph);
          cleanText = promptText.replace(ph, "");
          break;
        }
      }
    }

    editor.focus();
    const currentText = getEditorPlainText(editor);
    const cursorOffset = lastEditorCursorOffset;
    const newText = currentText.slice(0, cursorOffset) + cleanText + currentText.slice(cursorOffset);
    rebuildEditor(editor, newText);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    let finalCursorPos = cursorOffset + (placeholderIndex !== -1 ? placeholderIndex : cleanText.length);
    finalCursorPos -= countNewlinesBefore(currentText, cursorOffset);
    finalCursorPos -= countNewlinesBefore(cleanText, placeholderIndex !== -1 ? placeholderIndex : cleanText.length);
    setCursorAtPosition(editor, finalCursorPos);
    lastEditorCursorOffset = cursorOffset + (placeholderIndex !== -1 ? placeholderIndex : cleanText.length);
    editor.focus();
    log("inserted prompt", item.name, { finalCursorPos, lastEditorCursorOffset, placeholder });
  }

  // Module: App bootstrap
  async function init() {
    const data = await loadData();
    createPanel();
    createFloatingButton(data.buttonPos);
    renderList();

    document.addEventListener("click", (e) => {
      const panel = document.getElementById(PANEL_ID);
      const btn = document.getElementById(BTN_ID);
      if (panel && btn && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePanel();
      if (activeContextMenu && !activeContextMenu.contains(e.target)) closeContextMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeContextMenu();
        closePanel();
      }
    });

    document.addEventListener("selectionchange", trackEditorCursor);
    document.addEventListener(
      "focusout",
      (e) => {
        const editor = findGeminiEditor();
        if (editor && editor.contains(e.target)) {
          const sel = window.getSelection();
          if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) lastEditorCursorOffset = getCursorOffset(editor);
        }
      },
      true
    );

    log("initialized");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
