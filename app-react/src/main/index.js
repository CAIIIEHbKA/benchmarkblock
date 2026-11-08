import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { runBenchmark, calculateScore } from './engine.mjs'

let win = null
let running = false

function loadConfig() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'config', 'sites.json') : '',
    path.join(app.getAppPath(), 'config', 'sites.json'),
    path.join(app.getAppPath(), '..', 'config', 'sites.json'),
    path.join(process.cwd(), 'config', 'sites.json')
  ]
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (e) {
      console.error('Не удалось прочитать конфиг', p, e)
    }
  }
  throw new Error('config/sites.json не найден')
}


function findOutFile(rel) {
  const base = app.getAppPath()
  for (const ext of ['mjs', 'js', 'cjs']) {
    const p = path.join(base, 'out', rel + '.' + ext)
    if (fs.existsSync(p)) return p
  }
  return path.join(base, 'out', rel + '.mjs')
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 760,
    minHeight: 520,
    title: 'Бенчмарк доступа к заблокированным сайтам (РФ)',
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      preload: findOutFile('preload/index'),
      contextIsolation: true,
      nodeIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServer) {
    win.loadURL(devServer)
  } else {
    win.loadFile(path.join(app.getAppPath(), 'out/renderer/index.html'))
  }
}


app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('bench:sites', () => {
  try {
    return { ok: true, config: loadConfig() }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('bench:run', async () => {
  if (running) return { ok: false, error: 'Бенчмарк уже выполняется' }
  running = true
  try {
    const config = loadConfig()
    const summary = await runBenchmark(config, {
      onSiteDone: (r) => win?.webContents.send('bench:site-done', r),
      onYoutubeProgress: (domain, i, total) => win?.webContents.send('bench:yt-progress', { domain, i, total })
    })
    const score = calculateScore(summary)
    win?.webContents.send('bench:done', { summary, score })
    return { ok: true }
  } catch (e) {
    win?.webContents.send('bench:error', String(e?.message || e))
    return { ok: false, error: String(e?.message || e) }
  } finally {
    running = false
  }
})

ipcMain.handle('bench:export-csv', async (_evt, csvText) => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
    .slice(0, 15)
  const defaultName = `benchmark_results_${stamp}.csv`
  const dir = app.getPath('documents')

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить CSV',
    defaultPath: path.join(dir, defaultName),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  fs.writeFileSync(filePath, csvText, 'utf8')
  return { ok: true, path: filePath }
})

ipcMain.handle('bench:app-info', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
  electron: process.versions.electron,
  node: process.versions.node
}))
