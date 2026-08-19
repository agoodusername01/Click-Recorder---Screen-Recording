const fs = require('fs');
const sharp = require('sharp');
const { bufferWithMarker } = require('../markerOverlay');

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Renders a step list to a single self-contained .html file - no external
 * files, everything (images included) is embedded as base64 data URIs so
 * it can be emailed, dropped on a shared drive, or posted to an intranet
 * as one file and still work.
 *
 * Two things this format can do that PDF/Word can't:
 *  - A sidebar timeline (built from the user's section headers) for
 *    jumping around a long SOP, same idea as the in-app one.
 *  - "Checklist mode": each step gets a checkbox. Checked state is saved
 *    in the browser's localStorage, keyed by the SOP's title, so someone
 *    following the SOP can close the tab and pick up where they left off.
 */
async function exportToHtml({ title, steps, outPath }) {
  const storageKey = `sop-progress:${title}`;
  const sections = []; // { id, text } for the sidebar, in document order

  const bodyParts = [];
  let stepNumber = 0;

  for (const step of steps) {
    if (step.type === 'header') {
      const headerId = `section-${step.id}`;
      sections.push({ id: headerId, text: step.text || 'Section' });
      bodyParts.push(`
        <div class="section-divider" id="${headerId}">
          <h2>${escapeHtml(step.text || 'Section')}</h2>
        </div>
      `);
      continue;
    }

    stepNumber += 1;
    let imgTag = '';
    if (step.screenshot && fs.existsSync(step.screenshot)) {
      try {
        const buffer = await bufferWithMarker(step.screenshot, step.marker);
        const meta = await sharp(step.screenshot).metadata();
        const format = meta.format === 'jpeg' ? 'jpeg' : 'png';
        const base64 = buffer.toString('base64');
        imgTag = `<img class="step-img" src="data:image/${format};base64,${base64}" alt="Step ${stepNumber} screenshot" />`;
      } catch (_) {
        // Skip unreadable images rather than failing the whole export.
      }
    }

    bodyParts.push(`
      <div class="step" id="step-${step.id}">
        <label class="step-checkbox">
          <input type="checkbox" data-step-id="${escapeHtml(step.id)}" />
          <span class="step-num">Step ${stepNumber}</span>
        </label>
        <h3 class="step-title">${escapeHtml(step.title || '')}</h3>
        ${step.description ? `<p class="step-desc">${escapeHtml(step.description)}</p>` : ''}
        ${imgTag}
      </div>
    `);
  }

  const sidebarLinks = sections.length
    ? sections.map((s) => `<a href="#${s.id}">${escapeHtml(s.text)}</a>`).join('\n')
    : '<p class="sidebar-empty">No sections in this SOP.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --border: #e2e2e6; --muted: #6b6b70; --accent: #0a84ff; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    background: #fafafa;
    display: flex;
  }
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    width: 220px;
    flex: 0 0 220px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: #fff;
    padding: 20px 16px;
  }
  .sidebar h4 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .sidebar a { display: block; padding: 8px 10px; margin-bottom: 4px; border-radius: 8px; color: #1a1a1a; text-decoration: none; font-size: 14px; }
  .sidebar a:hover { background: #f0f0f2; }
  .sidebar-empty { color: var(--muted); font-size: 13px; }
  main { flex: 1; max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
  header.doc-header { margin-bottom: 24px; }
  header.doc-header h1 { margin: 0 0 6px; font-size: 28px; }
  header.doc-header .meta { color: var(--muted); font-size: 13px; }
  .progress-bar-wrap { margin-top: 16px; background: #eee; border-radius: 8px; height: 8px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--accent); width: 0%; transition: width 0.2s ease; }
  .progress-label { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .reset-btn { margin-top: 10px; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: #fff; cursor: pointer; }
  .section-divider { margin: 40px 0 16px; padding-top: 8px; border-top: 2px solid #1a1a1a; }
  .section-divider h2 { margin: 12px 0 0; font-size: 20px; }
  .step { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .step.done { opacity: 0.55; }
  .step-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px; }
  .step-checkbox input { width: 18px; height: 18px; }
  .step-num { font-size: 11px; letter-spacing: 0.04em; color: var(--muted); text-transform: uppercase; }
  .step-title { margin: 0 0 8px; font-size: 15px; }
  .step-desc { margin: 0 0 12px; font-size: 14px; color: #333; white-space: pre-wrap; }
  .step-img { width: 100%; max-height: 640px; object-fit: contain; border-radius: 8px; border: 1px solid var(--border); background: #eee; }
  @media (max-width: 720px) { .sidebar { display: none; } }
</style>
</head>
<body>
  <nav class="sidebar">
    <h4>Sections</h4>
    ${sidebarLinks}
  </nav>
  <main>
    <header class="doc-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Exported ${new Date().toLocaleString()}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="progressBar"></div></div>
      <div class="progress-label" id="progressLabel">0 of ${stepNumber} steps checked off</div>
      <button class="reset-btn" id="resetBtn" type="button">Reset progress</button>
    </header>
    ${bodyParts.join('\n')}
  </main>
  <script>
    // Checklist mode: lets someone following this SOP check off steps as
    // they go. Progress is saved in this browser's localStorage under a
    // key based on the SOP title, so closing the tab and reopening the
    // file later picks up right where they left off. This never touches
    // the file on disk - it's purely local to whoever's browser opens it.
    (function () {
      var STORAGE_KEY = ${JSON.stringify(storageKey)};
      var checkboxes = Array.prototype.slice.call(document.querySelectorAll('.step-checkbox input'));
      var total = checkboxes.length;

      function loadState() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch (e) {
          return {};
        }
      }

      function saveState(state) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
          // Ignore - e.g. localStorage disabled/unavailable; checking
          // boxes still works for the current view, it just won't persist.
        }
      }

      function updateProgress() {
        var done = checkboxes.filter(function (cb) { return cb.checked; }).length;
        var pct = total ? Math.round((done / total) * 100) : 0;
        document.getElementById('progressBar').style.width = pct + '%';
        document.getElementById('progressLabel').textContent = done + ' of ' + total + ' steps checked off';
      }

      var state = loadState();
      checkboxes.forEach(function (cb) {
        var id = cb.getAttribute('data-step-id');
        if (state[id]) {
          cb.checked = true;
          cb.closest('.step').classList.add('done');
        }
        cb.addEventListener('change', function () {
          state[id] = cb.checked;
          saveState(state);
          cb.closest('.step').classList.toggle('done', cb.checked);
          updateProgress();
        });
      });
      updateProgress();

      document.getElementById('resetBtn').addEventListener('click', function () {
        state = {};
        saveState(state);
        checkboxes.forEach(function (cb) {
          cb.checked = false;
          cb.closest('.step').classList.remove('done');
        });
        updateProgress();
      });
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outPath, html, 'utf8');
}

module.exports = { exportToHtml };
