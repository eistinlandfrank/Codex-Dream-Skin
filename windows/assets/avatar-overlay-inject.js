(() => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_ACTIVITY_OVERLAY__";
  const BADGE_ID = "codex-dream-skin-activity-fallback-badge";
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
        pointer-events: none;
        user-select: none;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const removeBadge = () => document.getElementById(BADGE_ID)?.remove();

  const ensure = () => {
    scheduled = false;
    const signalFresh = Date.now() - lastSignalAt <= 7000;
    if (!signalFresh || count <= 0 || nativeActivityVisible()) {
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
      mascot.appendChild(badge);
    }
    const nextText = count > 99 ? "99+" : String(count);
    if (badge.textContent !== nextText) badge.textContent = nextText;
    const label = titles.length ? `${count} running task${count === 1 ? "" : "s"}: ${titles.join(", ")}`
      : `${count} running task${count === 1 ? "" : "s"}`;
    if (badge.getAttribute("aria-label") !== label) badge.setAttribute("aria-label", label);
    if (badge.title !== label) badge.title = label;
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

  window[STATE_KEY] = { cleanup, ensure, receive, version: "1.0.0" };
  ensure();
  return { installed: true, version: "1.0.0" };
})()
