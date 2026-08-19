/**
 * Headless test for displayMap.js. Since this sandbox has no real
 * multi-monitor hardware (or a display at all) to test against, this
 * mocks Electron's `screen` module and screenshot-desktop with a
 * synthetic two-monitor layout and verifies the matching + click
 * resolution logic against known-correct answers.
 */
const { buildDisplayMap, resolveDisplayForPoint } = require('../src/displayMap');

async function main() {
  // Primary: 1920x1080 at the origin. Secondary: 1280x800, placed
  // immediately to the right of the primary. Both at 1x scale (the
  // common, non-mixed-DPI case this implementation targets).
  const electronDisplays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 800 }, scaleFactor: 1 },
  ];
  const electronScreen = {
    getAllDisplays: () => electronDisplays,
    getPrimaryDisplay: () => electronDisplays[0],
  };

  // Deliberately returned in a different order than electronDisplays, and
  // with ids that don't correspond by index, to prove matching happens by
  // physical size rather than by array position.
  const sdOrder = [
    { id: 'sd-secondary', width: 1280, height: 800 },
    { id: 'sd-primary', width: 1920, height: 1080 },
  ];

  const screenshotModule = async ({ screen: sdId }) => {
    const found = sdOrder.find((s) => s.id === sdId);
    return Buffer.from(JSON.stringify({ width: found.width, height: found.height }));
  };
  screenshotModule.listDisplays = async () => sdOrder.map((s) => ({ id: s.id, name: s.id }));

  const sharpModule = (buffer) => ({ metadata: async () => JSON.parse(buffer.toString()) });

  const map = await buildDisplayMap({ electronScreen, screenshotModule, sharpModule });

  const entryPrimary = map.entries.find((e) => e.sdId === 'sd-primary');
  assert(entryPrimary.electronDisplayId === 1, 'primary capture matched to primary Electron display by size');
  assert(entryPrimary.physicalBounds.x === 0 && entryPrimary.physicalBounds.width === 1920, 'primary bounds correct');
  assert(entryPrimary.isPrimary === true, 'primary entry flagged isPrimary');

  const entrySecondary = map.entries.find((e) => e.sdId === 'sd-secondary');
  assert(entrySecondary.electronDisplayId === 2, 'secondary capture matched to secondary Electron display by size');
  assert(entrySecondary.physicalBounds.x === 1920, 'secondary display origin offset by primary width');
  assert(entrySecondary.isPrimary === false, 'secondary entry not flagged isPrimary');

  // Click on the secondary monitor (global x=2500 falls within [1920, 3200))
  const clickOnSecondary = resolveDisplayForPoint(map, 2500, 300);
  assert(clickOnSecondary.entry.sdId === 'sd-secondary', 'click at x=2500 resolves to the secondary monitor');
  assert(clickOnSecondary.localX === 580 && clickOnSecondary.localY === 300, 'local coords correctly offset (2500-1920=580)');

  // Click on the primary monitor
  const clickOnPrimary = resolveDisplayForPoint(map, 500, 500);
  assert(clickOnPrimary.entry.sdId === 'sd-primary', 'click at x=500 resolves to the primary monitor');
  assert(clickOnPrimary.localX === 500 && clickOnPrimary.localY === 500, 'local coords unchanged on primary (origin 0,0)');

  // Click right at the boundary between monitors
  const clickAtBoundary = resolveDisplayForPoint(map, 1920, 50);
  assert(clickAtBoundary.entry.sdId === 'sd-secondary', 'click exactly at the seam belongs to the monitor starting there');

  console.log('\nAll displayMap tests passed.');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
