import { redo, undo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import type { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { MenuCommand, OpenedFile } from '../../shared/api'
import { formatAccelerator, menuAccelerators } from '../../shared/shortcuts'
import { insertLinkCommand, wrapWith } from './editor/commands'
import { renderMermaid, setDocumentDir } from './editor/livePreview'
import { createEditorState, isSourceMode, setSourceMode } from './editor/setup'
import { mermaidBlocks, renderPage } from './markdown/html'
import { basename, dirname } from './markdown/paths'
import { PdfPreview } from './preview'
import { renderSyntaxPanel } from './syntaxPanel'
import './style.css'

interface Tab {
  id: number
  path: string | null
  untitledNumber: number
  state: EditorState
  /** 마지막으로 저장(또는 연) 때의 내용. 지금 내용과 다르면 "수정됨" */
  saved: Text
}

const api = window.api
const tabsElement = document.getElementById('tabs')!
const statusElement = document.getElementById('status')!
const view = new EditorView({ parent: document.getElementById('editor')! })
const previewElement = document.getElementById('preview')!
const preview = new PdfPreview(previewElement)

const tabs: Tab[] = []
let active: Tab | null = null
let nextId = 1

// MARK: - 탭

const tabName = (tab: Tab): string =>
  tab.path ? basename(tab.path) : tab.untitledNumber > 1 ? `무제 ${tab.untitledNumber}` : '무제'

const stateOf = (tab: Tab): EditorState => (tab === active ? view.state : tab.state)
const isDirty = (tab: Tab): boolean => !stateOf(tab).doc.eq(tab.saved)

function createTab(file?: OpenedFile): Tab {
  const untitledNumbers = new Set(tabs.filter((tab) => !tab.path).map((tab) => tab.untitledNumber))
  let untitledNumber = 1
  while (!file && untitledNumbers.has(untitledNumber)) untitledNumber++

  const state = createEditorState(file?.content ?? '', file ? dirname(file.path) : null, sourceMode, () => {
    updateChrome()
    refreshPreview()
  })
  const tab: Tab = { id: nextId++, path: file?.path ?? null, untitledNumber: file ? 0 : untitledNumber, state, saved: state.doc }
  tabs.push(tab)
  return tab
}

function switchTo(tab: Tab): void {
  if (active && active !== tab) active.state = view.state
  active = tab
  view.setState(tab.state)
  updateChrome()
  refreshPreview(true)
  view.focus()
}

// MARK: - PDF 미리보기

const PREVIEW_WIDTH = 'preview-width'
const toggleButton = document.getElementById('toggle-preview')!
/** 미리보기를 열 때 넓힌 창 폭 (닫을 때 그만큼 되돌린다) */
let widenedBy = 0

function refreshPreview(immediately = false): void {
  if (!active || document.body.classList.contains('preview-hidden')) return
  preview.update(view.state.doc.toString(), active.path ? dirname(active.path) : null, immediately)
}

/** > 버튼: 미리보기를 열고 창을 그 폭만큼 넓힌다. < 버튼: 닫고 창을 되돌린다. */
async function setPreviewVisible(visible: boolean): Promise<void> {
  if (visible === !document.body.classList.contains('preview-hidden')) return
  document.body.classList.toggle('preview-hidden', !visible)
  toggleButton.textContent = visible ? '<' : '>'
  toggleButton.title = visible ? 'PDF 미리보기 닫기 (⌥⌘P)' : 'PDF 미리보기 열기 (⌥⌘P)'
  if (visible) {
    refreshPreview(true)
    widenedBy = await api.resizeWindowBy(previewElement.offsetWidth + 6)
  } else if (widenedBy !== 0) {
    await api.resizeWindowBy(-widenedBy)
    widenedBy = 0
  }
}

function safeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장이 안 되면 다음 실행 때 기본값을 쓴다.
  }
}

function safeLoad(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// MARK: - 문법 창

const SYNTAX_PANEL_OPEN = 'syntax-panel-open'
const SYNTAX_PANEL_WIDTH = 'syntax-panel-width'
const isMac = api.platform === 'darwin'
const accelerators = menuAccelerators(isMac)
const shortcutText = (command: MenuCommand): string => formatAccelerator(accelerators[command], isMac)
const syntaxPanel = document.getElementById('syntax-panel')!
const syntaxButton = document.getElementById('toggle-syntax')!
/** style.css에서 문법 창을 숨기는 좁은 창 기준과 같다. */
const narrowWindow = window.matchMedia('(max-width: 760px)')
/** 문법 창을 열 때 넓힌 창 폭 (닫을 때 그만큼 되돌린다). 넓히지 않은 상태면 null */
let syntaxWidenedBy: number | null = null
/** 창 폭 바꾸기를 한 번에 하나씩 차례로 한다. */
let syntaxResizing = Promise.resolve()

/** 왼쪽 위 < / > 버튼: 문법 창을 열고 창을 그 폭만큼 넓힌다. 닫으면 되돌린다. */
function setSyntaxPanelVisible(visible: boolean): Promise<void> {
  if (visible === !document.body.classList.contains('syntax-hidden')) return syntaxResizing
  // 좁은 창에선 문법 창이 보이지 않으니 열지 않는다. (열림 상태와 창 폭도 그대로)
  if (visible && narrowWindow.matches) return syntaxResizing
  document.body.classList.toggle('syntax-hidden', !visible)
  syntaxButton.textContent = visible ? '>' : '<'
  syntaxButton.title = `문법 창 ${visible ? '닫기' : '열기'} (${shortcutText('toggleSyntaxPanel')})`
  safeStore(SYNTAX_PANEL_OPEN, visible ? '1' : '0')
  // 앞의 창 폭 응답을 기다리는 동안 다시 열고 닫았을 수 있으니, 차례가 왔을 때의 열림 상태에 맞춘다.
  syntaxResizing = syntaxResizing.then(async () => {
    const open = !document.body.classList.contains('syntax-hidden')
    if (open && syntaxWidenedBy === null) {
      syntaxWidenedBy = await api.resizeWindowBy(syntaxPanel.offsetWidth + 6)
    } else if (!open && syntaxWidenedBy !== null) {
      if (syntaxWidenedBy !== 0) await api.resizeWindowBy(-syntaxWidenedBy)
      syntaxWidenedBy = null
    }
  })
  return syntaxResizing
}

/** 문법 창 오른쪽 막대를 끌어서 폭을 바꾼다. */
function setupSyntaxDivider(): void {
  const divider = document.getElementById('syntax-divider')!
  const apply = (width: number) => {
    syntaxPanel.style.width = `${Math.min(Math.max(width, 220), 520)}px`
  }
  const saved = Number(safeLoad(SYNTAX_PANEL_WIDTH))
  if (saved > 0) apply(saved)

  divider.addEventListener('mousedown', (event) => {
    event.preventDefault()
    document.body.classList.add('resizing')
    const startX = event.clientX
    const startWidth = syntaxPanel.offsetWidth
    const move = (moveEvent: MouseEvent) => apply(startWidth + moveEvent.clientX - startX)
    const up = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      safeStore(SYNTAX_PANEL_WIDTH, String(syntaxPanel.offsetWidth))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
}

// MARK: - 원문 보기

const sourceButton = document.getElementById('toggle-source')!
/** 앱 전체 설정: 모든 탭이 같은 상태로 보인다. */
let sourceMode = false

function toggleSourceMode(): void {
  sourceMode = !sourceMode
  sourceButton.classList.toggle('active', sourceMode)
  sourceButton.setAttribute('aria-pressed', String(sourceMode))
  sourceButton.title = `원문 보기 ${sourceMode ? '끄기' : '켜기'} (${shortcutText('toggleSourceMode')})`
  applySourceMode()
}

/** 모든 탭(보고 있는 탭과 저장해 둔 탭)을 지금 원문 보기 설정에 맞춘다. */
function applySourceMode(): void {
  // 한글 조합 중에 꾸미기를 바꾸면 입력이 깨지므로 조합이 끝난 뒤에 맞춘다. 그 사이 탭을 옮겼어도 그때의 탭들을 모두 맞춘다.
  if (view.composing) {
    window.setTimeout(applySourceMode, 50)
    return
  }
  for (const tab of tabs) {
    if (isSourceMode(stateOf(tab)) === sourceMode) continue
    if (tab === active) view.dispatch({ effects: setSourceMode(sourceMode) })
    else tab.state = tab.state.update({ effects: setSourceMode(sourceMode) }).state
  }
}

// MARK: - 편집기 글씨 크기

const EDITOR_FONT_SIZE = 'editor-font-size'
const DEFAULT_FONT_SIZE = 15
const MIN_FONT_SIZE = 11
const MAX_FONT_SIZE = 24
const savedFontSize = Number(safeLoad(EDITOR_FONT_SIZE))
let editorFontSize = Number.isInteger(savedFontSize) && savedFontSize >= MIN_FONT_SIZE && savedFontSize <= MAX_FONT_SIZE
  ? savedFontSize
  : DEFAULT_FONT_SIZE

function setEditorFontSize(size: number): void {
  editorFontSize = Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE)
  view.dom.style.setProperty('--editor-font-size', `${editorFontSize}px`)
  view.requestMeasure()
  safeStore(EDITOR_FONT_SIZE, String(editorFontSize))
}

/** 가운데 막대를 끌어서 미리보기 폭을 바꾼다. */
function setupDivider(): void {
  const divider = document.getElementById('divider')!
  const main = document.getElementById('main')!
  const apply = (width: number) => {
    const clamped = Math.min(Math.max(width, 320), main.clientWidth - 400)
    previewElement.style.width = `${clamped}px`
  }
  const saved = Number(safeLoad(PREVIEW_WIDTH))
  if (saved > 0) apply(saved)

  divider.addEventListener('mousedown', (event) => {
    event.preventDefault()
    document.body.classList.add('resizing')
    const move = (moveEvent: MouseEvent) => apply(main.getBoundingClientRect().right - moveEvent.clientX)
    const up = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      safeStore(PREVIEW_WIDTH, String(previewElement.offsetWidth))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
}

/** 편집 화면을 스크롤하면 미리보기도 같은 곳으로 */
view.scrollDOM.addEventListener('scroll', () => {
  const block = view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop)
  preview.syncTo(view.state.doc.lineAt(block.from).number - 1)
})

function newTab(): void {
  switchTo(createTab())
}

/** 파일을 연다. 이미 열린 파일이면 그 탭으로, 손대지 않은 빈 "무제" 탭이면 그 자리에 연다. */
function openFile(file: OpenedFile): void {
  const existing = tabs.find((tab) => tab.path === file.path)
  if (existing) return switchTo(existing)
  const pristine = active && !active.path && stateOf(active).doc.length === 0 && !isDirty(active) ? active : null
  const tab = createTab(file)
  if (pristine) {
    tabs.pop()
    tabs.splice(tabs.indexOf(pristine), 1, tab)
    active = null
  }
  switchTo(tab)
}

async function closeTab(tab: Tab): Promise<void> {
  if (isDirty(tab)) {
    switchTo(tab)
    const choice = await api.confirmClose([tabName(tab)])
    if (choice === 'cancel') return
    if (choice === 'save' && !(await save(tab))) return
  }
  const index = tabs.indexOf(tab)
  tabs.splice(index, 1)
  if (tabs.length === 0) {
    active = null
    updateChrome()
    api.closeWindow()
    return
  }
  if (tab === active) {
    active = null
    switchTo(tabs[Math.min(index, tabs.length - 1)])
  } else {
    updateChrome()
  }
}

function cycleTab(step: number): void {
  if (!active || tabs.length < 2) return
  switchTo(tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length])
}

/** 탭 막대와 창 제목을 지금 상태에 맞춘다. */
function updateChrome(): void {
  tabsElement.replaceChildren(
    ...tabs.map((tab) => {
      const element = document.createElement('div')
      element.className = 'tab' + (tab === active ? ' active' : '') + (isDirty(tab) ? ' dirty' : '')
      element.title = tab.path ?? tabName(tab)
      element.dataset.id = String(tab.id)
      const title = document.createElement('span')
      title.className = 'tab-title'
      title.textContent = tabName(tab)
      const close = document.createElement('button')
      close.className = 'tab-close'
      close.title = '탭 닫기'
      close.textContent = '×'
      close.addEventListener('click', (event) => {
        event.stopPropagation()
        void closeTab(tab)
      })
      element.addEventListener('mousedown', (event) => {
        if (event.button === 1) void closeTab(tab) // 가운데 버튼 클릭으로 닫기
      })
      element.addEventListener('click', () => switchTo(tab))
      element.append(title, close)
      return element
    })
  )
  if (active) api.setWindowState(`${tabName(active)}${isDirty(active) ? ' •' : ''} — MdMaker`, tabs.some(isDirty))
}

// MARK: - 저장

/** 저장(⌘S): 열려 있는 그 파일에 덮어쓴다. 새 문서면 처음 한 번만 위치를 묻는다. */
async function save(tab: Tab): Promise<boolean> {
  if (!tab.path) return saveAs(tab)
  const doc = stateOf(tab).doc
  await api.save(tab.path, doc.toString())
  tab.saved = doc
  updateChrome()
  return true
}

/** 다른 이름으로 저장(⇧⌘S): 폴더와 이름을 골라 저장하고, 탭은 새 파일을 가리킨다. */
async function saveAs(tab: Tab): Promise<boolean> {
  const doc = stateOf(tab).doc
  const name = tab.path ? basename(tab.path) : `${tabName(tab)}.md`
  const path = await api.saveAs(doc.toString(), name, tab.path ? dirname(tab.path) : undefined)
  if (!path) return false
  tab.path = path
  tab.saved = doc
  const effects = setDocumentDir.of(dirname(path))
  if (tab === active) view.dispatch({ effects })
  else tab.state = tab.state.update({ effects }).state
  updateChrome()
  return true
}

/** 창을 닫으려 할 때: 저장 안 한 문서가 있으면 저장할지 묻는다. */
async function handleCloseRequest(): Promise<void> {
  const dirty = tabs.filter(isDirty)
  if (dirty.length > 0) {
    const choice = await api.confirmClose(dirty.map(tabName))
    if (choice === 'cancel') return
    if (choice === 'save') {
      for (const tab of dirty) {
        switchTo(tab)
        if (!(await save(tab))) return
      }
    }
  }
  api.closeWindow()
}

// MARK: - PDF

async function exportPDF(tab: Tab): Promise<void> {
  const markdown = stateOf(tab).doc.toString()
  // 다이어그램은 화면에서 미리 SVG로 그려 넣는다. (PDF 창에선 스크립트를 실행하지 않는다)
  const mermaidSVGs: Record<string, string> = {}
  for (const code of new Set(mermaidBlocks(markdown))) {
    try {
      mermaidSVGs[code] = await renderMermaid(code, false)
    } catch {
      // 문법이 틀린 다이어그램은 코드 그대로 넣는다.
    }
  }
  const documentDir = tab.path ? dirname(tab.path) : null
  const html = renderPage(markdown, { mermaidSVGs, documentDir })
  const name = tabName(tab).replace(/\.(md|markdown)$/i, '') + '.pdf'
  try {
    const path = await api.exportPDF(html, name, documentDir ?? undefined)
    if (path) showStatus(`PDF로 저장했습니다: ${basename(path)}`)
  } catch (error) {
    showStatus(`PDF를 만들지 못했습니다: ${String(error)}`, true)
  }
}

let statusTimer = 0
function showStatus(message: string, isError = false): void {
  statusElement.textContent = message
  statusElement.className = 'visible' + (isError ? ' error' : '')
  window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => (statusElement.className = ''), 4000)
}

// MARK: - 메뉴 명령

async function run(command: MenuCommand): Promise<void> {
  const tab = active
  switch (command) {
    case 'new': return newTab()
    case 'open': return (await api.openDialog()).forEach(openFile)
    case 'nextTab': return cycleTab(1)
    case 'previousTab': return cycleTab(-1)
    case 'togglePreview': return setPreviewVisible(document.body.classList.contains('preview-hidden'))
    case 'toggleSyntaxPanel': return setSyntaxPanelVisible(document.body.classList.contains('syntax-hidden'))
    case 'toggleSourceMode': return toggleSourceMode()
    case 'increaseFontSize': return setEditorFontSize(editorFontSize + 1)
    case 'decreaseFontSize': return setEditorFontSize(editorFontSize - 1)
    case 'resetFontSize': return setEditorFontSize(DEFAULT_FONT_SIZE)
  }
  if (!tab) return
  switch (command) {
    case 'save': await save(tab); break
    case 'saveAs': await saveAs(tab); break
    case 'closeTab': await closeTab(tab); break
    case 'exportPDF': await exportPDF(tab); break
    case 'undo': undo(view); break
    case 'redo': redo(view); break
    case 'find':
    case 'replace': openSearchPanel(view); break
    case 'bold': wrapWith('**')(view); break
    case 'italic': wrapWith('*')(view); break
    case 'strikethrough': wrapWith('~~')(view); break
    case 'code': wrapWith('`')(view); break
    case 'link': insertLinkCommand(view); break
  }
}

api.onMenu((command) => void run(command))
api.onOpenFile(openFile)
api.onCloseRequest(() => void handleCloseRequest())
document.getElementById('new-tab')!.addEventListener('click', newTab)
toggleButton.addEventListener('click', () => void run('togglePreview'))
syntaxButton.addEventListener('click', () => void run('toggleSyntaxPanel'))
sourceButton.addEventListener('click', () => void run('toggleSourceMode'))
document.body.classList.add('preview-hidden', 'syntax-hidden')
syntaxButton.title = `문법 창 열기 (${shortcutText('toggleSyntaxPanel')})`
sourceButton.title = `원문 보기 켜기 (${shortcutText('toggleSourceMode')})`
setupDivider()
setupSyntaxDivider()
renderSyntaxPanel(syntaxPanel, isMac)
setEditorFontSize(editorFontSize)
if (safeLoad(SYNTAX_PANEL_OPEN) === '1') void setSyntaxPanelVisible(true)

newTab()

// 자동 테스트에서 화면 상태를 확인·조작하는 창구
Object.assign(window, {
  __md: {
    view,
    run,
    tabNames: () => tabs.map(tabName),
    activeIndex: () => (active ? tabs.indexOf(active) : -1),
    dirtyFlags: () => tabs.map(isDirty),
    pdfPreviewPages: () => Number(previewElement.dataset.pages ?? 0),
    pdfPreviewText: () => previewElement.querySelector('iframe')?.contentDocument?.body.innerText ?? '',
    previewStates: () =>
      Array.from(document.querySelectorAll<HTMLElement>('.cm-preview')).map((element) => element.dataset.state ?? 'pending')
  }
})
