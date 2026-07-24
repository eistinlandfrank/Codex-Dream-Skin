import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const template = await fs.readFile(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");

const payload = template
  .replace("__DREAM_CSS_JSON__", JSON.stringify(".toki-fixture { color: #45bddd; }"))
  .replace("__DREAM_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
  .replace("__DREAM_THEME_JSON__", JSON.stringify({
    id: "preset-toki-bunny-04",
    variant: "toki",
    appearance: "light",
    brandTitle: "Toki Codex",
    brandMark: "· 04",
    settingsLabel: "主题设置",
    settingsStatus: "外观",
    photoTitle: "TOKI · 04",
    photoCaption: "Be with Toki",
    palette: { accent: "#45bddd" },
    art: { focusX: 0.72, focusY: 0.45, safeArea: "left", taskMode: "ambient" },
  }));

function splitSelectorList(selector) {
  const parts = [];
  let start = 0;
  let squareDepth = 0;
  let roundDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "[") squareDepth += 1;
    else if (character === "]") squareDepth -= 1;
    else if (character === "(") roundDepth += 1;
    else if (character === ")") roundDepth -= 1;
    else if (character === "," && squareDepth === 0 && roundDepth === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

function splitDescendantSelector(selector) {
  const parts = [];
  let start = 0;
  let squareDepth = 0;
  let roundDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "[") squareDepth += 1;
    else if (character === "]") squareDepth -= 1;
    else if (character === "(") roundDepth += 1;
    else if (character === ")") roundDepth -= 1;
    else if (/\s/.test(character) && squareDepth === 0 && roundDepth === 0) {
      const part = selector.slice(start, index).trim();
      if (part) parts.push(part);
      while (index + 1 < selector.length && /\s/.test(selector[index + 1])) index += 1;
      start = index + 1;
    }
  }
  const tail = selector.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function createFixture({ nativeSuggestions = true, wrappedHomeContent = false } = {}) {
  const observers = [];
  const timeouts = new Map();
  const intervals = new Map();
  const revokedUrls = [];
  let nextTimerId = 1;
  let objectUrlCount = 0;

  const isWithin = (node, ancestor) => {
    for (let current = node; current; current = current.parentElement) {
      if (current === ancestor) return true;
    }
    return false;
  };

  const emitMutation = (record) => {
    for (const observer of observers) {
      if (!observer.target || (!isWithin(record.target, observer.target) && record.target !== observer.target)) continue;
      if (record.target !== observer.target && !observer.options.subtree) continue;
      if (record.type === "attributes") {
        if (!observer.options.attributes) continue;
        if (observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName)) continue;
      } else if (record.type === "childList" && !observer.options.childList) {
        continue;
      }
      observer.records.push(record);
    }
  };

  class ClassList {
    constructor(owner) {
      this.owner = owner;
      this.values = new Set();
    }

    add(...values) {
      let changed = false;
      for (const value of values) {
        if (!this.values.has(value)) {
          this.values.add(value);
          changed = true;
        }
      }
      if (changed) emitMutation({ type: "attributes", attributeName: "class", target: this.owner });
    }

    remove(...values) {
      let changed = false;
      for (const value of values) changed = this.values.delete(value) || changed;
      if (changed) emitMutation({ type: "attributes", attributeName: "class", target: this.owner });
    }

    toggle(value, enabled) {
      const shouldEnable = enabled === undefined ? !this.values.has(value) : Boolean(enabled);
      if (shouldEnable) this.add(value);
      else this.remove(value);
      return shouldEnable;
    }

    contains(value) {
      return this.values.has(value);
    }

    toString() {
      return [...this.values].join(" ");
    }
  }

  const matchesCompound = (node, rawSelector) => {
    let selector = rawSelector.replaceAll("\\/", "/");
    const hasIndex = selector.indexOf(":has(");
    if (hasIndex >= 0) {
      const base = selector.slice(0, hasIndex);
      const inner = selector.slice(hasIndex + 5, -1);
      return matchesCompound(node, base) && Boolean(node.querySelector(inner));
    }

    const tag = /^([a-z][\w-]*)/i.exec(selector)?.[1];
    if (tag && node.tagName !== tag.toUpperCase()) return false;

    for (const match of selector.matchAll(/#([\w-]+)/g)) {
      if (node.id !== match[1]) return false;
    }
    for (const match of selector.matchAll(/\.([\w/-]+)/g)) {
      if (!node.classList.contains(match[1])) return false;
    }
    for (const match of selector.matchAll(/\[([^\]=*]+)(?:([*]?=)"([^"]*)")?\]/g)) {
      const [, attribute, operator, expected] = match;
      if (!node.hasAttribute(attribute)) return false;
      if (operator === "=" && node.getAttribute(attribute) !== expected) return false;
      if (operator === "*=" && !node.getAttribute(attribute).includes(expected)) return false;
    }
    return true;
  };

  const matchesComplex = (node, selector) => {
    const parts = splitDescendantSelector(selector);
    if (!parts.length || !matchesCompound(node, parts.at(-1))) return false;
    let ancestor = node.parentElement;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchesCompound(ancestor, parts[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  };

  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.classList = new ClassList(this);
      this._textContent = "";
      this.style = {
        values: new Map(),
        setProperty: (name, value) => this.style.values.set(name, String(value)),
        removeProperty: (name) => this.style.values.delete(name),
        getPropertyValue: (name) => this.style.values.get(name) || "",
      };
      this.listeners = new Map();
      this.rect = { left: 0, top: 0, width: 100, height: 30, x: 0, y: 0 };
    }

    get id() {
      return this.getAttribute("id") || "";
    }

    set id(value) {
      this.setAttribute("id", value);
    }

    get className() {
      return this.classList.toString();
    }

    set className(value) {
      const next = new Set(String(value).split(/\s+/).filter(Boolean));
      const current = this.classList.values;
      if (next.size === current.size && [...next].every((item) => current.has(item))) return;
      this.classList.values = next;
      emitMutation({ type: "attributes", attributeName: "class", target: this });
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(value) {
      this._textContent = String(value);
    }

    setAttribute(name, value) {
      const text = String(value);
      if (this.attributes.get(name) === text) return;
      this.attributes.set(name, text);
      emitMutation({ type: "attributes", attributeName: name, target: this });
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    removeAttribute(name) {
      if (!this.attributes.delete(name)) return;
      emitMutation({ type: "attributes", attributeName: name, target: this });
    }

    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      this.children.push(child);
      emitMutation({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }

    append(...children) {
      for (const child of children) this.appendChild(child);
    }

    prepend(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      this.children.unshift(child);
      emitMutation({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
    }

    remove() {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parentElement = null;
      emitMutation({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
    }

    contains(candidate) {
      return isWithin(candidate, this);
    }

    matches(selector) {
      return splitSelectorList(selector).some((part) => matchesComplex(this, part));
    }

    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    }

    querySelectorAll(selector) {
      const result = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    getBoundingClientRect() {
      return this.rect;
    }
  }

  class HTMLElement extends Element {}

  class HTMLButtonElement extends HTMLElement {
    constructor() {
      super("button");
      this._disabled = false;
    }

    get disabled() {
      return this._disabled;
    }

    set disabled(value) {
      const next = Boolean(value);
      if (next === this._disabled) return;
      this._disabled = next;
      if (next) this.attributes.set("disabled", "");
      else this.attributes.delete("disabled");
      emitMutation({ type: "attributes", attributeName: "disabled", target: this });
    }
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.options = {};
      this.records = [];
      observers.push(this);
    }

    observe(target, options = {}) {
      this.target = target;
      this.options = options;
    }

    disconnect() {
      this.target = null;
      this.records = [];
    }

    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
  }

  class Document {
    constructor() {
      this.documentElement = new HTMLElement("html");
      this.head = new HTMLElement("head");
      this.body = new HTMLElement("body");
      this.visibilityState = "visible";
      this.documentElement.append(this.head, this.body);
    }

    createElement(tagName) {
      return tagName.toLowerCase() === "button" ? new HTMLButtonElement() : new HTMLElement(tagName);
    }

    createElementNS(_namespace, tagName) {
      return new HTMLElement(tagName);
    }

    querySelectorAll(selector) {
      const result = [];
      if (this.documentElement.matches(selector)) result.push(this.documentElement);
      return result.concat(this.documentElement.querySelectorAll(selector));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    getElementById(id) {
      return this.querySelector(`#${id}`);
    }
  }

  const document = new Document();
  const shellMain = document.createElement("main");
  shellMain.classList.add("main-surface");
  shellMain.rect = { left: 280, top: 36, width: 1000, height: 764, x: 280, y: 36 };
  const sidebar = document.createElement("aside");
  sidebar.classList.add("app-shell-left-panel");
  sidebar.rect = { left: 0, top: 36, width: 280, height: 764, x: 0, y: 36 };
  document.body.append(sidebar, shellMain);

  const brandButton = document.createElement("button");
  brandButton.setAttribute("aria-haspopup", "menu");
  brandButton.rect = { left: 8, top: 44, width: 250, height: 42, x: 8, y: 44 };
  const brandName = document.createElement("span");
  brandName.textContent = "Codex";
  const brandMark = document.createElement("span");
  brandMark.textContent = "Desktop";
  brandButton.append(brandName, brandMark);
  sidebar.appendChild(brandButton);

  const projectRow = document.createElement("div");
  projectRow.setAttribute("data-app-action-sidebar-project-row", "");
  const projectLogo = document.createElement("div");
  projectLogo.setAttribute("data-sidebar-project-drop-zone", "project-icon");
  projectRow.appendChild(projectLogo);
  sidebar.appendChild(projectRow);

  const footer = document.createElement("div");
  footer.className = "absolute inset-x-0 bottom-0 z-20";
  const profileButton = document.createElement("button");
  profileButton.setAttribute("aria-label", "Profile menu");
  footer.appendChild(profileButton);
  sidebar.appendChild(footer);

  const home = document.createElement("section");
  home.setAttribute("role", "main");
  const homeIcon = document.createElement("div");
  homeIcon.setAttribute("data-testid", "home-icon");
  const suggestions = document.createElement("div");
  suggestions.classList.add("group/home-suggestions");
  const cards = Array.from({ length: 4 }, (_, index) => {
    const card = document.createElement("button");
    card.setAttribute("aria-labelledby", `suggestion-${index + 1}`);
    card.disabled = true;
    suggestions.appendChild(card);
    return card;
  });
  const homeContent = wrappedHomeContent ? document.createElement("div") : home;
  homeContent.appendChild(homeIcon);
  if (nativeSuggestions) homeContent.appendChild(suggestions);
  const composerWrapper = document.createElement("div");
  composerWrapper.className = "mx-auto w-full max-w-(--thread-content-max-width)";
  const composer = document.createElement("div");
  composer.classList.add("composer-surface-chrome");
  const editor = document.createElement("div");
  editor.classList.add("ProseMirror");
  editor.setAttribute("contenteditable", "true");
  composer.appendChild(editor);
  composerWrapper.appendChild(composer);
  homeContent.appendChild(composerWrapper);
  if (wrappedHomeContent) {
    const banners = document.createElement("div");
    banners.classList.add("home-banners");
    home.append(banners, homeContent);
  }
  shellMain.appendChild(home);

  const context = {
    window: {
      matchMedia() { return { matches: false }; },
      postMessage() {},
    },
    document,
    Element,
    HTMLElement,
    HTMLButtonElement,
    MutationObserver,
    URL: {
      createObjectURL() {
        objectUrlCount += 1;
        return `blob:toki-fixture-${objectUrlCount}`;
      },
      revokeObjectURL(value) {
        revokedUrls.push(value);
      },
    },
    Blob,
    Uint8Array,
    atob,
    Event: class {
      constructor(type, options = {}) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    setTimeout(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    getComputedStyle() {
      return { colorScheme: "light" };
    },
  };

  const flushObservers = () => {
    let count = 0;
    for (const observer of observers) {
      if (!observer.target || !observer.records.length) continue;
      const records = observer.takeRecords();
      count += records.length;
      observer.callback(records);
    }
    return count;
  };

  const flushTimeouts = () => {
    const pending = [...timeouts.values()];
    timeouts.clear();
    for (const callback of pending) callback();
    return pending.length;
  };

  const settle = () => {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const mutations = flushObservers();
      const timers = flushTimeouts();
      if (!mutations && !timers) return;
    }
    throw new Error("Toki fixture did not settle");
  };

  return {
    context,
    document,
    root: document.documentElement,
    shellMain,
    sidebar,
    brandButton,
    brandName,
    brandMark,
    projectRow,
    projectLogo,
    footer,
    home,
    homeContent,
    homeIcon,
    suggestions,
    cards,
    composerWrapper,
    composer,
    editor,
    settle,
    flushObservers,
    revokedUrls,
  };
}

const fixture = createFixture();
const result = vm.runInNewContext(payload, fixture.context);
await Promise.resolve();
fixture.settle();

assert.equal(result.installed, true);
assert.equal(fixture.root.classList.contains("codex-dream-skin"), true);
assert.equal(fixture.root.classList.contains("dream-skin-toki"), true);
assert.equal(fixture.root.classList.contains("dream-toki-home"), true);
assert.equal(fixture.home.classList.contains("dream-home"), true);

assert.equal(fixture.brandName.textContent, "Toki Codex");
assert.equal(fixture.brandMark.textContent, "· 04");
assert.equal(fixture.brandButton.classList.contains("dream-toki-brand-button"), true);
assert.equal(fixture.projectRow.classList.contains("dream-toki-project-row"), true);
assert.equal(fixture.projectLogo.classList.contains("dream-toki-project-logo"), true);

assert.ok(fixture.document.getElementById("dream-toki-settings-row"));
assert.ok(fixture.document.getElementById("dream-toki-polaroid"));
assert.equal(fixture.document.getElementById("dream-toki-settings-row").parentElement, fixture.footer);
assert.equal(fixture.document.getElementById("dream-toki-polaroid").parentElement, fixture.shellMain);
assert.equal(fixture.composerWrapper.classList.contains("dream-toki-composer-wrap"), true);

fixture.cards.forEach((card, index) => {
  assert.equal(card.disabled, false, `card ${index + 1} should be enabled on first home paint`);
  assert.equal(card.classList.contains("dream-toki-card"), true);
  assert.equal(card.classList.contains(`dream-toki-card-${index + 1}`), true);
  assert.equal(card.dataset.dreamTokiForcedEnabled, "true");
});

fixture.cards[2].disabled = true;
fixture.flushObservers();
assert.equal(fixture.cards[2].disabled, false, "observer should immediately undo a later disabled mutation");
fixture.settle();

fixture.homeIcon.remove();
fixture.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
fixture.settle();
assert.equal(fixture.root.classList.contains("dream-toki-home"), false);
assert.equal(fixture.home.classList.contains("dream-home"), false);
assert.equal(fixture.home.classList.contains("dream-task"), true);
assert.equal(fixture.document.getElementById("dream-toki-polaroid"), null);
assert.equal(fixture.composerWrapper.classList.contains("dream-toki-composer-wrap"), false);
fixture.cards.forEach((card, index) => {
  assert.equal(card.disabled, true, `card ${index + 1} should regain its original disabled state off home`);
  assert.equal(card.classList.contains("dream-toki-card"), false);
  assert.equal(card.classList.contains(`dream-toki-card-${index + 1}`), false);
  assert.equal(card.dataset.dreamTokiForcedEnabled, undefined);
});

fixture.home.appendChild(fixture.homeIcon);
fixture.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(fixture.root.classList.contains("dream-toki-home"), true);
assert.ok(fixture.document.getElementById("dream-toki-polaroid"));
assert.equal(fixture.composerWrapper.classList.contains("dream-toki-composer-wrap"), true);
fixture.cards.forEach((card) => assert.equal(card.disabled, false));

const wrapped = createFixture({ wrappedHomeContent: true });
vm.runInNewContext(payload, wrapped.context);
await Promise.resolve();
wrapped.settle();
assert.equal(wrapped.home.classList.contains("dream-home"), true,
  "The home route must keep the route-level skin state.");
assert.equal(wrapped.homeContent.classList.contains("dream-home-content"), true,
  "The direct child containing both the home icon and composer must be marked as the layout content.");
assert.equal(wrapped.composerWrapper.classList.contains("dream-toki-composer-wrap"), true);
assert.equal(wrapped.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(wrapped.homeContent.classList.contains("dream-home-content"), false,
  "Cleanup must remove the compatibility marker.");

const state = fixture.context.window.__CODEX_DREAM_SKIN_STATE__;
assert.equal(state.cleanup(), true);
assert.equal(fixture.root.classList.contains("codex-dream-skin"), false);
assert.equal(fixture.root.classList.contains("dream-skin-toki"), false);
assert.equal(fixture.root.classList.contains("dream-toki-home"), false);
assert.equal(fixture.brandName.textContent, "Codex");
assert.equal(fixture.brandMark.textContent, "Desktop");
assert.equal(fixture.brandButton.classList.contains("dream-toki-brand-button"), false);
assert.equal(fixture.projectRow.classList.contains("dream-toki-project-row"), false);
assert.equal(fixture.projectLogo.classList.contains("dream-toki-project-logo"), false);
assert.equal(fixture.document.getElementById("dream-toki-settings-row"), null);
assert.equal(fixture.document.getElementById("dream-toki-polaroid"), null);
assert.equal(fixture.composerWrapper.classList.contains("dream-toki-composer-wrap"), false);
assert.equal(fixture.document.getElementById("codex-dream-skin-style"), null);
assert.equal(fixture.document.getElementById("codex-dream-skin-chrome"), null);
assert.equal(fixture.context.window.__CODEX_DREAM_SKIN_STATE__, undefined);
fixture.cards.forEach((card, index) => {
  assert.equal(card.disabled, true, `cleanup should restore card ${index + 1}`);
  assert.equal(card.classList.contains("dream-toki-card"), false);
  assert.equal(card.classList.contains(`dream-toki-card-${index + 1}`), false);
  assert.equal(card.dataset.dreamTokiForcedEnabled, undefined);
});
assert.deepEqual(fixture.revokedUrls, ["blob:toki-fixture-1"]);

const fallbackFixture = createFixture({ nativeSuggestions: false });
vm.runInNewContext(payload, fallbackFixture.context);
await Promise.resolve();
fallbackFixture.settle();
const fallbackGroup = fallbackFixture.document.getElementById("dream-toki-fallback-cards");
assert.ok(fallbackGroup, "Toki should render immediate cards when native suggestions are absent");
const fallbackCards = fallbackGroup.querySelectorAll("button");
assert.equal(fallbackCards.length, 4);
fallbackCards[0].listeners.get("click")();
assert.equal(
  fallbackFixture.editor.textContent,
  "请探索并理解当前项目，先概述结构、关键模块和运行方式。",
  "fallback card should seed the native composer without auto-submitting",
);
fallbackFixture.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup();
assert.equal(fallbackFixture.document.getElementById("dream-toki-fallback-cards"), null);

console.log("PASS: Toki renderer keeps native and immediate fallback home cards clickable and cleans up reversibly.");
