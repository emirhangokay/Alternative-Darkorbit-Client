# Alternative Darkorbit Browser
An Electron-based game client developed for DarkOrbit. This repository contains the application’s source code, user interface, and configuration files.

---

## ✨ Features

- Tabs in the title bar, a toolbar you can hide, dark and light themes
- Settings and saved accounts open in a side panel while the game keeps running
- Your own client name and icon: upload any picture (it is cropped and shrunk for you) or pick a rank icon
- Flash performance boost:
  - forces GPU rendering and gives Flash a hardware `wmode` on pages that do not ask for one
  - keeps the game at full speed when the window is in the background
  - raises the priority of the Flash, GPU and active tab processes
  - opts the client out of Windows background throttling
  - optional Flash render quality override
- Flash memory watchdog: live indicator of how much memory Flash has piled up, one-click Flash restart, optional automatic restart that only fires while you are idle, automatic recovery if Flash crashes; on computers short on RAM it hands Flash's unused memory back to Windows without reloading the game
- Performance log (`performance-log.csv` in the profile folder, also under More → Show performance log) for finding out why a session got slow

---

## 🚀 Quick Start

Requirements:

- Windows 10/11, 64-bit
- Node.js 12+ (LTS recommended)
- npm (or yarn)

> Electron is pinned to **11.5.0** on purpose. It is the last Electron release that can load the Flash plugin; newer versions start but show no game.

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm start
```

Build distributable packages (electron-builder):

```bash
npm run dist
```

---

## ⌨️ Keyboard Shortcuts

Here are the main keyboard shortcuts used in the client (Windows/Linux: Ctrl, macOS: ⌘):

| Action | Shortcut |
|---|---|
| New tab | Ctrl/Cmd + T |
| Close tab | Ctrl/Cmd + W |
| Reload | Ctrl/Cmd + R |
| Find in page | Ctrl/Cmd + F |
| Focus address bar | Ctrl/Cmd + L |
| Zoom in | Ctrl/Cmd + + (Ctrl+= or Ctrl+Plus) |
| Zoom out | Ctrl/Cmd + - (Ctrl+- or Ctrl+Minus) |
| Reset zoom | Ctrl/Cmd + 0 |
| Next tab | Ctrl/Cmd + Tab |
| Previous tab | Ctrl/Cmd + Shift + Tab |
| Toggle fullscreen | F11 |
