import { describe, expect, test } from 'vitest'
import { formatAccelerator, menuAccelerators } from '../../src/shared/shortcuts'

describe('단축키 표시', () => {
  test('Mac은 ⌃ ⌥ ⇧ ⌘ 기호를 메뉴와 같은 순서로 붙인다', () => {
    expect(formatAccelerator('CmdOrCtrl+B', true)).toBe('⌘B')
    expect(formatAccelerator('CmdOrCtrl+Alt+P', true)).toBe('⌥⌘P')
    expect(formatAccelerator('CmdOrCtrl+Shift+S', true)).toBe('⇧⌘S')
    expect(formatAccelerator('Ctrl+Shift+Tab', true)).toBe('⌃⇧Tab')
    expect(formatAccelerator('CmdOrCtrl+-', true)).toBe('⌘-')
    expect(formatAccelerator('CmdOrCtrl+/', true)).toBe('⌘/')
  })
  test('Windows는 Ctrl+Alt+Shift 글자로 쓴다', () => {
    expect(formatAccelerator('CmdOrCtrl+B', false)).toBe('Ctrl+B')
    expect(formatAccelerator('CmdOrCtrl+Alt+L', false)).toBe('Ctrl+Alt+L')
    expect(formatAccelerator('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S')
    expect(formatAccelerator('CmdOrCtrl+=', false)).toBe('Ctrl+=')
  })
  test('문법 창·원문 보기 단축키와 OS별 다른 단축키', () => {
    expect(menuAccelerators(true).toggleSyntaxPanel).toBe('CmdOrCtrl+Alt+L')
    expect(menuAccelerators(true).toggleSourceMode).toBe('CmdOrCtrl+/')
    expect(menuAccelerators(true).redo).toBe('Cmd+Shift+Z')
    expect(menuAccelerators(false).redo).toBe('Ctrl+Y')
  })
})
