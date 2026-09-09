import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererDirectory = join(__dirname, 'renderer')
const preloadPath = join(__dirname, 'preload.mjs')
const DEFAULT_SERVER_URL = process.env.MINDMAPCHAT_SERVER_URL || 'http://localhost:11113'

app.setName('MindmapChat Desktop')

let mainWindow = null
let settingsWindow = null
let activeServerUrl = DEFAULT_SERVER_URL
let lastLoadError = ''

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

function normalizeServerUrl(value) {
  const parsed = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('服务器地址必须以 http:// 或 https:// 开头')
  }
  if (parsed.username || parsed.password) {
    throw new Error('服务器地址不能包含用户名或密码')
  }
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/$/, '')
}

function readServerUrl() {
  const environmentUrl = process.env.MINDMAPCHAT_SERVER_URL
  if (environmentUrl) {
    try {
      return normalizeServerUrl(environmentUrl)
    } catch (error) {
      console.error('[desktop] MINDMAPCHAT_SERVER_URL 无效:', error.message)
    }
  }
  try {
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return normalizeServerUrl(settings.serverUrl)
  } catch {
    return DEFAULT_SERVER_URL
  }
}

function saveServerUrl(value) {
  const serverUrl = normalizeServerUrl(value)
  writeFileSync(settingsPath(), `${JSON.stringify({ serverUrl }, null, 2)}\n`, 'utf8')
  activeServerUrl = serverUrl
  return serverUrl
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function isCurrentServerUrl(value) {
  const parsed = parseHttpUrl(value)
  return parsed ? parsed.origin === new URL(activeServerUrl).origin : false
}

async function openExternal(value) {
  if (parseHttpUrl(value)) await shell.openExternal(value)
}

function secureWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: true,
    preload: preloadPath,
  }
}

function attachNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || isCurrentServerUrl(url)) return
    event.preventDefault()
    void openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

async function loadMindmapChat() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  lastLoadError = ''
  activeServerUrl = readServerUrl()
  await mainWindow.loadURL(activeServerUrl)
}

async function showConnectionError(errorDescription) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  lastLoadError = errorDescription || '无法连接到 MindmapChat 服务'
  await mainWindow.loadFile(join(rendererDirectory, 'error.html'))
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f6ff',
    title: 'MindmapChat Desktop',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: secureWebPreferences(),
  })
  attachNavigationGuards(mainWindow)
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !parseHttpUrl(validatedUrl)) return
    void showConnectionError(errorDescription)
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  void loadMindmapChat().catch((error) => showConnectionError(error.message))
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 430,
    minWidth: 460,
    minHeight: 390,
    parent: mainWindow || undefined,
    modal: process.platform !== 'darwin',
    title: 'MindmapChat 连接设置',
    backgroundColor: '#f7f7ff',
    webPreferences: secureWebPreferences(),
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.on('closed', () => { settingsWindow = null })
  void settingsWindow.loadFile(join(rendererDirectory, 'settings.html'))
}

function installApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: '服务器设置…', accelerator: 'Command+,', click: openSettingsWindow },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        ...(!isMac ? [{ label: '服务器设置…', accelerator: 'Ctrl+,', click: openSettingsWindow }, { type: 'separator' }] : []),
        { role: isMac ? 'close' : 'quit', label: isMac ? '关闭窗口' : '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' }, { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }, { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放窗口' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : []),
      ],
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: '打开 MindmapChat 服务', click: () => openExternal(activeServerUrl) },
        { label: '关于 MindmapChat Desktop', click: () => dialog.showMessageBox({
          type: 'info',
          title: '关于 MindmapChat Desktop',
          message: 'MindmapChat Desktop',
          detail: `版本 ${app.getVersion()}\n把对话变成思维导图，让每一次追问都有迹可循。`,
        }) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.handle('desktop:get-state', () => ({
  serverUrl: activeServerUrl,
  defaultServerUrl: DEFAULT_SERVER_URL,
  error: lastLoadError,
  version: app.getVersion(),
}))
ipcMain.handle('desktop:apply-settings', async (_event, serverUrl) => {
  try {
    saveServerUrl(serverUrl)
    settingsWindow?.close()
    await loadMindmapChat()
    mainWindow?.show()
    mainWindow?.focus()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})
ipcMain.handle('desktop:retry', async () => {
  try {
    await loadMindmapChat()
    return { ok: true }
  } catch (error) {
    await showConnectionError(error.message)
    return { ok: false, error: error.message }
  }
})
ipcMain.on('desktop:open-settings', openSettingsWindow)
ipcMain.on('desktop:close-settings', () => settingsWindow?.close())

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createMainWindow()
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.whenReady().then(() => {
    activeServerUrl = readServerUrl()
    installApplicationMenu()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
