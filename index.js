const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  ipcMain,
  globalShortcut,
  screen,
  session,
} = require("electron");
const fs = require("fs");
const path = require("path");

process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

const DEFAULT_URL = "https://darkorbit.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
  
const TAB_BAR_HEIGHT = 72;
const SESSION_PARTITION = "persist:ua-client";
const AUTOFILL_STORE = path.join(app.getPath("userData"), "autofill.json");
const DARKORBIT_UA = "BigpointClient/1.7.2";

let mainWindow;
let tabs = [];
let activeTabId = null;
let chromeHeight = TAB_BAR_HEIGHT;
let pendingAutofill = new Map();
let isFullScreen = false;
let isModalOpen = false;
const defaultZoom = 1;
const getZoom = (tab) => {
  if (!tab || !tab.view || !tab.view.webContents) return defaultZoom;
  const current = tab.view.webContents.getZoomFactor();
  return Number.isFinite(current) ? current : tab.zoom || defaultZoom;
};
const pickUserAgent = (targetUrl) => {
  // DarkOrbit detection remains highest priority
  try {
    const u = new URL(targetUrl);
    if ((u.hostname || "").toLowerCase().includes("darkorbit.com")) {
      return DARKORBIT_UA;
    }
  } catch (_err) {
    // ignore parse errors
  }

  // If user enabled a custom UA and provided a non-empty string, use it
  if (settings && settings.useCustomUA && settings.customUserAgent && settings.customUserAgent.trim()) {
    return settings.customUserAgent.trim();
  }

  return USER_AGENT;
};
const setTabActivity = (tab, isActive) => {
  if (!tab || !tab.view || !tab.view.webContents) return;
  const wc = tab.view.webContents;
  try {
    // Background tabs are throttled and muted to save resources.
    if (typeof wc.setBackgroundThrottling === "function") {
      wc.setBackgroundThrottling(!isActive);
    }
  } catch (_err) {}
  try {
    wc.setAudioMuted(!isActive);
  } catch (_err) {}
};

const pluginName = "pepflashplayer.dll";
const pluginPath = app.isPackaged
  ? path.join(process.resourcesPath, pluginName)
  : path.join(__dirname, pluginName);

app.commandLine.appendSwitch("ppapi-flash-path", pluginPath);
app.commandLine.appendSwitch("ppapi-flash-version", "17.0.0.169");
app.commandLine.appendSwitch("enable-autofill");
app.commandLine.appendSwitch("enable-autofill-profile");
app.commandLine.appendSwitch("enable-features", "AutofillServerCommunication");
app.commandLine.appendSwitch("enable-pinch");

// Load saved DNS settings and apply
const SETTINGS_FILE = path.join(app.getPath("userData"), "do-settings.json");
const loadSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (_err) {
    return {
      homepage: "http://darkorbit.com/",
      gpuAcceleration: true,
      clientName: "Your Name",
      rankIcon: "none",
      useCustomUA: false,
      customUserAgent: "",
    };
  }
};

let settings = loadSettings();
// Ensure new fields have sane defaults
settings = Object.assign(
  {
    homepage: "http://darkorbit.com/",
    gpuAcceleration: true,
    clientName: "Your Name",
    rankIcon: "none",
    useCustomUA: false,
    customUserAgent: "",
  },
  settings
);

Menu.setApplicationMenu(null);

const readAutofill = () => {
  try {
    return JSON.parse(fs.readFileSync(AUTOFILL_STORE, "utf8"));
  } catch (_err) {
    return {};
  }
};

const writeAutofill = (data) => {
  try {
    fs.writeFileSync(AUTOFILL_STORE, JSON.stringify(data, null, 2), "utf8");
  } catch (_err) {
    // ignore
  }
};

const commitPendingAutofill = (webContents) => {
  if (!webContents) return;
  const entries = pendingAutofill.get(webContents.id);
  if (!entries || !entries.length) return;
  let origin;
  let pathName;
  let currentUrl;
  try {
    currentUrl = webContents.getURL();
    const url = new URL(currentUrl);
    origin = url.origin;
    pathName = url.pathname;
  } catch (_err) {
    origin = null;
    pathName = null;
    currentUrl = null;
  }
  if (!origin) {
    pendingAutofill.delete(webContents.id);
    return;
  }
  const store = readAutofill();
  const forOrigin = store[origin] || {};
  entries
    .filter((e) => e && e.origin === origin && e.key && e.value)
    .forEach((entry) => {
      const existing = forOrigin[entry.key] || [];
      if (!existing.includes(entry.value)) {
        forOrigin[entry.key] = [entry.value, ...existing].slice(0, 5);
      }
    });
  store[origin] = forOrigin;
  writeAutofill(store);
  pendingAutofill.delete(webContents.id);
};

const normalizeUrl = (raw) => {
  if (!raw || typeof raw !== "string") return DEFAULT_URL;
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("about:") || trimmed.startsWith("chrome://")) {
    return DEFAULT_URL;
  }
  return `http://${trimmed}`;
};

const broadcastState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeTabs = tabs.filter(
    (tab) => tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()
  );
  tabs = safeTabs;
  if (tabs.length && !tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }

  const canGoBack = {};
  const canGoForward = {};
  
  safeTabs.forEach((tab) => {
    if (tab.view && tab.view.webContents) {
      canGoBack[tab.id] = tab.view.webContents.canGoBack();
      canGoForward[tab.id] = tab.view.webContents.canGoForward();
    }
  });

  const payload = {
    activeId: activeTabId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || "New Tab",
      url: tab.url,
      isLoading: tab.view.webContents.isLoading(),
    })),
    canGoBack,
    canGoForward,
  };
  mainWindow.webContents.send("tabs:update", payload);
};

const findTab = (id) => tabs.find((t) => t.id === id);
const findTabByWebContentsId = (wcId) =>
  tabs.find((t) => t.view && t.view.webContents && t.view.webContents.id === wcId);

const safeRemoveViewFromWindow = (view) => {
  if (!view || !mainWindow) return;
  try {
    if (mainWindow.getBrowserView() === view) {
      mainWindow.removeBrowserView(view);
    }
  } catch (_err) {
    // ignore
  }
};

const layoutActiveView = () => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!mainWindow || !activeTab || activeTab.view.webContents.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  activeTab.view.setBounds({
    x: 0,
    y: chromeHeight,
    width,
    height: Math.max(height - chromeHeight, 200),
  });
  activeTab.view.setAutoResize({ width: true, height: true });
};

const attachViewEvents = (tab) => {
  const { view } = tab;
  view.webContents.on("page-title-updated", (_e, title) => {
    tab.title = title;
    broadcastState();
  });

  view.webContents.on("did-navigate", (_e, url) => {
    tab.url = url;
    broadcastState();
  });

  view.webContents.on("did-finish-load", () => {
    tab.url = view.webContents.getURL();
    broadcastState();
    commitPendingAutofill(view.webContents);
  });

  view.webContents.on("did-start-loading", broadcastState);
  view.webContents.on("did-stop-loading", broadcastState);
  view.webContents.on("did-fail-load", () => pendingAutofill.delete(view.webContents.id));

  view.webContents.on("new-window", (event, url) => {
    event.preventDefault();
    createTab(url, true);
  });

  view.webContents.on("context-menu", (event, params) => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Reload",
        click: () => view.webContents.reload(),
      },
      {
        label: params.linkURL ? "Open Link" : "Back",
        enabled: params.linkURL ? true : view.webContents.canGoBack(),
        click: () => {
          if (params.linkURL) {
            navigateActive(params.linkURL);
          } else if (view.webContents.canGoBack()) {
            view.webContents.goBack();
          }
        },
      },
      {
        label: "Forward",
        enabled: view.webContents.canGoForward(),
        click: () => view.webContents.goForward(),
      },
      { type: "separator" },
      {
        label: "Inspect Element",
        click: () => view.webContents.inspectElement(params.x, params.y),
      },
    ]);
    menu.popup({ window: mainWindow });
  });

  view.webContents.on("before-input-event", (event, input) => {
    if (input.control) {
      const key = input.code.toLowerCase();
      if (key === "keyr") {
        view.webContents.reload();
        event.preventDefault();
      }
      if (key === "keyw") {
        closeTab(tab.id);
        event.preventDefault();
      }
      if (key === "keyf") {
        event.preventDefault();
        const selection =
          typeof view.webContents.getSelectedText === "function"
            ? view.webContents.getSelectedText()
            : "";
        mainWindow?.webContents.send("find:open", { text: selection || "" });
      }
      if (input.type === "mouseWheel" && (input.control || input.meta)) {
        event.preventDefault();
        const direction = input.deltaY < 0 ? 1 : -1; // ctrl+scroll up -> zoom in
        adjustZoom(tab, direction);
      }
    }
  });
};

const createTab = (url = DEFAULT_URL, activate = true) => {
  if (!mainWindow) return;
  const view = new BrowserView({
    webPreferences: {
      plugins: true,
      nodeIntegration: false,
      nativeWindowOpen: true,
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
    },
  });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tab = {
    id,
    view,
    title: "Loading...",
    url: normalizeUrl(url),
    zoom: defaultZoom,
  };

  tabs.push(tab);
  view.webContents.setVisualZoomLevelLimits(0.25, 3).catch(() => {});
  view.webContents.setZoomFactor(defaultZoom);
  setTabActivity(tab, activate);
  attachViewEvents(tab);
  const ua = pickUserAgent(tab.url);
  view.webContents.setUserAgent(ua);
  view.webContents.loadURL(tab.url, { userAgent: ua });

  if (activate) {
    setActiveTab(id);
  } else {
    broadcastState();
  }
};

const destroyTab = (tab) => {
  if (!tab) return;
  safeRemoveViewFromWindow(tab.view);
  setTabActivity(tab, false);
  if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.removeAllListeners();
    tab.view.webContents.destroy();
  }
  if (tab.view && tab.view.webContents) {
    pendingAutofill.delete(tab.view.webContents.id);
  }
};

const closeTab = (id) => {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  const fallback = tabs[index - 1] || tabs[index] || tabs[0];

  safeRemoveViewFromWindow(tab.view);
  destroyTab(tab);

  if (!tabs.length) {
    createTab(DEFAULT_URL, true);
    return;
  }

  if (fallback) {
    setActiveTab(fallback.id);
  } else {
    broadcastState();
  }
};

const setActiveTab = (id) => {
  const tab = findTab(id);
  if (!tab || !mainWindow) return;
  if (tab.view.webContents.isDestroyed()) {
    closeTab(id);
    return;
  }

  const current = findTab(activeTabId);
  if (current && current.view && current.view !== tab.view) {
    setTabActivity(current, false);
    safeRemoveViewFromWindow(current.view);
  }

  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  setTabActivity(tab, true);
  if (typeof tab.zoom === "number") {
    tab.view.webContents.setZoomFactor(tab.zoom);
  }
  layoutActiveView();
  broadcastState();
};

const navigateActive = (url) => {
  const active = tabs.find((t) => t.id === activeTabId);
  if (!active) return;
  const target = normalizeUrl(url);
  active.url = target;
  const ua = pickUserAgent(target);
  active.view.webContents.setUserAgent(ua);
  active.view.webContents.loadURL(target, { userAgent: ua });
};

const moveActive = (delta) => {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx === -1) return;
  const next = tabs[(idx + delta + tabs.length) % tabs.length];
  setActiveTab(next.id);
};

const adjustZoom = (tab, direction) => {
  if (!tab || !tab.view || !tab.view.webContents) return;
  const step = 0.05 * (direction > 0 ? 1 : -1);
  const current = getZoom(tab);
  const next = Math.min(3, Math.max(0.5, current + step));
  tab.zoom = next;
  tab.view.webContents.setZoomFactor(next);
};

const createMainWindow = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#050914",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      plugins: true,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Start maximized so the window fills the screen like the native maximize control.
  mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "tabs.html"));
  mainWindow.on("resize", layoutActiveView);
  mainWindow.on("focus", registerShortcuts);
  mainWindow.on("blur", () => globalShortcut.unregisterAll());
  mainWindow.on("enter-full-screen", () => {
    isFullScreen = true;
    chromeHeight = 0;
    layoutActiveView();
    mainWindow.webContents.send("window:fullscreen", { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    isFullScreen = false;
    chromeHeight = TAB_BAR_HEIGHT;
    layoutActiveView();
    mainWindow.webContents.send("window:fullscreen", { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    globalShortcut.unregisterAll();
    tabs.forEach(destroyTab);
    tabs = [];
    mainWindow = null;
  });
};

const toggleFullscreen = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const next = !mainWindow.isFullScreen();
  isFullScreen = next;
  mainWindow.setFullScreen(next);
  chromeHeight = next ? 0 : TAB_BAR_HEIGHT;
  layoutActiveView();
  mainWindow.webContents.send("window:fullscreen", { fullscreen: next });
};

const registerShortcuts = () => {
  globalShortcut.unregisterAll();
  const safeRegister = (accel, cb) => {
    try {
      globalShortcut.register(accel, cb);
    } catch (_err) {
      // ignore invalid accelerator on this platform/layout
    }
  };

  safeRegister("CommandOrControl+T", () => createTab(DEFAULT_URL, true));
  safeRegister("CommandOrControl+W", () => closeTab(activeTabId));
  safeRegister("CommandOrControl+R", () => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active) active.view.webContents.reload();
  });
  safeRegister("CommandOrControl+=", () => adjustZoom(findTab(activeTabId), 1));
  safeRegister("CommandOrControl+Plus", () => adjustZoom(findTab(activeTabId), 1));
  safeRegister("CommandOrControl+-", () => adjustZoom(findTab(activeTabId), -1));
  safeRegister("CommandOrControl+Minus", () => adjustZoom(findTab(activeTabId), -1));
  safeRegister("CommandOrControl+0", () => {
    const tab = findTab(activeTabId);
    if (tab && tab.view && tab.view.webContents) {
      tab.zoom = defaultZoom;
      tab.view.webContents.setZoomFactor(defaultZoom);
    }
  });
  safeRegister("CommandOrControl+Tab", () => moveActive(1));
  safeRegister("CommandOrControl+Shift+Tab", () => moveActive(-1));
  safeRegister("F11", toggleFullscreen);
};

ipcMain.handle("tabs:create", (_event, url) => createTab(url || DEFAULT_URL, true));
ipcMain.handle("tabs:activate", (_event, id) => setActiveTab(id));
ipcMain.handle("tabs:close", (_event, id) => closeTab(id || activeTabId));
ipcMain.handle("tabs:reload", (_event, tabId) => {
  const tab = tabId ? findTab(tabId) : findTab(activeTabId);
  if (tab) tab.view.webContents.reload();
});
ipcMain.handle("tabs:back", () => {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && active.view.webContents.canGoBack()) active.view.webContents.goBack();
});
ipcMain.handle("tabs:forward", () => {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && active.view.webContents.canGoForward()) active.view.webContents.goForward();
});
ipcMain.handle("tabs:navigate", (_event, url) => navigateActive(url));
ipcMain.on("tabs:request-state", () => broadcastState());
ipcMain.on("tabs:next", () => moveActive(1));
ipcMain.on("tabs:previous", () => moveActive(-1));
ipcMain.on("tabs:reorder", (_event, { draggedId, targetId }) => {
  const draggedIndex = tabs.findIndex((t) => t.id === draggedId);
  const targetIndex = tabs.findIndex((t) => t.id === targetId);
  
  if (draggedIndex !== -1 && targetIndex !== -1) {
    // Tab sırasını değiştir
    const temp = tabs[draggedIndex];
    tabs[draggedIndex] = tabs[targetIndex];
    tabs[targetIndex] = temp;
    console.log(`Tab sırası değiştirildi: ${draggedId} <-> ${targetId}`);
    broadcastState();
  }
});
ipcMain.handle("zoom:adjust", (event, deltaY) => {
  const tab = findTabByWebContentsId(event.sender.id) || findTab(activeTabId);
  if (tab) {
    const direction = deltaY < 0 ? 1 : -1;
    adjustZoom(tab, direction);
  }
});
ipcMain.handle("zoom:reset", () => {
  const tab = findTab(activeTabId);
  if (tab && tab.view && tab.view.webContents) {
    tab.zoom = defaultZoom;
    tab.view.webContents.setZoomFactor(defaultZoom);
  }
});
ipcMain.handle("find:start", (_e, query, direction) => {
  const tab = findTab(activeTabId);
  if (!tab || !query) return;
  tab.view.webContents.findInPage(query, {
    forward: direction !== "backward",
    findNext: true,
    matchCase: false,
  });
});
ipcMain.handle("find:stop", () => {
  const tab = findTab(activeTabId);
  if (!tab) return;
  tab.view.webContents.stopFindInPage("keepSelection");
});
ipcMain.handle("autofill:queue", (event, entries) => {
  pendingAutofill.set(event.sender.id, entries || []);
});
ipcMain.handle("autofill:get", (_e, origin, key) => {
  const store = readAutofill();
  const forOrigin = store[origin] || {};
  return forOrigin[key] || [];
});
ipcMain.handle("autofill:delete", (_e, origin, key, value) => {
  if (!origin || !key || !value) return;
  const store = readAutofill();
  const forOrigin = store[origin] || {};
  const existing = forOrigin[key] || [];
  const next = existing.filter((v) => v !== value);
  if (next.length) {
    forOrigin[key] = next;
    store[origin] = forOrigin;
  } else {
    delete forOrigin[key];
    if (Object.keys(forOrigin).length) {
      store[origin] = forOrigin;
    } else {
      delete store[origin];
    }
  }
  writeAutofill(store);
  return next;
});
ipcMain.handle("autofill:clear", () => {
  pendingAutofill.clear();
  writeAutofill({});
});
ipcMain.handle("tabs:view-source", () => {
  const tab = findTab(activeTabId);
  if (tab) {
    const url = tab.view.webContents.getURL();
    createTab(`view-source:${url}`, true);
  }
});
ipcMain.handle("tabs:inspect-element", (_event, coords) => {
  const tab = findTab(activeTabId);
  if (tab && tab.view && tab.view.webContents) {
    try {
      tab.view.webContents.inspectElement(coords.x - 0, coords.y - TAB_BAR_HEIGHT);
    } catch (err) {
      console.log("DevTools açılırken hata:", err);
    }
  }
});
ipcMain.handle("cookies:clear", async () => {
  try {
    await session.fromPartition(SESSION_PARTITION).clearStorageData();
    await session.defaultSession.clearStorageData();
    const targetTab = findTab(activeTabId) || tabs[0];
    if (targetTab) {
      setActiveTab(targetTab.id);
      navigateActive(DEFAULT_URL);
    }
    return true;
  } catch (_err) {
    return false;
  }
});
ipcMain.handle("dialog:confirm", async (_e, { message, detail }) => {
  const res = await app.whenReady().then(() =>
    BrowserWindow.getFocusedWindow()
      ?.webContents
      ?.executeJavaScript(`window.confirm(${JSON.stringify(message + (detail ? "\\n\\n" + detail : ""))})`)
  );
  return !!res;
});
ipcMain.handle("dialog:info", async (_e, { message }) => {
  await app.whenReady().then(() =>
    BrowserWindow.getFocusedWindow()
      ?.webContents
      ?.executeJavaScript(`window.alert(${JSON.stringify(message || "")})`)
  );
});
ipcMain.handle("window:toggle-fullscreen", () => {
  toggleFullscreen();
});
ipcMain.on("ui:header-height", (_event, height) => {
  if (isFullScreen) {
    chromeHeight = 0;
    layoutActiveView();
    return;
  }
  if (typeof height === "number" && !Number.isNaN(height)) {
    chromeHeight = Math.max(height, TAB_BAR_HEIGHT);
    layoutActiveView();
  }
});
ipcMain.on("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.on("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on("modal:open", () => {
  isModalOpen = true;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab && activeTab.view && mainWindow) {
    // BrowserView'u gizle - bounds'unu sıfıra set et
    activeTab.view.setBounds({
      x: 0,
      y: mainWindow.getContentSize()[1],
      width: 0,
      height: 0,
    });
  }
});
ipcMain.on("modal:close", () => {
  isModalOpen = false;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab && activeTab.view) {
    // Restore BrowserView
    layoutActiveView();
  }
});
ipcMain.on("settings:update", (_event, newSettings) => {
  // Merge and persist the new settings in-memory
  try {
    // Update runtime settings object
    settings = Object.assign(settings || {}, newSettings || {});

    // DNS handling (maintained for backward compatibility)
    let dnsAddress = "default";
    switch (settings.dnsServer) {
      case "cloudflare":
        dnsAddress = "1.1.1.1 (Cloudflare)";
        break;
      case "google":
        dnsAddress = "8.8.8.8 (Google)";
        break;
      case "quad9":
        dnsAddress = "9.9.9.9 (Quad9)";
        break;
      case "custom":
        dnsAddress = settings.customDns || "default";
        break;
      default:
        dnsAddress = "Default (automatic)";
    }

    console.log(`Settings updated. DNS: ${dnsAddress}`);

    // Log and apply the effective User Agent
    try {
      const sampleUA = pickUserAgent(tabs[0]?.url || "");
      console.log("Applying User Agent for tabs:", sampleUA);
    } catch (_) {}

    // Apply user agent changes and reload all tabs so new UA takes effect
    tabs.forEach((tab) => {
      if (tab.view && tab.view.webContents) {
        try {
          const ua = pickUserAgent(tab.url || "");
          tab.view.webContents.setUserAgent(ua);
        } catch (_) {}
        tab.view.webContents.reload();
      }
    });
  } catch (err) {
    console.error("Error applying settings:", err);
  }
});

ipcMain.on("app:restart", () => {
  console.log("Application is restarting...");
  app.relaunch();
  app.exit(0);
});

ipcMain.on("settings:save-file", (_event, settings) => {
  // Save settings to file
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    console.log("Settings saved to file:", settings);
  } catch (err) {
    console.error("Failed to write settings to file:", err);
  }
});

ipcMain.on("ranks:list", (event) => {
  const ranksDir = path.join(__dirname, "ranks");
  try {
    if (!fs.existsSync(ranksDir)) {
      event.reply("ranks:list", []);
      return;
    }
    const files = fs.readdirSync(ranksDir);
    const ranks = files
      .filter((f) => f.startsWith("rank_") && f.endsWith(".png"))
      .map((f) => f.replace("rank_", "").replace(".png", ""))
      .sort((a, b) => parseInt(a) - parseInt(b));
    event.reply("ranks:list", ranks);
  } catch (err) {
    console.error("Failed to read ranks folder:", err);
    event.reply("ranks:list", []);
  }
});

ipcMain.on("page:context-menu", (_event, data) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  const template = [];
  

    template.push({
      label: `Search "${data.selection.substring(0, 30)}${data.selection.length > 30 ? "..." : ""}"`,
      click: () => {
        if (activeTab) {
          navigateActive(`https://www.google.com/search?q=${encodeURIComponent(data.selection)}`);
        }
      }
    });
    template.push({ type: "separator" });
  
  // Link options
  if (data.isLink) {
    template.push({
      label: "🔗 Open Link in New Tab",
      click: () => createTab(data.linkUrl, true)
    });
    template.push({
      label: "📋 Copy Link",
      click: () => require("electron").clipboard.writeText(data.linkUrl)
    });
    template.push({ type: "separator" });
  }
  
  // Image options
  if (data.isImage) {
    template.push({
      label: "🖼️ Open Image in New Tab",
      click: () => createTab(data.imageUrl, true)
    });
    template.push({
      label: "💾 Download Image",
      click: () => {
        if (activeTab && activeTab.view && activeTab.view.webContents) {
          activeTab.view.webContents.downloadURL(data.imageUrl);
        }
      }
    });
    template.push({ type: "separator" });
  }
  
  // Page options
  template.push({
    label: "📄 View Page Source",
    click: () => {
      if (activeTab) {
        const url = activeTab.view.webContents.getURL();
        createTab(`view-source:${url}`, true);
      }
    }
  });
  
  template.push({
    label: "🔍 Inspect Element (DevTools)",
    click: () => {
      if (activeTab && activeTab.view && activeTab.view.webContents) {
        activeTab.view.webContents.inspectElement(data.x, data.y);
      }
    }
  });
  
  const contextMenu = Menu.buildFromTemplate(template);
  contextMenu.popup({ window: mainWindow });
});

app.on("ready", () => {
  createMainWindow();
  createTab(DEFAULT_URL, true);
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

