/**
 * recorder.js
 *
 * Listens for clicks anywhere on the desktop (via uiohook-napi, a
 * cross-platform native hook), figures out which monitor the click
 * happened on, grabs a screenshot of just that monitor, draws a
 * highlight ring around the click point, and emits a "step" for each
 * one. Steps are plain JSON + PNG files on disk so the rest of the app
 * (UI, exporters) never has to know about the OS-level capture details.
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { uIOhook } = require('uiohook-napi');
const { buildDisplayMap, resolveDisplayForPoint } = require('./displayMap');

// Best-effort only: active-win needs OS-specific access (e.g. a
// Linux window manager exposing wmctrl/xdotool) that isn't guaranteed to
// be present everywhere, and step capture should never fail just because
// a step title couldn't be auto-suggested.
let activeWin = null;
try {
  activeWin = require('active-win');
} catch (_) {
  activeWin = null;
}

class Recorder extends EventEmitter {
  /**
   * @param {string} sessionDir where screenshots/session data are written
   * @param {Electron.Screen} electronScreen the `screen` module from
   *   `require('electron')`, passed in rather than required directly so
   *   this class stays testable outside a running Electron app.
   * @param {Electron.BrowserWindow} [ownWindow] the app's own window, if
   *   available - clicks landing inside its bounds (e.g. hitting Pause,
   *   Stop, or any other app button while recording) are ignored rather
   *   than captured as a step. Without this, clicking Pause itself would
   *   get recorded as a step an instant before the pause takes effect.
   */
  constructor(sessionDir, electronScreen, ownWindow) {
    super();
    this.sessionDir = sessionDir;
    this.shotsDir = path.join(sessionDir, 'screenshots');
    fs.mkdirSync(this.shotsDir, { recursive: true });
    this.electronScreen = electronScreen;
    this.ownWindow = ownWindow || null;

    this.recording = false;
    this.paused = false;
    this.steps = [];
    this.stepCounter = 0;
    this.displayMap = null; // built fresh each time recording starts

    // Debounce: ignore a mousedown immediately after mouseup of the same
    // click, and coalesce rapid double-clicks into a single step so the
    // resulting SOP doesn't get one row per pixel-perfect event.
    this._lastClickAt = 0;
    this._minGapMs = 350;

    this._onClick = this._onClick.bind(this);
  }

  async start() {
    if (this.recording) return;

    // Built once per recording session rather than per click: monitor
    // topology essentially never changes mid-recording, and rebuilding
    // it on every click would mean capturing every screen on every click
    // just to work out which one to keep.
    this.displayMap = await buildDisplayMap({
      electronScreen: this.electronScreen,
      screenshotModule: screenshot,
      sharpModule: sharp,
    });

    this.recording = true;
    this.paused = false;
    uIOhook.on('mousedown', this._onClick);
    uIOhook.start();
    this.emit('started');
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    this.paused = false;
    uIOhook.removeListener('mousedown', this._onClick);
    uIOhook.stop();
    this.emit('stopped', this.steps);
  }

  // Pausing keeps the hook running but ignores clicks, rather than
  // stopping/restarting uiohook - that's both simpler and avoids any
  // edge cases around re-registering the native hook mid-session.
  pause() {
    if (!this.recording) return;
    this.paused = true;
    this.emit('paused');
  }

  resume() {
    if (!this.recording) return;
    this.paused = false;
    this.emit('resumed');
  }

  // Clicks landing inside our own app's window (Pause, Stop, editing a
  // step, etc.) are never real workflow steps and should never be
  // captured - without this check, clicking Pause would itself get
  // recorded as a step the instant before pausing takes effect.
  _isOwnWindowClick(e) {
    if (!this.ownWindow || this.ownWindow.isDestroyed()) return false;
    const b = this.ownWindow.getBounds();
    return e.x >= b.x && e.x <= b.x + b.width && e.y >= b.y && e.y <= b.y + b.height;
  }

  async _onClick(e) {
    if (this.paused) return;
    if (this._isOwnWindowClick(e)) return;

    const now = Date.now();
    if (now - this._lastClickAt < this._minGapMs) return;
    this._lastClickAt = now;

    try {
      const step = await this._captureStep(e);
      this.steps.push(step);
      this.emit('step', step);
    } catch (err) {
      this.emit('error', err);
    }
  }

  async _suggestTitle(index) {
    if (!activeWin) return `Step ${index}`;
    try {
      const win = await activeWin();
      if (win && win.title) return win.title;
    } catch (_) {
      // Unsupported platform/permissions - fall back silently.
    }
    return `Step ${index}`;
  }

  async _captureStep(e) {
    const index = ++this.stepCounter;
    const finalPath = path.join(this.shotsDir, `step-${index}.png`);

    const { entry, localX, localY } = resolveDisplayForPoint(this.displayMap, e.x, e.y);

    // The screenshot is saved raw, with no ring baked into the pixels.
    // The click marker is kept as separate metadata (below) so it can
    // later be dragged to a new spot or removed entirely in the image
    // editor - something that's impossible once it's burned into the PNG.
    const [, suggestedTitle] = await Promise.all([
      screenshot({ filename: finalPath, screen: entry.sdId, format: 'png' }),
      this._suggestTitle(index),
    ]);

    return {
      id: `step-${index}`,
      type: 'step',
      index,
      timestamp: Date.now(),
      x: e.x,
      y: e.y,
      button: e.button,
      display: { id: entry.sdId, isPrimary: entry.isPrimary },
      screenshot: finalPath,
      marker: { x: localX, y: localY, radius: 28, color: '#ff3b30' },
      // Pre-filled from the foreground window's title bar when available
      // (e.g. "Gmail - Inbox") so most steps don't need a manual rename -
      // falls back to a generic "Step N" wherever that isn't available.
      title: suggestedTitle,
      description: '',
    };
  }
}

module.exports = { Recorder };
