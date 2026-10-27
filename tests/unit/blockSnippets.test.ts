import { describe, expect, test } from 'vitest'
import { detailsSnippet, tableSnippet, typedBlockTrigger } from '../../src/renderer/src/markdown/blockSnippets'
import { mermaidBlocks, renderBody } from '../../src/renderer/src/markdown/html'

describe('줄 맨 앞 | · < 목록', () => {
  test('줄 맨 앞(들여쓰기만 앞에 있어도)에서 친 | 와 < 만 찾는다', () => {
    expect(typedBlockTrigger('|', true)).toEqual({ mark: '|', indent: '' })
    expect(typedBlockTrigger('  <', true)).toEqual({ mark: '<', indent: '  ' })
    expect(typedBlockTrigger('글 |', true)).toBeNull()
    expect(typedBlockTrigger('||', true)).toBeNull()
    expect(typedBlockTrigger('<d', true)).toBeNull()
    expect(typedBlockTrigger('|', false)).toBeNull()
  })
  test('3×3 표: 머리글 + 구분선 + 본문 2행, 커서는 첫 칸', () => {
    const snippet = tableSnippet('')
    expect(snippet.text).toBe('|  |  |  |\n|---|---|---|\n|  |  |  |\n|  |  |  |')
    expect(snippet.anchor).toBe(2)
    expect(snippet.head).toBe(2)
    expect(renderBody(snippet.text)).toContain('<table>')
    expect(tableSnippet('  ').text.split('\n').slice(1).every((line) => line.startsWith('  |'))).toBe(true)
  })
  test('접기 상자: "제목"을 선택해 둔다', () => {
    const snippet = detailsSnippet('')
    expect(snippet.text).toBe('<details>\n<summary>제목</summary>\n\n내용\n\n</details>')
    expect(snippet.text.slice(snippet.anchor, snippet.head)).toBe('제목')
  })
})

describe('Mermaid 빈 블록', () => {
  test('아직 닫지 않은 블록은 PDF용으로 그리지 않는다', () => {
    expect(mermaidBlocks('앞 본문\n\n```mermaid\n아래 본문')).toEqual([])
    expect(mermaidBlocks('```mermaid\nflowchart TD\n    A --> B\n')).toEqual([])
    expect(mermaidBlocks('> ```mermaid\n> pie\n> ```')).toEqual(['pie\n'])
    expect(mermaidBlocks('````mermaid\npie\n```')).toEqual([])
    // 같은 코드의 그림이 있어도 안 닫힌 블록에는 넣지 않는다.
    const code = 'flowchart TD\n    A --> B\n'
    const svgs = { mermaidSVGs: { [code]: '<svg>그림</svg>' } }
    expect(renderBody('```mermaid\n' + code, svgs)).not.toContain('<svg>')
    expect(renderBody('```mermaid\n' + code + '```', svgs)).toContain('<svg>그림</svg>')
  })
  test('내용이 빈 블록은 PDF용으로 그리지 않는다', () => {
    expect(mermaidBlocks('```mermaid')).toEqual([])
    expect(mermaidBlocks('```mermaid\n\n```')).toEqual([])
    expect(mermaidBlocks('```mermaid\nflowchart TD\n    A -->\n```')).toEqual(['flowchart TD\n    A -->\n'])
  })
})
