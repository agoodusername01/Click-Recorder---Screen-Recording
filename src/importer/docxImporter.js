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
 * to disk as it goes). We then walk the HTML:
 *  - a heading (h1/h2/h3) becomes a section "header" item, matching the
 *    same header type a user can insert manually in the editor - it does
 *    NOT start a step, so content under it isn't swallowed into one giant
 *    step.
 *  - each <li> in a numbered/bulleted list becomes its own step, since
 *    that's how this kind of instructional document is actually
 *    structured (one instruction per list item). A screenshot sitting
 *    right after a list item (either inside the <li> or as the next
 *    sibling) is attached to that same step.
 *  - any other paragraph/image is attached to whichever step is current,
 *    so free-form text/images between list items aren't lost.
 * A document with no headings or list items at all becomes a single step.
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
  let headerCounter = 0;

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
    return current;
  };

  const addHeader = (text) => {
    headerCounter += 1;
    steps.push({ id: `header-${Date.now()}-${headerCounter}`, type: 'header', text: text || 'Section' });
    // A heading closes off whatever step came before it - content after
    // the heading belongs to the next step/list item, not this one.
    current = null;
  };

  // node.text concatenates an element's text with no separator, so a
  // <br> inside a list item (a second line within one instruction) would
  // otherwise get glued onto the line before it. Swap <br> for a newline
  // first so multi-line instructions stay readable.
  const textOf = (node) => {
    const clone = node.clone ? node.clone() : node;
    if (clone.querySelectorAll) {
      clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    }
    return (clone.text || '').trim();
  };

  const attachImage = (target, src) => {
    if (src && !target.screenshot) target.screenshot = src;
  };

  const appendDescription = (target, text) => {
    if (!text) return;
    target.description = target.description ? `${target.description}\n${text}` : text;
  };

  // Content before the first heading/list item (e.g. a subtitle line
  // under the document title) is buffered here; if the whole document
  // turns out to have no headings or list items, it becomes the single
  // step's content instead of being dropped.
  const preamble = { screenshot: null, description: '' };
  let sawAnyStep = false;

  for (const node of root.childNodes) {
    const tag = node.tagName ? node.tagName.toLowerCase() : null;

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      addHeader(node.text.trim());
      continue;
    }

    if (tag === 'ol' || tag === 'ul') {
      node.querySelectorAll('li').forEach((li) => {
        const step = startNewStep(null);
        sawAnyStep = true;
        appendDescription(step, textOf(li));
        const img = li.querySelector('img');
        if (img) attachImage(step, img.getAttribute('src'));
      });
      continue;
    }

    const img = tag === 'img' ? node : (node.querySelector ? node.querySelector('img') : null);
    const text = tag === 'img' ? '' : textOf(node);
    const target = current || preamble;

    if (img) attachImage(target, img.getAttribute('src'));
    if (text) appendDescription(target, text);
  }

  const realSteps = steps.filter((s) => s.type !== 'header');
  if (!sawAnyStep && realSteps.length === 0 && (preamble.description || preamble.screenshot)) {
    const step = startNewStep(null);
    if (preamble.screenshot) step.screenshot = preamble.screenshot;
    if (preamble.description) step.description = preamble.description;
  }

  return steps;
}

module.exports = { importFromDocx };
