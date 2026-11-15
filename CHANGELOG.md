# Changelog

## 2.4.0

### What's new
- **Flash starts in Low quality:** the quality you see in Flash's right-click menu now starts on Low instead of High, so every frame is cheaper to draw. Change it any time in ⚙️ → Flash render quality (Low, Medium, High, or let the game decide).

## 2.3.0

### What's new
- **Updates ask first:** when a new version is out, the client shows a pop-up when it starts. **Update now** downloads and installs it, then reopens the client. **Later** changes nothing: nothing is downloaded or installed, and an **Update x.y.z available** button stays at the top for when you are ready.
- **Check for updates** in the ⋮ menu.

## 2.2.0

### Installation
Download and run `Alternative-Darkorbit-Client-Setup-2.2.0.exe` once. Your settings and saved accounts are kept. This is the last version you install by hand: from now on the client updates itself.

### What's new
- **Automatic updates:** the client checks for new versions, downloads them in the background and installs them when you close it. It never restarts by itself while you play; an **Update to x.y.z** button lets you restart right away.

## 2.1.0

### Installation
Download and run `Alternative Darkorbit Client Setup 2.1.0.exe`. It updates an existing installation; your settings and saved accounts are kept.

### What's new
- **Saved accounts:** the list scrolls when you have many accounts, and the add-account form stays in view.
- **Reorder accounts:** drag an account by its handle (⠿) to move it up or down. The order is saved.
- **Sliding panels:** Settings and Accounts slide in smoothly on top of the game. The game is no longer pushed aside or resized.
- **Right-click menu:** standard browser order, no icons. "Search Google for" sits at the bottom, appears only when text is selected and opens in a new tab.

## 2.0.0

### Installation
Download and run `Alternative Darkorbit Client Setup 2.0.0.exe`. Accept the license, choose the install type and folder. A desktop shortcut is created automatically.

If Windows shows an "unknown publisher" warning: **More info → Run anyway**.

### What's new
- **New interface:** tabs in the title bar, a toolbar you can hide, dark and light themes. Settings and accounts open next to the game, so the game keeps running.
- **Your own icon:** upload a picture or pick a rank icon.
- **Flash performance:** GPU rendering, full speed in the background, higher priority for Flash, pinned to the fast CPU cores, Flash quality setting.
- **Stutter protection:** once Flash's memory passes the limit, the game refreshes itself while you are in another window or idle for 90 seconds, never while you play. Press **Ctrl+Shift+R** to refresh at any time.
- **Memory indicator** and **performance log** (⋮ → Show performance log).
- One-click login with a saved account.
- Step-by-step installer with license page, install folder choice, desktop and Start menu shortcuts.

### Recommended settings (⚙️)
- Flash performance boost: on
- Memory limit: 1400 MB
- Refresh Flash while I'm away: on

### Under the hood
- Electron pinned to 11.5.0, the last release that can load the Flash plugin.
- MIT license for the client's own code.

## 1.0.0
- First release.
