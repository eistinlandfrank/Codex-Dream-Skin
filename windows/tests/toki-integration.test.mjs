import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  avatarEarlyPayloadFor,
  isAvatarOverlayTarget,
  loadPayload,
} from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../assets");

test("avatar target detection stays scoped to the pet renderer", () => {
  assert.equal(isAvatarOverlayTarget({
    url: "app://-/index.html?initialRoute=%2Favatar-overlay",
  }), true);
  assert.equal(isAvatarOverlayTarget({ url: "app://-/index.html" }), false);
  assert.equal(isAvatarOverlayTarget({ url: "https://example.com/?initialRoute=/avatar-overlay" }), false);
});

test("avatar early payload waits for a document root and remains parseable", () => {
  const payload = "window.__TOKI_AVATAR_TEST__ = true";
  const wrapped = avatarEarlyPayloadFor(payload);
  assert.match(wrapped, /document\.documentElement/);
  assert.match(wrapped, /DOMContentLoaded/);
  assert.match(wrapped, /__TOKI_AVATAR_TEST__/);
  assert.doesNotThrow(() => new Function(wrapped));
});

test("Toki themes load the additive CSS and renderer extension", async () => {
  const themeDir = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-toki-payload-"));
  try {
    await fs.copyFile(path.join(assets, "dream-reference.jpg"), path.join(themeDir, "background.jpg"));
    await fs.writeFile(path.join(themeDir, "theme.json"), JSON.stringify({
      schemaVersion: 1,
      id: "preset-toki-test",
      name: "Toki test",
      image: "background.jpg",
      appearance: "light",
      art: { focusX: 0.72, focusY: 0.45, safeArea: "left", taskMode: "ambient" },
    }), "utf8");
    const loaded = await loadPayload(themeDir);
    assert.match(loaded.payload, /Toki preset for Dream Skin/);
    assert.match(loaded.payload, /__CODEX_DREAM_SKIN_TOKI__/);
    assert.doesNotThrow(() => new Function(loaded.payload));
  } finally {
    await fs.rm(themeDir, { recursive: true, force: true });
  }
});

test("the clickable task badge is not suppressed by the native badge", async () => {
  const source = await fs.readFile(path.join(assets, "avatar-overlay-inject.js"), "utf8");
  assert.match(source, /aria-haspopup", "dialog"/);
  assert.match(source, /if \(!signalFresh \|\| count <= 0\)/);
  assert.doesNotMatch(source, /if \(!signalFresh \|\| count <= 0 \|\| nativeActivityVisible\(\)\)/);
});

test("Toki resize path avoids full-tree relational matching and layout reads", async () => {
  const [css, enhancer] = await Promise.all([
    fs.readFile(path.join(assets, "toki-skin.css"), "utf8"),
    fs.readFile(path.join(assets, "toki-enhancements.js"), "utf8"),
  ]);
  const relationalSelectors = css.match(/:has\(/g) || [];
  assert.ok(relationalSelectors.length <= 4, `expected at most 4 :has() selectors, found ${relationalSelectors.length}`);
  assert.doesNotMatch(css, /div:first-child:not\(:has\(\.home-banners\)\)/);
  assert.doesNotMatch(enhancer, /getBoundingClientRect/);
  assert.doesNotMatch(enhancer, /attributeFilter/);
  assert.match(enhancer, /mutationTouchesSkin/);
  assert.match(enhancer, /ignoredMutations/);
  assert.match(enhancer, /contenteditable=\"true\".*role=\"textbox\"/);
  assert.match(enhancer, /findHomeComposer/);
});

test("Toki targets the stable Codex 26.924 shell and composer attributes", async () => {
  const [css, enhancer] = await Promise.all([
    fs.readFile(path.join(assets, "toki-skin.css"), "utf8"),
    fs.readFile(path.join(assets, "toki-enhancements.js"), "utf8"),
  ]);
  for (const selector of [
    "data-app-shell-main-surface",
    "app-shell-floating-left-panel",
    "home-composer-anchor",
    "data-thread-user-message-navigation-content",
    "data-composer-body",
    "data-codex-composer",
    "data-home-suggestion-id",
  ]) {
    assert.match(enhancer, new RegExp(selector));
  }
  assert.match(enhancer, /dream-toki-modern-layout/);
  assert.match(enhancer, /version: "1\.5\.18-toki\.1"/);
  assert.match(css, /--color-text-primary: var\(--dream-text\)/);
  assert.match(css, /\.dream-toki-composer/);
  assert.match(css, /\.dream-toki-transcript/);
  assert.match(css, /\.dream-toki-modern-card/);
});
