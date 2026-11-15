# Alternative Darkorbit Client 2.2
An Electron-based game client developed for DarkOrbit. This repository contains the application’s source code, user interface, and configuration files.

---

## ⬇️ Download

[![Download the latest release](https://img.shields.io/github/v/release/emirhangokay/Alternative-Darkorbit-Client?label=Download&style=for-the-badge&color=4DB8FF)](https://github.com/emirhangokay/Alternative-Darkorbit-Client/releases/latest)

Get **`Alternative Darkorbit Client`** from the [latest release](https://github.com/emirhangokay/Alternative-Darkorbit-Client/releases/latest) (Windows 10/11, 64-bit). Installing a new version over an old one keeps your settings and saved accounts.

From 2.2.0 on the client updates itself: it downloads a new version in the background and installs it when you close the client, keeping your settings and saved accounts. When an update is ready, an **Update to x.y.z** button appears next to the window buttons if you want to restart right away. (Coming from 2.1.0 or older? Install 2.2.0 by hand once.)

---

## ✨ Features

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.


- Tabs in the title bar, a toolbar you can hide, dark and light themes
- Settings and saved accounts slide in over the game while it keeps running; drag saved accounts to reorder them
- Your own client name and icon: upload any picture (it is cropped and shrunk for you) or pick a rank icon
- Flash performance boost:
  - forces GPU rendering and gives Flash a hardware `wmode` on pages that do not ask for one
  - keeps the game at full speed when the window is in the background
  - raises the priority of the Flash, GPU and active tab processes
  - opts the client out of Windows background throttling
  - optional Flash render quality override
- Flash memory watchdog: live indicator of how much memory Flash has piled up, one-click Flash restart, automatic refresh above the limit that waits until you are away from the game, automatic recovery if Flash crashes; on computers short on RAM it hands Flash's unused memory back to Windows without reloading the game
- Performance log (`performance-log.csv` in the profile folder, also under More → Show performance log) for finding out why a session got slow

---

## 📦 Install

1. Download the installer from the [latest release](https://github.com/emirhangokay/Alternative-Darkorbit-Client/releases/latest) and run it. If Windows shows an "unknown publisher" warning, choose **More info → Run anyway**. Follow the steps: accept the license, choose whether to install for yourself or for everyone on the computer, pick the folder. It creates a desktop and Start menu shortcut and can start the client when it finishes.
2. Log in to DarkOrbit as usual.

Recommended settings (⚙️ in the toolbar):

- **Flash performance boost**: on
- **Memory limit**: 1400 MB
- **Refresh Flash while I’m away**: on

Why the last one matters: DarkOrbit’s Flash client piles up memory while it runs and, after roughly half an hour, starts to stutter. Only reloading the game clears that. The client does it for you when Flash is over the limit and you have switched to another window for 20 seconds or left mouse and keyboard alone for 90 seconds. You can also press **Ctrl+Shift+R** at a safe moment.

If a session still gets slow, open ⋮ → **Show performance log** and keep the file; it records Flash’s memory and CPU every few seconds.

---

## 🚢 Publishing a release

1. Raise `version` in `package.json` and add the notes to `CHANGELOG.md`.
2. Run `npm run dist`.
3. Create a GitHub release tagged `v<version>` and upload **all three** files from `dist/`:
   - `Alternative-Darkorbit-Client-Setup-<version>.exe`
   - `Alternative-Darkorbit-Client-Setup-<version>.exe.blockmap`
   - `latest.yml`

`latest.yml` is what installed clients read to find the update; without it nobody gets updated. Installs made "for all users" (in Program Files) show a Windows admin prompt when the update installs; "only for me" installs update silently.

---

## 🚀 Quick Start (development)

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
| Refresh Flash (frees its memory, the game reloads) | Ctrl/Cmd + Shift + R |

---

## 📄 License

MIT, see [LICENSE](LICENSE). This covers the client's own code; the bundled Flash Player plugin belongs to Adobe. DarkOrbit is a trademark of Bigpoint GmbH; this project is not affiliated with Bigpoint.
