(function exposeUpdateCheck(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const GITHUB_API_LATEST =
    "https://api.github.com/repos/issacsmit/Prompt_Helper_Extension/releases/latest";
  const GITHUB_RELEASES_PAGE =
    "https://github.com/issacsmit/Prompt_Helper_Extension/releases";
  const RELEASE_URL_PREFIX =
    "https://github.com/issacsmit/Prompt_Helper_Extension/";
  const CHECK_TIMEOUT_MS = 5000;

  function normalizeVersion(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().replace(/^v/iu, "");
    if (!normalized || !/^\d+(?:\.\d+)*$/u.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function isNewerVersion(latest, current) {
    const latestParts = normalizeVersion(latest);
    const currentParts = normalizeVersion(current);
    if (!latestParts || !currentParts) {
      return false;
    }
    const latestNumbers = latestParts.split(".").map(Number);
    const currentNumbers = currentParts.split(".").map(Number);
    const length = Math.max(latestNumbers.length, currentNumbers.length);
    for (let index = 0; index < length; index += 1) {
      const latestValue = latestNumbers[index] || 0;
      const currentValue = currentNumbers[index] || 0;
      if (latestValue > currentValue) {
        return true;
      }
      if (latestValue < currentValue) {
        return false;
      }
    }
    return false;
  }

  function readCurrentVersion(chromeApi = globalObject.chrome) {
    try {
      const version = chromeApi?.runtime?.getManifest?.()?.version;
      return normalizeVersion(version);
    } catch (_error) {
      return null;
    }
  }

  function sanitizeReleaseUrl(value) {
    if (typeof value !== "string") {
      return GITHUB_RELEASES_PAGE;
    }
    const trimmed = value.trim();
    if (!trimmed.startsWith(RELEASE_URL_PREFIX) || trimmed.includes("\\")) {
      return GITHUB_RELEASES_PAGE;
    }
    return trimmed;
  }

  function isTimeoutError(error) {
    return error?.code === "TIMEOUT" || error?.name === "AbortError";
  }

  async function checkForUpdate(options = {}) {
    const current = normalizeVersion(options.currentVersion) || readCurrentVersion(options.chrome);
    const fetchImpl = options.fetch || globalObject.fetch;
    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : CHECK_TIMEOUT_MS;

    if (!current) {
      return {
        status: "unavailable",
        current: null,
        code: "NO_VERSION",
        htmlUrl: GITHUB_RELEASES_PAGE,
      };
    }

    if (typeof fetchImpl !== "function") {
      return {
        status: "unavailable",
        current,
        code: "FETCH_UNAVAILABLE",
        htmlUrl: GITHUB_RELEASES_PAGE,
      };
    }

    const abortController =
      typeof globalObject.AbortController === "function" ? new globalObject.AbortController() : null;
    let timeoutId;
    const request = Promise.resolve()
      .then(() =>
        fetchImpl(GITHUB_API_LATEST, {
          method: "GET",
          headers: { Accept: "application/vnd.github+json" },
          signal: abortController ? abortController.signal : undefined,
        }),
      )
      .then(async (response) => {
        if (!response || response.ok !== true) {
          const error = new Error("HTTP_ERROR");
          error.code = `HTTP_${response?.status || 0}`;
          throw error;
        }
        if (typeof response.json !== "function") {
          throw new Error("BAD_BODY");
        }
        return response.json();
      });
    request.catch(() => {});

    try {
      const payload = await Promise.race([
        request,
        new Promise((_resolve, reject) => {
          timeoutId = globalObject.setTimeout(() => {
            try {
              abortController?.abort();
            } catch (_error) {
              // Some fetch mocks throw if aborted after the caller already timed out.
            }
            const error = new Error("TIMEOUT");
            error.code = "TIMEOUT";
            reject(error);
          }, timeoutMs);
        }),
      ]);
      const latest = normalizeVersion(payload?.tag_name || payload?.name);
      if (!latest) {
        return {
          status: "unavailable",
          current,
          code: "BAD_RELEASE",
          htmlUrl: GITHUB_RELEASES_PAGE,
        };
      }
      const htmlUrl = sanitizeReleaseUrl(payload?.html_url);
      if (isNewerVersion(latest, current)) {
        return { status: "available", current, latest, htmlUrl };
      }
      return { status: "current", current, latest, htmlUrl };
    } catch (error) {
      return {
        status: "unavailable",
        current,
        code: isTimeoutError(error) ? "TIMEOUT" : error?.code || "NETWORK",
        htmlUrl: GITHUB_RELEASES_PAGE,
      };
    } finally {
      if (timeoutId !== undefined) {
        globalObject.clearTimeout(timeoutId);
      }
    }
  }

  const api = {
    GITHUB_API_LATEST,
    GITHUB_RELEASES_PAGE,
    isNewerVersion,
    normalizeVersion,
    readCurrentVersion,
    checkForUpdate,
  };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
