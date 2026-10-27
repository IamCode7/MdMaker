import { markdownLanguage } from '@codemirror/lang-markdown'
import { Text } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { frontMatterEnd, hiddenMarkRanges, type MarkWidget, type TextRange } from '../../src/renderer/src/markdown/hiddenMarks'

/** 대신 그리는 모양을 글자로: 글머리표는 그대로, 체크박스는 ☐/☑, 콜아웃은 제목 */
const widgetText = (widget?: MarkWidget) =>
  !widget ? '' : widget.kind === 'bullet' ? widget.symbol : widget.kind === 'task' ? (widget.checked ? '☑' : '☐') : widget.title

/** 커서를 cursor에 두었을 때 기호를 숨기고(대신 그리는 모양은 글자로 넣고) 남는 글자. shown을 주면 그 범위만 화면에 보인다고 본다. */
const visible = (text: string, cursor: number | [number, number], shown?: TextRange[]) => {
  const [from, to] = typeof cursor === 'number' ? [cursor, cursor] : cursor
  const doc = Text.of(text.split('\n'))
  const ranges = hiddenMarkRanges(doc, markdownLanguage.parser.parse(text), frontMatterEnd(doc), [{ from, to }], shown)
  let result = ''
  let last = 0
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    result += text.slice(last, range.from) + widgetText(range.widget)
    last = range.to
  }
  return result + text.slice(last)
}

describe('문법 기호 숨기기', () => {
  const line = '앞 **굵게** *기울임* ~~취소~~ `코드` 뒤'

  test('커서가 닿지 않으면 굵게·기울임·취소선·인라인 코드 기호를 숨긴다', () => {
    expect(visible(line, 0)).toBe('앞 굵게 기울임 취소 코드 뒤')
  })

  test('커서가 안에 있거나 바로 앞뒤에 닿은 요소만 기호를 보여준다', () => {
    expect(visible(line, line.indexOf('굵게'))).toBe('앞 **굵게** 기울임 취소 코드 뒤')
    expect(visible(line, line.indexOf('*기울임'))).toBe('앞 굵게 *기울임* 취소 코드 뒤')
    expect(visible(line, line.indexOf('~~ `'))).toBe('앞 굵게 기울임 ~~취소~~ 코드 뒤')
    expect(visible(line, line.indexOf(' 뒤'))).toBe('앞 굵게 기울임 취소 `코드` 뒤')
  })

  test('선택 영역이 걸친 요소는 모두 기호를 보여준다', () => {
    expect(visible(line, [line.indexOf('굵게'), line.indexOf('기울임')])).toBe('앞 **굵게** *기울임* 취소 코드 뒤')
  })

  test('겹친 꾸밈은 바깥 요소에 닿으면 안쪽 기호까지 보여준다', () => {
    expect(visible('***둘 다*** 끝', 0)).toBe('***둘 다*** 끝')
    expect(visible('***둘 다*** 끝', 12)).toBe('둘 다 끝')
  })

  test('제목은 커서가 그 줄에 있을 때만 # 과 띄어쓰기를 보여준다', () => {
    const text = '## 제목\n\n본문'
    expect(visible(text, text.length)).toBe('제목\n\n본문')
    expect(visible(text, 3)).toBe('## 제목\n\n본문')
  })

  test('제목 줄에 커서가 있어도 안쪽 굵게는 따로 판단한다', () => {
    const text = '# 제목 **굵게** 끝'
    expect(visible(text, 2)).toBe('# 제목 굵게 끝')
    expect(visible(text, text.indexOf('굵게'))).toBe('# 제목 **굵게** 끝')
  })

  test('제목 끝의 닫는 # 도 숨긴다', () => {
    expect(visible('# 제목 #\n\n본문', 10)).toBe('제목 \n\n본문')
  })

  test('코드 블록 안은 건드리지 않는다', () => {
    const text = '```\n# 아님 **굵게** `코드`\n```\n\n끝'
    expect(visible(text, text.length)).toBe(text)
  })

  test('문서 맨 위 front matter 안은 건드리지 않는다', () => {
    const text = '---\ntitle: **제목**\n# 주석\n---\n\n# 본문 **굵게**\n\n끝'
    expect(visible(text, text.length)).toBe('---\ntitle: **제목**\n# 주석\n---\n\n본문 굵게\n\n끝')
  })

  test('front matter가 ... 로 닫히고 바로 다음 줄에 본문이 붙어도 본문 기호는 숨긴다', () => {
    const text = '---\ntitle: **test**\n...\n**본문**\n\n끝'
    expect(visible(text, text.length)).toBe('---\ntitle: **test**\n...\n본문\n\n끝')
  })

  test('front matter 안에서 시작해 밖으로 이어지는 꾸밈은 기호를 하나도 숨기지 않는다', () => {
    const text = '---\ntitle: "*test"\n...\n본문*\n\n끝'
    expect(visible(text, text.length)).toBe(text)
  })

  test('화면에 보이는 범위에 걸친 요소만 계산한다', () => {
    const text = '**위** 문단\n\n**가운데** 문단\n\n**아래** 문단'
    const middle = text.indexOf('**가운데')
    expect(visible(text, 0, [{ from: middle, to: middle + 4 }])).toBe('**위** 문단\n\n가운데 문단\n\n**아래** 문단')
    // 보이는 범위 두 개가 한 요소에 걸쳐도 한 번만 숨긴다
    const shown = [{ from: middle, to: middle + 3 }, { from: middle + 5, to: middle + 8 }]
    expect(hiddenMarkRanges(Text.of(text.split('\n')), markdownLanguage.parser.parse(text), 0, [{ from: 0, to: 0 }], shown)).toEqual([
      { from: middle, to: middle + 2 },
      { from: middle + 5, to: middle + 7 }
    ])
  })
})

describe('줄 단위 기호 숨기기', () => {
  test('수평선(---, ***, ___)은 커서가 그 줄에 없으면 기호를 숨긴다', () => {
    const text = '위\n\n---\n\n***\n\n___\n\n끝'
    expect(visible(text, text.length)).toBe('위\n\n\n\n\n\n\n\n끝')
    expect(visible(text, text.indexOf('***'))).toBe('위\n\n\n\n***\n\n\n\n끝')
  })

  test('밑줄식 제목은 아래 줄(=== / ---)을 숨기고, 제목에 커서가 닿으면 보여준다', () => {
    const text = '큰 제목\n===\n\n작은 **제목**\n---\n\n끝'
    expect(visible(text, text.length)).toBe('큰 제목\n\n\n작은 제목\n\n\n끝')
    expect(visible(text, 0)).toBe('큰 제목\n===\n\n작은 제목\n\n\n끝')
    // 안쪽 굵게는 따로 판단한다
    expect(visible(text, text.indexOf('작은'))).toBe('큰 제목\n\n\n작은 제목\n---\n\n끝')
  })

  test('문서 맨 위 front matter의 --- 는 수평선·밑줄식 제목으로 보지 않는다', () => {
    const text = '---\ntitle: 문서\n---\n\n- 본문\n\n---\n\n끝'
    expect(visible(text, text.length)).toBe('---\ntitle: 문서\n---\n\n● 본문\n\n\n\n끝')
    const list = '---\n- 목록 같은 줄\n> 인용 같은 줄\n---\n\n끝'
    expect(visible(list, list.length)).toBe(list)
  })

  test('순서 없는 목록(-, *, +)은 깊이에 따라 ● ○ ■ 로 보이고, 순서 있는 목록 번호는 그대로 둔다', () => {
    const text = '- 하나\n  * 둘\n    + 셋\n      - 넷\n\n1. 첫째\n   - 안쪽\n\n끝'
    expect(visible(text, text.length)).toBe('● 하나\n  ○ 둘\n    ■ 셋\n      ■ 넷\n\n1. 첫째\n   ○ 안쪽\n\n끝')
  })

  test('커서가 닿은 목록 줄만 원문 기호를 보여준다', () => {
    const text = '- 하나\n  - 둘\n\n끝'
    expect(visible(text, text.indexOf('둘'))).toBe('● 하나\n  - 둘\n\n끝')
    expect(visible(text, 0)).toBe('- 하나\n  ○ 둘\n\n끝')
  })

  test('체크박스는 글머리표 없이 체크박스 모양으로 보인다', () => {
    const text = '- [ ] 할 일\n- [x] 한 일\n* [X] 큰 X\n1. [ ] 번호\n\n끝'
    expect(visible(text, text.length)).toBe('☐ 할 일\n☑ 한 일\n☑ 큰 X\n1. ☐ 번호\n\n끝')
    expect(visible(text, text.indexOf('한 일'))).toBe('☐ 할 일\n- [x] 한 일\n☑ 큰 X\n1. ☐ 번호\n\n끝')
  })

  test('체크박스 모양은 원문 [ ] 자리를 그대로 대신한다 (클릭 위치 찾기용)', () => {
    const text = '- [ ] 할 일\n\n끝'
    const doc = Text.of(text.split('\n'))
    const ranges = hiddenMarkRanges(doc, markdownLanguage.parser.parse(text), 0, [{ from: text.length, to: text.length }])
    expect(ranges).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 5, widget: { kind: 'task', checked: false } }
    ])
  })

  test('인용문은 > 와 뒤 띄어쓰기를 숨기고, 중첩 인용도 숨긴다', () => {
    const text = '> 바깥\n> 이어짐\n> > 안쪽\n>\n> - 목록\n\n끝'
    expect(visible(text, text.length)).toBe('바깥\n이어짐\n안쪽\n\n● 목록\n\n끝')
    expect(visible(text, text.indexOf('안쪽'))).toBe('바깥\n이어짐\n> > 안쪽\n\n● 목록\n\n끝')
  })

  test('커서가 닿은 여러 줄 꾸밈 안의 > 는 줄마다 따로 판단한다', () => {
    const text = '> **하나\n> 둘**\n\n끝'
    expect(visible(text, text.indexOf('하나'))).toBe('> **하나\n둘**\n\n끝')
    expect(visible(text, text.indexOf('둘'))).toBe('**하나\n> 둘**\n\n끝')
    expect(visible(text, text.length)).toBe('하나\n둘\n\n끝')
    // 안쪽 꾸밈 기호는 지금처럼 모두 보여준다
    const nested = '> *기울임 **굵게\n> 이어짐** 끝*\n\n끝'
    expect(visible(nested, nested.indexOf('기울임'))).toBe('> *기울임 **굵게\n이어짐** 끝*\n\n끝')
  })

  test('콜아웃은 > 와 [!NOTE] 대신 PDF처럼 제목을 보여준다', () => {
    const text = '> [!NOTE]\n> 참고\n\n> [!warning]\n> 조심\n\n> [!TIP]  내 제목 \n> 도움말\n\n끝'
    expect(visible(text, text.length)).toBe('Note\n참고\n\nWarning\n조심\n\n내 제목\n도움말\n\n끝')
  })

  test('콜아웃 첫 줄에 커서가 닿으면 원문을 보여준다', () => {
    const text = '> [!NOTE]\n> 참고\n\n끝'
    expect(visible(text, 3)).toBe('> [!NOTE]\n참고\n\n끝')
    expect(visible(text, text.indexOf('참고'))).toBe('Note\n> 참고\n\n끝')
  })

  test('중첩 인용의 첫 줄이 [!NOTE] 면 바깥 > 까지 함께 제목으로 바꾼다', () => {
    const text = '> > [!CAUTION]\n> > 위험\n\n끝'
    expect(visible(text, text.length)).toBe('Caution\n위험\n\n끝')
  })

  test('코드 블록 안의 목록·인용·수평선 같은 줄은 건드리지 않는다', () => {
    const text = '```\n- 목록\n> 인용\n---\n- [ ] 할 일\n```\n\n    - 들여쓴 코드\n\n끝'
    expect(visible(text, text.length)).toBe(text)
  })

  test('화면에 보이는 범위에 걸친 줄 단위 요소만 계산한다', () => {
    const text = '- 위\n\n---\n\n> 아래'
    const rule = text.indexOf('---')
    expect(visible(text, text.length + 1, [{ from: rule, to: rule + 3 }])).toBe('- 위\n\n\n\n> 아래')
  })
})
