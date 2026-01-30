# Alternative Darkorbit Browser
An Electron-based game client developed for DarkOrbit. This repository contains the application’s source code, user interface, and configuration files.

---

## 🚀 Quick Start

Requirements:

- Node.js 12+ (LTS recommended)
- npm (or yarn)

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
| Back | Alt + ← |
| Forward | Alt + → |
| Zoom in | Ctrl/Cmd + + (Ctrl+= or Ctrl+Plus) |
| Zoom out | Ctrl/Cmd + - (Ctrl+- or Ctrl+Minus) |
| Reset zoom | Ctrl/Cmd + 0 |
| Next tab | Ctrl/Cmd + Tab |
| Previous tab | Ctrl/Cmd + Shift + Tab |
| Toggle fullscreen | F11 |

## 📁 Project Structure (at a glance)

- `index.js` — Electron main process and IPC handlers
- `tabs.html` — Renderer UI (includes Settings modal)
- `ranks/` — Rank icons (`rank_1.png`, `rank_2.png`, ...)
- `dist/`, `win-unpacked/` — Build outputs; these should NOT be tracked in git

---

## ✅ Recent Fixes

- Fixed the Settings > **Rank Icon** preview showing as a black square. (See `tabs.html`, function `updateRankPreview`)
- Fixed cropping for irregularly sized rank images (e.g. `rank_21.png`) by ensuring previews and the header logo use `background-size: contain; background-repeat: no-repeat;` so full icons display regardless of image canvas size. (Files changed: `tabs.html` — `updateRankPreview` and `updateLogo`)
- Added: Custom User Agent option in Settings. You can enable a custom user agent and provide the UA string; this will be applied to all tabs (DarkOrbit detection still takes precedence for a specialized UA). (Files changed: `tabs.html`, `index.js`)

How to verify:
1. Start the app (`npm start`).
2. Open Settings:
   - To verify rank behavior: go to **Rank Icon** and select a rank (try the one previously cropped).
   - To verify User Agent: enable **Custom User Agent**, enter a value (e.g. `MyCustomUA/1.0`) and save. Open a new tab or reload existing tabs — the web views will use the provided User Agent. (For DarkOrbit pages, the client will still use the specialized `BigpointClient/1.7.2` user agent.)
3. Confirm previews, header logo, and UA behavior accordingly.

---
