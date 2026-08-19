const fs = require('fs');
const PDFDocument = require('pdfkit');
const { bufferWithMarker } = require('../markerOverlay');

/**
 * Renders a step list to a PDF: a title page followed by one section per
 * step (heading, screenshot, description).
 */
async function exportToPdf({ title, steps, outPath }) {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(24).text(title, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#666').text(new Date().toLocaleString(), { align: 'center' });
  doc.fillColor('#000');

  let stepNumber = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    doc.addPage();

    if (step.type === 'header') {
      // A user-added section divider - its own page with just the large
      // heading, so it reads as a clear break when flipping through.
      doc.fontSize(26).fillColor('#000').text(step.text || 'Section', { align: 'left' });
      continue;
    }

    stepNumber += 1;
    doc.fontSize(16).text(`Step ${stepNumber}: ${step.title || ''}`);
    doc.moveDown(0.3);

    // Description above the screenshot, and the image rendered large:
    // the picture is the main reference material for a step, so it gets
    // the bulk of the page rather than being a small thumbnail below.
    if (step.description) {
      doc.fontSize(12).fillColor('#333').text(step.description, { align: 'left' });
      doc.fillColor('#000');
    }
    doc.moveDown(0.6);

    if (step.screenshot && fs.existsSync(step.screenshot)) {
      const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const maxHeight = doc.page.height - doc.y - doc.page.margins.bottom;
      try {
        const buffer = await bufferWithMarker(step.screenshot, step.marker);
        doc.image(buffer, { fit: [maxWidth, maxHeight], align: 'center' });
      } catch (_) {
        // Skip unreadable images rather than failing the whole export.
      }
    }
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { exportToPdf };
