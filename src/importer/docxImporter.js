const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { parse } = require('node-html-parser');

/**
 * Converts a .docx file into the same step-list shape produced by the
 * recorder, so an imported document can be edited, re-recorded into, and
 * re-exported through the normal pipeline.
 *
 * Strategy: mammoth converts the docx to HTML (extracting embedded images
 * to disk as it goes). We then walk the HTML and start a new "step"
 * every time we hit a heading (h1/h2/h3); everything else - paragraphs,
 * images - gets attached to the current step until the next heading.
 * A document with no headings at all becomes a single step.
 */
async function importFromDocx({ docxPath, sessionDir }) {
  const imagesDir = path.join(sessionDir, 'imported-images');
  fs.mkdirSync(imagesDir, { recursive: true });

  let imgCounter = 0;
  const { value: html } = await mammoth.convertToHtml(
    { path: docxPath },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        imgCounter += 1;
        const ext = (image.contentType || 'image/png').split('/')[1] || 'png';
        const filename = `imported-${imgCounter}.${ext}`;
        const dest = path.join(imagesDir, filename);
        const buffer = await image.read();
        fs.writeFileSync(dest, buffer);
        return { src: dest };
      }),
    }
  );

  const root = parse(html);
  const steps = [];
  let current = null;
  let stepIndex = 0;

  const startNewStep = (titleText) => {
    stepIndex += 1;
    current = {
      id: `step-${stepIndex}`,
      index: stepIndex,
      timestamp: Date.now(),
      x: null,
      y: null,
      button: null,
      screenshot: null,
      title: titleText || `Step ${stepIndex}`,
      description: '',
    };
    steps.push(current);
  };

  // Content that appears before the first step heading (e.g. a subtitle
  // or date line under the document title) is buffered here rather than
  // attached to a step; if the document turns out to have no step
  // headings at all, it becomes the single step's content instead.
  const preamble = [];

  for (const node of root.childNodes) {
    const tag = node.tagName ? node.tagName.toLowerCase() : null;

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      startNewStep(node.text.trim());
      continue;
    }

    const target = current || { screenshot: null, description: '' };

    if (tag === 'img') {
      const src = node.getAttribute('src');
      if (src && !target.screenshot) target.screenshot = src;
    } else {
      const img = node.querySelector ? node.querySelector('img') : null;
      if (img) {
        const src = img.getAttribute('src');
        if (src && !target.screenshot) target.screenshot = src;
      }
      const text = node.text ? node.text.trim() : '';
      if (text) {
        target.description = target.description ? `${target.description}\n${text}` : text;
      }
    }

    if (!current) preamble.push(target);
  }

  if (steps.length === 0 && preamble.length) {
    startNewStep(null);
    for (const p of preamble) {
      if (p.screenshot && !current.screenshot) current.screenshot = p.screenshot;
      if (p.description) {
        current.description = current.description ? `${current.description}\n${p.description}` : p.description;
      }
    }
  }

  return steps;
}

module.exports = { importFromDocx };
