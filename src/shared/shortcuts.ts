import type { MenuCommand } from './api'

/** 메뉴 명령마다 붙는 단축키. 메뉴(main)와 문법 창(renderer)이 이 표 하나를 같이 쓴다. */
export function menuAccelerators(isMac: boolean): Record<MenuCommand, string> {
  return {
    new: 'CmdOrCtrl+N',
    open: 'CmdOrCtrl+O',
    save: 'CmdOrCtrl+S',
    saveAs: 'CmdOrCtrl+Shift+S',
    exportPDF: 'CmdOrCtrl+Alt+E',
    closeTab: 'CmdOrCtrl+W',
    undo: 'CmdOrCtrl+Z',
    redo: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
    find: 'CmdOrCtrl+F',
    replace: isMac ? 'Cmd+Alt+F' : 'Ctrl+H',
    bold: 'CmdOrCtrl+B',
    italic: 'CmdOrCtrl+I',
    strikethrough: 'CmdOrCtrl+Shift+X',
    code: 'CmdOrCtrl+Shift+C',
    link: 'CmdOrCtrl+K',
    increaseFontSize: 'CmdOrCtrl+=',
    decreaseFontSize: 'CmdOrCtrl+-',
    resetFontSize: 'CmdOrCtrl+0',
    togglePreview: 'CmdOrCtrl+Alt+P',
    toggleSyntaxPanel: 'CmdOrCtrl+Alt+L',
    toggleSourceMode: 'CmdOrCtrl+/',
    nextTab: 'Ctrl+Tab',
    previousTab: 'Ctrl+Shift+Tab'
  }
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘' }

/** Electron 단축키 글자를 사람이 읽는 모양으로: Mac은 `⌥⌘P`, Windows는 `Ctrl+Alt+P` */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  const modifiers = new Set(parts.map((part) => (part === 'CmdOrCtrl' ? (isMac ? 'Cmd' : 'Ctrl') : part)))
  if (isMac) {
    // Mac 메뉴와 같은 순서: ⌃ ⌥ ⇧ ⌘
    return ['Ctrl', 'Alt', 'Shift', 'Cmd'].filter((name) => modifiers.has(name)).map((name) => MAC_SYMBOLS[name]).join('') + key
  }
  return [...['Ctrl', 'Alt', 'Shift'].filter((name) => modifiers.has(name)), key].join('+')
}
