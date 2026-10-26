import { describe, expect, test } from 'vitest'
import { insertLink, toggleWrap, type TextEdit } from '../../src/renderer/src/markdown/editing'

const apply = (text: string, edit: TextEdit) => ({
  text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
  selection: [edit.anchor, edit.head]
})

describe('⌘B / ⌘I 감싸기', () => {
  test('선택 영역을 감싼다', () => {
    expect(apply('굵게', toggleWrap('굵게', 0, 2, '**'))).toEqual({ text: '**굵게**', selection: [2, 4] })
  })
  test('바깥 기호를 벗긴다', () => {
    expect(apply('**굵게**', toggleWrap('**굵게**', 2, 4, '**'))).toEqual({ text: '굵게', selection: [0, 2] })
  })
  test('안쪽 기호를 벗긴다', () => {
    expect(apply('**굵게**', toggleWrap('**굵게**', 0, 6, '**'))).toEqual({ text: '굵게', selection: [0, 2] })
  })
  test('굵은 글자에 기울임을 더하고 빼기', () => {
    expect(apply('**굵게**', toggleWrap('**굵게**', 2, 4, '*')).text).toBe('***굵게***')
    expect(apply('***굵게***', toggleWrap('***굵게***', 3, 5, '*')).text).toBe('**굵게**')
  })
  test('선택이 없으면 기호 쌍을 넣고 커서를 가운데 둔다', () => {
    expect(apply('', toggleWrap('', 0, 0, '**'))).toEqual({ text: '****', selection: [2, 2] })
  })
  test('링크', () => {
    expect(apply('글', insertLink('글', 0, 1))).toEqual({ text: '[글]()', selection: [4, 4] })
    expect(apply('', insertLink('', 0, 0))).toEqual({ text: '[]()', selection: [1, 1] })
  })
})
