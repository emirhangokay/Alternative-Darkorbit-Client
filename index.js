const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  dialog,
  ipcMain,
  globalShortcut,
  powerSaveBlocker,
  powerMonitor,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const path = require("path");

process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

const DEFAULT_URL = "https://darkorbit.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
  
const TAB_BAR_HEIGHT = 82;
const MIN_CHROME_HEIGHT = 36;
const SESSION_PARTITION = "persist:ua-client";
const AUTOFILL_STORE = path.join(app.getPath("userData"), "autofill.json");
const CREDENTIALS_STORE = path.join(app.getPath("userData"), "credentials.json");
const DARKORBIT_UA = "BigpointClient/1.7.2";

let mainWindow;
let tabs = [];
let activeTabId = null;
let chromeHeight = TAB_BAR_HEIGHT;
let pendingAutofill = new Map();
let isFullScreen = false;
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
  // The page process feeds Flash its mouse and keyboard input, so the tab being
  // played gets a priority bump too; tabs in the background give it back.
  if (settings && settings.performanceMode !== false) {
    try {
      const pid = wc.getOSProcessId();
      if (pid > 0) {
        os.setPriority(
          pid,
          isActive ? os.constants.priority.PRIORITY_ABOVE_NORMAL : os.constants.priority.PRIORITY_NORMAL
        );
      }
    } catch (_err) {}
  }
};

const pluginName = "pepflashplayer.dll";
const pluginPath = app.isPackaged
  ? path.join(process.resourcesPath, pluginName)
  : path.join(__dirname, pluginName);

app.commandLine.appendSwitch("ppapi-flash-path", pluginPath);
app.commandLine.appendSwitch("ppapi-flash-version", "29.0.0.171");
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
    clientIcon: "",
      useCustomUA: false,
      customUserAgent: "",
      theme: "dark",
      saveLogin: false,
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
    clientIcon: "",
    useCustomUA: false,
    customUserAgent: "",
    theme: "dark",
    saveLogin: false,
    performanceMode: true,
    flashQuality: "default",
    flashMemoryLimitMB: 1400,
    flashAutoRestart: true,
  },
  settings
);

// ---- Flash performance switches (must be set before app is ready) ----
if (settings.gpuAcceleration === false) {
  app.disableHardwareAcceleration();
} else if (settings.performanceMode !== false && !settings.gpuSafeMode) {
  // Without these, Chromium silently drops Flash/Stage3D to software rendering
  // on GPUs/drivers it does not like, which is the #1 cause of in-game stutter.
  app.commandLine.appendSwitch("ignore-gpu-blacklist");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  // Laptops with two GPUs: always take the fast one.
  app.commandLine.appendSwitch("force_high_performance_gpu");
}
if (settings.performanceMode !== false) {
  // Keep the game running at full speed when the window is unfocused,
  // covered by another window or minimized.
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  // Room for the game's maps, ships and sounds to stay cached between sessions
  // instead of being downloaded (and stuttering in) again.
  app.commandLine.appendSwitch("disk-cache-size", String(1024 * 1024 * 1024));
  // Never let Chromium throttle/pause Flash content as "peripheral".
  app.commandLine.appendSwitch("override-plugin-power-saver-for-testing", "never");
}
// The switches above override Chromium's own caution about bad drivers. On a
// computer where that caution was justified the graphics process keeps dying;
// after three crashes we give up on them for good and restart without them, so
// nobody ends up with a client that cannot even open its settings.
let gpuCrashCount = 0;
app.on("gpu-process-crashed", () => {
  gpuCrashCount += 1;
  if (gpuCrashCount < 3 || settings.gpuSafeMode || settings.gpuAcceleration === false) return;
  if (settings.performanceMode === false) return;
  settings.gpuSafeMode = true;
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (_err) {}
  app.relaunch();
  app.exit(0);
});

// ---- Flash Player's own configuration (mms.cfg) ----
// Flash reads this file from its data folder inside our profile when it
// starts. Only the keys listed here are ours; anything else already in the
// file is left alone.
const writeFlashConfig = () => {
  const partition = SESSION_PARTITION.replace(/^persist:/, "");
  const dir = path.join(
    app.getPath("userData"),
    "Partitions",
    partition,
    "Pepper Data",
    "Shockwave Flash",
    "System"
  );
  const file = path.join(dir, "mms.cfg");
  const fastGpu =
    settings.gpuAcceleration !== false && settings.performanceMode !== false && !settings.gpuSafeMode;
  const ours = {
    // no update checks, crash uploads or uninstall nags in the background
    AutoUpdateDisable: "1",
    SilentAutoUpdateEnable: "0",
    ErrorReportingEnable: "0",
    EOLUninstallDisable: "1",
    // Flash has its own list of graphics cards and drivers it refuses to
    // accelerate (old drivers, little video memory). Skip that check.
    OverrideGPUValidation: fastGpu ? "1" : null,
  };
  let kept = [];
  try {
    kept = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !(line.split("=")[0].trim() in ours));
  } catch (_err) {}
  const lines = kept.concat(
    Object.keys(ours)
      .filter((key) => ours[key] !== null)
      .map((key) => key + "=" + ours[key])
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join("\r\n") + "\r\n", "utf8");
};
try {
  writeFlashConfig();
} catch (_err) {
  // read-only profile or similar: Flash simply runs with its defaults
}

// settings that no longer exist, left behind by older versions
[
  "lowDpiRender",
  "flashForceDirect",
  "flashAutoTrim",
  "flashRenderScale",
  "dnsServer",
  "customDns",
  "autoLogin",
].forEach((key) => {
  delete settings[key];
});

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

const readCredentials = () => {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_STORE, "utf8"));
  } catch (_err) {
    return {};
  }
};

const writeCredentials = (data) => {
  try {
    fs.writeFileSync(CREDENTIALS_STORE, JSON.stringify(data, null, 2), "utf8");
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
  if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send("tabs:update", payload);
};

const findTab = (id) => tabs.find((t) => t.id === id);
const findTabByWebContentsId = (wcId) =>
  tabs.find((t) => t.view && t.view.webContents && t.view.webContents.id === wcId);

const safeRemoveViewFromWindow = (view) => {
  if (!view || !mainWindow) return;
  try {
    mainWindow.removeBrowserView(view);
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
    width: Math.max(width, 200),
    height: Math.max(height - chromeHeight, 200),
  });
  activeTab.view.setAutoResize({ width: true, height: true });
  layoutPanelView();
};

// ---------- settings/accounts overlay ----------
// The panels are drawn by a second BrowserView (tabs.html?overlay) stacked above the
// game view. It slides in from the right over the game; the game is never resized.
const PANEL_WIDTH = 380;
const PANEL_SLIDE_MS = 200;
let panelView = null;
let panelAttached = false;
let panelName = null;
let panelSlideTimer = null;

const ensurePanelView = () => {
  if (panelView && !panelView.webContents.isDestroyed()) return panelView;
  panelView = new BrowserView({
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  // Transparent, so the game shows through until the panel has slid in.
  panelView.setBackgroundColor("#00000000");
  panelView.webContents.loadFile(path.join(__dirname, "tabs.html"), { query: { overlay: "1" } });
  panelAttached = false;
  return panelView;
};

const layoutPanelView = () => {
  if (!panelView || !panelAttached || !mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  panelView.setBounds({
    x: width - PANEL_WIDTH,
    y: chromeHeight,
    width: PANEL_WIDTH,
    height: Math.max(height - chromeHeight, 200),
  });
};

const attachPanelView = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  ensurePanelView();
  if (panelAttached) return;
  // Added last, so it is drawn on top of the game view.
  mainWindow.addBrowserView(panelView);
  panelAttached = true;
  layoutPanelView();
};

const detachPanelView = () => {
  if (!panelView || !panelAttached || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.removeBrowserView(panelView);
  } catch (_err) {}
  panelAttached = false;
};

const sendPanelState = () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("panel:state", panelName);
  if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send("panel:state", panelName);
};

const setPanel = (name) => {
  const next = name === "settings" || name === "accounts" ? name : null;
  if (next === panelName) return;
  panelName = next;
  sendPanelState();
  // The view sits still at its final place; the panel inside it slides with a CSS
  // transition (GPU-composited, smooth). Moving the native view every frame was choppy.
  clearTimeout(panelSlideTimer);
  panelSlideTimer = null;
  if (next) {
    attachPanelView();
    panelView.webContents.focus();
  } else {
    const active = findTab(activeTabId);
    if (active && !active.view.webContents.isDestroyed()) active.view.webContents.focus();
    // Let the slide-out finish, then take the view off the game so clicks reach it.
    panelSlideTimer = setTimeout(() => {
      panelSlideTimer = null;
      if (!panelName) detachPanelView();
    }, PANEL_SLIDE_MS + 60);
  }
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
    // a navigation can move the page to a new process; re-apply its priority
    setTabActivity(tab, tab.id === activeTabId);
    tab.url = view.webContents.getURL();
    broadcastState();
    commitPendingAutofill(view.webContents);
  });

  view.webContents.on("did-start-loading", broadcastState);
  view.webContents.on("did-stop-loading", broadcastState);
  view.webContents.on("did-fail-load", () => pendingAutofill.delete(view.webContents.id));

  // Flash died (out of memory, crash, or our own "Restart Flash") -> bring the game back.
  view.webContents.on("plugin-crashed", () => {
    const now = Date.now();
    if (now - (tab.lastPluginRecovery || 0) < 15000) return; // avoid crash loops
    tab.lastPluginRecovery = now;
    setTimeout(() => {
      if (!view.webContents.isDestroyed()) view.webContents.reload();
    }, 400);
  });

  view.webContents.on("new-window", (event, url) => {
    event.preventDefault();
    createTab(url, true);
  });

  // Prevent page from closing the entire client; close only this tab instead
  view.webContents.on("will-prevent-unload", (event) => {
    // Allow the page to close without showing confirmation dialog
    event.preventDefault();
  });

  view.webContents.on("context-menu", (event, params) => {
    const isFlashContext = (() => {
      if (!params) return false;
      if (params.mediaType === "plugin") return true;
      const candidates = [params.srcURL, params.frameURL, params.pageURL];
      return candidates.some((value) => {
        if (!value || typeof value !== "string") return false;
        return value.toLowerCase().includes(".swf");
      });
    })();
    if (isFlashContext) {
      // Allow Flash/Pepper plugin to show its own native context menu.
      return;
    }

    Menu.buildFromTemplate(buildContextMenu(view.webContents, params)).popup({ window: mainWindow });
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
      spellcheck: false,
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
  if (panelAttached) {
    panelAttached = false;
    attachPanelView();
  }
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
  ensurePanelView();
  mainWindow.on("resize", layoutActiveView);
  mainWindow.on("focus", () => {
    unfocusedSince = 0;
    registerShortcuts();
  });
  mainWindow.on("blur", () => {
    unfocusedSince = Date.now();
    globalShortcut.unregisterAll();
  });
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
    clearTimeout(panelSlideTimer);
    if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.destroy();
    panelView = null;
    panelAttached = false;
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
  safeRegister("CommandOrControl+Shift+R", () => {
    if (restartFlash()) lastAutoRestart = Date.now();
  });
};

// ---- Flash memory watchdog ----
// Flash leaks inside its own plugin process; the only real cure is a fresh
// process. We watch it, show the number in the toolbar and restart on demand
// (or automatically if the user opted in).
const PERF_INTERVAL_MS = 3000;
const boostedPids = new Set();
const qosPids = new Set();
let allPids = [];
let gpuPids = [];
let psBusy = false;

// Small Windows calls that Node has no API for run in a throwaway PowerShell
// process, one at a time, so the game never waits on them. The command is
// passed as plain readable text: encoded commands look like malware to
// antivirus software, and this client runs on other people's computers.
// If PowerShell is missing or blocked the call just fails and nothing else
// is affected.
const runPowerShell = (script) =>
  new Promise((resolve) => {
    if (process.platform !== "win32" || psBusy) return resolve(false);
    psBusy = true;
    try {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 20000 },
        (err) => {
          psBusy = false;
          resolve(!err);
        }
      );
    } catch (_err) {
      psBusy = false;
      resolve(false);
    }
  });

const forEachPid = (pids, call) =>
  "foreach ($id in " + pids.join(",") + ") { try { [void]" + call + "((Get-Process -Id $id).Handle) } catch {} }";

// Windows 11 quietly slows processes it considers "background": their timers
// get coarse and, on CPUs with performance + efficiency cores, their threads
// are parked on the slow cores. Flash runs in a windowless helper process, so
// it is the first victim whenever the client is not the focused window.
// This opts every process of the client out of that throttling. Windows 10
// only knows the first half of the request, hence the second attempt.
const QOS_SCRIPT =
  "Add-Type -Name Qos -Namespace DoClient -MemberDefinition '" +
  "[StructLayout(LayoutKind.Sequential)] public struct S { public uint Version; public uint ControlMask; public uint StateMask; } " +
  '[DllImport("kernel32.dll")] public static extern bool SetProcessInformation(IntPtr h, int c, ref S s, int size); ' +
  '[DllImport("kernel32.dll")] static extern bool GetSystemCpuSetInformation(IntPtr info, uint len, out uint ret, IntPtr proc, uint flags); ' +
  '[DllImport("kernel32.dll")] static extern bool SetProcessDefaultCpuSets(IntPtr h, uint[] ids, uint count); ' +
  "public static bool Off(IntPtr h) { S s; s.Version = 1; s.StateMask = 0; " +
  "s.ControlMask = 5; if (SetProcessInformation(h, 4, ref s, 12)) return true; " +
  "s.ControlMask = 1; return SetProcessInformation(h, 4, ref s, 12); } " +
  // Ids of the performance cores, or null when every core is the same kind.
  "public static uint[] Fast() { uint len; GetSystemCpuSetInformation(IntPtr.Zero, 0, out len, IntPtr.Zero, 0); " +
  "if (len == 0) return null; IntPtr buf = Marshal.AllocHGlobal((int)len); try { " +
  "if (!GetSystemCpuSetInformation(buf, len, out len, IntPtr.Zero, 0)) return null; " +
  "var ids = new System.Collections.Generic.List<uint>(); var eff = new System.Collections.Generic.List<byte>(); " +
  "byte max = 0; byte min = 255; int off = 0; " +
  "while (off < len) { int size = Marshal.ReadInt32(buf, off); if (size <= 0) break; " +
  "byte e = Marshal.ReadByte(buf, off + 18); ids.Add((uint)Marshal.ReadInt32(buf, off + 8)); eff.Add(e); " +
  "if (e > max) max = e; if (e < min) min = e; off += size; } " +
  "if (max == min) return null; var fast = new System.Collections.Generic.List<uint>(); " +
  "for (int i = 0; i < ids.Count; i++) if (eff[i] == max) fast.Add(ids[i]); return fast.ToArray(); " +
  "} finally { Marshal.FreeHGlobal(buf); } } " +
  "public static bool Pin(IntPtr h) { uint[] fast = Fast(); if (fast == null || fast.Length == 0) return false; " +
  "return SetProcessDefaultCpuSets(h, fast, (uint)fast.Length); }'; ";

const TRIM_SCRIPT =
  "Add-Type -Name Mem -Namespace DoClient -MemberDefinition '" +
  '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);\'; ';

const disablePowerThrottling = () => {
  if (settings.performanceMode === false || psBusy) return;
  const fresh = allPids.filter((pid) => Number.isInteger(pid) && !qosPids.has(pid));
  if (!fresh.length) return;
  fresh.forEach((pid) => qosPids.add(pid));
  // Processors with fast and slow cores (Intel 12th gen and later): Windows is
  // free to move Flash's one busy thread onto a slow core for a moment, which
  // shows up in the game as a hitch. Flash and the graphics process are told to
  // prefer the fast cores. On ordinary processors this does nothing.
  const hot = fresh.filter((pid) => flashPids.includes(pid) || gpuPids.includes(pid));
  runPowerShell(
    QOS_SCRIPT +
      forEachPid(fresh, "[DoClient.Qos]::Off") +
      (hot.length ? " " + forEachPid(hot, "[DoClient.Qos]::Pin") : "")
  );
};
let flashPids = [];
let lastAutoRestart = 0;
let lastTrim = 0;
let trimCooldown = 60000;
let trimBusy = false;
let perfTimer = null;
let sleepBlockerId = null;
// When the client window last stopped being the focused one (0 = focused).
let unfocusedSince = 0;

// A game left running must not be suspended by Windows going to sleep.
const syncSleepBlocker = (flashRunning) => {
  if (flashRunning && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!flashRunning && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
};

const isFlashProcess = (m) => /pepper|ppapi|plugin/i.test(m.type || "") && !/broker/i.test(m.type || "");

const collectPerfStats = () => {
  let metrics;
  try {
    metrics = app.getAppMetrics();
  } catch (_err) {
    return null;
  }
  let flashKB = 0;
  let flashCommitKB = 0;
  let totalKB = 0;
  let cpu = 0;
  let flashCpu = 0;
  let gpuCpu = 0;
  let tabCpu = 0;
  let activePid = 0;
  try {
    const active = findTab(activeTabId);
    if (active) activePid = active.view.webContents.getOSProcessId();
  } catch (_err) {}
  const pids = [];
  allPids = metrics.map((m) => m.pid);
  gpuPids = metrics.filter((m) => /gpu/i.test(m.type || "")).map((m) => m.pid);
  metrics.forEach((m) => {
    const mem = m.memory || {};
    // workingSetSize = RAM actually occupied right now (what a trim frees);
    // privateBytes = everything Flash has allocated, including what was paged out.
    const kb = mem.workingSetSize || 0;
    totalKB += kb;
    const share = (m.cpu && m.cpu.percentCPUUsage) || 0;
    cpu += share;
    if (/gpu/i.test(m.type || "")) gpuCpu += share;
    if (m.pid === activePid) tabCpu += share;
    if (isFlashProcess(m)) {
      flashCpu += share;
      flashKB += kb;
      flashCommitKB += mem.privateBytes || kb;
      pids.push(m.pid);
    }
  });
  flashPids = pids;
  return {
    flashMB: Math.round(flashKB / 1024),
    flashCommitMB: Math.round(flashCommitKB / 1024),
    totalMB: Math.round(totalKB / 1024),
    cpu: Math.round(cpu),
    // Electron reports CPU as a share of all cores; these are scaled so that
    // 100 means "one core fully busy". Flash's game loop runs on a single
    // thread, so a Flash value near 100 means the game itself is the limit.
    flashCpu: Math.round(flashCpu * CORE_COUNT),
    gpuCpu: Math.round(gpuCpu * CORE_COUNT),
    tabCpu: Math.round(tabCpu * CORE_COUNT),
    flashRunning: pids.length > 0,
    limitMB: Number(settings.flashMemoryLimitMB) || 0,
  };
};

// ---- Performance log ----
// One line every few seconds while a game is running, so a slowdown can be
// looked at afterwards instead of guessed at: did Flash's memory grow, was
// Flash's thread maxed out, was the graphics process busy, or none of those
// (which points at the game server or the network). The previous session is
// kept next to the current one.
const PERF_LOG = path.join(app.getPath("userData"), "performance-log.csv");
const PERF_LOG_PREVIOUS = path.join(app.getPath("userData"), "performance-log.previous.csv");
const CORE_COUNT = Math.max(1, os.cpus().length);
let perfLogReady = false;
let flashSince = 0;

const startPerfLog = () => {
  try {
    if (fs.existsSync(PERF_LOG)) fs.renameSync(PERF_LOG, PERF_LOG_PREVIOUS);
  } catch (_err) {}
  try {
    fs.writeFileSync(
      PERF_LOG,
      "time,minutes_in_game,flash_allocated_mb,flash_ram_mb,flash_cpu_pct_of_core,gpu_cpu_pct_of_core,tab_cpu_pct_of_core,client_cpu_pct_total,window_focused,tabs,system_free_mb\r\n",
      "utf8"
    );
    perfLogReady = true;
  } catch (_err) {
    perfLogReady = false;
  }
};

const writePerfLog = (stats) => {
  if (!perfLogReady) return;
  if (!stats.flashRunning) {
    flashSince = 0;
    return;
  }
  const now = Date.now();
  if (!flashSince) flashSince = now;
  const line = [
    new Date(now).toISOString(),
    ((now - flashSince) / 60000).toFixed(1),
    stats.flashCommitMB,
    stats.flashMB,
    stats.flashCpu,
    stats.gpuCpu,
    stats.tabCpu,
    stats.cpu,
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() ? 1 : 0,
    tabs.length,
    Math.round(os.freemem() / 1048576),
  ].join(",");
  fs.appendFile(PERF_LOG, line + "\r\n", () => {});
};

ipcMain.handle("perf:open-log", () => {
  shell.showItemInFolder(PERF_LOG);
});

const boostFlashPriority = () => {
  if (settings.performanceMode === false) return;
  // Flash draws through the GPU process, so both get the bump.
  flashPids.concat(gpuPids).forEach((pid) => {
    if (boostedPids.has(pid)) return;
    boostedPids.add(pid);
    try {
      os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch (_err) {
      // not fatal, the game just keeps normal priority
    }
  });
};

// Frees Flash's RAM without touching the game: Windows is asked to drop the
// plugin's working set. Memory the game leaked and never reads again leaves
// physical RAM for good; pages it still uses come straight back on next access.
// Runs in a short-lived helper process, so the game itself never stalls on it.
const trimFlashMemory = async () => {
  const pids = flashPids.filter((pid) => Number.isInteger(pid));
  if (trimBusy || !pids.length) return false;
  trimBusy = true;
  const ok = await runPowerShell(TRIM_SCRIPT + forEachPid(pids, "[DoClient.Mem]::EmptyWorkingSet"));
  trimBusy = false;
  return ok;
};

const restartFlash = () => {
  collectPerfStats();
  if (!flashPids.length) return false;
  // Killing the plugin process frees everything it leaked; every tab that was
  // using Flash gets "plugin-crashed" and reloads itself.
  flashPids.forEach((pid) => {
    try {
      process.kill(pid);
    } catch (_err) {}
    boostedPids.delete(pid);
  });
  return true;
};

// Never refresh Flash in the middle of play. The player counts as away once
// the client has been in the background (another window in front, or
// minimised) for 20 seconds, or mouse and keyboard have been untouched for a
// minute and a half.
const playerIsAway = (now) => {
  const inBackground = unfocusedSince > 0 && now - unfocusedSince >= 20000;
  let idleSeconds = 0;
  try {
    idleSeconds = powerMonitor.getSystemIdleTime();
  } catch (_err) {}
  return inBackground || idleSeconds >= 90;
};

const perfTick = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const stats = collectPerfStats();
  if (!stats) return;
  boostFlashPriority();
  disablePowerThrottling();
  syncSleepBlocker(stats.flashRunning);
  writePerfLog(stats);
  const now = Date.now();
  // Trimming only helps a computer that is actually short on RAM. With plenty
  // free it frees nothing useful and just makes Flash fetch its pages back, so
  // it is skipped unless less than a fifth of the system's memory is left.
  const memoryIsTight = os.freemem() < os.totalmem() * 0.2;
  if (
    memoryIsTight &&
    stats.limitMB > 0 &&
    stats.flashMB >= stats.limitMB &&
    now - lastTrim > trimCooldown &&
    !psBusy
  ) {
    // If RAM climbed straight back over the limit, the game really is using
    // that memory; trimming it again and again would only cost FPS, so back off.
    trimCooldown = lastTrim && now - lastTrim < trimCooldown * 2 ? Math.min(trimCooldown * 2, 600000) : 60000;
    lastTrim = now;
    trimFlashMemory();
  }
  if (
    settings.flashAutoRestart &&
    stats.limitMB > 0 &&
    stats.flashCommitMB >= stats.limitMB &&
    now - lastAutoRestart > 120000 &&
    playerIsAway(now)
  ) {
    lastAutoRestart = now;
    restartFlash();
  }
  mainWindow.webContents.send("perf:stats", stats);
};

const startPerfMonitor = () => {
  startPerfLog();
  if (perfTimer) clearInterval(perfTimer);
  perfTimer = setInterval(perfTick, PERF_INTERVAL_MS);
};

ipcMain.handle("flash:restart", () => restartFlash());

ipcMain.handle("tabs:create", (_event, url) => createTab(url || DEFAULT_URL, true));
ipcMain.handle("tabs:close-others", (_event, id) => {
  if (!findTab(id)) return;
  tabs
    .filter((t) => t.id !== id)
    .forEach((t) => closeTab(t.id));
});
ipcMain.handle("tabs:devtools", () => {
  const tab = findTab(activeTabId);
  if (tab) tab.view.webContents.openDevTools({ mode: "detach" });
});

// HTML drawn in the window always sits under the game view, so menus that must
// overlap the game are native ones.
ipcMain.handle("ui:menu", (_event, items) => {
  if (!mainWindow || mainWindow.isDestroyed() || !Array.isArray(items)) return null;
  return new Promise((resolve) => {
    let picked = null;
    const template = items.map((item) => {
      if (item.separator) return { type: "separator" };
      if (item.role) return { role: item.role };
      return {
        label: String(item.label || ""),
        enabled: !item.disabled,
        // shown as a hint only; the real shortcuts are handled elsewhere
        accelerator: item.accelerator || undefined,
        registerAccelerator: false,
        click: () => {
          picked = item.id;
        },
      };
    });
    Menu.buildFromTemplate(template).popup({
      window: mainWindow,
      callback: () => setTimeout(() => resolve(picked), 30),
    });
  });
});

ipcMain.on("ui:side-panel", (_event, name) => setPanel(name));

// Fill and submit the login form of the active tab with a saved account.
ipcMain.handle("credentials:apply", (_event, account) => {
  const tab = findTab(activeTabId);
  if (!tab || !account) return false;
  tab.view.webContents.send("credentials:apply", account);
  tab.view.webContents.focus();
  return true;
});
ipcMain.handle("tabs:activate", (_event, id) => setActiveTab(id));
ipcMain.handle("tabs:close", (_event, id) => closeTab(id || activeTabId));

// Handle page-initiated close (e.g., when game's logout triggers window.close())
ipcMain.on("tab:close-current", (event) => {
  // Find which tab owns this webContents
  const senderTab = tabs.find((t) => t.view && t.view.webContents && t.view.webContents.id === event.sender.id);
  if (senderTab) {
    closeTab(senderTab.id);
  }
});

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

// Helper to extract base domain (e.g., darkorbit.com from tr5.darkorbit.com)
const getBaseDomain = (origin) => {
  try {
    const url = new URL(origin);
    const parts = url.hostname.split('.');
    // If has subdomain, use last 2 parts (domain.tld)
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return url.hostname;
  } catch (err) {
    return origin;
  }
};

ipcMain.handle("credentials:list", (_e, origin) => {
  if (!origin) return [];
  const baseDomain = getBaseDomain(origin);
  const store = readCredentials();
  const list = store[baseDomain];
  return Array.isArray(list) ? list : [];
});
ipcMain.handle("credentials:save", (_e, origin, payload) => {
  if (!origin || !payload) return false;
  const username = (payload.username || "").trim();
  const password = payload.password || "";
  if (!username || !password) return false;
  const baseDomain = getBaseDomain(origin);
  const store = readCredentials();
  if (!Array.isArray(store[baseDomain])) {
    store[baseDomain] = [];
  }
  const existing = store[baseDomain].findIndex((c) => c.username === username);
  const cred = {
    username,
    password,
    updatedAt: Date.now(),
  };
  if (existing !== -1) {
    store[baseDomain][existing] = cred;
  } else {
    store[baseDomain].unshift(cred);
  }
  writeCredentials(store);
  return true;
});
ipcMain.handle("credentials:reorder", (_e, origin, usernames) => {
  if (!origin || !Array.isArray(usernames)) return false;
  const baseDomain = getBaseDomain(origin);
  const store = readCredentials();
  const list = store[baseDomain];
  if (!Array.isArray(list)) return false;
  const rank = new Map(usernames.map((name, index) => [name, index]));
  // Accounts missing from the new order (e.g. added meanwhile) keep their place at the end.
  store[baseDomain] = list
    .map((cred, index) => ({ cred, key: rank.has(cred.username) ? rank.get(cred.username) : usernames.length + index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.cred);
  writeCredentials(store);
  return true;
});
ipcMain.handle("credentials:delete", (_e, origin, username) => {
  if (!origin || !username) return false;
  const baseDomain = getBaseDomain(origin);
  const store = readCredentials();
  if (Array.isArray(store[baseDomain])) {
    store[baseDomain] = store[baseDomain].filter((c) => c.username !== username);
    if (!store[baseDomain].length) {
      delete store[baseDomain];
    }
  }
  writeCredentials(store);
  return true;
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
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["OK", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: app.getName(),
    message: message || "",
    detail: detail || undefined,
  });
  return response === 0;
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
    chromeHeight = Math.max(height, MIN_CHROME_HEIGHT);
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
ipcMain.on("settings:update", (_event, newSettings) => {
  const previousUA = JSON.stringify([settings.useCustomUA, settings.customUserAgent]);
  settings = Object.assign(settings || {}, newSettings || {});
  const uaChanged = previousUA !== JSON.stringify([settings.useCustomUA, settings.customUserAgent]);

  // Only a user agent change needs a reload; never kick the player out of the
  // game for renaming the client or switching the theme.
  if (uaChanged) {
    tabs.forEach((tab) => {
      if (!tab.view || !tab.view.webContents) return;
      try {
        tab.view.webContents.setUserAgent(pickUserAgent(tab.url || ""));
      } catch (_err) {}
      tab.view.webContents.reload();
    });
  }

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save settings:", err);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings:updated", settings);
    if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send("settings:updated", settings);
  }
});

// Page preload needs the settings before the page starts building its DOM.
ipcMain.on("settings:get-sync", (event) => {
  event.returnValue = settings;
});

ipcMain.handle("app:version", () => app.getVersion());

// ---------- automatic updates ----------
// Checks GitHub Releases, downloads a new version in the background and installs it
// when the client is closed. It never restarts by itself (the player may be mid-fight);
// the UI offers a "restart to update" button instead.
const UPDATE_CHECK_DELAY_MS = 15 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateState = { state: "idle" };
let autoUpdater = null;

const sendUpdateState = () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:state", updateState);
};

const setUpdateState = (next) => {
  updateState = next;
  sendUpdateState();
};

const setupAutoUpdater = () => {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("Auto update unavailable:", err && err.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.on("update-available", (info) => setUpdateState({ state: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent || 0);
    if (percent === updateState.percent) return;
    setUpdateState({ state: "downloading", version: updateState.version, percent });
  });
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ state: "ready", version: info.version }));
  autoUpdater.on("error", (err) => {
    console.warn("Update check failed:", err && err.message);
    if (updateState.state === "downloading") setUpdateState({ state: "idle" });
  });
  const check = () => {
    if (updateState.state !== "idle") return;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, UPDATE_CHECK_DELAY_MS);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
};

ipcMain.handle("update:state", () => updateState);
ipcMain.handle("update:install", () => {
  if (!autoUpdater || updateState.state !== "ready") return false;
  // Silent install, then start the client again on the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

ipcMain.handle("settings:get", () => {
  return settings;
});

ipcMain.on("app:restart", () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on("ranks:list", (event) => {
  const ranksDir = path.join(__dirname, "ranks");
  try {
    const ranks = fs
      .readdirSync(ranksDir)
      .filter((f) => /^rank_\d+\.png$/.test(f))
      .map((f) => f.replace("rank_", "").replace(".png", ""))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    event.reply("ranks:list", ranks);
  } catch (_err) {
    event.reply("ranks:list", []);
  }
});

// Right-click menu for web pages, in the usual browser order. Flash keeps its own menu.
const buildContextMenu = (wc, params) => {
  const { clipboard } = require("electron");
  const groups = [];
  if (params.linkURL) {
    groups.push([
      { label: "Open link in new tab", click: () => createTab(params.linkURL, true) },
      { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
    ]);
  }
  if (params.mediaType === "image" && params.srcURL) {
    groups.push([
      { label: "Open image in new tab", click: () => createTab(params.srcURL, true) },
      { label: "Save image as...", click: () => wc.downloadURL(params.srcURL) },
      { label: "Copy image", click: () => wc.copyImageAt(params.x, params.y) },
      { label: "Copy image address", click: () => clipboard.writeText(params.srcURL) },
    ]);
  }
  const selection = (params.selectionText || "").trim();
  if (params.isEditable) {
    const flags = params.editFlags || {};
    groups.push([
      { label: "Undo", role: "undo", enabled: !!flags.canUndo },
      { label: "Redo", role: "redo", enabled: !!flags.canRedo },
    ]);
    groups.push([
      { label: "Cut", role: "cut", enabled: !!flags.canCut },
      { label: "Copy", role: "copy", enabled: !!flags.canCopy },
      { label: "Paste", role: "paste", enabled: !!flags.canPaste },
      { label: "Select all", role: "selectAll" },
    ]);
  } else if (selection) {
    groups.push([{ label: "Copy", role: "copy" }]);
  }
  if (!params.linkURL && !params.isEditable && !selection && params.mediaType !== "image") {
    groups.push([
      { label: "Back", enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: "Forward", enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: "Reload", click: () => wc.reload() },
    ]);
  }
  groups.push([
    { label: "View page source", click: () => createTab(`view-source:${wc.getURL()}`, true) },
    { label: "Inspect", click: () => wc.inspectElement(params.x, params.y) },
  ]);
  if (selection) {
    const short = selection.length > 30 ? `${selection.slice(0, 30)}...` : selection;
    groups.push([
      {
        label: `Search Google for "${short.replace(/&/g, "&&")}"`,
        click: () => createTab(`https://www.google.com/search?q=${encodeURIComponent(selection)}`, true),
      },
    ]);
  }
  return groups.flatMap((group, index) => (index ? [{ type: "separator" }, ...group] : group));
};

app.on("ready", () => {
  createMainWindow();
  createTab(DEFAULT_URL, true);
  startPerfMonitor();
  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

