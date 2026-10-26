import { describe, expect, test } from 'vitest'
import { renderBody, renderPage } from '../../src/renderer/src/markdown/html'
import { fileURL } from '../../src/renderer/src/markdown/paths'

describe('PDF용 HTML', () => {
  test('특수문자를 이스케이프하고 GFM을 지원한다', () => {
    const html = renderBody('a < b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n- [x] 끝\n- [ ] 할 일\n\n~~취소~~')
    expect(html).toContain('a &lt; b')
    expect(html).toContain('<table>')
    expect(html).toContain('<input type="checkbox" disabled checked> 끝')
    expect(html).toContain('<input type="checkbox" disabled> 할 일')
    expect(html).toContain('<s>취소</s>')
  })
  test('코드 블록을 색칠한다', () => {
    expect(renderBody('```swift\nlet a = 1\n```')).toContain('<span class="hljs-keyword">let</span>')
  })
  test('Mermaid는 미리 그린 SVG로 바꾼다', () => {
    const code = 'flowchart TD\n    A --> B\n'
    expect(renderBody('```mermaid\n' + code + '```', { mermaidSVGs: { [code]: '<svg>그림</svg>' } })).toContain(
      '<div class="mermaid"><svg>그림</svg></div>'
    )
  })
  test('각주', () => {
    const html = renderBody('본문[^1]\n\n[^1]: 설명입니다.')
    expect(html).toContain('class="footnote-ref"')
    expect(html).toContain('class="footnotes"')
    expect(html).not.toContain('[^1]')
  })
  test('콜아웃', () => {
    expect(renderBody('> [!WARNING]\n> 조심하세요')).toContain(
      '<blockquote class="callout callout-warning">\n<p class="callout-title">Warning</p>\n<p>조심하세요</p>'
    )
    expect(renderBody('> [!TIP] 알아두면 좋아요\n>\n> 내용')).toContain('<p class="callout-title">알아두면 좋아요</p>')
    // 미리보기용 줄 번호가 붙어도 콜아웃으로 바뀐다 (미리보기와 PDF가 같아야 한다)
    expect(renderBody('> [!NOTE]\n> 참고', { sourceLines: true })).toContain('<blockquote class="callout callout-note" data-line="0">')
  })
  test('접기 상자는 펼쳐서, 문서 정보는 숨겨서', () => {
    expect(renderBody('<details>\n<summary>요약</summary>\n내용\n</details>')).toContain('<details open>')
    const html = renderBody('---\ntitle: 비밀\n---\n본문')
    expect(html).not.toContain('비밀')
    expect(html).not.toContain('<hr')
  })
  test('내 컴퓨터 이미지는 mdfile 주소로', () => {
    expect(renderBody('![그림](a.png)', { documentDir: '/Users/me' })).toContain(`src="${fileURL('/Users/me/a.png')}"`)
  })
  test('표 미리보기에선 문서 속 HTML을 넣지 않는다', () => {
    expect(renderBody('<img src=x onerror=alert(1)>', { allowRawHTML: false })).not.toContain('<img')
  })
  test('완성된 페이지', () => {
    expect(renderPage('# 제목')).toMatch(/^<!doctype html>[\s\S]*<h1>제목<\/h1>/)
  })
})
