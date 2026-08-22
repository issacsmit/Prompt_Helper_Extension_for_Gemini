(function () {
  "use strict";

  const PANEL_ID = "ph-prompt-helper-panel";
  const BTN_ID = "ph-prompt-helper-btn";
  const MODAL_ID = "ph-modal-overlay";
  const CONFIRM_ID = "ph-confirm-overlay";
  const SETTINGS_ID = "ph-settings-overlay";
  const STATUS_ID = "ph-status";

  const helper = globalThis.PromptHelper || {};
  const DEFAULT_PLACEHOLDER = helper.DEFAULT_PLACEHOLDER || "【光标】";
  const DEBUG = false;
  const TRANSITION_MS_FALLBACK = 180;

  const UI_TEXT = {
    toolName: "提示词工具",
    floatingButton: "✦",
    addPrompt: "添加提示词",
    editPrompt: "编辑提示词",
    insertSettings: "插入设置",
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
    hint: "在需要定位光标的位置输入占位符（如 {0}），注入后会自动移除并将光标定位到该位置。正文中的第一处【…】默认会被选中，可在插入设置中关闭。",
    autoSelectLabel: "自动选中第一处【…】",
    autoSelectHint: "插入后可直接输入内容，替换整段全角中括号占位符。关闭后不影响【光标】、[光标] 和自定义光标。",
    priorityNote: "优先级：当前自定义光标 → 【光标】/[光标] → 第一处【…】 → 历史兼容占位符。只有实际命中的规则才会生效。",
    deleteConfirm: "确定要删除 “{0}” 吗？",
    noEditor: "未找到 Gemini 输入框",
    saveFailed: "保存失败，请重试。",
    settingsSaveFailed: "插入设置保存失败，请重试。",
    settingsUnavailable: "插入设置暂时无法保存。",
    loadFailed: "提示词加载失败，已使用安全空列表。",
    deleteFailed: "删除失败，请重试。",
    historyDeleteFailed: "删除历史失败，请重试。",
    positionSaveFailed: "按钮位置保存失败，当前位置会保留到本页关闭。",
    syncUnavailable: "跨标签页同步暂不可用。",
  };

  let promptsData = [];
  let placeholderHistory = [];
  let autoSelectBracketPlaceholder = true;
  let lastEditorCursorOffset = 0;
  let activeContextMenu = null;
  let lastActiveTrigger = null;
  let currentModalOverlay = null;
  let currentConfirmOverlay = null;
  let currentSettingsOverlay = null;
  const overlayRemovalTimers = new WeakMap();
  let pendingWrites = 0;
  let pendingExternalSync = false;
  let storageUnsubscribe = null;
  let statusHideTimer = null;

  const storage = typeof helper.Storage === "function"
    ? new helper.Storage(typeof chrome !== "undefined" ? chrome : undefined)
    : null;

  function log(...args) {
    if (DEBUG) console.log("[Prompt Helper]", ...args);
  }

  function t(template, value) {
    return template.replace("{0}", value);
  }

  function isIgnorableStorageError(error) {
    if (!error) return false;
    if (error.code === "EXTENSION_CONTEXT_INVALID") return true;
    return !!(error.message && /context invalidated/i.test(error.message));
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
    if (currentSettingsOverlay === overlay) currentSettingsOverlay = null;
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

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function applyState(state) {
    promptsData = Array.isArray(state.prompts) ? state.prompts.map((record) => ({ ...record })) : [];
    placeholderHistory = Array.isArray(state.placeholderHistory) ? [...state.placeholderHistory] : [];
    autoSelectBracketPlaceholder = state.autoSelectBracketPlaceholder !== false;
  }

  async function loadData() {
    if (!storage) {
      applyState({
        prompts: [],
        placeholderHistory: [],
        buttonPosition: null,
        autoSelectBracketPlaceholder: true,
      });
      return {
        prompts: promptsData,
        placeholderHistory,
        buttonPosition: null,
        autoSelectBracketPlaceholder: true,
      };
    }
    try {
      const state = await storage.load();
      applyState(state);
      return state;
    } catch (error) {
      applyState({
        prompts: [],
        placeholderHistory: [],
        buttonPosition: null,
        autoSelectBracketPlaceholder: true,
      });
      if (!isIgnorableStorageError(error)) {
        console.error("[Prompt Helper] load failed:", error);
        showStatus(UI_TEXT.loadFailed, "error");
      }
      return {
        prompts: promptsData,
        placeholderHistory,
        buttonPosition: null,
        autoSelectBracketPlaceholder: true,
      };
    }
  }

  async function withWrite(operation) {
    pendingWrites += 1;
    try {
      return await operation();
    } finally {
      pendingWrites -= 1;
      if (pendingWrites === 0 && pendingExternalSync) {
        pendingExternalSync = false;
        await reloadFromStorage();
      }
    }
  }

  async function saveData() {
    if (!storage) return;
    await storage.savePrompts(promptsData, placeholderHistory);
  }

  async function saveButtonPosition(pos) {
    if (!storage) return;
    try {
      await withWrite(() => storage.saveButtonPosition(pos));
    } catch (error) {
      if (!isIgnorableStorageError(error)) {
        console.error("[Prompt Helper] save button position failed:", error);
        showStatus(UI_TEXT.positionSaveFailed, "error");
      }
    }
  }

  async function reloadFromStorage() {
    const state = await loadData();
    renderList();
    if (state.buttonPosition) {
      const btn = document.getElementById(BTN_ID);
      if (btn && typeof state.buttonPosition.left === "number" && typeof state.buttonPosition.top === "number") {
        btn.style.left = `${state.buttonPosition.left}px`;
        btn.style.top = `${state.buttonPosition.top}px`;
        btn.style.right = "auto";
        btn.style.bottom = "auto";
        updatePanelPosition();
        updateStatusPosition();
      }
    }
    return state;
  }

  function subscribeToStorage() {
    if (!storage || typeof storage.subscribe !== "function" || storageUnsubscribe) return;
    try {
      storageUnsubscribe = storage.subscribe(() => {
        if (pendingWrites > 0) {
          pendingExternalSync = true;
          return;
        }
        void reloadFromStorage();
      });
    } catch (error) {
      if (!isIgnorableStorageError(error)) {
        showStatus(UI_TEXT.syncUnavailable, "error");
      }
    }
  }

  function findGeminiEditor() {
    return typeof helper.findGeminiEditor === "function"
      ? helper.findGeminiEditor(document)
      : document.querySelector('[aria-label="Enter a prompt for Gemini"]') ||
        document.querySelector('.ql-editor[contenteditable="true"]');
  }

  function getCursorOffset(editor) {
    if (typeof helper.getCursorOffset === "function") {
      return helper.getCursorOffset(editor, window);
    }
    return 0;
  }

  function trackEditorCursor() {
    const editor = findGeminiEditor();
    if (!editor) return;
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      lastEditorCursorOffset = getCursorOffset(editor);
    }
  }

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
        await withWrite(() => saveData());
        tag.remove();
        if (historyContainer.children.length === 0) historyContainer.style.display = "none";
        closeContextMenu();
      } catch (error) {
        placeholderHistory = previousHistory;
        console.error("[Prompt Helper] delete placeholder history failed:", error);
        showStatus(UI_TEXT.historyDeleteFailed, "error");
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

  function createStatusNode() {
    if (document.getElementById(STATUS_ID)) return;
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.className = "ph-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    document.body.appendChild(status);
  }

  function updateStatusPosition() {
    const status = document.getElementById(STATUS_ID);
    const btn = document.getElementById(BTN_ID);
    if (!status || status.hidden || !btn) return;

    const margin = 12;
    const gap = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const btnRect = btn.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const width = statusRect.width || Math.min(320, viewportWidth - margin * 2);
    const height = statusRect.height || 44;
    const maximumLeft = Math.max(margin, viewportWidth - width - margin);
    const maximumTop = Math.max(margin, viewportHeight - height - margin);
    const preferredTop = btnRect.top - height - gap;
    const fallbackTop = btnRect.bottom + gap;
    const left = Math.min(Math.max(btnRect.right - width, margin), maximumLeft);
    const top = Math.min(
      Math.max(preferredTop >= margin ? preferredTop : fallbackTop, margin),
      maximumTop
    );
    status.style.left = `${left}px`;
    status.style.top = `${top}px`;
    status.style.right = "auto";
    status.style.bottom = "auto";
  }

  function showStatus(message, kind = "info") {
    createStatusNode();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = String(message || "");
    status.setAttribute("data-ph-kind", kind === "error" ? "error" : "info");
    status.hidden = !message;
    updateStatusPosition();
    if (statusHideTimer) {
      window.clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    if (message) {
      statusHideTimer = window.setTimeout(() => {
        status.hidden = true;
      }, 4000);
    }
  }

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
      updateStatusPosition();
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
    createStatusNode();
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
    const title = document.createElement("span");
    title.className = "ph-panel-title";
    title.textContent = UI_TEXT.toolName;
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "ph-settings-btn";
    settingsBtn.textContent = UI_TEXT.insertSettings;
    settingsBtn.setAttribute("aria-label", UI_TEXT.insertSettings);
    settingsBtn.title = UI_TEXT.insertSettings;
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSettingsModal();
    });
    header.appendChild(title);
    header.appendChild(settingsBtn);

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
        e.preventDefault();
        openModal(item);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ph-action-btn ph-action-delete";
      deleteBtn.type = "button";
      deleteBtn.title = UI_TEXT.delete;
      deleteBtn.textContent = UI_TEXT.delete;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        openConfirm(item);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      entry.appendChild(content);
      entry.appendChild(actions);
      entry.addEventListener("click", (e) => {
        if (e.target.closest(".ph-entry-actions")) return;
        insertPrompt(item);
      });
      entry.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          insertPrompt(item);
        }
      });
      list.appendChild(entry);
    });
  }

  function rememberPlaceholder(placeholder) {
    if (typeof helper.updatePlaceholderHistory === "function") {
      placeholderHistory = helper.updatePlaceholderHistory(placeholderHistory, placeholder);
      return;
    }
    if (!placeholder || placeholder === DEFAULT_PLACEHOLDER) return;
    placeholderHistory = placeholderHistory.filter((p) => p !== placeholder);
    placeholderHistory.unshift(placeholder);
    if (placeholderHistory.length > 5) placeholderHistory.pop();
  }

  function openSettingsModal() {
    cleanupOverlayGroup(`#${SETTINGS_ID}, .ph-settings-overlay`);
    cleanupOverlayGroup(`#${MODAL_ID}, .ph-modal-overlay`);
    cleanupOverlayGroup(`#${CONFIRM_ID}, .ph-confirm-overlay`);
    lastActiveTrigger = document.activeElement;

    const overlay = document.createElement("div");
    overlay.id = SETTINGS_ID;
    overlay.className = "ph-modal-overlay ph-settings-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", UI_TEXT.insertSettings);

    const box = document.createElement("div");
    box.className = "ph-modal-box";

    const header = document.createElement("div");
    header.className = "ph-modal-header";
    header.textContent = UI_TEXT.insertSettings;

    const body = document.createElement("div");
    body.className = "ph-modal-body";

    const setting = document.createElement("label");
    setting.className = "ph-switch-setting";
    setting.setAttribute("for", "ph-auto-select-bracket-placeholder");

    const copy = document.createElement("span");
    copy.className = "ph-setting-copy";
    const settingTitle = document.createElement("span");
    settingTitle.className = "ph-setting-title";
    settingTitle.textContent = UI_TEXT.autoSelectLabel;
    const settingDescription = document.createElement("span");
    settingDescription.className = "ph-setting-description";
    settingDescription.textContent = UI_TEXT.autoSelectHint;
    copy.appendChild(settingTitle);
    copy.appendChild(settingDescription);

    const checkbox = document.createElement("input");
    checkbox.id = "ph-auto-select-bracket-placeholder";
    checkbox.className = "ph-switch-input";
    checkbox.type = "checkbox";
    checkbox.setAttribute("role", "switch");
    checkbox.checked = autoSelectBracketPlaceholder !== false;

    setting.appendChild(copy);
    setting.appendChild(checkbox);

    const priorityNote = document.createElement("p");
    priorityNote.className = "ph-setting-note";
    priorityNote.textContent = UI_TEXT.priorityNote;

    const errorMsg = document.createElement("div");
    errorMsg.className = "ph-form-hint";
    errorMsg.style.color = "#dc2626";
    errorMsg.style.display = "none";
    errorMsg.textContent = UI_TEXT.settingsSaveFailed;

    body.appendChild(setting);
    body.appendChild(priorityNote);
    body.appendChild(errorMsg);

    const footer = document.createElement("div");
    footer.className = "ph-modal-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ph-btn ph-btn-secondary";
    cancelBtn.type = "button";
    cancelBtn.textContent = UI_TEXT.cancel;
    cancelBtn.addEventListener("click", closeSettingsModal);
    const saveBtn = document.createElement("button");
    saveBtn.className = "ph-btn ph-btn-primary";
    saveBtn.type = "button";
    saveBtn.textContent = UI_TEXT.save;
    let isSaving = false;
    saveBtn.addEventListener("click", async () => {
      if (isSaving) return;
      if (!storage || typeof storage.saveAutoSelectBracketPlaceholder !== "function") {
        showStatus(UI_TEXT.settingsUnavailable, "error");
        errorMsg.textContent = UI_TEXT.settingsUnavailable;
        errorMsg.style.display = "";
        return;
      }
      const previous = autoSelectBracketPlaceholder;
      const nextValue = checkbox.checked;
      isSaving = true;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      errorMsg.style.display = "none";
      try {
        await withWrite(() => storage.saveAutoSelectBracketPlaceholder(nextValue));
        autoSelectBracketPlaceholder = nextValue;
        closeSettingsModal();
      } catch (error) {
        autoSelectBracketPlaceholder = previous;
        checkbox.checked = previous;
        console.error("[Prompt Helper] save insert settings failed:", error);
        errorMsg.style.display = "";
        showStatus(UI_TEXT.settingsSaveFailed, "error");
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        isSaving = false;
      }
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettingsModal(); });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSettingsModal();
        return;
      }
      trapFocus(box, e);
    });
    document.body.appendChild(overlay);
    currentSettingsOverlay = overlay;
    requestAnimationFrame(() => {
      overlay.classList.add("ph-modal-open");
      checkbox.focus();
    });
  }

  function closeSettingsModal() {
    const overlay =
      currentSettingsOverlay ||
      document.querySelector(".ph-settings-overlay.ph-modal-open") ||
      document.getElementById(SETTINGS_ID);
    closeOverlay(overlay, "ph-modal-open", lastActiveTrigger);
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
    errorMsg.textContent = UI_TEXT.saveFailed;
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
        rememberPlaceholder(placeholder);
        await withWrite(() => saveData());
        renderList();
        closeModal();
      } catch (error) {
        promptsData = previousPrompts;
        placeholderHistory = previousHistory;
        console.error("[Prompt Helper] save prompt failed:", error);
        errorMsg.style.display = "";
        showStatus(UI_TEXT.saveFailed, "error");
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
        await withWrite(() => saveData());
        renderList();
        closeConfirm();
      } catch (error) {
        promptsData = previousPrompts;
        console.error("[Prompt Helper] delete prompt failed:", error);
        msg.textContent = UI_TEXT.deleteFailed;
        showStatus(UI_TEXT.deleteFailed, "error");
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

  function insertPrompt(item) {
    const editor = findGeminiEditor();
    if (!editor) {
      showStatus(UI_TEXT.noEditor, "error");
      return;
    }

    if (typeof helper.prepareInsertion !== "function" || typeof helper.insertPreparedText !== "function") {
      showStatus(UI_TEXT.noEditor, "error");
      return;
    }

    const prepared = helper.prepareInsertion(item, placeholderHistory, {
      autoSelectBracketPlaceholder,
    });
    const result = helper.insertPreparedText(editor, prepared, lastEditorCursorOffset, {
      window,
    });
    if (!result || result.ok !== true) {
      showStatus(UI_TEXT.noEditor, "error");
      return;
    }
    lastEditorCursorOffset = result.caretOffset;
    editor.focus();
    log("inserted prompt", item.name, result);
  }

  async function init() {
    const data = await loadData();
    createPanel();
    createFloatingButton(data.buttonPosition || data.buttonPos || null);
    renderList();
    subscribeToStorage();

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

    window.addEventListener("resize", () => {
      updatePanelPosition();
      updateStatusPosition();
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
