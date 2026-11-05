# AquaMate 💧

A small desktop prototype of a 3D hydration buddy for **Windows and macOS**.
Click **Test Reminder** and a 3D character walks onto your desktop from the
bottom-right corner, waves, and reminds you to drink water. He cheers when you
say you drank some, then walks off again.

Built with Electron, React, TypeScript, three.js and React Three Fiber.

| Reminder | "I Drank Water" | Walking away |
| --- | --- | --- |
| ![Reminder card](docs/reminder.png) | ![Happy animation](docs/happy.png) | ![Walking away](docs/walking-away.png) |

<sub>These screenshots come from the automated test, which runs on Linux. On
Windows and macOS the white area is transparent and your desktop shows through.</sub>

## Quick start

You need Node.js 22 or newer (20.19+ also works). Step-by-step Mac
instructions are in [Try it on a Mac](#try-it-on-a-mac).

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts Vite with hot reload and opens the app. To run the
production build locally instead:

```bash
npm start
```

A small **AquaMate** control panel opens. Click **Test Reminder**:

1. The transparent overlay appears in the bottom-right corner of the screen
   you're using.
2. The character walks in from the right edge, stops and waves.
3. A card says **"Hey! Time to drink some water 💧"** with two buttons:
   - **I Drank Water**: he plays the Happy animation, the card says
     **"Great job! Stay hydrated."**, and after about 2.4 s he walks away and
     the overlay hides.
   - **Dismiss**: he walks away and the overlay hides.

Closing the control panel quits the app.

## Try it on a Mac

### 1. Install the tools (one time)

- **Node.js:** download the **LTS** installer from https://nodejs.org and run it.
- **Git:** run `git --version` in Terminal. If Git isn't installed, macOS offers
  to install the Command Line Tools; click **Install**. If you'd rather skip
  Git, use the ZIP download in step 2.

Check that Node works:

```bash
node -v
```

### 2. Get the code

```bash
git clone https://github.com/tumatikiran/waterintake.git
```

```bash
cd waterintake
```

No Git? Download https://github.com/tumatikiran/waterintake/archive/refs/heads/main.zip,
double-click it to unzip, then `cd` into the `waterintake-main` folder in Terminal.

### 3. Test it without installing anything

```bash
npm install
```

```bash
npm start
```

The **AquaMate** control panel opens. Click **Test Reminder** and watch the
bottom-right corner of your screen, just above the Dock. While you run it this
way, the menu bar says "Electron"; the installed app from step 4 says
"AquaMate". Both use Electron's default icon until a custom one is added. Quit
by closing the control panel or pressing **⌘Q**.

You can also run the automated test. It runs the whole flow twice on your
screen, which takes under a minute:

```bash
npm test
```

### 4. Build and install the app

```bash
npm run dist:mac
```

This creates a DMG for your Mac's chip in the `release/` folder:

- `AquaMate-0.1.0-arm64.dmg` on Apple Silicon (M1 and newer)
- `AquaMate-0.1.0-x64.dmg` on Intel Macs

Open the DMG, drag **AquaMate** into **Applications**, then open it from
Launchpad or the Applications folder.

The app is ad-hoc signed, not signed with an Apple Developer ID. A DMG you
build on your own Mac opens normally. If you copy it to another Mac or
download it, macOS says it can't verify the app. To open it anyway:

1. Try to open AquaMate once and close the warning.
2. Go to **System Settings → Privacy & Security**.
3. Scroll down, click **Open Anyway** next to the AquaMate message, and confirm.

To uninstall, quit AquaMate and drag it from **Applications** to the Trash.

## Building installers

```bash
npm run dist:win
```

Run this on Windows. It writes an NSIS installer to `release/AquaMate-Setup-0.1.0.exe`.

```bash
npm run dist:mac
```

Run this on macOS. It writes a `.dmg` for the Mac you're building on to
`release/`, for example `AquaMate-0.1.0-arm64.dmg`. To build both Intel and
Apple Silicon DMGs:

```bash
npm run dist:mac -- --x64 --arm64
```

Build each installer on its own OS: electron-builder can't make a macOS DMG from
Windows, and needs extra tools to make a Windows installer from macOS or Linux.
Neither installer is signed with a developer certificate:

- On Windows, SmartScreen may say "Windows protected your PC". Click
  **More info → Run anyway**.
- On macOS, the app is ad-hoc signed (`"identity": "-"` in `package.json`) so it
  runs on Apple Silicon. A copy downloaded from elsewhere needs
  **System Settings → Privacy & Security → Open Anyway** the first time.

For real distribution, sign with a Developer ID: replace `"identity": "-"` with
your certificate name, turn `hardenedRuntime` back on and set up notarization.
To add custom app icons, put `icon.icns` and `icon.ico` in a `build/` folder.

## Tests

`npm test` builds the app, launches the real Electron app with Playwright and
runs the whole reminder flow twice: once with **I Drank Water** and once with
**Dismiss**. It checks that:

- the overlay is hidden at start, then becomes visible, always on top, and
  anchored to the bottom-right of the work area
- the character moves left while the Walk clip plays, stops exactly at the
  designated position, and plays Wave, then Idle
- **I Drank Water** plays Happy, shows "Great job! Stay hydrated.", waits
  briefly, then walks right while the Walk clip plays, and hides the window
- **Dismiss** walks away and hides the window
- the control panel status updates, and no renderer errors are logged

Screenshots are saved to `test-results/`.

```bash
npm test
```

On a headless Linux machine or CI, run it under a virtual display:

```bash
xvfb-run -a npm test
```

## Project structure

```
src/
  main/
    main.ts              app lifecycle, app:// protocol, IPC
    window-manager.ts    control panel + transparent mascot overlay
    preload.ts           safe IPC bridge (contextIsolation + sandbox)
  renderer/
    App.tsx              view switch, reminder state machine, control panel
    Mascot.tsx           GLB loading, walk in/out movement, facing
    ReminderCard.tsx     floating speech-bubble card
    AnimationController.ts  AnimationMixer wrapper (cross-fades, one-shots, clip aliases)
    styles.css           card, button and panel styles + CSS animations
    index.html, main.tsx, env.d.ts
assets/
  models/
    human-character.glb  placeholder rigged character (see assets/models/README.md)
scripts/
  dev.mjs                         dev runner (tsc + Vite + Electron)
  generate-placeholder-model.mjs  builds the placeholder GLB
tests/
  e2e.mjs                         Playwright end-to-end test
```

## How it works

**Smooth movement without flicker.** The overlay is a fixed 720 × 440
transparent window anchored to the bottom-right of the work area, so it sits
above the taskbar or Dock. It is positioned once, while it is still hidden, and
never moves while it is visible. The character walks *inside* it. This avoids the
jitter and tearing you get from calling `setBounds()` on every frame, which is
especially noticeable on Windows.

**Showing and hiding.** The renderer resets the character off-stage first and
only then asks the main process to show the window, which uses `showInactive()`
so it never steals focus. After the exit, it waits for an empty frame to be
painted before hiding the window. A stale frame can't flash on the next show.

**Synced animation.** Movement is advanced in `useFrame` using the frame
delta. Ground speed is `WALK_STRIDE_SPEED × timeScale` of the Walk clip, so the
feet match the stride. The delta is capped, so a stalled frame never teleports
the character. Turning is smoothed with exponential damping.

**Click-through.** On Windows and macOS the overlay ignores the mouse
(`setIgnoreMouseEvents(true)`) except while the cursor is over the card. Your
desktop stays usable even when the character is on screen. The renderer tells
the main process where the card is, and the main process checks the cursor
position every 40 ms while the card is visible. This works even though the
overlay never takes focus, which mouse-move forwarding doesn't reliably do on
macOS. On macOS, `acceptFirstMouse` makes the first click press the button
instead of only focusing the window.

**Always on top.** The overlay uses the `screen-saver` level, is visible on all
workspaces, skips the taskbar and has no shadow. On macOS, AquaMate keeps its
Dock icon and menu bar (`skipTransformProcessType`).

**Lightweight.**
- The renderer is a single Vite bundle, with no runtime `node_modules` in the
  installer.
- The model is about 0.5 MB.
- WebGL uses the `low-power` GPU preference, and Chromium throttles the
  overlay while it is hidden.

**Resilient.** If WebGL isn't available or the model fails to load, the
reminder still works with the card only.

**Secure defaults.**
- `contextIsolation`, `sandbox` and no `nodeIntegration` are on.
- A strict CSP is set on the packaged renderer.
- Navigation and `window.open` are blocked.
- Packaged files are served from a custom `app://` protocol with a
  path-traversal guard.

## The 3D character

> ⚠️ **Missing production asset.** No suitably licensed GLB of a stylized man
> in a blue-and-white outfit with Idle, Walk, Wave and Happy clips was
> available, so `assets/models/human-character.glb` is a **replaceable
> placeholder**.

The placeholder is a real rigged model: an 18-bone skeleton, skinned meshes and
four clips. It is generated by `scripts/generate-placeholder-model.mjs`. You
can swap in a production model without code changes: the loader rescales and
grounds any model, and the animation controller maps common clip names such as
`Walking`, `Cheering` and `mixamo.com|Wave`. The full asset spec and the
replacement steps are in [`assets/models/README.md`](assets/models/README.md).

## Scope and known limitations

This is a prototype. It only shows a reminder when you click **Test Reminder**:
there is no scheduler, history, settings, database, accounts, analytics or
backend.

- The automated test runs on Linux with software WebGL. The Windows (NSIS) and
  macOS (DMG) build settings are included, but the installers haven't been built
  or tested on real Windows or macOS machines yet.
- On macOS, the overlay may not appear on top of apps in full-screen mode. Doing
  that reliably would mean hiding AquaMate's Dock icon.
- On Linux, click-through is off, so the whole overlay area stays clickable
  while it is visible.
- The installers aren't signed with a developer certificate (see
  [Building installers](#building-installers)).

## License and credits

MIT, see [LICENSE](LICENSE). Some desktop-window techniques are adapted from
[sharada-dev/hydrate-buddy](https://github.com/sharada-dev/hydrate-buddy)
(MIT). Its license and a list of what was reused are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
