const stepListEl = document.getElementById('stepList');
const recordBtn = document.getElementById('recordBtn');
const pauseBtn = document.getElementById('pauseBtn');
const exportToggle = document.getElementById('exportToggle');
const exportMenu = document.getElementById('exportMenu');
const docTitleEl = document.getElementById('docTitle');
const saveIndicator = document.getElementById('saveIndicator');
const homeBtn = document.getElementById('homeBtn');
const homeView = document.getElementById('homeView');
const editorView = document.getElementById('editorView');
const sopGrid = document.getElementById('sopGrid');
const newSopBtn = document.getElementById('newSopBtn');
const homeImportToggle = document.getElementById('homeImportToggle');
const homeImportMenu = document.getElementById('homeImportMenu');
const folderSidebar = document.getElementById('folderSidebar');
const timelinePanel = document.getElementById('timelinePanel');
const timelineList = document.getElementById('timelineList');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');

let steps = [];
let isRecording = false;
let isPaused = false;
let selectedFolder = null; // null = "All"

// Small "Saving… / All changes saved" indicator so autosave (which
// happens silently on every edit) still gives some visible confirmation
// that nothing's being lost.
let saveIndicatorTimer = null;
async function withSaveIndicator(promise) {
  saveIndicator.textContent = 'Saving…';
  saveIndicator.classList.add('saving');
  try {
    return await promise;
  } finally {
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => {
      saveIndicator.textContent = 'All changes saved';
      saveIndicator.classList.remove('saving');
    }, 250);
  }
}

// View-only zoom per step (not persisted - resets each launch). Lets you
// blow up a screenshot to see fine detail without cropping or otherwise
// touching the actual file; the enlarged image pans inside a
// fixed-size frame rather than growing the whole card.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;
const zoomLevels = new Map(); // step.id -> zoom factor

function applyZoom(img, imgScroll, zoom) {
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) return; // metrics not ready yet - 'load' will re-invoke this

  // Zoom is expressed relative to the "fit the frame" size (what
  // object-fit: contain would show at 100%), not raw native pixels.
  // Screenshots can come from very different native resolutions - a 4K
  // capture and a 1080p capture look the same size at 100% since both
  // are scaled to fit - so zooming by native pixels made the same zoom
  // level jump by wildly different amounts (or even shrink) depending on
  // the image. Anchoring to the fit scale keeps every step's zoom
  // consistent regardless of its original resolution.
  const frameW = imgScroll.clientWidth || 860;
  const frameH = imgScroll.clientHeight || 500;
  const fitScale = Math.min(frameW / naturalW, frameH / naturalH);
  const scale = fitScale * zoom;

  img.style.objectFit = '';
  img.style.width = `${Math.round(naturalW * scale)}px`;
  img.style.height = `${Math.round(naturalH * scale)}px`;
}

// A textarea that grows/shrinks to fit its content, so a one-line
// description stays a thin single line and a long one is never scrolled
// inside its own tiny box - the whole card just gets taller instead.
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/* -------------------------------------------------------------------------
 * Drag-and-drop reordering. Works on the flat `steps` array regardless of
 * whether an entry is a normal step or a section header - both render as
 * draggable cards and share the same reorder IPC call.
 * ---------------------------------------------------------------------- */
let dragFromIndex = null;

function makeDraggable(card, index) {
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    dragFromIndex = index;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    card.classList.toggle('drag-over-top', before);
    card.classList.toggle('drag-over-bottom', !before);
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    card.classList.remove('drag-over-top', 'drag-over-bottom');
    if (dragFromIndex === null) return;

    let toIndex = index;
    if (!before) toIndex += 1;
    if (dragFromIndex < toIndex) toIndex -= 1; // account for the removal shift
    if (toIndex === dragFromIndex) return;

    steps = await withSaveIndicator(window.sop.reorderSteps(dragFromIndex, toIndex));
    dragFromIndex = null;
    render();
  });
}

function buildTimeline() {
  const headers = steps.filter((s) => s.type === 'header');
  timelinePanel.classList.toggle('hidden', headers.length === 0);
  timelineList.innerHTML = '';
  headers.forEach((h) => {
    const link = document.createElement('a');
    link.textContent = h.text || 'Section';
    link.addEventListener('click', () => {
      const target = document.getElementById(`item-${h.id}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    timelineList.appendChild(link);
  });
}

function renderHeaderCard(item, index) {
  const card = document.createElement('div');
  card.className = 'header-card';
  card.id = `item-${item.id}`;
  makeDraggable(card, index);

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';

  const input = document.createElement('input');
  input.className = 'header-text';
  input.value = item.text || '';
  input.placeholder = 'Section name…';
  input.addEventListener('change', async () => {
    item.text = input.value;
    await withSaveIndicator(window.sop.updateHeader(item.id, item.text));
    buildTimeline();
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    steps = await withSaveIndicator(window.sop.deleteStep(item.id));
    render();
  });

  card.append(handle, input, delBtn);
  return card;
}

/**
 * The inline "+" divider between cards (and one before the very first
 * card). Clicking it reveals a small menu to insert either a section
 * header or a blank manual step at that exact position - `afterId` is
 * the id of the item it should be inserted after, or null to insert at
 * the very top.
 */
function renderInsertRow(afterId) {
  const row = document.createElement('div');
  row.className = 'insert-row';

  const plus = document.createElement('button');
  plus.className = 'insert-plus';
  plus.type = 'button';
  plus.textContent = '+';
  plus.title = 'Insert a header or step here';

  const menu = document.createElement('div');
  menu.className = 'insert-menu hidden';

  const headerOpt = document.createElement('button');
  headerOpt.type = 'button';
  headerOpt.textContent = '📑 Header';
  headerOpt.addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.classList.add('hidden');
    steps = await withSaveIndicator(window.sop.addHeader('New Section', afterId));
    render();
  });

  const stepOpt = document.createElement('button');
  stepOpt.type = 'button';
  stepOpt.textContent = '🖊 Step';
  stepOpt.addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.classList.add('hidden');
    steps = await withSaveIndicator(window.sop.addStep(afterId));
    render();
  });

  menu.append(headerOpt, stepOpt);

  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = menu.classList.contains('hidden');
    document.querySelectorAll('.insert-menu').forEach((m) => m.classList.add('hidden'));
    menu.classList.toggle('hidden', !wasHidden);
  });

  row.append(plus, menu);
  return row;
}

document.addEventListener('click', () => {
  document.querySelectorAll('.insert-menu').forEach((m) => m.classList.add('hidden'));
});

function renderStepImageArea(step) {
  if (!step.screenshot) return null; // text-only step - no image area at all, not even a placeholder

  const imgWrap = document.createElement('div');
  imgWrap.className = 'img-wrap';

  const imgScroll = document.createElement('div');
  imgScroll.className = 'img-scroll';

  const img = document.createElement('img');
  img.alt = 'Step screenshot';
  img.addEventListener('load', () => applyZoom(img, imgScroll, zoomLevels.get(step.id) || 1));
  paintStepImage(step, img);
  imgScroll.appendChild(img);

  const zoomControls = document.createElement('div');
  zoomControls.className = 'zoom-controls';

  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.className = 'zoom-btn';
  zoomOutBtn.type = 'button';
  zoomOutBtn.textContent = '−';
  zoomOutBtn.title = 'Zoom out';

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'zoom-label';
  zoomLabel.title = 'Reset to 100%';

  const zoomInBtn = document.createElement('button');
  zoomInBtn.className = 'zoom-btn';
  zoomInBtn.type = 'button';
  zoomInBtn.textContent = '+';
  zoomInBtn.title = 'Zoom in';

  function refreshZoomUI() {
    const z = zoomLevels.get(step.id) || 1;
    zoomLabel.textContent = `${Math.round(z * 100)}%`;
    zoomOutBtn.disabled = z <= ZOOM_MIN;
    zoomInBtn.disabled = z >= ZOOM_MAX;
  }
  refreshZoomUI();

  zoomOutBtn.addEventListener('click', () => {
    const z = Math.max(ZOOM_MIN, Math.round(((zoomLevels.get(step.id) || 1) - ZOOM_STEP) * 100) / 100);
    zoomLevels.set(step.id, z);
    applyZoom(img, imgScroll, z);
    refreshZoomUI();
  });
  zoomInBtn.addEventListener('click', () => {
    const z = Math.min(ZOOM_MAX, Math.round(((zoomLevels.get(step.id) || 1) + ZOOM_STEP) * 100) / 100);
    zoomLevels.set(step.id, z);
    applyZoom(img, imgScroll, z);
    refreshZoomUI();
  });
  zoomLabel.addEventListener('click', () => {
    zoomLevels.set(step.id, ZOOM_MIN);
    applyZoom(img, imgScroll, ZOOM_MIN);
    refreshZoomUI();
  });

  zoomControls.append(zoomOutBtn, zoomLabel, zoomInBtn);
  imgWrap.append(imgScroll, zoomControls);
  return imgWrap;
}

function render() {
  document.body.classList.toggle('empty', steps.length === 0);
  stepListEl.innerHTML = '';
  buildTimeline();

  stepListEl.appendChild(renderInsertRow(null));

  let stepNumber = 0;
  steps.forEach((item, i) => {
    if (item.type === 'header') {
      stepListEl.appendChild(renderHeaderCard(item, i));
      stepListEl.appendChild(renderInsertRow(item.id));
      return;
    }

    stepNumber += 1;
    const step = item;
    const displayIndex = stepNumber;
    const card = document.createElement('div');
    card.className = 'step-card';
    card.id = `item-${step.id}`;
    makeDraggable(card, i);

    const imageArea = renderStepImageArea(step);

    const body = document.createElement('div');
    body.className = 'step-body';

    const num = document.createElement('div');
    num.className = 'step-num';
    num.textContent = `STEP ${displayIndex}`;

    const titleInput = document.createElement('input');
    titleInput.className = 'step-title';
    titleInput.value = step.title || '';
    titleInput.addEventListener('change', () => {
      step.title = titleInput.value;
      withSaveIndicator(window.sop.updateStep(step.id, step.title, step.description));
    });

    const descArea = document.createElement('textarea');
    descArea.placeholder = 'Describe this step…';
    descArea.value = step.description || '';
    descArea.rows = 1;
    descArea.addEventListener('input', () => autoResizeTextarea(descArea));
    descArea.addEventListener('change', () => {
      step.description = descArea.value;
      withSaveIndicator(window.sop.updateStep(step.id, step.title, step.description));
    });

    const actions = document.createElement('div');
    actions.className = 'step-actions';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿ Drag';

    const upBtn = document.createElement('button');
    upBtn.textContent = '↑ Move up';
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', async () => {
      steps = await withSaveIndicator(window.sop.reorderSteps(i, i - 1));
      render();
    });

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓ Move down';
    downBtn.disabled = i === steps.length - 1;
    downBtn.addEventListener('click', async () => {
      steps = await withSaveIndicator(window.sop.reorderSteps(i, i + 1));
      render();
    });

    actions.append(handle, upBtn, downBtn);

    if (step.screenshot) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '🖊 Edit Image';
      editBtn.addEventListener('click', () => openEditor(step));

      const replaceBtn = document.createElement('button');
      replaceBtn.textContent = '🔄 Replace Image';
      replaceBtn.addEventListener('click', async () => {
        const result = await window.sop.replaceImage(step.id);
        if (result && result.ok) {
          step.screenshot = result.screenshot;
          step.marker = null; // the old marker's coordinates don't apply to a different image
          render();
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '🗑 Remove Screenshot';
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Remove the screenshot from this step? The title and description will stay.')) return;
        await withSaveIndicator(window.sop.removeImage(step.id));
        step.screenshot = null;
        step.marker = null;
        render();
      });

      actions.append(editBtn, replaceBtn, removeBtn);
    } else {
      // Same slot the Remove-Screenshot button occupies when there is one -
      // a text-only step just shows this instead, with no separate
      // "no screenshot" placeholder cluttering the card above it.
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add Screenshot';
      addBtn.addEventListener('click', async () => {
        const result = await window.sop.replaceImage(step.id);
        if (result && result.ok) {
          step.screenshot = result.screenshot;
          render();
        }
      });
      actions.append(addBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      steps = await withSaveIndicator(window.sop.deleteStep(step.id));
      render();
    });
    actions.append(delBtn);

    body.append(num, titleInput, descArea, actions);
    if (imageArea) card.append(imageArea, body);
    else card.append(body);
    stepListEl.appendChild(card);
    autoResizeTextarea(descArea); // needs to be attached to the DOM first for scrollHeight to be measurable
    stepListEl.appendChild(renderInsertRow(step.id));
  });
}

/* -------------------------------------------------------------------------
 * Recording controls: a short countdown before capture starts (so there's
 * time to switch to the target window), plus Pause/Resume so an
 * off-script click while checking something else doesn't have to be
 * cleaned up afterward.
 * ---------------------------------------------------------------------- */

function runCountdown(seconds) {
  return new Promise((resolve) => {
    countdownOverlay.classList.remove('hidden');
    let n = seconds;
    countdownNumber.textContent = String(n);
    const tick = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(tick);
        countdownOverlay.classList.add('hidden');
        resolve();
      } else {
        countdownNumber.textContent = String(n);
      }
    }, 800);
  });
}

recordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    recordBtn.disabled = true;
    await runCountdown(3);
    recordBtn.disabled = false;
    // Deliberately not clearing `steps` here: recording can be started
    // again on an SOP that already has steps (e.g. you opened it from the
    // home screen to add more), and those existing steps should stay put
    // with new ones appended after them.
    await window.sop.startRecording();
    isRecording = true;
    isPaused = false;
    recordBtn.textContent = '■ Stop Recording';
    recordBtn.classList.add('recording');
    pauseBtn.classList.remove('hidden');
    pauseBtn.textContent = '⏸ Pause';
  } else {
    const { steps: finalSteps } = await window.sop.stopRecording();
    steps = finalSteps;
    isRecording = false;
    isPaused = false;
    recordBtn.textContent = '● Start Recording';
    recordBtn.classList.remove('recording');
    pauseBtn.classList.add('hidden');
    render();
  }
});

pauseBtn.addEventListener('click', async () => {
  if (!isRecording) return;
  if (!isPaused) {
    await window.sop.pauseRecording();
    isPaused = true;
    pauseBtn.textContent = '▶ Resume';
  } else {
    await window.sop.resumeRecording();
    isPaused = false;
    pauseBtn.textContent = '⏸ Pause';
  }
});

/* -------------------------------------------------------------------------
 * Export dropdown (editor) and Import dropdown (home screen).
 * ---------------------------------------------------------------------- */

function toggleMenu(menuEl) {
  const wasHidden = menuEl.classList.contains('hidden');
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
  menuEl.classList.toggle('hidden', !wasHidden);
}

exportToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(exportMenu);
});

homeImportToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(homeImportMenu);
});

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
});

exportMenu.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    exportMenu.classList.add('hidden');
    const format = btn.dataset.format;
    if (format === 'pdf') window.sop.exportPdf(docTitleEl.value);
    else if (format === 'docx') window.sop.exportDocx(docTitleEl.value);
    else if (format === 'html') window.sop.exportHtml(docTitleEl.value);
  });
});

homeImportMenu.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    homeImportMenu.classList.add('hidden');
    if (btn.dataset.format === 'docx') {
      const result = await window.sop.importDocx();
      if (result.ok) {
        docTitleEl.value = result.title || 'Untitled SOP';
        steps = result.steps;
        showEditor();
      }
    }
  });
});

docTitleEl.addEventListener('change', () => {
  withSaveIndicator(window.sop.updateTitle(docTitleEl.value));
});

window.sop.onStep((step) => {
  steps.push(step);
  render();
});

window.sop.onError((msg) => {
  console.error('Recording error:', msg);
});

/* =========================================================================
 * Home page: lists every SOP that's ever been started (each recording or
 * import creates a session that's persisted to disk), so you can leave one
 * half-finished and come back to it later without re-importing anything.
 * ========================================================================= */

function showHome() {
  // Stop recording if it's active, so leaving the editor never leaves an
  // orphaned uiohook listener running in the background.
  const stopping = isRecording ? window.sop.stopRecording() : Promise.resolve();
  if (isRecording) {
    isRecording = false;
    isPaused = false;
    recordBtn.textContent = '● Start Recording';
    recordBtn.classList.remove('recording');
    pauseBtn.classList.add('hidden');
  }
  editorView.classList.add('hidden');
  homeView.classList.remove('hidden');
  stopping.then(loadHome);
}

function showEditor() {
  homeView.classList.add('hidden');
  editorView.classList.remove('hidden');
  isPaused = false;
  pauseBtn.classList.add('hidden');
  render();
}

function formatUpdatedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderFolderSidebar(sessions, allFolders) {
  folderSidebar.innerHTML = '';

  const heading = document.createElement('h4');
  heading.textContent = 'Folders';
  folderSidebar.appendChild(heading);

  const allBtn = document.createElement('button');
  allBtn.textContent = `All (${sessions.length})`;
  allBtn.classList.toggle('active', selectedFolder === null);
  allBtn.addEventListener('click', () => { selectedFolder = null; loadHome(); });
  folderSidebar.appendChild(allBtn);

  const uncategorizedCount = sessions.filter((s) => !s.folder).length;
  if (uncategorizedCount > 0) {
    const uncatBtn = document.createElement('button');
    uncatBtn.textContent = `Uncategorized (${uncategorizedCount})`;
    uncatBtn.classList.toggle('active', selectedFolder === 'Uncategorized');
    uncatBtn.addEventListener('click', () => { selectedFolder = 'Uncategorized'; loadHome(); });
    folderSidebar.appendChild(uncatBtn);
  }

  allFolders.forEach((f) => {
    const count = sessions.filter((s) => s.folder === f).length;
    const btn = document.createElement('button');
    btn.textContent = `${f} (${count})`;
    btn.classList.toggle('active', selectedFolder === f);
    btn.addEventListener('click', () => { selectedFolder = f; loadHome(); });
    folderSidebar.appendChild(btn);
  });

  const newFolderBtn = document.createElement('button');
  newFolderBtn.className = 'new-folder';
  newFolderBtn.textContent = '+ New Folder…';
  newFolderBtn.addEventListener('click', async () => {
    const name = prompt('New folder name:');
    if (name && name.trim()) {
      // Folders are persisted separately from sessions (see main.js) so
      // an empty one still shows up here and survives a restart, rather
      // than only existing implicitly once something's assigned to it.
      await window.sop.createFolder(name.trim());
      selectedFolder = name.trim();
      loadHome();
    }
  });
  folderSidebar.appendChild(newFolderBtn);
}

function buildFolderSelect(session, allFolderNames) {
  const select = document.createElement('select');
  select.className = 'sop-card-folder';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'No folder';
  select.appendChild(noneOpt);

  allFolderNames.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    select.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New Folder…';
  select.appendChild(newOpt);

  select.value = session.folder || '';

  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', async (e) => {
    e.stopPropagation();
    let folder = select.value;
    if (folder === '__new__') {
      const name = prompt('New folder name:');
      if (!name || !name.trim()) {
        select.value = session.folder || '';
        return;
      }
      folder = name.trim();
    }
    await window.sop.setSessionFolder(session.id, folder || null);
    loadHome();
  });

  return select;
}

async function loadHome() {
  const [allSessions, persistedFolders] = await Promise.all([
    window.sop.listSessions(),
    window.sop.listFolders(),
  ]);

  // Union of explicitly-created (possibly still empty) folders and any
  // folder names already in use by a session, so nothing gets dropped
  // either direction.
  const fromSessions = allSessions.map((s) => s.folder).filter(Boolean);
  const allFolders = Array.from(new Set([...persistedFolders, ...fromSessions])).sort();

  renderFolderSidebar(allSessions, allFolders);

  const sessions = selectedFolder === null
    ? allSessions
    : selectedFolder === 'Uncategorized'
      ? allSessions.filter((s) => !s.folder)
      : allSessions.filter((s) => s.folder === selectedFolder);

  document.body.classList.toggle('home-empty', sessions.length === 0 && selectedFolder === null);
  sopGrid.innerHTML = '';

  sessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'sop-card';

    if (s.thumbnail) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = `file://${s.thumbnail}`;
      img.alt = '';
      card.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'thumb placeholder';
      placeholder.textContent = 'No steps yet';
      card.appendChild(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'sop-card-body';
    const title = document.createElement('div');
    title.className = 'sop-card-title';
    title.textContent = s.title;
    const meta = document.createElement('div');
    meta.className = 'sop-card-meta';
    meta.textContent = `${s.stepCount} step${s.stepCount === 1 ? '' : 's'} · Updated ${formatUpdatedAt(s.updatedAt)}`;
    body.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'sop-card-actions';

    actions.appendChild(buildFolderSelect(s, allFolders));

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
      await window.sop.deleteSession(s.id);
      loadHome();
    });
    actions.appendChild(delBtn);

    card.addEventListener('click', () => openExistingSop(s.id));

    card.append(body, actions);
    sopGrid.appendChild(card);
  });
}

async function openExistingSop(id) {
  const result = await window.sop.openSession(id);
  if (!result.ok) return;
  docTitleEl.value = result.title;
  steps = result.steps;
  showEditor();
}

newSopBtn.addEventListener('click', async () => {
  const result = await window.sop.newSession('Untitled SOP', selectedFolder === 'Uncategorized' ? null : selectedFolder);
  docTitleEl.value = result.title;
  steps = result.steps;
  showEditor();
});

homeBtn.addEventListener('click', showHome);

showHome();

/* =========================================================================
 * Image editor: a small "Snip & Sketch"-style tool for annotating a step's
 * screenshot before export - draw, add shape callouts, redact sensitive
 * info by pixelating a region, and crop. Opened via each step's "Edit
 * Image" button; saves back through window.sop.saveEditedImage, which
 * writes a new PNG on disk and updates the step's screenshot path.
 * ========================================================================= */

const editorOverlay = document.getElementById('editorOverlay');
const editorCanvas = document.getElementById('editorCanvas');
const editorCtx = editorCanvas.getContext('2d');
const editorColorInput = document.getElementById('editorColor');
const editorSizeInput = document.getElementById('editorSize');
const editorApplyCropBtn = document.getElementById('editorApplyCrop');
const editorDeleteMarkerBtn = document.getElementById('editorDeleteMarker');
const editorUndoBtn = document.getElementById('editorUndo');
const editorResetBtn = document.getElementById('editorReset');
const editorCancelBtn = document.getElementById('editorCancel');
const editorSaveBtn = document.getElementById('editorSave');
const editorHint = document.getElementById('editorHint');
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));

let currentTool = 'pen';
let editingStep = null;
let initialSnapshot = null; // { width, height, data, marker } captured when the editor opened, for Reset
let historyStack = [];
let isDrawing = false;
let startPt = null;
let baseImageData = null; // canvas state captured at drag-start, used to redraw live previews without leaving trails
let cropSelection = null; // pending crop rect, committed only when "Apply Crop" is clicked

// The click marker (red ring) is kept separate from the canvas's actual
// pixels for as long as it's being edited - it's redrawn on top each
// frame rather than painted in, which is what makes it possible to drag
// or delete it without leaving a ghost copy behind. `committedImageData`
// is always the marker-free source of truth for the image content;
// `activeMarker` is the marker's current position, or null if removed.
let committedImageData = null;
let activeMarker = null;
let draggingMarker = false;
let markerDragOffset = { x: 0, y: 0 };

const TOOL_HINTS = {
  pen: 'Click and drag to draw freehand.',
  rect: 'Click and drag to draw a rectangle outline.',
  circle: 'Click and drag to draw a circle outline.',
  arrow: 'Click and drag to draw an arrow.',
  blur: 'Drag over anything sensitive - it gets pixelated so it can\u2019t be read.',
  crop: 'Drag to select an area, then click Apply Crop.',
  marker: 'Drag the red circle to reposition it, or use Delete Marker to remove it.',
};

function drawMarkerRing(ctx, marker) {
  ctx.save();
  ctx.strokeStyle = marker.color || '#ff3b30';
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(marker.x, marker.y, marker.radius || 28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = marker.color || '#ff3b30';
  ctx.beginPath();
  ctx.arc(marker.x, marker.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Repaints the canvas from the marker-free source of truth, then draws
// the marker back on top if one exists. Call this any time the canvas
// needs to reflect current state for display.
function redrawWithMarker() {
  if (!committedImageData) return;
  editorCtx.putImageData(committedImageData, 0, 0);
  if (activeMarker) drawMarkerRing(editorCtx, activeMarker);
}

function pushHistory() {
  historyStack.push({ width: editorCanvas.width, height: editorCanvas.height, data: committedImageData });
}

function openEditor(step) {
  editingStep = step;
  cropSelection = null;
  historyStack = [];
  currentTool = 'pen';
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === 'pen'));
  editorHint.textContent = TOOL_HINTS.pen;
  editorApplyCropBtn.classList.add('hidden');

  const img = new Image();
  img.onload = () => {
    editorCanvas.width = img.naturalWidth;
    editorCanvas.height = img.naturalHeight;
    editorCtx.drawImage(img, 0, 0);
    committedImageData = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
    activeMarker = step.marker ? { ...step.marker } : null;
    initialSnapshot = { width: editorCanvas.width, height: editorCanvas.height, data: committedImageData, marker: activeMarker };
    editorDeleteMarkerBtn.classList.toggle('hidden', !activeMarker);
    redrawWithMarker();
    editorOverlay.classList.remove('hidden');
  };
  img.onerror = () => {
    alert('Could not load this screenshot for editing.');
  };
  img.src = `file://${step.screenshot}`;
}

function closeEditor() {
  editorOverlay.classList.add('hidden');
  editingStep = null;
  cropSelection = null;
}

editorCancelBtn.addEventListener('click', closeEditor);

editorSaveBtn.addEventListener('click', async () => {
  if (!editingStep) return;
  // Save the marker-free pixels - the marker travels as separate metadata
  // so it stays draggable/removable next time this image is reopened,
  // rather than becoming permanent the moment you hit Save.
  editorCtx.putImageData(committedImageData, 0, 0);
  const dataUrl = editorCanvas.toDataURL('image/png');
  const result = await window.sop.saveEditedImage(editingStep.id, dataUrl, activeMarker);
  if (result && result.ok) {
    editingStep.screenshot = result.screenshot;
    editingStep.marker = activeMarker;
    closeEditor();
    render();
  } else {
    alert('Could not save changes: ' + (result && result.error ? result.error : 'unknown error'));
  }
});

editorUndoBtn.addEventListener('click', () => {
  if (historyStack.length === 0) return;
  const snap = historyStack.pop();
  editorCanvas.width = snap.width;
  editorCanvas.height = snap.height;
  committedImageData = snap.data;
  redrawWithMarker();
});

editorResetBtn.addEventListener('click', () => {
  if (!initialSnapshot) return;
  pushHistory();
  editorCanvas.width = initialSnapshot.width;
  editorCanvas.height = initialSnapshot.height;
  committedImageData = initialSnapshot.data;
  activeMarker = initialSnapshot.marker ? { ...initialSnapshot.marker } : null;
  editorDeleteMarkerBtn.classList.toggle('hidden', !activeMarker);
  cropSelection = null;
  editorApplyCropBtn.classList.add('hidden');
  redrawWithMarker();
});

editorDeleteMarkerBtn.addEventListener('click', () => {
  activeMarker = null;
  editorDeleteMarkerBtn.classList.add('hidden');
  redrawWithMarker();
});

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    toolButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tool !== 'crop' && cropSelection) {
      // Leaving the crop tool with an unapplied selection: discard the
      // dashed guide so it doesn't linger visually on the canvas.
      cropSelection = null;
      redrawWithMarker();
    }
    currentTool = btn.dataset.tool;
    editorApplyCropBtn.classList.toggle('hidden', currentTool !== 'crop' || !cropSelection);
    editorHint.textContent = TOOL_HINTS[currentTool] || '';
  });
});

function getCanvasPoint(evt) {
  const rect = editorCanvas.getBoundingClientRect();
  const scaleX = editorCanvas.width / rect.width;
  const scaleY = editorCanvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

// Pixelates a region in place - a mosaic/block-average blur that reliably
// destroys legibility of text or details, which is what "redact this"
// actually needs (a soft gaussian blur can still be reversible-ish).
function pixelateRegion(x, y, w, h, blockSize = 14) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.min(editorCanvas.width - x, Math.round(w));
  h = Math.min(editorCanvas.height - y, Math.round(h));
  if (w <= 0 || h <= 0) return;

  const imageData = editorCtx.getImageData(x, y, w, h);
  const { data, width, height } = imageData;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const bw = Math.min(blockSize, width - bx);
      const bh = Math.min(blockSize, height - by);
      let r = 0, g = 0, b = 0, a = 0, count = 0;

      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const idx = ((by + dy) * width + (bx + dx)) * 4;
          r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; a += data[idx + 3];
          count++;
        }
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count); a = Math.round(a / count);

      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const idx = ((by + dy) * width + (bx + dx)) * 4;
          data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
        }
      }
    }
  }
  editorCtx.putImageData(imageData, x, y);
}

function drawArrow(ctx, x1, y1, x2, y2, color, size) {
  const headLen = Math.max(12, size * 3);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

editorCanvas.addEventListener('mousedown', (evt) => {
  if (!editingStep) return;
  const pt = getCanvasPoint(evt);

  if (currentTool === 'marker') {
    if (activeMarker) {
      const dx = pt.x - activeMarker.x;
      const dy = pt.y - activeMarker.y;
      if (Math.hypot(dx, dy) <= (activeMarker.radius || 28) + 10) {
        draggingMarker = true;
        markerDragOffset = { x: dx, y: dy };
      }
    }
    return; // the marker tool never touches pixel history
  }

  isDrawing = true;
  startPt = pt;
  pushHistory();
  // Always draw against the marker-free committed image, so the marker
  // itself never accidentally gets painted into a stroke, shape, or crop.
  editorCtx.putImageData(committedImageData, 0, 0);
  baseImageData = committedImageData;

  if (currentTool === 'pen') {
    editorCtx.strokeStyle = editorColorInput.value;
    editorCtx.lineWidth = Number(editorSizeInput.value);
    editorCtx.lineCap = 'round';
    editorCtx.lineJoin = 'round';
    editorCtx.beginPath();
    editorCtx.moveTo(pt.x, pt.y);
  }
});

editorCanvas.addEventListener('mousemove', (evt) => {
  if (draggingMarker) {
    const pt = getCanvasPoint(evt);
    activeMarker.x = pt.x - markerDragOffset.x;
    activeMarker.y = pt.y - markerDragOffset.y;
    redrawWithMarker();
    return;
  }

  if (!isDrawing || !editingStep) return;
  const pt = getCanvasPoint(evt);

  if (currentTool === 'pen') {
    editorCtx.lineTo(pt.x, pt.y);
    editorCtx.stroke();
    return;
  }

  // Every other tool previews against the pre-drag snapshot so dragging
  // doesn't leave a trail of intermediate shapes/selections behind.
  editorCtx.putImageData(baseImageData, 0, 0);
  const x = Math.min(startPt.x, pt.x);
  const y = Math.min(startPt.y, pt.y);
  const w = Math.abs(pt.x - startPt.x);
  const h = Math.abs(pt.y - startPt.y);

  if (currentTool === 'rect') {
    editorCtx.strokeStyle = editorColorInput.value;
    editorCtx.lineWidth = Number(editorSizeInput.value);
    editorCtx.strokeRect(x, y, w, h);
  } else if (currentTool === 'circle') {
    editorCtx.strokeStyle = editorColorInput.value;
    editorCtx.lineWidth = Number(editorSizeInput.value);
    editorCtx.beginPath();
    editorCtx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    editorCtx.stroke();
  } else if (currentTool === 'arrow') {
    drawArrow(editorCtx, startPt.x, startPt.y, pt.x, pt.y, editorColorInput.value, Number(editorSizeInput.value));
  } else if (currentTool === 'blur' || currentTool === 'crop') {
    editorCtx.save();
    editorCtx.setLineDash([6, 4]);
    editorCtx.strokeStyle = currentTool === 'blur' ? '#ff3b30' : '#0a84ff';
    editorCtx.lineWidth = 2;
    editorCtx.strokeRect(x, y, w, h);
    editorCtx.restore();
  }
});

window.addEventListener('mouseup', (evt) => {
  if (draggingMarker) {
    draggingMarker = false;
    return;
  }
  if (!isDrawing || !editingStep) return;
  isDrawing = false;
  const pt = getCanvasPoint(evt);
  const x = Math.min(startPt.x, pt.x);
  const y = Math.min(startPt.y, pt.y);
  const w = Math.abs(pt.x - startPt.x);
  const h = Math.abs(pt.y - startPt.y);

  if (currentTool === 'blur') {
    editorCtx.putImageData(baseImageData, 0, 0);
    pixelateRegion(x, y, w, h);
    committedImageData = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
    redrawWithMarker();
  } else if (currentTool === 'crop') {
    editorCtx.putImageData(baseImageData, 0, 0);
    // Crop is a two-step action (select, then Apply Crop) so the pre-drag
    // history entry pushed on mousedown doesn't apply here - pop it back
    // off; Undo shouldn't have to "undo" a selection that was never applied.
    historyStack.pop();
    if (w > 4 && h > 4) {
      cropSelection = { x, y, w, h };
      editorCtx.save();
      editorCtx.setLineDash([6, 4]);
      editorCtx.strokeStyle = '#0a84ff';
      editorCtx.lineWidth = 2;
      editorCtx.strokeRect(x, y, w, h);
      editorCtx.restore();
      editorApplyCropBtn.classList.remove('hidden');
    }
    // Draw the marker back on top without disturbing the dashed guide
    // (redrawWithMarker would repaint from committedImageData and erase it).
    if (activeMarker) drawMarkerRing(editorCtx, activeMarker);
  } else if (currentTool === 'pen') {
    editorCtx.closePath();
    committedImageData = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
    redrawWithMarker();
  } else if (currentTool === 'rect' || currentTool === 'circle' || currentTool === 'arrow') {
    committedImageData = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
    redrawWithMarker();
  }
  baseImageData = null;
});

editorApplyCropBtn.addEventListener('click', () => {
  if (!cropSelection) return;
  pushHistory();
  // Crop from the clean (marker- and dashed-guide-free) pixels so neither
  // ends up baked into the cropped image.
  editorCtx.putImageData(committedImageData, 0, 0);
  const { x, y, w, h } = cropSelection;
  const cropped = editorCtx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  editorCanvas.width = Math.round(w);
  editorCanvas.height = Math.round(h);
  editorCtx.putImageData(cropped, 0, 0);
  committedImageData = cropped;

  if (activeMarker) {
    const nx = activeMarker.x - x;
    const ny = activeMarker.y - y;
    if (nx >= 0 && ny >= 0 && nx <= w && ny <= h) {
      activeMarker = { ...activeMarker, x: nx, y: ny };
    } else {
      activeMarker = null; // marker was cropped out of the image entirely
    }
    editorDeleteMarkerBtn.classList.toggle('hidden', !activeMarker);
  }

  cropSelection = null;
  editorApplyCropBtn.classList.add('hidden');
  redrawWithMarker();
});

/**
 * Draws a step's screenshot into the given <img> for the compact list
 * view, compositing the click marker on top if one exists - the marker
 * is metadata (not baked into the file on disk), so it has to be rendered
 * in wherever the screenshot is displayed, not just in the editor.
 */
function paintStepImage(step, imgEl) {
  if (!step.screenshot) {
    imgEl.src = '';
    return;
  }
  if (!step.marker) {
    imgEl.src = `file://${step.screenshot}`;
    return;
  }
  const src = new Image();
  src.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = src.naturalWidth;
    canvas.height = src.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0);
    drawMarkerRing(ctx, step.marker);
    imgEl.src = canvas.toDataURL('image/png');
  };
  src.onerror = () => {
    imgEl.src = `file://${step.screenshot}`;
  };
  src.src = `file://${step.screenshot}`;
}
