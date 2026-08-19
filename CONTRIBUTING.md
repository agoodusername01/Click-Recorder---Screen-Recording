# Contributing to Click Recorder

Thanks for considering a contribution! This project is young and there's a
lot of low-hanging fruit — see [ROADMAP.md](ROADMAP.md) for ideas, or open
an issue with your own.

## Setup

```bash
npm install
npm start      # run the app
npm test       # headless export/import smoke test
```

## Guidelines

- Keep the main process (`src/main.js`, `src/recorder.js`) free of UI logic —
  it should only ever talk to the renderer through the `window.sop` IPC
  bridge defined in `src/preload.js`.
- Exporters and the importer should stay pure functions of `(steps) -> file`
  / `(file) -> steps` wherever possible, so they can be tested without
  Electron or a display (see `test/export-import.test.js`).
- Please don't add analytics, telemetry, or network calls without discussing
  in an issue first — this app is meant to work entirely offline, and to
  stay that way.
- Match the existing code style (plain CommonJS, no build step for the
  renderer). If you want to introduce a framework or bundler, open an issue
  to discuss first so we don't end up with conflicting approaches.

## Reporting bugs

Please include your OS/version, whether you granted Accessibility/Screen
Recording permissions (macOS), and steps to reproduce.

## Pull requests

1. Fork, branch, commit, push.
2. Run `npm test`.
3. Open a PR describing what changed and why.
