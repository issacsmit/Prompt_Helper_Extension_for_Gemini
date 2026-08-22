(function exposeStorage(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const constants =
    typeof module !== "undefined" && module.exports
      ? require("./constants.js")
      : namespace;
  const DEFAULT_PLACEHOLDER = constants.DEFAULT_PLACEHOLDER || "【光标】";
  const LEGACY_PLACEHOLDER = constants.LEGACY_PLACEHOLDER || "[光标]";
  const MAX_PLACEHOLDER_HISTORY = constants.MAX_PLACEHOLDER_HISTORY || 5;
  const DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER =
    constants.DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER !== false;
  const STORAGE_KEYS =
    constants.STORAGE_KEYS ||
    Object.freeze({
      PROMPTS: "ph_prompts",
      PLACEHOLDER_HISTORY: "ph_placeholder_history",
      BUTTON_POSITION: "ph_button_pos",
      AUTO_SELECT_BRACKET_PLACEHOLDER: "ph_auto_select_bracket_placeholder",
    });
  const STORAGE_TIMEOUT_MS = constants.STORAGE_TIMEOUT_MS || 3000;
  const CONTEXT_INVALID_MESSAGE =
    "Prompt Helper storage is unavailable because the extension context was invalidated.";

  class StorageError extends Error {
    constructor(message, code, cause) {
      super(message);
      this.name = "StorageError";
      this.code = code;
      if (cause !== undefined) {
        this.cause = cause;
      }
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizePlaceholder(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized || null;
  }

  function normalizePrompt(record) {
    if (
      !isObject(record) ||
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.prompt !== "string"
    ) {
      return null;
    }

    const id = record.id.trim();
    const name = record.name.trim();
    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      prompt: record.prompt,
      placeholder: normalizePlaceholder(record.placeholder) || DEFAULT_PLACEHOLDER,
    };
  }

  function normalizePrompts(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map(normalizePrompt).filter((record) => record !== null);
  }

  function normalizeHistory(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const history = [];
    const seen = new Set();
    for (const entry of value) {
      const placeholder = normalizePlaceholder(entry);
      if (
        placeholder === null ||
        placeholder === DEFAULT_PLACEHOLDER ||
        placeholder === LEGACY_PLACEHOLDER ||
        seen.has(placeholder)
      ) {
        continue;
      }

      seen.add(placeholder);
      history.push(placeholder);
      if (history.length === MAX_PLACEHOLDER_HISTORY) {
        break;
      }
    }
    return history;
  }

  function normalizeButtonPosition(value) {
    if (
      !isObject(value) ||
      !Number.isFinite(value.left) ||
      !Number.isFinite(value.top) ||
      value.left < 0 ||
      value.top < 0
    ) {
      return null;
    }
    return { left: value.left, top: value.top };
  }

  function createEmptyState() {
    return {
      prompts: [],
      placeholderHistory: [],
      buttonPosition: null,
      autoSelectBracketPlaceholder: DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER,
    };
  }

  function clonePrompts(prompts) {
    return prompts.map((record) => ({ ...record }));
  }

  function cloneButtonPosition(position) {
    return position === null ? null : { ...position };
  }

  function cloneState(state) {
    return {
      prompts: clonePrompts(state.prompts),
      placeholderHistory: [...state.placeholderHistory],
      buttonPosition: cloneButtonPosition(state.buttonPosition),
      autoSelectBracketPlaceholder: state.autoSelectBracketPlaceholder !== false,
    };
  }

  function normalizeState(raw) {
    const source = isObject(raw) ? raw : {};
    return {
      prompts: normalizePrompts(source[STORAGE_KEYS.PROMPTS]),
      placeholderHistory: normalizeHistory(
        source[STORAGE_KEYS.PLACEHOLDER_HISTORY],
      ),
      buttonPosition: normalizeButtonPosition(
        source[STORAGE_KEYS.BUTTON_POSITION],
      ),
      autoSelectBracketPlaceholder:
        typeof source[STORAGE_KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER] === "boolean"
          ? source[STORAGE_KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]
          : DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER,
    };
  }

  function getErrorMessage(error) {
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error.message === "string") {
      return error.message;
    }
    return "Unknown Chrome storage error";
  }

  function isContextInvalidError(error) {
    return /(?:extension\s+)?context\s+(?:was\s+)?invalidated/i.test(
      getErrorMessage(error),
    );
  }

  function createContextInvalidError(cause) {
    return new StorageError(
      CONTEXT_INVALID_MESSAGE,
      "EXTENSION_CONTEXT_INVALID",
      cause,
    );
  }

  function normalizeOperationError(operation, error, code = "STORAGE_ERROR") {
    if (isContextInvalidError(error)) {
      return createContextInvalidError(error);
    }
    return new StorageError(
      `Chrome storage ${operation} failed: ${getErrorMessage(error)}`,
      code,
      error,
    );
  }

  class Storage {
    constructor(chromeApi = globalObject.chrome, options = {}) {
      this._chrome = chromeApi;
      this._timeoutMs =
        Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
          ? options.timeoutMs
          : STORAGE_TIMEOUT_MS;
      this._state = createEmptyState();
    }

    async load() {
      const raw = await this._callStorage("get", Object.values(STORAGE_KEYS));
      const state = normalizeState(raw);
      this._state = state;
      return cloneState(state);
    }

    async savePrompts(prompts, placeholderHistory) {
      const nextPrompts = normalizePrompts(prompts);
      const nextHistory = normalizeHistory(placeholderHistory);
      const rollbackSnapshot = {
        prompts: clonePrompts(this._state.prompts),
        placeholderHistory: [...this._state.placeholderHistory],
      };

      try {
        await this._callStorage("set", {
          [STORAGE_KEYS.PROMPTS]: clonePrompts(nextPrompts),
          [STORAGE_KEYS.PLACEHOLDER_HISTORY]: [...nextHistory],
        });
      } catch (error) {
        error.rollbackSnapshot = rollbackSnapshot;
        throw error;
      }

      this._state = {
        ...this._state,
        prompts: nextPrompts,
        placeholderHistory: nextHistory,
      };
      return { rollbackSnapshot };
    }

    async saveButtonPosition(position) {
      const nextPosition =
        position === null ? null : normalizeButtonPosition(position);
      if (position !== null && nextPosition === null) {
        throw new TypeError(
          "Button position must be null or finite, non-negative left/top coordinates.",
        );
      }

      const rollbackSnapshot = {
        buttonPosition: cloneButtonPosition(this._state.buttonPosition),
      };

      try {
        await this._callStorage("set", {
          [STORAGE_KEYS.BUTTON_POSITION]: cloneButtonPosition(nextPosition),
        });
      } catch (error) {
        error.rollbackSnapshot = rollbackSnapshot;
        throw error;
      }

      this._state = { ...this._state, buttonPosition: nextPosition };
      return { rollbackSnapshot };
    }

    async saveAutoSelectBracketPlaceholder(enabled) {
      if (typeof enabled !== "boolean") {
        throw new TypeError("Auto-select bracket placeholder setting must be boolean.");
      }
      const rollbackSnapshot = {
        autoSelectBracketPlaceholder: this._state.autoSelectBracketPlaceholder,
      };

      try {
        await this._callStorage("set", {
          [STORAGE_KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: enabled,
        });
      } catch (error) {
        error.rollbackSnapshot = rollbackSnapshot;
        throw error;
      }

      this._state = {
        ...this._state,
        autoSelectBracketPlaceholder: enabled,
      };
      return { rollbackSnapshot };
    }

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Storage change listener must be a function.");
      }

      let changeEvent;
      try {
        changeEvent = this._chrome?.storage?.onChanged;
      } catch (error) {
        throw normalizeOperationError("subscribe", error);
      }
      if (
        !changeEvent ||
        typeof changeEvent.addListener !== "function" ||
        typeof changeEvent.removeListener !== "function"
      ) {
        throw createContextInvalidError();
      }

      const wrappedListener = (changes, areaName) => {
        if (areaName !== "local" || !isObject(changes)) {
          return;
        }

        let relevant = false;
        if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.PROMPTS)) {
          this._state.prompts = normalizePrompts(
            changes[STORAGE_KEYS.PROMPTS]?.newValue,
          );
          relevant = true;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            STORAGE_KEYS.PLACEHOLDER_HISTORY,
          )
        ) {
          this._state.placeholderHistory = normalizeHistory(
            changes[STORAGE_KEYS.PLACEHOLDER_HISTORY]?.newValue,
          );
          relevant = true;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            STORAGE_KEYS.BUTTON_POSITION,
          )
        ) {
          this._state.buttonPosition = normalizeButtonPosition(
            changes[STORAGE_KEYS.BUTTON_POSITION]?.newValue,
          );
          relevant = true;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            STORAGE_KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER,
          )
        ) {
          const nextValue =
            changes[STORAGE_KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]?.newValue;
          this._state.autoSelectBracketPlaceholder =
            typeof nextValue === "boolean"
              ? nextValue
              : DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER;
          relevant = true;
        }

        if (relevant) {
          listener(changes, areaName);
        }
      };

      try {
        changeEvent.addListener(wrappedListener);
      } catch (error) {
        throw normalizeOperationError("subscribe", error);
      }

      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        try {
          changeEvent.removeListener(wrappedListener);
        } catch (error) {
          throw normalizeOperationError("unsubscribe", error);
        }
      };
    }

    _callStorage(operation, payload) {
      let storageArea;
      let method;
      try {
        storageArea = this._chrome?.storage?.local;
        method = storageArea?.[operation];
      } catch (error) {
        return Promise.reject(normalizeOperationError(operation, error));
      }

      if (!storageArea || typeof method !== "function") {
        return Promise.reject(createContextInvalidError());
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (settle, value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          settle(value);
        };
        const timeoutId = setTimeout(() => {
          finish(
            reject,
            new StorageError(
              `Chrome storage ${operation} timed out after ${this._timeoutMs} ms.`,
              "STORAGE_TIMEOUT",
            ),
          );
        }, this._timeoutMs);

        const callback = (result) => {
          let lastError;
          try {
            lastError = this._chrome?.runtime?.lastError;
          } catch (error) {
            finish(reject, normalizeOperationError(operation, error));
            return;
          }

          if (lastError) {
            finish(
              reject,
              normalizeOperationError(
                operation,
                lastError,
                "CHROME_RUNTIME_ERROR",
              ),
            );
            return;
          }
          finish(resolve, result);
        };

        try {
          const maybePromise = method.call(storageArea, payload, callback);
          if (maybePromise && typeof maybePromise.then === "function") {
            Promise.resolve(maybePromise).then(
              (result) => finish(resolve, result),
              (error) =>
                finish(reject, normalizeOperationError(operation, error)),
            );
          }
        } catch (error) {
          finish(reject, normalizeOperationError(operation, error));
        }
      });
    }
  }

  const api = { Storage, StorageError, normalizeState, STORAGE_KEYS };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
