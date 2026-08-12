(() => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_TOKI__";
  const CORE_STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const ACTIVITY_CHANNEL = "codex-dream-skin-activity-v1";
  const ROOT_CLASSES = [
    "codex-dream-skin", "dream-skin-toki", "dream-theme-light",
    "dream-art-wide", "dream-focus-right", "dream-safe-left",
    "dream-task-ambient", "dream-toki-home",
  ];
  const OWNED_IDS = [
    "dream-toki-settings-row", "dream-toki-polaroid", "dream-toki-fallback-cards",
  ];
  const previous = window[STATE_KEY];
  if (typeof previous?.cleanup === "function") previous.cleanup();

  const core = window[CORE_STATE_KEY];
  const themeId = String(core?.themeId || "");
  if (!/^preset-toki(?:-|$)/i.test(themeId)) {
    return { installed: false, reason: "not-toki" };
  }

  let observer = null;
  let timer = null;
  let channel = null;
  let activityTimer = null;
  let scheduled = false;
  let scheduledTimer = null;
  let decorationsActive = false;
  const metrics = {
    ensureCalls: 0,
    mutationBatches: 0,
    relevantMutations: 0,
    ignoredMutations: 0,
  };
  const RELEVANT_SELECTOR = [
    "aside.app-shell-left-panel",
    '[role="main"]',
    '[data-testid="home-icon"]',
    ".composer-surface-chrome",
    '[contenteditable="true"][role="textbox"]',
    ".group\\/home-suggestions",
    "[data-home-ambient-suggestions]",
    "[data-app-action-sidebar-project-row]",
    "[data-settings-panel-slug]",
    'input[name="appearance-theme"]',
    '[data-testid="theme-preview"]',
  ].join(",");

  const setOriginalText = (node, text, className) => {
    if (!(node instanceof HTMLElement)) return;
    if (!node.hasAttribute("data-dream-toki-original-text")) {
      node.setAttribute("data-dream-toki-original-text", node.textContent || "");
    }
    if (node.textContent !== text) node.textContent = text;
    if (className) node.classList.add(className);
  };

  const removeDecorations = () => {
    if (!decorationsActive) return;
    const root = document.documentElement;
    root?.classList.remove(...ROOT_CLASSES);
    for (const name of ["--dream-art", "--dream-art-position", "--dream-accent", "--dream-accent-ink"]) {
      root?.style.removeProperty(name);
    }
    for (const id of OWNED_IDS) document.getElementById(id)?.remove();
    document.querySelectorAll("[data-dream-toki-original-text]").forEach((node) => {
      node.textContent = node.getAttribute("data-dream-toki-original-text") || "";
      node.removeAttribute("data-dream-toki-original-text");
      node.classList.remove("dream-toki-brand-name", "dream-toki-brand-mark");
    });
    document.querySelectorAll(".dream-home, .dream-has-utility, .dream-has-fallback-cards").forEach((node) =>
      node.classList.remove("dream-home", "dream-has-utility", "dream-has-fallback-cards"));
    document.querySelectorAll(".dream-home-content").forEach((node) => node.classList.remove("dream-home-content"));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll(".dream-toki-sidebar").forEach((node) => node.classList.remove("dream-toki-sidebar"));
    document.querySelectorAll(".dream-toki-brand-button").forEach((node) => node.classList.remove("dream-toki-brand-button"));
    document.querySelectorAll(".dream-toki-project-row").forEach((node) => {
      node.classList.remove("dream-toki-project-row");
      delete node.dataset.dreamTokiLogoIndex;
    });
    document.querySelectorAll(".dream-toki-project-logo").forEach((node) => node.classList.remove("dream-toki-project-logo"));
    document.querySelectorAll(".dream-toki-card").forEach((node) => {
      node.classList.remove("dream-toki-card", "dream-toki-card-1", "dream-toki-card-2", "dream-toki-card-3", "dream-toki-card-4");
      delete node.dataset.dreamTokiCardIndex;
    });
    document.querySelectorAll(".dream-toki-composer-wrap").forEach((node) => node.classList.remove("dream-toki-composer-wrap"));
    decorationsActive = false;
  };

  const seedPrompt = (home, prompt) => {
    const editor = home?.querySelector('.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]');
    if (!(editor instanceof HTMLElement)) return;
    editor.focus?.({ preventScroll: true });
    try {
      if (document.execCommand?.("insertText", false, prompt)) return;
    } catch {}
    editor.textContent = prompt;
    const event = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt })
      : new Event("input", { bubbles: true });
    editor.dispatchEvent(event);
  };

  const ensureFallbackCards = (home, nativeCount) => {
    const existing = document.getElementById("dream-toki-fallback-cards");
    if (!home || nativeCount > 0) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const templates = [
      ["探索并理解代码", "请探索并理解当前项目，概述结构、关键模块和运行方式。"],
      ["构建新功能或工具", "请根据我的目标构建一个新功能、应用或工具。"],
      ["审查代码", "请审查当前代码并提出具体、可执行的修改建议。"],
      ["修复问题", "请定位并修复当前项目中的问题，并验证结果。"],
    ];
    const group = document.createElement("div");
    group.id = "dream-toki-fallback-cards";
    group.className = "dream-toki-fallback-cards";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Toki 快速开始");
    templates.forEach(([label, prompt], index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `dream-toki-card dream-toki-card-${index + 1} dream-toki-fallback-card`;
      card.dataset.dreamTokiCardIndex = String(index + 1);
      card.addEventListener("click", () => seedPrompt(home, prompt));
      const iconRow = document.createElement("span");
      const icon = document.createElement("span");
      icon.textContent = ["⌘", "✦", "✓", "↻"][index];
      iconRow.appendChild(icon);
      const text = document.createElement("span");
      text.textContent = label;
      card.append(iconRow, text);
      group.appendChild(card);
    });
    home.appendChild(group);
  };

  const decorateSidebar = (sidebar) => {
    sidebar.classList.add("dream-toki-sidebar");
    const brand = sidebar.querySelector('.dream-toki-brand-button, button[aria-haspopup="menu"]');
    if (brand instanceof HTMLElement) {
      brand.classList.add("dream-toki-brand-button");
      const labels = brand.querySelectorAll("span");
      setOriginalText(labels[0], "Toki Codex", "dream-toki-brand-name");
      if (labels[1]) setOriginalText(labels[1], "· 04", "dream-toki-brand-mark");
    }
    Array.from(sidebar.querySelectorAll("[data-app-action-sidebar-project-row]")).forEach((row, index) => {
      row.classList.add("dream-toki-project-row");
      row.dataset.dreamTokiLogoIndex = String(index % 8);
      row.querySelector('[data-sidebar-project-drop-zone="project-icon"]')?.classList.add("dream-toki-project-logo");
    });
  };

  const ensurePolaroid = (shellMain, home) => {
    const existing = document.getElementById("dream-toki-polaroid");
    if (!home || !shellMain) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const figure = document.createElement("figure");
    figure.id = "dream-toki-polaroid";
    figure.className = "dream-toki-polaroid";
    figure.setAttribute("aria-hidden", "true");
    const photo = document.createElement("div");
    photo.className = "dream-toki-polaroid-photo";
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.src = core?.artUrl || "";
    photo.appendChild(image);
    const caption = document.createElement("figcaption");
    const title = document.createElement("strong");
    title.textContent = "TOKI · 04";
    const note = document.createElement("span");
    note.textContent = "Be with Toki";
    caption.append(title, note);
    figure.append(photo, caption);
    shellMain.appendChild(figure);
  };

  const findHomeComposer = (home) => home?.querySelector(
    '.composer-surface-chrome, [contenteditable="true"][role="textbox"]',
  ) || null;

  const ensure = () => {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    scheduled = false;
    metrics.ensureCalls += 1;
    const currentCore = window[CORE_STATE_KEY];
    if (!currentCore || !/^preset-toki(?:-|$)/i.test(String(currentCore.themeId || "")) ||
        window.__CODEX_DREAM_SKIN_DISABLED__) {
      removeDecorations();
      return;
    }
    const settings = document.querySelector('[data-settings-panel-slug], input[name="appearance-theme"], [data-testid="theme-preview"]');
    if (settings) {
      removeDecorations();
      return;
    }
    const root = document.documentElement;
    const home = document.querySelector('[data-testid="home-icon"]')?.closest('[role="main"]') || null;
    const sidebar = document.querySelector("aside.app-shell-left-panel");
    const shellMain = document.querySelector('main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])') || home?.closest("main");
    if (!root || !sidebar || !shellMain) return;
    root.classList.add(...ROOT_CLASSES.slice(0, -1));
    root.classList.toggle("dream-toki-home", Boolean(home));
    root.style.setProperty("--dream-art", "var(--dream-skin-art)");
    root.style.setProperty("--dream-art-position", "var(--dream-skin-art-position, 72% 45%)");
    root.style.setProperty("--dream-accent", "#45bddd");
    root.style.setProperty("--dream-accent-ink", "#ffffff");
    decorationsActive = true;
    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    document.querySelectorAll('[role="main"]').forEach((node) => {
      node.classList.toggle("dream-home", node === home);
      node.classList.toggle("dream-task", node !== home);
    });
    const composer = findHomeComposer(home);
    const homeContent = home ? Array.from(home.children).find((candidate) =>
      candidate.querySelector?.('[data-testid="home-icon"]') && findHomeComposer(candidate)) : null;
    homeContent?.classList.add("dream-home-content");
    home?.classList.toggle("dream-has-utility", Boolean(home.querySelector(".dream-home-utility")));
    decorateSidebar(sidebar);
    const cards = home ? Array.from(new Set(home.querySelectorAll('.group\\/home-suggestions button, [data-home-ambient-suggestions] button'))).slice(0, 4) : [];
    cards.forEach((card, index) => {
      card.classList.add("dream-toki-card", `dream-toki-card-${index + 1}`);
      card.dataset.dreamTokiCardIndex = String(index + 1);
    });
    ensureFallbackCards(home, cards.length);
    home?.classList.toggle("dream-has-fallback-cards", Boolean(document.getElementById("dream-toki-fallback-cards")));
    let wrapper = composer?.parentElement;
    while (wrapper && wrapper !== home) {
      if (String(wrapper.className).includes("max-w-(--thread-content-max-width)")) {
        wrapper.classList.add("dream-toki-composer-wrap");
        break;
      }
      wrapper = wrapper.parentElement;
    }
    ensurePolaroid(shellMain, home);
  };

  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      ensure();
    }, 60);
  };

  const mutationTouchesSkin = (record) => {
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches(RELEVANT_SELECTOR) || node.querySelector(RELEVANT_SELECTOR)) return true;
    }
    return false;
  };

  const collectRunningTasks = () => {
    const rows = new Set();
    for (const spinner of document.querySelectorAll("aside.app-shell-left-panel .animate-spin")) {
      const row = spinner.closest?.('[role="listitem"]');
      if (row) rows.add(row);
    }
    const titles = [...rows].map((row) => (row.innerText || row.textContent || "")
      .split(/\r?\n/).map((part) => part.trim()).find(Boolean)).filter(Boolean).slice(0, 99);
    if (!titles.length) {
      const stopButton = Array.from(document.querySelectorAll('button[aria-label]')).find((button) =>
        /^(stop|停止)$/i.test((button.getAttribute("aria-label") || "").trim()));
      if (stopButton) titles.push(document.title?.trim() || "当前任务");
    }
    return { type: "running-tasks", count: titles.length, titles, sentAt: Date.now() };
  };

  const publishActivity = () => {
    try { channel?.postMessage(collectRunningTasks()); } catch {}
  };

  const cleanup = () => {
    observer?.disconnect();
    if (scheduledTimer) clearTimeout(scheduledTimer);
    if (timer) clearInterval(timer);
    if (activityTimer) clearInterval(activityTimer);
    channel?.close?.();
    removeDecorations();
    if (window[STATE_KEY]?.cleanup === cleanup) delete window[STATE_KEY];
    return true;
  };

  if (typeof BroadcastChannel === "function") {
    channel = new BroadcastChannel(ACTIVITY_CHANNEL);
    activityTimer = setInterval(publishActivity, 2000);
  }
  observer = new MutationObserver((records) => {
    metrics.mutationBatches += 1;
    if (records.some(mutationTouchesSkin)) {
      metrics.relevantMutations += 1;
      scheduleEnsure();
    } else {
      metrics.ignoredMutations += 1;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(() => { if (document.visibilityState === "visible") ensure(); }, 30000);
  window[STATE_KEY] = { cleanup, ensure, collectRunningTasks, publishActivity, metrics, version: "1.5.11-toki.3" };
  ensure();
  publishActivity();
  return { installed: true, version: "1.5.11-toki.3" };
})()
