# Changelog

## 2.6.3

### Changes
- **Simplified Flash memory watchdog:** Removed the manual Memory limit and **Refresh Flash while I'm away** toggles from Settings. The top bar now warns once Flash passes **2300 MB** so you can refresh with **Ctrl+Shift+R** without interrupting active play.
- **AFK-only auto-refresh:** Flash only resets automatically when it stays over **2300 MB** for **90 seconds** while you are AFK (90 seconds without mouse or keyboard input); switching to another window or monitor no longer triggers a reload.
- **Remember logins enabled by default:** Saving login credentials is now turned on out of the box on new installs.

## 2.6.2

### Fixes
- Tab groups no longer show account names left over from an earlier run. A group shows an account name only after you log in with it, or open a saved account in its own tab; until then it is labelled "Account N".

## 2.6.1

### What's new
- **Tab groups, one per account:** tabs are grouped by session. Each group has a coloured label with its account name, and its tabs always sit next to each other, so two accounts that both started the game make two tidy groups of two tabs.
- **The game opens in a new tab again**, inside the same group as the page that opened it (same login, same Flash).
- Click a group's label for **New tab in this group** or **Close group**. Dragging a tab only moves it within its own group.
- Closing a background tab keeps you on the tab you are looking at; closing the current tab moves to another tab of the same group.

## 2.6.0

### What's new
- **Open an account in its own tab:** every saved account has a new-tab button in Accounts. It opens the site in a session of its own and logs in by itself. An account you used before goes back to its old session, which is usually still logged in.
- **Account names on tabs:** a tab shows the account its session logged in with, so you can tell your accounts apart at a glance.
- **The game you look at goes first:** with several games open, the one in the current tab gets the CPU first; games in other tabs give way when the CPU is busy and keep running.
- **Game map opens in the same tab:** DarkOrbit's Start button no longer leaves the start page behind in an extra tab.
- Accounts list: edit and delete are icon buttons now, so long names fit.

## 2.5.0

### What's new
- **Every tab has its own Flash:** each new tab runs in its own session, with its own login and its own Flash. The memory indicator shows only the game in the tab you are looking at, and refreshing Flash (button, Ctrl+Shift+R or the automatic refresh) reloads only that game; games in other tabs keep running.
- **Several accounts at once:** because each tab keeps its own login, you can be logged in with a different account in every tab. Logins are remembered per tab number, shown as a small badge on the tab when more than one session is open.
- Pages a game opens itself (pop-ups) and "Open link in new tab" stay in the same session as the page they came from.

### Good to know
- A new tab starts logged out; log in once and that tab number remembers it.
- ⋮ → Clear cookies now logs out every session.

## 2.4.1

### Fixed
- **Flash quality really stays on Low:** DarkOrbit switched Flash back to High once the game had loaded. The client now checks the quality a few times during the first minutes after a page loads and sets it back to the one in ⚙️ → Flash render quality, without the right-click menu ever appearing.

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
