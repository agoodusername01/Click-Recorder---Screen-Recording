# Click Recorder - Screen Recording

An open-source, cross-platform desktop app that watches you click through a
process — in *any* application, not just the browser — and turns it into an
editable, exportable Standard Operating Procedure (SOP) document. Think
"Scribe, but self-hosted and yours to modify."

- 🖱️ Records clicks system-wide and auto-captures a screenshot for each one, with a movable/removable click marker
- 🏠 A home screen lists every SOP you've started, grouped into folders, so you can leave one half-finished and pick it back up later
- ⏸️ A short countdown before recording starts, plus Pause/Resume so an off-script click doesn't need cleanup afterward
- 🏷️ Step titles are auto-suggested from the active window's title bar when available
- 📑 Add section headers to organize a long SOP, with a clickable sidebar timeline to jump between them
- ✋ Drag-and-drop (or Move Up/Down) to reorder steps and headers; add a step manually with no screenshot if you just want to write instructions by hand
- 🖼️ A built-in image editor per step: draw, add shape callouts, blur/redact sensitive info, crop, or replace/remove the screenshot entirely
- 🔍 Zoom in on any screenshot in place, without cropping the underlying file
- 📄 Export to PDF, Word (.docx), or a single self-contained HTML file with a built-in checklist mode (checkboxes with progress saved in the browser)
- 📥 Import an existing Word document and it becomes an editable step list
- 🖥️ Runs on macOS, Windows, and Linux (Electron), and captures the correct monitor in multi-monitor setups
- 🔓 MIT licensed, contributions welcome

## Why a desktop app, not a website?

Capturing clicks and screenshots across arbitrary desktop applications
requires OS-level accessibility and screen-recording permissions that a
browser tab is deliberately not allowed to have. There's no way around that
in-browser — so this is a small, local, installable app instead. Nothing is
uploaded anywhere; everything (screenshots, sessions, exports) stays on your
disk unless you choose to share the exported file.

## Installation

### Option A — for developers (any OS)

Requires [Node.js](https://nodejs.org) (LTS version).

```bash
git clone <your-fork-url>
cd click-recorder
npm install
npm start
```

`npm test` runs the headless export/import/display-mapping smoke tests.

### Option B — Windows, without using a terminal

If you're not comfortable with the command line, this gets you a normal
double-click-to-launch app:

1. **Download the code.** On this repo's GitHub page, click the green **Code**
   button → **Download ZIP**.
2. **Unblock the zip before extracting it.** Windows tags anything
   downloaded from the internet, which triggers a security warning later.
   Right-click the downloaded `.zip` → **Properties** → check **Unblock** at
   the bottom → **OK**. *Then* extract it (right-click → **Extract All**).
3. **Install [Node.js](https://nodejs.org)** if you don't already have it
   (the LTS installer is fine — just click through it).
4. **Double-click `Create Desktop Shortcut.vbs`** inside the extracted
   folder, once. This adds a **Click Recorder** icon to your Desktop — it
   doesn't launch the app itself yet.
5. **Double-click the new Desktop icon.** The first launch will take a
   minute or two to install dependencies (you'll see a black window with
   text scrolling by — that's normal); every launch after that is instant.

If Windows shows a blue **"Windows protected your PC"** or a **"This file
does not have a valid digital signature"** warning the first time it runs:
that's normal for any small, independently-built app that hasn't paid for a
commercial code-signing certificate — it isn't a sign anything is wrong.
Click **More info → Run anyway**.

If you'd rather skip the shortcut script and just run it directly, you can
also double-click `run.bat` any time (it does the same install-then-launch,
just without creating a Desktop icon first).

### macOS / Linux

Follow **Option A** above. On macOS, the first time you hit **Start
Recording** you'll be prompted to grant **Accessibility** and **Screen
Recording** permissions (System Settings → Privacy & Security) — this is
required for the app to see clicks and capture your screen system-wide. On
Linux, this works out of the box on X11; Wayland desktops have tighter
global-input restrictions and are a known rough edge (see
[ROADMAP.md](ROADMAP.md)).

## Using it

1. From the **home screen**, click **+ New SOP** (or open one you've already
   started).
2. Click **Start Recording** — after a short countdown, click through the
   process you want to document, in any app. Use **Pause** if you need to
   step away or click around without it being captured.
3. Click **Stop Recording**. Each click becomes a step with a screenshot and
   a red click marker — auto-titled from the active window where possible.
4. Organize as needed: drag steps/headers to reorder, use the **+** between
   cards to insert a section header or a manual (screenshot-free) step,
   and edit any step's title/description directly.
5. Per step, use **🖊 Edit Image** to draw, add shape callouts, blur out
   sensitive info, crop, or move/delete the click marker; **🔄 Replace
   Image** / **🗑 Remove Screenshot** to swap in a different screenshot or
   drop it entirely.
6. **Export ▾** to PDF, Word, or HTML (the HTML export includes a
   checklist someone following the SOP can check off, with progress saved
   in their browser). **Import ▾** on the home screen turns an existing
   Word doc into a new, editable SOP.

## Project structure

```
src/
  main.js                    Electron main process, window + IPC wiring, session/folder persistence
  preload.js                 Safe IPC bridge exposed to the renderer as window.sop
  recorder.js                Global click hook, pause/resume, screenshot capture, auto-titling
  displayMap.js               Multi-monitor mapping: matches displays to captures, resolves clicks to a monitor
  markerOverlay.js             Composites the click marker onto a screenshot at export time only
  exporter/
    pdfExporter.js            Step list -> PDF (pdfkit)
    docxExporter.js            Step list -> Word document (docx)
    htmlExporter.js             Step list -> single self-contained HTML file with sidebar timeline + checklist mode
  importer/
    docxImporter.js             Word document -> editable step list (mammoth + node-html-parser)
  renderer/
    index.html / styles.css / renderer.js   The UI (home screen, editor, image editor)
test/
  export-import.test.js      Headless smoke test for export/import (no Electron/display needed)
  displayMap.test.js          Multi-monitor mapping logic tests
```

## Multi-monitor support

Each click is captured from the monitor it actually happened on, not just
the primary display. This works by pairing up two libraries that don't
know about each other: Electron's `screen` module (which knows each
monitor's position/size but can't take screenshots) and
`screenshot-desktop` (which can screenshot a single monitor by id, but
doesn't expose position/size). At the start of each recording session,
`src/displayMap.js` captures every monitor once and matches each capture
to the Electron display with the closest physical pixel dimensions,
building a lookup table used for the rest of that session — so a normal
recording only ever screenshots the one monitor a click lands on.

**Known limitation:** click coordinates are converted to physical pixels
using the *primary* monitor's scale factor. This is exact when all your
monitors share one scale factor (the common case). With **mixed-DPI**
monitors, the click marker can land a few pixels off near a secondary
display's edges — screenshots are still taken from the correct monitor
either way. See [ROADMAP.md](ROADMAP.md).

## How it works

- **Capture**: [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) provides a cross-platform native hook for global mouse events. On each click, [`screenshot-desktop`](https://github.com/bencevans/screenshot-desktop) grabs a full-screen image of the correct monitor; the click marker is kept as separate metadata rather than being drawn into the file, so it can be dragged or deleted later. [`active-win`](https://github.com/sindresorhus/active-win) (optional — the app works fine without it) reads the foreground window's title to auto-suggest a step title.
- **Editing**: the per-step image editor is a plain `<canvas>`-based tool (draw, shape callouts, pixelate/redact, crop, move/delete the marker) — no external dependency, just the Canvas API.
- **Export**: [`sharp`](https://sharp.pixelplumbing.com/) composites the click marker onto a copy of each screenshot at export time. [`pdfkit`](http://pdfkit.org/) lays out PDF; [`docx`](https://docx.js.org/) builds an equivalent Word document; the HTML exporter embeds everything (images included) as base64 in one file, with checkbox state persisted via `localStorage` in whatever browser opens it.
- **Import**: [`mammoth`](https://github.com/mwilliamson/mammoth.js) converts a `.docx` to HTML (extracting embedded images to disk), then the importer walks the HTML and starts a new step at each heading.
- **Persistence**: every SOP is a folder on disk (under Electron's `userData` directory) containing its screenshots and a `meta.json` with title/folder/steps — autosaved on every edit, no explicit "save" step.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the checklist of what's planned/being
considered, including known limitations and good-first-issue-sized items.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please run `npm test`
before opening a PR; it exercises the export/import and multi-monitor
mapping logic headlessly.

## License

MIT — see [LICENSE](LICENSE).
