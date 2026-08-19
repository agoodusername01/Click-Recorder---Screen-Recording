/**
 * Headless smoke test for the export/import pipeline. Doesn't touch
 * Electron or the OS-level recorder (those need a real display/session) -
 * just verifies pdfExporter, docxExporter, and docxImporter work end to
 * end against synthetic step data.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const { exportToPdf } = require('../src/exporter/pdfExporter');
const { exportToDocx } = require('../src/exporter/docxExporter');
const { importFromDocx } = require('../src/importer/docxImporter');

async function makeFakeScreenshot(dest) {
  await sharp({
    create: { width: 400, height: 250, channels: 3, background: { r: 210, g: 220, b: 235 } },
  })
    .png()
    .toFile(dest);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-test-'));
  const shot1 = path.join(tmp, 'shot1.png');
  const shot2 = path.join(tmp, 'shot2.png');
  await makeFakeScreenshot(shot1);
  await makeFakeScreenshot(shot2);

  const steps = [
    { id: 's1', title: 'Open the app', description: 'Launch the application from the dock.', screenshot: shot1 },
    { id: 's2', title: 'Click Settings', description: 'Navigate to the settings menu.', screenshot: shot2 },
  ];

  const pdfPath = path.join(tmp, 'test.pdf');
  await exportToPdf({ title: 'Test SOP', steps, outPath: pdfPath });
  assert(fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0, 'PDF export produced a non-empty file');

  const docxPath = path.join(tmp, 'test.docx');
  await exportToDocx({ title: 'Test SOP', steps, outPath: docxPath });
  assert(fs.existsSync(docxPath) && fs.statSync(docxPath).size > 0, 'DOCX export produced a non-empty file');

  const importDir = path.join(tmp, 'import-session');
  fs.mkdirSync(importDir, { recursive: true });
  const imported = await importFromDocx({ docxPath, sessionDir: importDir });
  assert(imported.length === steps.length, `DOCX import recovered ${imported.length}/${steps.length} steps`);
  assert(imported[0].title.includes('Open the app'), 'First imported step title matches');
  assert(imported[0].screenshot && fs.existsSync(imported[0].screenshot), 'First imported step has an image on disk');

  console.log('\nAll export/import smoke tests passed.');
  console.log(`  PDF:  ${pdfPath} (${fs.statSync(pdfPath).size} bytes)`);
  console.log(`  DOCX: ${docxPath} (${fs.statSync(docxPath).size} bytes)`);
  console.log(`  Round-trip recovered ${imported.length} step(s) from the exported DOCX.`);
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
