const fs = require('fs');
const sharp = require('sharp');
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  ImageRun,
  TextRun,
} = require('docx');
const { bufferWithMarker } = require('../markerOverlay');

/**
 * Renders a step list to a .docx file. Structure is deliberately simple
 * (Heading1 title, Heading2 per step, image, paragraph) so the result
 * round-trips cleanly back through docxImporter.js if the user edits it
 * in Word and re-imports it.
 */
async function exportToDocx({ title, steps, outPath }) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: new Date().toLocaleString(), spacing: { after: 400 } }),
  ];

  let stepNumber = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === 'header') {
      // A user-added section divider. HEADING_1 (steps use HEADING_2) so
      // it's visually distinct and shows up as its own top-level entry
      // in Word's navigation pane.
      children.push(
        new Paragraph({
          text: step.text || 'Section',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      );
      continue;
    }

    stepNumber += 1;
    children.push(
      new Paragraph({
        text: `Step ${stepNumber}: ${step.title || ''}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      })
    );

    // Description sits above the screenshot: the image is the main
    // reference material for the step, so it reads best right below the
    // short blurb introducing it rather than being sandwiched above it.
    children.push(
      new Paragraph({
        children: [new TextRun(step.description || '')],
        spacing: { after: 150 },
      })
    );

    if (step.screenshot && fs.existsSync(step.screenshot)) {
      try {
        const buffer = await bufferWithMarker(step.screenshot, step.marker);
        const { width, height } = await sharp(step.screenshot).metadata();
        // Images are the main focus of the SOP, so render them large -
        // close to the full page width - rather than as a small thumbnail.
        const maxWidth = 620;
        const scale = width > maxWidth ? maxWidth / width : 1;
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                // `type` is required so the embedded part gets a real file
                // extension (e.g. "media/xyz.png") and a matching entry in
                // [Content_Types].xml. Without it the part is written as
                // "xyz.undefined", which Word silently can't resolve, and
                // the screenshot just doesn't appear - the underlying bug
                // behind "it doesn't have the images in Word".
                type: 'png',
                data: buffer,
                transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
              }),
            ],
            spacing: { after: 200 },
          })
        );
      } catch (_) {
        // Skip unreadable images rather than failing the whole export.
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

module.exports = { exportToDocx };
