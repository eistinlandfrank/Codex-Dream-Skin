(() => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_ACTIVITY_OVERLAY__";
  const BADGE_ID = "codex-dream-skin-activity-fallback-badge";
  const PANEL_ID = "codex-dream-skin-activity-fallback-panel";
  const STYLE_ID = "codex-dream-skin-activity-fallback-style";
  const CHANNEL_NAME = "codex-dream-skin-activity-v1";

  const route = new URL(location.href);
  if (location.protocol !== "app:" || route.searchParams.get("initialRoute") !== "/avatar-overlay") {
    return { installed: false, reason: "not-avatar-overlay" };
  }

  const previous = window[STATE_KEY];
  if (typeof previous?.cleanup === "function") previous.cleanup();

  let count = 0;
  let titles = [];
  let lastSignalAt = 0;
  let scheduled = false;
  let observer = null;
  let timer = null;
  let channel = null;

  const isVisible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
  };

  const nativeActivityVisible = () => {
    const nativeBadge = document.querySelector('[data-testid="avatar-overlay-notification-badge"]');
    if (isVisible(nativeBadge)) return true;
    return [...document.querySelectorAll('[class*="_activityPillMaterial_"]')].some(isVisible);
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        position: absolute;
        z-index: 50;
        top: 0;
        right: 0;
        display: flex;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, .92);
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(69, 189, 221, .98), rgba(111, 125, 232, .98));
        color: #fff;
        box-shadow: 0 2px 8px rgba(30, 92, 143, .28);
        font: 700 12px/1 "Segoe UI Variable", "Segoe UI", sans-serif;
        text-align: center;
        cursor: pointer;
        pointer-events: auto;
        user-select: none;
      }
      #${BADGE_ID}:focus-visible {
        outline: 2px solid rgba(69, 189, 221, .72);
        outline-offset: 2px;
      }
      #${PANEL_ID} {
        position: fixed;
        z-index: 70;
        width: 230px;
        max-width: calc(100vw - 16px);
        padding: 10px;
        box-sizing: border-box;
        color: #173f67;
        border: 1px solid rgba(77, 177, 217, .38);
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(249, 253, 255, .98), rgba(226, 244, 255, .97));
        box-shadow: 0 10px 28px rgba(30, 92, 143, .24), inset 0 1px rgba(255, 255, 255, .85);
        font: 12px/1.4 "Segoe UI Variable", "Segoe UI", sans-serif;
        pointer-events: auto;
        user-select: none;
      }
      #${PANEL_ID} .dream-activity-panel-title {
        margin: 0 0 7px;
        color: #245b7f;
        font-weight: 750;
      }
      #${PANEL_ID} .dream-activity-panel-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      #${PANEL_ID} .dream-activity-panel-item {
        padding: 6px 8px;
        overflow: hidden;
        color: #315f80;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid rgba(77, 177, 217, .20);
        border-radius: 9px;
        background: rgba(255, 255, 255, .72);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const removePanel = () => {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(BADGE_ID)?.setAttribute("aria-expanded", "false");
  };

  const updatePanel = (badge) => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (typeof panel.replaceChildren === "function") panel.replaceChildren();
    else panel.textContent = "";

    const heading = document.createElement("div");
    heading.className = "dream-activity-panel-title";
    heading.textContent = `运行中的任务 (${count})`;
    panel.appendChild(heading);

    const list = document.createElement("div");
    list.className = "dream-activity-panel-list";
    list.setAttribute("role", "list");
    for (const title of titles.length ? titles : ["当前任务"]) {
      const item = document.createElement("div");
      item.className = "dream-activity-panel-item";
      item.setAttribute("role", "listitem");
      item.textContent = title;
      item.title = title;
      list.appendChild(item);
    }
    panel.appendChild(list);

    const badgeBox = badge.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const viewportWidth = Number(window.innerWidth) || 320;
    const viewportHeight = Number(window.innerHeight) || 420;
    const left = Math.min(Math.max(8, badgeBox.right - panelBox.width),
      Math.max(8, viewportWidth - panelBox.width - 8));
    const above = badgeBox.top - panelBox.height - 8;
    const top = above >= 8 ? above : Math.min(viewportHeight - panelBox.height - 8, badgeBox.bottom + 8);
    panel.style.left = `${Math.max(8, left)}px`;
    panel.style.top = `${Math.max(8, top)}px`;
  };

  const togglePanel = (badge, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (document.getElementById(PANEL_ID)) {
      removePanel();
      return;
    }
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "运行中的任务");
    (document.body || document.documentElement).appendChild(panel);
    badge.setAttribute("aria-expanded", "true");
    updatePanel(badge);
  };

  const removeBadge = () => {
    removePanel();
    document.getElementById(BADGE_ID)?.remove();
  };

  const ensure = () => {
    scheduled = false;
    const signalFresh = Date.now() - lastSignalAt <= 7000;
    if (!signalFresh || count <= 0) {
      removeBadge();
      return;
    }

    const mascot = document.querySelector('[data-testid="avatar-mascot-button"]');
    if (!(mascot instanceof Element)) {
      removeBadge();
      return;
    }

    ensureStyle();
    let badge = document.getElementById(BADGE_ID);
    if (!badge || badge.parentElement !== mascot) {
      badge?.remove();
      badge = document.createElement("span");
      badge.id = BADGE_ID;
      badge.setAttribute("role", "status");
      badge.setAttribute("aria-live", "polite");
      badge.setAttribute("data-testid", "dream-skin-activity-fallback-badge");
      badge.setAttribute("tabindex", "0");
      badge.setAttribute("aria-haspopup", "dialog");
      badge.setAttribute("aria-expanded", "false");
      badge.addEventListener?.("pointerdown", (event) => event.stopPropagation());
      badge.addEventListener?.("click", (event) => togglePanel(badge, event));
      badge.addEventListener?.("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        togglePanel(badge, event);
      });
      mascot.appendChild(badge);
    }
    const nextText = count > 99 ? "99+" : String(count);
    if (badge.textContent !== nextText) badge.textContent = nextText;
    const label = titles.length ? `${count} running task${count === 1 ? "" : "s"}: ${titles.join(", ")}`
      : `${count} running task${count === 1 ? "" : "s"}`;
    if (badge.getAttribute("aria-label") !== label) badge.setAttribute("aria-label", label);
    if (badge.title !== label) badge.title = label;
    updatePanel(badge);
  };

  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(ensure, 0);
  };

  const receive = (event) => {
    const data = event?.data;
    if (!data || data.type !== "running-tasks" || !Number.isFinite(Number(data.count))) return;
    count = Math.max(0, Math.trunc(Number(data.count)));
    titles = Array.isArray(data.titles)
      ? data.titles.filter((value) => typeof value === "string" && value.trim()).slice(0, 5)
      : [];
    lastSignalAt = Date.now();
    scheduleEnsure();
  };

  if (typeof BroadcastChannel === "function") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", receive);
  }

  observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(ensure, 1000);

  const cleanup = () => {
    observer?.disconnect();
    if (timer) clearInterval(timer);
    channel?.removeEventListener("message", receive);
    channel?.close();
    removeBadge();
    document.getElementById(STYLE_ID)?.remove();
    if (window[STATE_KEY]?.cleanup === cleanup) delete window[STATE_KEY];
    return true;
  };

  window[STATE_KEY] = { cleanup, ensure, receive, version: "1.1.0" };
  ensure();
  return { installed: true, version: "1.1.0" };
})()
