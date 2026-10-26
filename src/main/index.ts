import { existsSync } from 'node:fs'
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import type { CloseChoice, MenuCommand, OpenedFile } from '../shared/api'

const isMac = process.platform === 'darwin'
/** 자동 테스트용: 저장·PDF 창 대신 이 폴더에 바로 저장한다. */
const testDir = process.env.MDEDITOR_TEST_DIR

let mainWindow: BrowserWindow | null = null
let windowEdited = false
let allowClose = false
let quitting = false
let rendererReady = false
const pendingPaths: string[] = []

// 자동 테스트가 실제 앱 설정(미리보기 폭 등)을 건드리지 않게 따로 저장한다.
if (testDir) app.setPath('userData', join(testDir, 'user-data'))

// 이미지 미리보기·PDF에서 내 컴퓨터 파일을 보여주기 위한 주소 (mdfile://local/<경로>)
protocol.registerSchemesAsPrivileged([
  { scheme: 'mdfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const isMarkdownPath = (path: string): boolean => ['.md', '.markdown'].includes(extname(path).toLowerCase())

async function readMarkdown(path: string): Promise<OpenedFile> {
  return { path, content: await readFile(path, 'utf8') }
}

/** 파일 더블클릭·드래그 등으로 OS가 넘겨준 파일을 화면에 탭으로 연다. */
async function openPaths(paths: string[]): Promise<void> {
  if (!mainWindow || !rendererReady) {
    pendingPaths.push(...paths)
    return
  }
  for (const path of paths) {
    try {
      mainWindow.webContents.send('open-file', await readMarkdown(path))
    } catch (error) {
      dialog.showErrorBox('파일을 열 수 없습니다', `${path}\n${String(error)}`)
    }
  }
}

function send(command: MenuCommand): void {
  mainWindow?.webContents.send('menu', command)
}

function buildMenu(): void {
  const item = (label: string, accelerator: string, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(command)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `${app.name} 정보` },
              { type: 'separator' },
              { role: 'services', label: '서비스' },
              { type: 'separator' },
              { role: 'hide', label: `${app.name} 가리기` },
              { role: 'hideOthers', label: '기타 가리기' },
              { role: 'unhide', label: '모두 보기' },
              { type: 'separator' },
              { role: 'quit', label: `${app.name} 종료` }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: '파일',
      submenu: [
        item('새 탭', 'CmdOrCtrl+N', 'new'),
        item('열기…', 'CmdOrCtrl+O', 'open'),
        { type: 'separator' },
        item('저장', 'CmdOrCtrl+S', 'save'),
        item('다른 이름으로 저장…', 'CmdOrCtrl+Shift+S', 'saveAs'),
        item('PDF로 내보내기…', 'CmdOrCtrl+Alt+E', 'exportPDF'),
        { type: 'separator' },
        item('탭 닫기', 'CmdOrCtrl+W', 'closeTab'),
        ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'quit', label: '끝내기' } as const])
      ]
    },
    {
      label: '편집',
      submenu: [
        item('실행 취소', 'CmdOrCtrl+Z', 'undo'),
        item('실행 복귀', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', 'redo'),
        { type: 'separator' },
        { role: 'cut', label: '오려두기' },
        { role: 'copy', label: '복사하기' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
        { type: 'separator' },
        item('찾기…', 'CmdOrCtrl+F', 'find'),
        item('찾기 및 바꾸기…', isMac ? 'Cmd+Alt+F' : 'Ctrl+H', 'replace')
      ]
    },
    {
      label: '서식',
      submenu: [
        item('굵게', 'CmdOrCtrl+B', 'bold'),
        item('기울임', 'CmdOrCtrl+I', 'italic'),
        item('취소선', 'CmdOrCtrl+Shift+X', 'strikethrough'),
        item('코드', 'CmdOrCtrl+Shift+C', 'code'),
        item('링크', 'CmdOrCtrl+K', 'link')
      ]
    },
    {
      label: '보기',
      submenu: [item('PDF 미리보기 보기/숨기기', 'CmdOrCtrl+Alt+P', 'togglePreview')]
    },
    ...(app.isPackaged
      ? []
      : [{ label: '개발', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] } satisfies MenuItemConstructorOptions]),
    {
      label: '윈도우',
      submenu: [
        item('다음 탭', 'Ctrl+Tab', 'nextTab'),
        item('이전 탭', 'Ctrl+Shift+Tab', 'previousTab'),
        { type: 'separator' },
        { role: 'minimize', label: '최소화' },
        ...(isMac ? [{ role: 'zoom', label: '확대/축소' } as const] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  rendererReady = false
  allowClose = false
  windowEdited = false
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.min(900, screenWidth),
    height: Math.min(940, screenHeight),
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: 'MdMaker',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = window

  window.once('ready-to-show', () => window.show())
  window.webContents.on('did-finish-load', () => {
    rendererReady = true
    void openPaths(pendingPaths.splice(0))
  })
  // 화면 안의 링크가 앱 창을 바꾸지 않게 하고, 웹 주소는 기본 브라우저로 연다.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // 저장 안 한 문서가 있으면 바로 닫지 않고 화면에 물어보게 한다.
  window.on('close', (event) => {
    if (allowClose || !windowEdited) return
    event.preventDefault()
    window.webContents.send('close-request')
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIPC(): void {
  ipcMain.handle('open-dialog', async (): Promise<OpenedFile[]> => {
    if (testDir || !mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    return Promise.all(result.filePaths.map(readMarkdown))
  })

  ipcMain.handle('read-file', (_event, path: string) => readMarkdown(path))

  ipcMain.handle('save', (_event, path: string, content: string) => writeFile(path, content, 'utf8'))

  ipcMain.handle('save-as', async (_event, content: string, defaultName: string, defaultDir?: string) => {
    let path: string | undefined
    if (testDir) {
      path = join(testDir, defaultName)
    } else if (mainWindow) {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(defaultDir ?? app.getPath('documents'), defaultName),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      path = result.canceled ? undefined : result.filePath
    }
    if (!path) return null
    await writeFile(path, content, 'utf8')
    return path
  })

  ipcMain.handle('confirm-close', async (_event, names: string[]): Promise<CloseChoice> => {
    if (testDir) return (process.env.MDEDITOR_TEST_CLOSE_CHOICE as CloseChoice | undefined) ?? 'discard'
    if (!mainWindow) return 'cancel'
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message:
        names.length === 1
          ? `"${names[0]}"의 변경 내용을 저장할까요?`
          : `저장하지 않은 문서가 ${names.length}개 있습니다. 저장할까요?`,
      detail: '저장하지 않으면 변경 내용이 사라집니다.'
    })
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
  })

  ipcMain.handle('export-pdf', async (_event, html: string, defaultName: string, defaultDir?: string) => {
    let target: string | undefined
    if (testDir) {
      target = join(testDir, defaultName)
    } else if (mainWindow) {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(defaultDir ?? app.getPath('documents'), defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      target = result.canceled ? undefined : result.filePath
    }
    if (!target) return null

    // 화면에 띄우지 않는 창에 HTML을 열고 A4로 인쇄한다. 문서 속 스크립트는 실행하지 않는다.
    const page = join(app.getPath('temp'), `mdeditor-print-${process.pid}-${Date.now()}.html`)
    await writeFile(page, html, 'utf8')
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
    try {
      await printer.loadFile(page)
      const pdf = await printer.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 }
      })
      await writeFile(target, pdf)
    } finally {
      printer.destroy()
      await rm(page, { force: true })
    }
    return target
  })

  ipcMain.handle('open-external', async (_event, url: string) => {
    if (!/^(https?|mailto):/i.test(url)) return
    // 자동 테스트에선 브라우저를 띄우지 않고 기록만 남긴다.
    if (testDir) await appendFile(join(testDir, 'opened-urls.txt'), url + '\n')
    else await shell.openExternal(url)
  })

  ipcMain.on('window-state', (_event, title: string, edited: boolean) => {
    windowEdited = edited
    mainWindow?.setTitle(title)
    if (isMac) mainWindow?.setDocumentEdited(edited)
  })

  // PDF 미리보기를 열면 그 폭만큼 창을 오른쪽으로 넓히고, 닫으면 되돌린다.
  ipcMain.handle('resize-window-by', (_event, delta: number) => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isFullScreen()) return 0
    const bounds = mainWindow.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const width = Math.min(Math.max(bounds.width + delta, 480), area.width)
    const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))
    mainWindow.setBounds({ ...bounds, x, width }, true)
    return width - bounds.width
  })

  ipcMain.on('close-window', () => {
    allowClose = true
    mainWindow?.close()
    if (quitting) app.quit()
  })
}

// 앱은 하나만 띄우고, 다시 실행하면(Windows에서 파일 더블클릭 등) 기존 창에 탭으로 연다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    void openPaths(argv.filter((arg) => isMarkdownPath(arg) && existsSync(arg)))
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  app.on('open-file', (event, path) => {
    event.preventDefault()
    void openPaths([path])
  })

  app.on('before-quit', () => {
    quitting = true
  })

  void app.whenReady().then(() => {
    protocol.handle('mdfile', (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname.slice(1))
      return net.fetch(pathToFileURL(path).toString())
    })
    registerIPC()
    buildMenu()
    createWindow()
    pendingPaths.push(...process.argv.slice(1).filter((arg) => isMarkdownPath(arg) && existsSync(arg)))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    quitting = false
    if (!isMac) app.quit()
  })
}

