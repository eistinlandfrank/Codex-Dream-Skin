import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(
  path.resolve(here, "..", "assets", "avatar-overlay-inject.js"),
  "utf8",
);

function createFixture(route = "/avatar-overlay") {
  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.id = "";
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.textContent = "";
      this.title = "";
      this.visible = true;
    }
    appendChild(node) {
      node.parentElement = this;
      this.children.push(node);
      return node;
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
      this.parentElement = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() {
      return this.visible
        ? { x: 0, y: 0, width: 64, height: 64 }
        : { x: 0, y: 0, width: 0, height: 0 };
    }
  }

  const root = new FakeElement("html");
  const head = root.appendChild(new FakeElement("head"));
  const body = root.appendChild(new FakeElement("body"));
  const mascot = body.appendChild(new FakeElement("button"));
  mascot.setAttribute("data-testid", "avatar-mascot-button");
  const nativeBadge = body.appendChild(new FakeElement("span"));
  nativeBadge.setAttribute("data-testid", "avatar-overlay-notification-badge");

  const allNodes = () => {
    const result = [];
    const visit = (node) => {
      result.push(node);
      for (const child of node.children) visit(child);
    };
    visit(root);
    return result;
  };
  const byTestId = (value) => allNodes().find((node) => node.getAttribute("data-testid") === value) ?? null;
  const document = {
    documentElement: root,
    head,
    body,
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById(id) { return allNodes().find((node) => node.id === id) ?? null; },
    querySelector(selector) {
      const match = /^\[data-testid="([^"]+)"\]$/.exec(selector);
      return match ? byTestId(match[1]) : null;
    },
    querySelectorAll(selector) {
      if (selector === '[class*="_activityPillMaterial_"]') return [];
      return [];
    },
  };

  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      this.closed = false;
      channels.push(this);
    }
    addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
    emit(data) { for (const listener of this.listeners) listener({ data }); }
    close() { this.closed = true; }
  }

  const location = {
    href: `app://-/index.html?initialRoute=${encodeURIComponent(route)}`,
    protocol: "app:",
  };
  const context = {
    window: {},
    document,
    location,
    URL,
    Element: FakeElement,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    BroadcastChannel: FakeBroadcastChannel,
    getComputedStyle(node) {
      return node.visible
        ? { display: "block", visibility: "visible", opacity: "1" }
        : { display: "none", visibility: "hidden", opacity: "0" };
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout(callback) { callback(); return 1; },
  };
  return { context, channels, nativeBadge, mascot, document };
}

const nonOverlay = createFixture("/home");
const nonOverlayResult = vm.runInNewContext(source, nonOverlay.context);
assert.equal(nonOverlayResult.installed, false);
assert.equal(nonOverlay.channels.length, 0);

const fixture = createFixture();
const result = vm.runInNewContext(source, fixture.context);
assert.equal(result.installed, true);
assert.equal(fixture.channels[0].name, "codex-dream-skin-activity-v1");

fixture.channels[0].emit({ type: "running-tasks", count: 1, titles: ["Running fixture"] });
assert.equal(fixture.document.getElementById("codex-dream-skin-activity-fallback-badge"), null);

fixture.nativeBadge.visible = false;
fixture.context.window.__CODEX_DREAM_SKIN_ACTIVITY_OVERLAY__.ensure();
let fallbackBadge = fixture.document.getElementById("codex-dream-skin-activity-fallback-badge");
assert.ok(fallbackBadge);
assert.equal(fallbackBadge.parentElement, fixture.mascot);
assert.equal(fallbackBadge.textContent, "1");
assert.match(fallbackBadge.getAttribute("aria-label"), /Running fixture/);

fixture.channels[0].emit({ type: "running-tasks", count: 2, titles: ["One", "Two"] });
fallbackBadge = fixture.document.getElementById("codex-dream-skin-activity-fallback-badge");
assert.equal(fallbackBadge.textContent, "2");

fixture.channels[0].emit({ type: "running-tasks", count: 0, titles: [] });
assert.equal(fixture.document.getElementById("codex-dream-skin-activity-fallback-badge"), null);

const overlayState = fixture.context.window.__CODEX_DREAM_SKIN_ACTIVITY_OVERLAY__;
assert.equal(overlayState.cleanup(), true);
assert.equal(fixture.channels[0].closed, true);
assert.equal(fixture.document.getElementById("codex-dream-skin-activity-fallback-style"), null);
assert.equal(fixture.context.window.__CODEX_DREAM_SKIN_ACTIVITY_OVERLAY__, undefined);

console.log("PASS: avatar overlay preserves a running-task badge after the native activity pill expires.");
