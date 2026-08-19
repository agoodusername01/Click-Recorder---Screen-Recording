# Roadmap

A running checklist of things planned or being considered for Click Recorder.
This is a living document — nothing here is promised on any timeline, and
it's a good place to start if you're looking for a way to contribute (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Open an issue before starting on
anything larger, so effort doesn't get duplicated.

- [ ] **File size optimization.** A fresh `npm install` currently pulls in
      Electron itself plus a few native modules (`sharp` for image
      compositing, `uiohook-napi` for the global click hook), which adds up
      to a sizeable `node_modules` folder and a non-trivial packaged app
      size. Worth investigating:
  - Auditing `electron-builder`'s output for unused locale files / platform
    binaries `sharp` and `uiohook-napi` pull in for platforms other than
    the build target, and pruning them from packaged builds.
  - Whether `sharp`'s full libvips build is needed, or a lighter image
    library would cover the resize/composite operations this app actually
    uses (marker overlay, blur/redact, resizing for exports).
  - Lazy-loading exporters (`pdfExporter`, `docxExporter`, `htmlExporter`)
    only when their format is actually chosen, rather than all being
    required up front.
- [ ] Packaged installers (Windows `.exe`, macOS `.dmg`, Linux `AppImage`)
      built via `electron-builder` (`npm run dist`) and attached to GitHub
      Releases, so most users don't need Node.js or `npm install` at all.
- [ ] Code signing for Windows and macOS, to remove the "unrecognized
      publisher" / Gatekeeper warnings on first run once installers exist.
- [ ] Auto-update support once packaged installers exist.
- [ ] Search/filter SOPs by title on the home screen.
- [ ] Duplicate an existing SOP as a starting template for a similar
      process.
- [ ] A global hotkey to pause/stop recording while the app window is
      minimized or in the background.
- [ ] A confirmation prompt before deleting an individual step (SOPs
      already confirm before deleting on the home screen; single steps
      currently delete immediately).
- [ ] Keystroke capture (with password-field masking) so steps involving
      typed input aren't just a screenshot with no context.
- [ ] Saved/reusable redaction zones — one click to blur a region you
      always want hidden (e.g. a profile photo in a nav bar), instead of
      doing it by hand on every screenshot.
- [ ] Mixed-DPI multi-monitor precision — click coordinates currently use
      the *primary* display's scale factor for all monitors, which can be
      a few pixels off near a secondary display's edge in mixed-DPI setups
      (e.g. a Retina laptop screen plus a 1x external monitor). See
      `src/displayMap.js` and `test/displayMap.test.js`.
- [ ] Wayland support for the global click hook (X11 only today, on
      Linux).
- [ ] To be added on.
