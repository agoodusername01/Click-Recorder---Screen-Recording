const { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { Recorder } = require('./recorder');
const { exportToPdf } = require('./exporter/pdfExporter');
const { exportToDocx } = require('./exporter/docxExporter');
const { exportToHtml } = require('./exporter/htmlExporter');
const { importFromDocx } = require('./importer/docxImporter');

let mainWindow;
let recorder;

// In-memory state for whichever SOP is currently open in the editor. All of
// it is mirrored to disk (see persistActiveSession) so closing and
// reopening the app - or switching back to the home screen - never loses
// work in progress.
let currentSteps = [];
let currentTitle = 'Untitled SOP';
let currentFolder = null;
let activeSessionId = null;
let activeCreatedAt = null;

function sessionsRoot() {
  return path.join(app.getPath('userData'), 'sessions');
}

function sessionDirFor(id) {
  return path.join(sessionsRoot(), id);
}

function metaPathFor(id) {
  return path.join(sessionDirFor(id), 'meta.json');
}

// Folders are just a persisted list of names, separate from sessions -
// this is what lets a brand-new, still-empty folder show up and stick
// around, rather than only existing implicitly whenever some SOP happens
// to reference it (which is what made "+ New Folder" appear to do
// nothing: the name wasn't stored anywhere once nothing was assigned to it).
function foldersPath() {
  return path.join(app.getPath('userData'), 'folders.json');
}

function loadFolders() {
  try {
    return JSON.parse(fs.readFileSync(foldersPath(), 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveFolders(list) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(foldersPath(), JSON.stringify(list, null, 2));
}

function ensureFolderExists(name) {
  if (!name) return;
  const folders = loadFolders();
  if (!folders.includes(name)) {
    folders.push(name);
    saveFolders(folders);
  }
}

// Every SOP lives in its own folder (screenshots + a meta.json with the
// title/step list), so "sessions" on disk double as the persisted SOPs
// shown on the home screen.
function createSession(title, folder) {
  const id = `session-${Date.now()}`;
  fs.mkdirSync(path.join(sessionDirFor(id), 'screenshots'), { recursive: true });
  const meta = {
    id,
    title: title || 'Untitled SOP',
    folder: folder || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [],
  };
  fs.writeFileSync(metaPathFor(id), JSON.stringify(meta, null, 2));
  return meta;
}

function loadSessionMeta(id) {
  const metaPath = metaPathFor(id);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listSessionSummaries() {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return [];

  const summaries = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = loadSessionMeta(entry.name);
    if (!meta) continue; // skip a corrupt/partial meta.json rather than failing the whole list
    const steps = meta.steps || [];
    const firstWithShot = steps.find((s) => s.screenshot && fs.existsSync(s.screenshot));
    summaries.push({
      id: meta.id || entry.name,
      title: meta.title || 'Untitled SOP',
      folder: meta.folder || null,
      updatedAt: meta.updatedAt || meta.createdAt || 0,
      stepCount: steps.filter((s) => s.type !== 'header').length,
      thumbnail: firstWithShot ? firstWithShot.screenshot : null,
    });
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

// Called after every edit (step change, title change, a new recorded step,
// an image edit) so the SOP on disk always reflects what's on screen -
// there's no separate "save" step, and closing the app mid-edit is safe.
function persistActiveSession() {
  if (!activeSessionId) return;
  fs.mkdirSync(sessionDirFor(activeSessionId), { recursive: true });
  const meta = {
    id: activeSessionId,
    title: currentTitle,
    folder: currentFolder,
    createdAt: activeCreatedAt || Date.now(),
    updatedAt: Date.now(),
    steps: currentSteps,
  };
  fs.writeFileSync(metaPathFor(activeSessionId), JSON.stringify(meta, null, 2));
}

function ensureActiveSession() {
  if (activeSessionId) return;
  const meta = createSession(currentTitle);
  activeSessionId = meta.id;
  activeCreatedAt = meta.createdAt;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Click Recorder - Screen Recording',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  // macOS requires explicit consent for both accessibility (to see global
  // clicks) and screen recording (to take screenshots). We surface the
  // prompt on launch so the user isn't confused when recording silently
  // captures nothing.
  if (process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient) {
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('folders:list', () => loadFolders());

ipcMain.handle('folders:create', (_e, { name }) => {
  ensureFolderExists(name);
  return loadFolders();
});

ipcMain.handle('sessions:list', () => listSessionSummaries());

ipcMain.handle('sessions:new', (_e, { title, folder } = {}) => {
  ensureFolderExists(folder);
  const meta = createSession(title, folder);
  activeSessionId = meta.id;
  activeCreatedAt = meta.createdAt;
  currentTitle = meta.title;
  currentFolder = meta.folder;
  currentSteps = [];
  return { id: meta.id, title: meta.title, folder: meta.folder, steps: [] };
});

ipcMain.handle('sessions:open', (_e, { id }) => {
  const meta = loadSessionMeta(id);
  if (!meta) return { ok: false };
  activeSessionId = meta.id;
  activeCreatedAt = meta.createdAt || Date.now();
  currentTitle = meta.title || 'Untitled SOP';
  currentFolder = meta.folder || null;
  currentSteps = meta.steps || [];
  return { ok: true, id: meta.id, title: currentTitle, folder: currentFolder, steps: currentSteps };
});

ipcMain.handle('sessions:delete', (_e, { id }) => {
  const dir = sessionDirFor(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  if (activeSessionId === id) {
    activeSessionId = null;
    activeCreatedAt = null;
    currentSteps = [];
    currentTitle = 'Untitled SOP';
    currentFolder = null;
  }
  return { ok: true };
});

ipcMain.handle('sessions:setFolder', (_e, { id, folder }) => {
  const meta = loadSessionMeta(id);
  if (!meta) return { ok: false };
  ensureFolderExists(folder);
  meta.folder = folder || null;
  meta.updatedAt = Date.now();
  fs.writeFileSync(metaPathFor(id), JSON.stringify(meta, null, 2));
  if (activeSessionId === id) currentFolder = meta.folder;
  return { ok: true };
});

ipcMain.handle('title:update', (_e, { title }) => {
  currentTitle = title || 'Untitled SOP';
  persistActiveSession();
  return { ok: true };
});

ipcMain.handle('recording:start', async () => {
  ensureActiveSession();
  const dir = sessionDirFor(activeSessionId);
  recorder = new Recorder(dir, screen, mainWindow);
  recorder.on('step', (step) => {
    currentSteps.push(step);
    persistActiveSession();
    mainWindow.webContents.send('recording:step', step);
  });
  recorder.on('error', (err) => {
    mainWindow.webContents.send('recording:error', String(err && err.message ? err.message : err));
  });
  await recorder.start();
  return { ok: true, sessionId: activeSessionId };
});

ipcMain.handle('recording:stop', () => {
  if (recorder) recorder.stop();
  persistActiveSession();
  return { ok: true, steps: currentSteps };
});

ipcMain.handle('recording:pause', () => {
  if (recorder) recorder.pause();
  return { ok: true };
});

ipcMain.handle('recording:resume', () => {
  if (recorder) recorder.resume();
  return { ok: true };
});

ipcMain.handle('steps:get', () => currentSteps);

ipcMain.handle('steps:update', (_e, { id, title, description }) => {
  const step = currentSteps.find((s) => s.id === id);
  if (step) {
    if (title !== undefined) step.title = title;
    if (description !== undefined) step.description = description;
    persistActiveSession();
  }
  return { ok: true };
});

ipcMain.handle('steps:delete', (_e, { id }) => {
  currentSteps = currentSteps.filter((s) => s.id !== id);
  persistActiveSession();
  return currentSteps;
});

ipcMain.handle('steps:reorder', (_e, { fromIndex, toIndex }) => {
  const [moved] = currentSteps.splice(fromIndex, 1);
  currentSteps.splice(toIndex, 0, moved);
  persistActiveSession();
  return currentSteps;
});

// Inserts an item at a specific position in the step list rather than
// always at the end - used by the inline "+" button between cards, so
// "insert a header here" actually lands where the user clicked it.
// `afterId` null/undefined means "insert at the very top".
function insertItem(item, afterId) {
  if (!afterId) {
    currentSteps.unshift(item);
    return;
  }
  const idx = currentSteps.findIndex((s) => s.id === afterId);
  if (idx === -1) currentSteps.push(item);
  else currentSteps.splice(idx + 1, 0, item);
}

// A "header" is a lightweight divider a user drops between steps to
// section a long SOP themselves ("Part 1: Setup", "Part 2: Configuration",
// etc.) - it lives in the same ordered `steps` array as normal steps so
// existing reorder/delete logic already works on it unchanged.
ipcMain.handle('steps:addHeader', (_e, { text, afterId } = {}) => {
  ensureActiveSession();
  const header = { id: `header-${Date.now()}`, type: 'header', text: text || 'New Section' };
  insertItem(header, afterId);
  persistActiveSession();
  return currentSteps;
});

ipcMain.handle('steps:updateHeader', (_e, { id, text }) => {
  const header = currentSteps.find((s) => s.id === id);
  if (header) {
    header.text = text;
    persistActiveSession();
  }
  return { ok: true };
});

// A manually-added step (as opposed to one captured by recording) - no
// screenshot yet, just text, so a step can be documented by hand and a
// screenshot attached afterwards (or never, if it isn't needed).
ipcMain.handle('steps:addStep', (_e, { afterId } = {}) => {
  ensureActiveSession();
  const step = {
    id: `step-manual-${Date.now()}`,
    type: 'step',
    index: null,
    timestamp: Date.now(),
    x: null,
    y: null,
    button: null,
    display: null,
    screenshot: null,
    marker: null,
    title: 'New Step',
    description: '',
  };
  insertItem(step, afterId);
  persistActiveSession();
  return currentSteps;
});

ipcMain.handle('image:remove', (_e, { stepId }) => {
  const step = currentSteps.find((s) => s.id === stepId);
  if (!step) return { ok: false, error: 'Step not found' };
  // Only clears the reference, not the file on disk - avoids any risk of
  // deleting something still needed elsewhere, and the session folder
  // isn't something users are expected to manage by hand anyway.
  step.screenshot = null;
  step.marker = null;
  persistActiveSession();
  return { ok: true };
});

ipcMain.handle('export:pdf', async (_e, { title }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SOP as PDF',
    defaultPath: `${title || 'SOP'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await exportToPdf({ title: title || 'Standard Operating Procedure', steps: currentSteps, outPath: filePath });
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('export:docx', async (_e, { title }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SOP as Word Document',
    defaultPath: `${title || 'SOP'}.docx`,
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await exportToDocx({ title: title || 'Standard Operating Procedure', steps: currentSteps, outPath: filePath });
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('export:html', async (_e, { title }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SOP as HTML',
    defaultPath: `${title || 'SOP'}.html`,
    filters: [{ name: 'Web Page', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await exportToHtml({ title: title || 'Standard Operating Procedure', steps: currentSteps, outPath: filePath });
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('image:save', (_e, { stepId, dataUrl, marker }) => {
  const step = currentSteps.find((s) => s.id === stepId);
  if (!step) return { ok: false, error: 'Step not found' };

  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return { ok: false, error: 'Unexpected image data' };
  const buffer = Buffer.from(match[1], 'base64');

  // Write edits to a fresh file (rather than overwriting in place) so a
  // stale on-disk write can't race a browser image cache still pointing
  // at the old path. Falls back to userData if this step has no session
  // directory yet (e.g. steps imported from a Word doc before any
  // recording session existed).
  const dir = step.screenshot ? path.dirname(step.screenshot) : path.join(app.getPath('userData'), 'edited');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${stepId}-edited-${Date.now()}.png`);
  fs.writeFileSync(outPath, buffer);

  step.screenshot = outPath;
  // The marker is metadata, not baked into the saved pixels above, so it
  // stays independently movable/removable the next time this image is
  // opened in the editor. `marker` may be null if it was deleted.
  step.marker = marker || null;
  persistActiveSession();
  return { ok: true, screenshot: outPath };
});

ipcMain.handle('image:replace', async (_e, { stepId }) => {
  const step = currentSteps.find((s) => s.id === stepId);
  if (!step) return { ok: false, error: 'Step not found' };

  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a replacement screenshot',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };

  const dir = step.screenshot ? path.dirname(step.screenshot) : path.join(sessionDirFor(activeSessionId || ''), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filePaths[0]) || '.png';
  const outPath = path.join(dir, `${stepId}-replaced-${Date.now()}${ext}`);
  fs.copyFileSync(filePaths[0], outPath);

  step.screenshot = outPath;
  // A marker recorded for the old screenshot won't line up with a
  // completely different image, so it's cleared rather than carried over.
  step.marker = null;
  persistActiveSession();
  return { ok: true, screenshot: outPath };
});

ipcMain.handle('import:docx', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Word Document',
    properties: ['openFile'],
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };

  // Importing always starts a brand-new SOP rather than folding into
  // whatever session happened to be active - it's reachable from the
  // home screen now, where there's no "current" editor session to
  // attach to, and semantically an import is its own new SOP regardless.
  const suggestedTitle = path.basename(filePaths[0], path.extname(filePaths[0])) || 'Imported SOP';
  const meta = createSession(suggestedTitle, null);
  activeSessionId = meta.id;
  activeCreatedAt = meta.createdAt;
  currentTitle = meta.title;
  currentFolder = meta.folder;

  const dir = sessionDirFor(activeSessionId);
  const imported = await importFromDocx({ docxPath: filePaths[0], sessionDir: dir });
  currentSteps = imported;
  persistActiveSession();
  return { ok: true, steps: currentSteps, title: currentTitle, id: activeSessionId };
});
