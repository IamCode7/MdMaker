import type { Text } from '@codemirror/state'
import type { Tree } from '@lezer/common'

/** 글자 범위 (from 이상 to 미만) */
export interface TextRange {
  from: number
  to: number
}

/** 꾸밈 요소 이름 → 그 요소의 기호 이름 */
const INLINE_MARKS: Record<string, string> = {
  StrongEmphasis: 'EmphasisMark',
  Emphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark'
}

const HEADING = /^ATXHeading[1-6]$/

/** 문서 맨 위 front matter가 끝나는 위치(없으면 0). 규칙은 frontMatterLength와 같고, 문서 전체를 문자열로 만들지 않는다. */
export function frontMatterEnd(doc: Text): number {
  if (doc.line(1).text.trim() !== '---') return 0
  for (let number = 2; number <= doc.lines; number++) {
    const line = doc.line(number)
    const text = line.text.trim()
    if (text === '---' || text === '...') return line.to
  }
  return 0
}

/**
 * Typora처럼 숨길 문법 기호(**, *, ~~, `, # )의 범위. visible 범위 안에 걸친 요소만 계산한다.
 * 커서나 선택 영역이 닿아 있는 요소의 기호는 남긴다. 코드 블록과 문서 맨 위 front matter 안은 건드리지 않는다.
 * frontMatter는 frontMatterEnd(doc)로 구한 값이다. 커서만 움직일 때 다시 찾지 않도록 따로 받는다.
 */
export function hiddenMarkRanges(
  doc: Text,
  tree: Tree,
  frontMatter: number,
  selection: readonly TextRange[],
  visible: readonly TextRange[] = [{ from: 0, to: doc.length }]
): TextRange[] {
  const ranges: TextRange[] = []
  const touched = (from: number, to: number) => selection.some((range) => range.from <= to && range.to >= from)
  // 보이는 범위가 여러 개면 둘에 걸친 요소를 두 번 만나므로, 시작 위치로 한 번만 넣는다.
  const added = new Set<number>()
  const hide = (from: number, to: number) => {
    if (added.has(from)) return
    added.add(from)
    ranges.push({ from, to })
  }

  for (const { from, to } of visible) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        // front matter 안에서 끝나는 요소는 건너뛰고, 밖으로 이어지는 요소는 안쪽까지 내려간다.
        if (node.to <= frontMatter) return false
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
        const markName = INLINE_MARKS[node.name]
        const heading = HEADING.test(node.name)
        // front matter 안에서 시작한 꾸밈 요소는 기호를 하나도 숨기지 않는다.
        if ((heading || markName) && node.from < frontMatter) return false
        if (heading) {
          // 제목 줄에 커서가 있으면 # 기호만 보여주고, 안쪽 굵게 등은 따로 판단한다.
          if (touched(node.from, node.to)) return
          node.node.getChildren('HeaderMark').forEach((mark, index) => {
            // 맨 앞 # 뒤의 띄어쓰기도 함께 숨긴다.
            const space = index === 0 ? /^[ \t]*/.exec(doc.sliceString(mark.to, node.to))![0].length : 0
            hide(mark.from, mark.to + space)
          })
          return
        }
        if (markName) {
          // 커서가 닿은 요소는 안쪽 요소의 기호까지 모두 보여준다.
          if (touched(node.from, node.to)) return false
          for (const mark of node.node.getChildren(markName)) hide(mark.from, mark.to)
        }
        return
      }
    })
  }
  return ranges
}
