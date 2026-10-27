import { markdownLanguage } from '@codemirror/lang-markdown'
import { Text } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { frontMatterEnd, hiddenMarkRanges, type TextRange } from '../../src/renderer/src/markdown/hiddenMarks'

/** 커서를 cursor에 두었을 때 기호를 숨기고 남는 글자. shown을 주면 그 범위만 화면에 보인다고 본다. */
const visible = (text: string, cursor: number | [number, number], shown?: TextRange[]) => {
  const [from, to] = typeof cursor === 'number' ? [cursor, cursor] : cursor
  const doc = Text.of(text.split('\n'))
  const ranges = hiddenMarkRanges(doc, markdownLanguage.parser.parse(text), frontMatterEnd(doc), [{ from, to }], shown)
  let result = ''
  let last = 0
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    result += text.slice(last, range.from)
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
