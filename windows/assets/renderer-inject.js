((cssText, artDataUrl, rawConfig) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const ACTIVITY_CHANNEL = "codex-dream-skin-activity-v1";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const ROOT_CLASSES = [
    "codex-dream-skin",
    "dream-theme-light",
    "dream-theme-dark",
    "dream-art-wide",
    "dream-art-standard",
    "dream-focus-left",
    "dream-focus-center",
    "dream-focus-right",
    "dream-safe-left",
    "dream-safe-center",
    "dream-safe-right",
    "dream-safe-none",
    "dream-task-ambient",
    "dream-task-banner",
    "dream-task-off",
    "dream-skin-toki",
    "dream-toki-home",
  ];
  const ROOT_PROPERTIES = [
    "--dream-art",
    "--dream-art-position",
    "--dream-focus-x",
    "--dream-focus-y",
    "--dream-accent",
    "--dream-accent-ink",
    "--dream-image-luma",
  ];
  const HOME_CONTENT_CLASS = "dream-home-content";
  const HOME_UTILITY_CLASS = "dream-home-utility";
  const TOKI_CARD_CLASS = "dream-toki-card";
  const TOKI_COMPOSER_WRAP_CLASS = "dream-toki-composer-wrap";
  const TOKI_FALLBACK_CARDS_ID = "dream-toki-fallback-cards";
  const TOKI_SETTINGS_ROW_ID = "dream-toki-settings-row";
  const TOKI_POLAROID_ID = "dream-toki-polaroid";
  const TOKI_ORIGINAL_TEXT = "data-dream-toki-original-text";
  const TOKI_RELEVANT_SELECTOR = [
    "main.main-surface",
    "aside.app-shell-left-panel",
    '[role="main"]',
    '[data-testid="home-icon"]',
    ".composer-surface-chrome",
    ".group\\/home-suggestions",
    "[data-home-ambient-suggestions]",
    `#${TOKI_FALLBACK_CARDS_ID}`,
    "[data-app-action-sidebar-project-row]",
    'button[aria-haspopup="menu"]',
    '[class*="bottom-0"]',
  ].join(",");
  const installToken = {};
  let samplingNativeShell = false;
  let observer = null;
  let activityChannel = null;
  let activityTimer = null;
  let lastProfileSignature = "";
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
  const luminance = (red, green, blue) => {
    const linear = [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const defaultProfile = {
    appearance: "dark",
    accent: [108, 131, 142],
    focusX: .5,
    focusY: .5,
    aspect: 1.6,
    luma: .32,
    safeArea: "center",
  };

  const normalizeConfig = (value) => {
    const config = value && typeof value === "object" ? value : {};
    const art = config.art && typeof config.art === "object" ? config.art : {};
    const hasNumber = (candidate) =>
      (typeof candidate === "number" || (typeof candidate === "string" && candidate.trim() !== "")) &&
      Number.isFinite(Number(candidate));
    const requestedAccent = typeof config?.palette?.accent === "string"
      ? config.palette.accent.trim()
      : "";
    const safeAccent = /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(requestedAccent)
      ? requestedAccent
      : null;
    const appearance = ["auto", "light", "dark"].includes(config.appearance)
      ? config.appearance
      : "auto";
    const safeArea = ["auto", "left", "right", "center", "none"].includes(art.safeArea)
      ? art.safeArea
      : "auto";
    const taskMode = ["auto", "ambient", "banner", "off"].includes(art.taskMode)
      ? art.taskMode
      : "auto";
    const cleanLabel = (candidate, fallback, limit = 80) => {
      if (typeof candidate !== "string") return fallback;
      const cleaned = candidate.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      return cleaned ? cleaned.slice(0, limit) : fallback;
    };
    const themeId = cleanLabel(config.id, "", 96);
    const variant = config.variant === "toki" || /^preset-toki(?:-|$)/i.test(themeId)
      ? "toki"
      : "default";
    const metadataRatio = Number(config?.artMetadata?.ratio);
    return {
      themeId,
      variant,
      appearance,
      safeArea,
      taskMode,
      focusX: hasNumber(art.focusX) ? clamp(art.focusX) : null,
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      accent: safeAccent,
      initialAspect: Number.isFinite(metadataRatio) && metadataRatio > 0 ? metadataRatio : null,
      labels: {
        brandTitle: cleanLabel(config.brandTitle, "Toki Codex", 40),
        brandMark: cleanLabel(config.brandMark, "· 04", 16),
        settingsLabel: cleanLabel(config.settingsLabel, "主题设置", 32),
        settingsStatus: cleanLabel(config.settingsStatus, "外观", 20),
        photoTitle: cleanLabel(config.photoTitle, "TOKI · 04", 40),
        photoCaption: cleanLabel(config.photoCaption, "Be with Toki", 60),
      },
    };
  };

  const previous = window[STATE_KEY];
  if (typeof previous?.cleanup === "function") {
    previous.cleanup();
  } else {
    if (previous?.observer) previous.observer.disconnect();
    if (previous?.timer) clearInterval(previous.timer);
    if (previous?.activityTimer) clearInterval(previous.activityTimer);
    previous?.activityChannel?.close?.();
    if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
    if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  }
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;
  const artUrl = (() => {
    const comma = artDataUrl.indexOf(",");
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = /^data:([^;,]+)/.exec(artDataUrl)?.[1] || "image/png";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  })();
  const config = normalizeConfig(rawConfig);
  let profile = {
    ...defaultProfile,
    aspect: config.initialAspect ?? defaultProfile.aspect,
  };
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamVersion = "3";
  }

  const analyzeArt = () => new Promise((resolve) => {
    if (typeof Image !== "function") {
      resolve(defaultProfile);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const width = 48;
        const height = Math.max(12, Math.round(width * image.naturalHeight / image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const samples = [];
        const sampleMap = new Array(width * height);
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = (.2126 * red + .7152 * green + .0722 * blue) / 255;
          const sample = { red, green, blue, light, index: offset / 4 };
          samples.push(sample);
          sampleMap[sample.index] = sample;
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += light;
          count += 1;
        }
        if (!count) throw new Error("Image contains no opaque pixels");
        const average = [totalRed / count, totalGreen / count, totalBlue / count];
        const averageBrightness = totalBrightness / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let sampleCount = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = sampleMap[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              sampleCount += 1;
              const previousSample = x > start ? sampleMap[y * width + x - 1] : null;
              const above = y > 0 ? sampleMap[(y - 1) * width + x] : null;
              if (previousSample) { edges += Math.abs(sample.light - previousSample.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = sampleCount ? total / sampleCount : 0;
          const variance = sampleCount ? Math.max(0, totalSquared / sampleCount - mean * mean) : 1;
          return Math.sqrt(variance) * .58 + (edgeCount ? edges / edgeCount : 1) * .42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * .38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * .86) safeArea = "left";
        else if (rightInformation < leftInformation * .86) safeArea = "right";
        let focusWeight = 0;
        let focusX = 0;
        let focusY = 0;
        let accentWeight = 0;
        let accent = [0, 0, 0];
        for (const sample of samples) {
          const x = sample.index % width;
          const y = Math.floor(sample.index / width);
          const difference = Math.sqrt(
            (sample.red - average[0]) ** 2 +
            (sample.green - average[1]) ** 2 +
            (sample.blue - average[2]) ** 2,
          ) / 441.7;
          const saliency = .03 + difference ** 1.35;
          focusX += (x / Math.max(1, width - 1)) * saliency;
          focusY += (y / Math.max(1, height - 1)) * saliency;
          focusWeight += saliency;
          const max = Math.max(sample.red, sample.green, sample.blue);
          const min = Math.min(sample.red, sample.green, sample.blue);
          const saturation = max ? (max - min) / max : 0;
          const usableLight = 1 - Math.min(1, Math.abs(sample.light - .46) / .54);
          const weight = saturation ** 2 * (.15 + usableLight);
          accent[0] += sample.red * weight;
          accent[1] += sample.green * weight;
          accent[2] += sample.blue * weight;
          accentWeight += weight;
        }
        const resolvedAccent = accentWeight > 1
          ? accent.map((channel) => Math.round(channel / accentWeight))
          : average.map((channel) => Math.round(channel));
        let resolvedFocusX = clamp(focusX / focusWeight);
        if (safeArea === "left") resolvedFocusX = Math.max(.64, resolvedFocusX);
        if (safeArea === "right") resolvedFocusX = Math.min(.36, resolvedFocusX);
        resolve({
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
          focusX: resolvedFocusX,
          focusY: clamp(focusY / focusWeight),
          aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
          luma: clamp(averageBrightness),
          safeArea,
        });
      } catch {
        resolve(defaultProfile);
      }
    };
    image.onerror = () => resolve(defaultProfile);
    image.src = artUrl;
  });

  const detectShellAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    const classes = `${root?.className || ""} ${body?.className || ""}`
      .toLowerCase()
      .replace(/\bdream-theme-(?:dark|light)\b/g, "");
    if (/\b(dark|electron-dark|theme-dark|appearance-dark)\b/.test(classes)) return "dark";
    if (/\b(light|electron-light|theme-light|appearance-light)\b/.test(classes)) return "light";

    const dataTheme = (
      root?.getAttribute?.("data-theme") ||
      root?.getAttribute?.("data-appearance") ||
      root?.getAttribute?.("data-color-mode") ||
      body?.getAttribute?.("data-theme") ||
      body?.getAttribute?.("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const hadSkin = root?.classList?.contains?.("codex-dream-skin");
      const savedSkinClasses = hadSkin
        ? ROOT_CLASSES.filter((className) => root.classList.contains(className))
        : [];
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove(...ROOT_CLASSES);
      try {
        const colorScheme = getComputedStyle(root).colorScheme || "";
        if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
        if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
      } finally {
        if (hadSkin) root.classList.add(...savedSkinClasses);
        observer?.takeRecords?.();
        samplingNativeShell = false;
      }
    } catch {
      samplingNativeShell = false;
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
    return "light";
  };

  const setTokiText = (node, value, className) => {
    if (!(node instanceof HTMLElement)) return;
    if (!node.hasAttribute(TOKI_ORIGINAL_TEXT)) {
      node.setAttribute(TOKI_ORIGINAL_TEXT, node.textContent || "");
    }
    if (node.textContent !== value) node.textContent = value;
    if (className) node.classList.add(className);
  };

  const createTokiSettingsIcon = () => {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("dream-toki-settings-icon");
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    icon.appendChild(path);
    return icon;
  };

  const ensureTokiSettingsRow = (sidebar) => {
    const existing = document.getElementById(TOKI_SETTINGS_ROW_ID);
    if (existing instanceof HTMLElement) return;
    const profileButton = Array.from(sidebar.querySelectorAll("button")).find((button) =>
      /(?:个人资料|profile).*(?:菜单|menu)/i.test(button.getAttribute("aria-label") || "")
    );
    const footer = profileButton?.closest(".absolute.inset-x-0.bottom-0.z-20") ||
      Array.from(sidebar.querySelectorAll("div")).find((node) => {
        const className = typeof node.className === "string" ? node.className : "";
        return className.includes("absolute") && className.includes("bottom-0") &&
          className.includes("inset-x-0");
      });
    if (!(footer instanceof HTMLElement)) return;

    const row = document.createElement("div");
    row.id = TOKI_SETTINGS_ROW_ID;
    row.className = "dream-toki-settings-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dream-toki-settings-button";
    button.setAttribute("aria-label", "打开 Toki 外观设置");
    button.title = "打开外观设置";
    button.addEventListener("click", () => {
      window.postMessage({ type: "navigate-to-route", path: "/settings/appearance" }, "*");
    });
    button.append(createTokiSettingsIcon());
    const label = document.createElement("span");
    label.className = "dream-toki-settings-label";
    label.textContent = config.labels.settingsLabel;
    const status = document.createElement("span");
    status.className = "dream-toki-settings-status";
    status.textContent = config.labels.settingsStatus;
    status.setAttribute("aria-hidden", "true");
    button.append(label, status);
    row.appendChild(button);
    footer.prepend(row);
  };

  const decorateTokiSidebar = (sidebar) => {
    sidebar.classList.add("dream-toki-sidebar");
    const sidebarRect = sidebar.getBoundingClientRect();
    const brandButton = sidebar.querySelector(".dream-toki-brand-button") ||
      Array.from(sidebar.querySelectorAll('button[aria-haspopup="menu"]')).find((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= sidebarRect.top && rect.top < sidebarRect.top + 96;
      });
    if (brandButton instanceof HTMLElement) {
      brandButton.classList.add("dream-toki-brand-button");
      const labels = brandButton.querySelectorAll("span");
      setTokiText(labels[0], config.labels.brandTitle, "dream-toki-brand-name");
      setTokiText(labels[1], config.labels.brandMark, "dream-toki-brand-mark");
    }

    Array.from(sidebar.querySelectorAll("[data-app-action-sidebar-project-row]")).forEach((row, index) => {
      row.classList.add("dream-toki-project-row");
      row.dataset.dreamTokiLogoIndex = String(index % 8);
      row.querySelector('[data-sidebar-project-drop-zone="project-icon"]')
        ?.classList.add("dream-toki-project-logo");
    });
    ensureTokiSettingsRow(sidebar);
  };

  const decorateTokiCards = (home) => {
    const selectors = [
      '.group\\/home-suggestions button',
      '[data-home-ambient-suggestions] button',
    ].join(",");
    const candidates = home ? Array.from(home.querySelectorAll(selectors)) : [];
    const liveCards = Array.from(new Set(candidates)).slice(0, 4);
    document.querySelectorAll(`.${TOKI_CARD_CLASS}`).forEach((card) => {
      if (card.closest?.(`#${TOKI_FALLBACK_CARDS_ID}`)) return;
      if (liveCards.includes(card)) return;
      card.classList.remove(TOKI_CARD_CLASS);
      for (let index = 1; index <= 4; index += 1) {
        card.classList.remove(`${TOKI_CARD_CLASS}-${index}`);
      }
      delete card.dataset.dreamTokiCardIndex;
      if (card.dataset.dreamTokiForcedEnabled === "true" && card instanceof HTMLButtonElement) {
        card.disabled = true;
      }
      delete card.dataset.dreamTokiForcedEnabled;
    });
    liveCards.forEach((card, index) => {
      const cardIndex = String(index + 1);
      card.classList.add(TOKI_CARD_CLASS, `${TOKI_CARD_CLASS}-${cardIndex}`);
      card.dataset.dreamTokiCardIndex = cardIndex;
      if (card instanceof HTMLButtonElement && card.disabled) {
        card.dataset.dreamTokiForcedEnabled = "true";
        card.disabled = false;
      }
    });
    return liveCards.length;
  };

  const seedTokiPrompt = (home, prompt) => {
    const editor = home?.querySelector('.ProseMirror[contenteditable="true"]');
    if (!(editor instanceof HTMLElement)) return;
    editor.focus?.({ preventScroll: true });
    try {
      const selection = window.getSelection?.();
      const range = document.createRange?.();
      if (selection && range) {
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (document.execCommand?.("insertText", false, prompt)) return;
    } catch {}
    editor.textContent = prompt;
    const event = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt })
      : new Event("input", { bubbles: true });
    editor.dispatchEvent?.(event);
  };

  const ensureTokiFallbackCards = (home, nativeCardCount) => {
    const existing = document.getElementById(TOKI_FALLBACK_CARDS_ID);
    if (!home || nativeCardCount > 0) {
      existing?.remove();
      return;
    }
    if (existing instanceof HTMLElement) {
      if (existing.parentElement !== home) home.appendChild(existing);
      return;
    }

    const templates = [
      ["探索并理解代码", "请探索并理解当前项目，先概述结构、关键模块和运行方式。"],
      ["构建新功能、应用或工具", "请根据我的目标构建一个新功能、应用或工具。"],
      ["审查代码并提出修改建议", "请审查当前代码并提出具体、可执行的修改建议。"],
      ["修复问题和失败", "请定位并修复当前项目中的问题或失败，并验证结果。"],
    ];
    const sidebarButtons = Array.from(
      document.querySelectorAll("aside.app-shell-left-panel button")
    );
    const allIcons = sidebarButtons.map((button) => button.querySelector("svg"))
      .filter((icon) => typeof icon?.cloneNode === "function");
    const iconPatterns = [
      /新建任务|new task/i,
      /插件|plugin|技能|skill/i,
      /拉取请求|pull request|review|审查/i,
      /聊天|chat|help|修复/i,
    ];
    const iconSources = iconPatterns.map((pattern, index) => {
      const matched = sidebarButtons.find((button) => pattern.test(
        `${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`
      ))?.querySelector("svg");
      return typeof matched?.cloneNode === "function"
        ? matched
        : allIcons[(index + 2) % Math.max(allIcons.length, 1)];
    });
    const group = document.createElement("div");
    group.id = TOKI_FALLBACK_CARDS_ID;
    group.className = "dream-toki-fallback-cards";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Toki 快速开始");
    templates.forEach(([labelText, prompt], index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `${TOKI_CARD_CLASS} ${TOKI_CARD_CLASS}-${index + 1} dream-toki-fallback-card`;
      card.dataset.dreamTokiCardIndex = String(index + 1);
      card.setAttribute("aria-label", labelText);
      card.addEventListener("click", () => seedTokiPrompt(home, prompt));
      const iconRow = document.createElement("span");
      const iconFrame = document.createElement("span");
      iconFrame.setAttribute("aria-hidden", "true");
      const icon = iconSources[index % Math.max(iconSources.length, 1)]?.cloneNode(true);
      if (icon) iconFrame.appendChild(icon);
      iconRow.appendChild(iconFrame);
      const label = document.createElement("span");
      label.textContent = labelText;
      card.append(iconRow, label);
      group.appendChild(card);
    });
    home.appendChild(group);
  };

  const decorateTokiComposer = (home) => {
    let liveWrapper = null;
    const composer = home?.querySelector(".composer-surface-chrome");
    if (composer instanceof HTMLElement) {
      let wrapper = composer.parentElement;
      while (wrapper && wrapper !== home) {
        const className = typeof wrapper.className === "string" ? wrapper.className : "";
        if (className.includes("max-w-(--thread-content-max-width)")) {
          liveWrapper = wrapper;
          break;
        }
        wrapper = wrapper.parentElement;
      }
    }

    document.querySelectorAll(`.${TOKI_COMPOSER_WRAP_CLASS}`).forEach((node) => {
      if (node !== liveWrapper) node.classList.remove(TOKI_COMPOSER_WRAP_CLASS);
    });
    liveWrapper?.classList.add(TOKI_COMPOSER_WRAP_CLASS);
  };

  const ensureTokiPolaroid = (shellMain, home) => {
    const existing = document.getElementById(TOKI_POLAROID_ID);
    if (!home) {
      existing?.remove();
      return;
    }
    if (existing instanceof HTMLElement) {
      if (existing.parentElement !== shellMain) shellMain.appendChild(existing);
      return;
    }
    const figure = document.createElement("figure");
    figure.id = TOKI_POLAROID_ID;
    figure.className = "dream-toki-polaroid";
    figure.setAttribute("aria-hidden", "true");
    const photo = document.createElement("div");
    photo.className = "dream-toki-polaroid-photo";
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.src = artUrl;
    photo.appendChild(image);
    const caption = document.createElement("figcaption");
    const title = document.createElement("strong");
    title.textContent = config.labels.photoTitle;
    const note = document.createElement("span");
    note.textContent = config.labels.photoCaption;
    caption.append(title, note);
    figure.append(photo, caption);
    shellMain.appendChild(figure);
  };

  const clearTokiDom = () => {
    document.getElementById(TOKI_SETTINGS_ROW_ID)?.remove();
    document.getElementById(TOKI_POLAROID_ID)?.remove();
    document.getElementById(TOKI_FALLBACK_CARDS_ID)?.remove();
    document.querySelectorAll(`[${TOKI_ORIGINAL_TEXT}]`).forEach((node) => {
      node.textContent = node.getAttribute(TOKI_ORIGINAL_TEXT) || "";
      node.removeAttribute(TOKI_ORIGINAL_TEXT);
      node.classList.remove("dream-toki-brand-name", "dream-toki-brand-mark");
    });
    document.querySelectorAll(".dream-toki-brand-button").forEach((node) =>
      node.classList.remove("dream-toki-brand-button"));
    document.querySelectorAll(".dream-toki-sidebar").forEach((node) =>
      node.classList.remove("dream-toki-sidebar"));
    document.querySelectorAll(".dream-toki-project-row").forEach((node) => {
      node.classList.remove("dream-toki-project-row");
      delete node.dataset.dreamTokiLogoIndex;
    });
    document.querySelectorAll(".dream-toki-project-logo").forEach((node) =>
      node.classList.remove("dream-toki-project-logo"));
    document.querySelectorAll(`.${TOKI_CARD_CLASS}`).forEach((card) => {
      card.classList.remove(TOKI_CARD_CLASS);
      for (let index = 1; index <= 4; index += 1) {
        card.classList.remove(`${TOKI_CARD_CLASS}-${index}`);
      }
      delete card.dataset.dreamTokiCardIndex;
      if (card.dataset.dreamTokiForcedEnabled === "true" && card instanceof HTMLButtonElement) {
        card.disabled = true;
      }
      delete card.dataset.dreamTokiForcedEnabled;
    });
    document.querySelectorAll(`.${TOKI_COMPOSER_WRAP_CLASS}`).forEach((node) =>
      node.classList.remove(TOKI_COMPOSER_WRAP_CLASS));
  };

  const ensureTokiDom = (root, shellMain, sidebar, home) => {
    const enabled = config.variant === "toki";
    root.classList.toggle("dream-skin-toki", enabled);
    root.classList.toggle("dream-toki-home", enabled && Boolean(home));
    if (!enabled) {
      clearTokiDom();
      return;
    }
    decorateTokiSidebar(sidebar);
    const nativeCardCount = decorateTokiCards(home);
    ensureTokiFallbackCards(home, nativeCardCount);
    decorateTokiComposer(home);
    ensureTokiPolaroid(shellMain, home);
  };

  const clearSkinDom = () => {
    const root = document.documentElement;
    clearTokiDom();
    lastProfileSignature = "";
    root?.classList.remove(...ROOT_CLASSES);
    for (const property of ROOT_PROPERTIES) root?.style.removeProperty(property);
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(`.${HOME_CONTENT_CLASS}`).forEach((node) => node.classList.remove(HOME_CONTENT_CLASS));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll(`.${HOME_UTILITY_CLASS}`).forEach((node) => node.classList.remove(HOME_UTILITY_CLASS));
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
  };

  const applyProfile = (root) => {
    const focusX = config.focusX ?? profile.focusX;
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
    const focus = focusX < .4 ? "left" : focusX > .6 ? "right" : "center";
    const safeArea = config.safeArea === "auto" ? (profile.safeArea ||
      (focus === "left" ? "right" : focus === "right" ? "left" : "center")) : config.safeArea;
    const taskMode = config.taskMode === "auto"
      ? profile.aspect >= 2.25 ? "banner" : "ambient"
      : config.taskMode;
    const accent = config.accent || `rgb(${profile.accent.join(" ")})`;
    const accentInk = luminance(...profile.accent) > .42 ? "rgb(26 24 28)" : "rgb(250 248 251)";
    const signature = [appearance, focus, safeArea, taskMode, profile.aspect >= 1.75,
      focusX, focusY, accent, accentInk, profile.luma.toFixed(3)].join("|");
    const expectedClasses = [
      `dream-theme-${appearance}`,
      profile.aspect >= 1.75 ? "dream-art-wide" : "dream-art-standard",
      `dream-focus-${focus}`,
      `dream-safe-${safeArea}`,
      `dream-task-${taskMode}`,
    ];
    if (signature === lastProfileSignature &&
      expectedClasses.every((className) => root.classList.contains(className)) &&
      root.style.getPropertyValue?.("--dream-art")) {
      return;
    }
    lastProfileSignature = signature;
    root.classList.toggle("dream-theme-light", appearance === "light");
    root.classList.toggle("dream-theme-dark", appearance === "dark");
    root.classList.toggle("dream-art-wide", profile.aspect >= 1.75);
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
      root.classList.toggle(`dream-focus-${value}`, focus === value);
    }
    for (const value of ["left", "center", "right", "none"]) {
      root.classList.toggle(`dream-safe-${value}`, safeArea === value);
    }
    for (const value of ["ambient", "banner", "off"]) {
      root.classList.toggle(`dream-task-${value}`, taskMode === value);
    }
    root.style.setProperty("--dream-art", `url("${artUrl}")`);
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    root.style.setProperty("--dream-focus-x", String(focusX));
    root.style.setProperty("--dream-focus-y", String(focusY));
    root.style.setProperty("--dream-accent", accent);
    root.style.setProperty("--dream-accent-ink", accentInk);
    root.style.setProperty("--dream-image-luma", profile.luma.toFixed(3));
  };

  const ensure = () => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root || !document.body) return;

    const shellMain = document.querySelector("main.main-surface");
    const shellSidebar = document.querySelector("aside.app-shell-left-panel");
    if (!shellMain || !shellSidebar) {
      clearSkinDom();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyProfile(root);

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamVersion !== "3") {
      style.textContent = cssText;
      style.dataset.dreamVersion = "3";
    }

    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    const homeContent = home
      ? Array.from(home.children || []).find((candidate) =>
          candidate.querySelector?.('[data-testid="home-icon"]') &&
          candidate.querySelector?.('.composer-surface-chrome')) || null
      : null;
    for (const candidate of document.querySelectorAll(`.${HOME_CONTENT_CLASS}`)) {
      if (candidate !== homeContent) candidate.classList.remove(HOME_CONTENT_CLASS);
    }
    homeContent?.classList.add(HOME_CONTENT_CLASS);
    for (const candidate of document.querySelectorAll('[role="main"]')) {
      candidate.classList.toggle("dream-home", candidate === home);
      candidate.classList.toggle("dream-task", candidate !== home);
    }
    const utilityBars = new Set(home ? home.querySelectorAll('[class*="_homeUtilityBar_"]') : []);
    for (const candidate of document.querySelectorAll(`.${HOME_UTILITY_CLASS}`)) {
      if (!utilityBars.has(candidate)) candidate.classList.remove(HOME_UTILITY_CLASS);
    }
    for (const candidate of utilityBars) candidate.classList.add(HOME_UTILITY_CLASS);
    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    ensureTokiDom(root, shellMain, shellSidebar, home);

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      document.body.appendChild(chrome);
    }
    chrome.classList.toggle("dream-home-shell", Boolean(home));
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    clearSkinDom();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.activityTimer) clearInterval(state.activityTimer);
    state?.activityChannel?.close?.();
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) return;
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 72);
  };
  const nodeTouchesRelevantUi = (node) => {
    if (!(node instanceof Element)) return false;
    return node.matches(TOKI_RELEVANT_SELECTOR) || Boolean(node.querySelector(TOKI_RELEVANT_SELECTOR));
  };
  observer = new MutationObserver((records) => {
    if (samplingNativeShell) return;
    let relevant = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const target = record.target;
        if (record.attributeName === "disabled" && config.variant === "toki" &&
          target instanceof HTMLButtonElement &&
          target.classList.contains(TOKI_CARD_CLASS)) {
          if (target.disabled) {
            target.dataset.dreamTokiForcedEnabled = "true";
            target.disabled = false;
          }
          relevant = true;
          continue;
        }
        if (target === document.documentElement || target === document.body || nodeTouchesRelevantUi(target)) {
          relevant = true;
        }
        continue;
      }
      if (nodeTouchesRelevantUi(record.target) ||
        [...record.addedNodes, ...record.removedNodes].some(nodeTouchesRelevantUi)) {
        relevant = true;
      }
    }
    if (relevant) scheduleEnsure();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "disabled", "data-theme", "data-appearance", "data-color-mode"],
  });
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") ensure();
  }, 30000);

  const collectRunningTasks = () => {
    const rows = new Set();
    for (const spinner of document.querySelectorAll("aside.app-shell-left-panel .animate-spin")) {
      const row = spinner.closest?.('[role="listitem"]');
      const list = row?.closest?.('[role="list"]');
      const listLabel = (list?.getAttribute?.("aria-label") || "").trim().toLowerCase();
      if (row && (listLabel.includes("task") || listLabel.includes("\u4efb\u52a1"))) rows.add(row);
    }
    const titles = [...rows].map((row) =>
      (row.innerText || row.textContent || "")
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find(Boolean),
    ).filter(Boolean).slice(0, 99);
    if (!titles.length) {
      const stopButton = [...document.querySelectorAll('button[aria-label]')].find((button) => {
        const label = (button.getAttribute?.("aria-label") || "").trim().toLowerCase();
        return label === "stop" || label === "\u505c\u6b62";
      });
      if (stopButton) titles.push(document.title?.trim() || "Current task");
    }
    return { type: "running-tasks", count: titles.length, titles, sentAt: Date.now() };
  };
  const publishActivity = () => {
    try {
      activityChannel?.postMessage(collectRunningTasks());
    } catch {
      // The overlay is optional; the skin must remain usable if the channel closes during shutdown.
    }
  };
  if (typeof BroadcastChannel === "function") {
    activityChannel = new BroadcastChannel(ACTIVITY_CHANNEL);
    activityTimer = setInterval(publishActivity, 2000);
  }
  window[STATE_KEY] = {
    ensure, cleanup, observer, timer, scheduler, artUrl, profile, config, installToken,
    activityChannel, activityTimer, collectRunningTasks, publishActivity, version: "1.2.0",
  };
  ensure();
  publishActivity();
  analyzeArt().then((result) => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
    profile = result;
    state.profile = result;
    ensure();
  });
  return { installed: true, version: "1.2.0", adaptive: true };
})(__DREAM_CSS_JSON__, __DREAM_ART_JSON__, __DREAM_THEME_JSON__)
