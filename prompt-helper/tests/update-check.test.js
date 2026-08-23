"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const updateCheck = require("../update-check.js");

test("update check exposes version helpers through CommonJS and PromptHelper", () => {
  assert.equal(typeof updateCheck.isNewerVersion, "function");
  assert.equal(typeof updateCheck.checkForUpdate, "function");
  assert.equal(globalThis.PromptHelper?.checkForUpdate, updateCheck.checkForUpdate);
});

test("update check targets this project's GitHub repository", () => {
  assert.equal(
    updateCheck.GITHUB_API_LATEST,
    "https://api.github.com/repos/issacsmit/Prompt_Helper_Extension/releases/latest"
  );
  assert.equal(
    updateCheck.GITHUB_RELEASES_PAGE,
    "https://github.com/issacsmit/Prompt_Helper_Extension/releases"
  );
});

test("semver comparison treats dotted numbers as newer, not strings", () => {
  assert.equal(updateCheck.isNewerVersion("1.1.0", "1.0.0"), true);
  assert.equal(updateCheck.isNewerVersion("v1.1.0", "1.0.0"), true);
  assert.equal(updateCheck.isNewerVersion("1.0.0", "1.0.0"), false);
  assert.equal(updateCheck.isNewerVersion("1.9.0", "1.10.0"), false);
  assert.equal(updateCheck.isNewerVersion("1.10.0", "1.9.0"), true);
  assert.equal(updateCheck.isNewerVersion("2.0", "1.9.9"), true);
  assert.equal(updateCheck.isNewerVersion("not-a-version", "1.0.0"), false);
});

test("checkForUpdate reports a newer GitHub release", async () => {
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async (url) => {
      assert.equal(url, updateCheck.GITHUB_API_LATEST);
      return {
        ok: true,
        json: async () => ({
          tag_name: "v1.1.0",
          html_url:
            "https://github.com/issacsmit/Prompt_Helper_Extension/releases/tag/v1.1.0",
        }),
      };
    },
  });

  assert.deepEqual(result, {
    status: "available",
    current: "1.0.0",
    latest: "1.1.0",
    htmlUrl:
      "https://github.com/issacsmit/Prompt_Helper_Extension/releases/tag/v1.1.0",
  });
});

test("checkForUpdate treats matching versions as current", async () => {
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0", html_url: "https://evil.example/x" }),
    }),
  });

  assert.equal(result.status, "current");
  assert.equal(result.latest, "1.0.0");
  assert.equal(result.htmlUrl, updateCheck.GITHUB_RELEASES_PAGE);
});

test("checkForUpdate fails closed when GitHub is missing or broken", async () => {
  const missing = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.htmlUrl, updateCheck.GITHUB_RELEASES_PAGE);

  const crashed = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(crashed.status, "unavailable");
  assert.equal(crashed.code, "NETWORK");
});

test("readCurrentVersion uses the chrome manifest and does not invent a version", () => {
  assert.equal(
    updateCheck.readCurrentVersion({
      runtime: { getManifest: () => ({ version: "1.2.3" }) },
    }),
    "1.2.3"
  );
  assert.equal(
    updateCheck.readCurrentVersion({
      runtime: {
        getManifest: () => {
          throw new Error("no manifest");
        },
      },
    }),
    null
  );
  assert.equal(updateCheck.readCurrentVersion({}), null);
});

test("checkForUpdate does not fetch when the current version is unknown", async () => {
  let fetched = false;
  const result = await updateCheck.checkForUpdate({
    chrome: {},
    fetch: async () => {
      fetched = true;
      return { ok: true, json: async () => ({ tag_name: "v1.2.0" }) };
    },
  });
  assert.equal(fetched, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "NO_VERSION");
});

test("checkForUpdate aborts a hung fetch when the timeout wins", async () => {
  let seenSignal;
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    timeoutMs: 20,
    fetch: (_url, init) => {
      seenSignal = init && init.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "TIMEOUT");
  assert.equal(Boolean(seenSignal), true);
  assert.equal(seenSignal.aborted, true);
});

test("a late fetch rejection after timeout is not unhandled", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  let rejectFetch;
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    timeoutMs: 20,
    fetch: () =>
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
  });
  assert.equal(result.code, "TIMEOUT");
  rejectFetch(new Error("late network"));
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled.length, 0);
});
