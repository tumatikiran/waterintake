# Third-party notices

## hydrate-buddy

AquaMate adapts a few desktop-window techniques from
[sharada-dev/hydrate-buddy](https://github.com/sharada-dev/hydrate-buddy):

- the transparent overlay window options (frameless, transparent background,
  no shadow, skip taskbar, `alwaysOnTop` at the `screen-saver` level, visible
  on all workspaces)
- anchoring the overlay to the bottom of the display's work area
- showing the overlay with `showInactive()` so it never steals keyboard focus
- checking the wall clock on short ticks (instead of one long timer) so
  reminders survive sleep and wake, and re-checking on resume/unlock
- a tray menu with "remind now", pause and start-at-login items
- the single-instance lock, the `contextBridge` preload pattern and the NSIS
  installer options

No sprites, art or settings code from hydrate-buddy is included.
The code was rewritten in TypeScript for this prototype. The original license:

```
MIT License

Copyright (c) 2026 sharada-dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime libraries

Electron, React, three.js and React Three Fiber are MIT-licensed and are
bundled by Vite and electron-builder under their own license files.
