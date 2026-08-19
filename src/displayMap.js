/**
 * displayMap.js
 *
 * Two libraries, two incompatible views of your monitors:
 *
 *  - Electron's `screen` module knows each display's position/size (in
 *    DIP units) and scaleFactor, but can't take a screenshot of just one
 *    of them.
 *  - `screenshot-desktop` can capture a single display by id, but its
 *    `listDisplays()` only returns `{ id, name }` — no position or size.
 *
 * This module bridges the two: it captures every display once, matches
 * each captured image to the Electron display whose physical (pixel) size
 * it best fits, and returns a lookup table the recorder can use to (a)
 * figure out which monitor a click happened on, and (b) capture just that
 * one monitor instead of all of them on every click.
 *
 * Coordinate note: uiohook-napi reports click coordinates in physical
 * pixels on Windows/Linux, but in DIP ("points") on macOS. We normalize
 * everything to physical pixels using the *primary* display's scaleFactor.
 * That's exact for the common case of every monitor sharing one scale
 * factor (the vast majority of setups); with mixed-DPI monitors the
 * crop can be off by a few pixels near the edges, which is a known,
 * documented limitation (see README) rather than a silent bug.
 */

async function buildDisplayMap({ electronScreen, screenshotModule, sharpModule }) {
  const electronDisplays = electronScreen.getAllDisplays();
  const primary = electronScreen.getPrimaryDisplay();
  const primaryScaleFactor = primary.scaleFactor || 1;

  const sdDisplays = await screenshotModule.listDisplays();

  // Capture every display once so we can match by physical pixel size.
  const captures = await Promise.all(
    sdDisplays.map(async (d) => {
      const buffer = await screenshotModule({ screen: d.id, format: 'png' });
      const meta = await sharpModule(buffer).metadata();
      return { sdId: d.id, width: meta.width, height: meta.height };
    })
  );

  const unclaimed = [...electronDisplays];
  const entries = [];

  for (const capture of captures) {
    // Best match = the still-unclaimed Electron display whose physical
    // size (bounds * its own scaleFactor) is closest to this capture.
    let bestIndex = -1;
    let bestScore = Infinity;
    unclaimed.forEach((d, i) => {
      const physW = d.bounds.width * d.scaleFactor;
      const physH = d.bounds.height * d.scaleFactor;
      const score = Math.abs(physW - capture.width) + Math.abs(physH - capture.height);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    });

    const display = bestIndex >= 0 ? unclaimed.splice(bestIndex, 1)[0] : null;

    entries.push({
      sdId: capture.sdId,
      capturedWidth: capture.width,
      capturedHeight: capture.height,
      // Physical-pixel bounding box of this display within the global
      // virtual desktop, using the primary display's scale factor to
      // translate DIP offsets into physical pixels (see note above).
      physicalBounds: display
        ? {
            x: display.bounds.x * primaryScaleFactor,
            y: display.bounds.y * primaryScaleFactor,
            width: display.bounds.width * display.scaleFactor,
            height: display.bounds.height * display.scaleFactor,
          }
        : { x: 0, y: 0, width: capture.width, height: capture.height },
      electronDisplayId: display ? display.id : null,
      isPrimary: display ? display.id === primary.id : sdDisplays.length === 1,
    });
  }

  return { entries, primaryScaleFactor };
}

/**
 * Converts a raw uiohook click point to physical desktop pixels, then
 * finds which display entry it falls inside (falling back to nearest
 * center if it's just outside every bounding box due to rounding).
 */
function resolveDisplayForPoint({ entries, primaryScaleFactor }, rawX, rawY) {
  const physical =
    process.platform === 'darwin'
      ? { x: rawX * primaryScaleFactor, y: rawY * primaryScaleFactor }
      : { x: rawX, y: rawY };

  for (const entry of entries) {
    const b = entry.physicalBounds;
    if (physical.x >= b.x && physical.x < b.x + b.width && physical.y >= b.y && physical.y < b.y + b.height) {
      return {
        entry,
        localX: clamp(physical.x - b.x, 0, entry.capturedWidth - 1),
        localY: clamp(physical.y - b.y, 0, entry.capturedHeight - 1),
      };
    }
  }

  // Nothing contained the point (edge rounding, or a mixed-DPI setup
  // where our approximation drifted) - fall back to the display whose
  // center is closest, and clamp the point into it.
  let best = entries[0];
  let bestDist = Infinity;
  for (const entry of entries) {
    const b = entry.physicalBounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const dist = (physical.x - cx) ** 2 + (physical.y - cy) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  const b = best.physicalBounds;
  return {
    entry: best,
    localX: clamp(physical.x - b.x, 0, best.capturedWidth - 1),
    localY: clamp(physical.y - b.y, 0, best.capturedHeight - 1),
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

module.exports = { buildDisplayMap, resolveDisplayForPoint };
