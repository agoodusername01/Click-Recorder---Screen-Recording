/**
 * markerOverlay.js
 *
 * Screenshots are stored raw on disk - the click marker (the red ring)
 * lives as separate {x, y, radius, color} metadata on the step, not baked
 * into the PNG, so it can be dragged or deleted later in the image editor.
 * Exports still need to *show* it though, so this composites it onto a
 * copy of the image at export time only, leaving the file on disk
 * untouched.
 */

const fs = require('fs');
const sharp = require('sharp');

function markerSvg(marker, width, height) {
  const { x, y, radius = 28, color = '#ff3b30' } = marker;
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="${color}" stroke-width="5" opacity="0.95"/>
      <circle cx="${x}" cy="${y}" r="4" fill="${color}"/>
    </svg>`;
}

/**
 * Returns a Buffer for the given image, with the marker composited on
 * top if one is present. Returns the file's original bytes unchanged if
 * there's no marker (e.g. it was deleted, or the image was replaced).
 */
async function bufferWithMarker(imagePath, marker) {
  const original = fs.readFileSync(imagePath);
  if (!marker) return original;

  const meta = await sharp(original).metadata();
  const svg = markerSvg(marker, meta.width, meta.height);
  return sharp(original)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

module.exports = { bufferWithMarker };
