import type { Text } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'

/** 글자 범위 (from 이상 to 미만) */
export interface TextRange {
  from: number
  to: number
}

/** 숨긴 기호 자리에 대신 보여줄 모양 */
export type MarkWidget =
  | { kind: 'bullet'; symbol: string }
  | { kind: 'task'; checked: boolean }
  | { kind: 'callout'; title: string }

/** 숨길 범위. widget이 있으면 그 자리에 대신 그린다. */
export interface HiddenMark extends TextRange {
  widget?: MarkWidget
}

/** 꾸밈 요소 이름 → 그 요소의 기호 이름 */
const INLINE_MARKS: Record<string, string> = {
  StrongEmphasis: 'EmphasisMark',
  Emphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark'
}

const HEADING = /^ATXHeading[1-6]$/
const SETEXT_HEADING = /^SetextHeading[12]$/
/** front matter 안에서 시작하면 건너뛸 줄 단위 요소 */
const BLOCKS = new Set(['HorizontalRule', 'Blockquote', 'BulletList', 'OrderedList'])

/** 콜아웃 첫 줄 `> [!NOTE]` (편집 화면의 콜아웃 상자도 이 규칙으로 찾는다) */
export const CALLOUT = /^\s*(?:>\s*)+\[!(note|tip|important|warning|caution)\]/i

/** 목록 깊이별 글머리표 (PDF의 disc · circle · square) */
const BULLETS = ['●', '○', '■']

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
 * Typora처럼 숨길 문법 기호의 범위. visible 범위 안에 걸친 요소만 계산한다.
 * - 줄 안: **, *, ~~, `, # (커서나 선택 영역이 닿은 요소는 기호를 남긴다)
 * - 줄 단위: 수평선, 밑줄식 제목의 아래 줄, 목록 기호, 체크박스, 인용 >, 콜아웃 [!NOTE]
 *   (커서나 선택 영역이 닿은 줄은 원문을 남긴다. 밑줄식 제목은 제목 전체를 본다)
 * 코드 블록과 문서 맨 위 front matter 안은 건드리지 않는다.
 * frontMatter는 frontMatterEnd(doc)로 구한 값이다. 커서만 움직일 때 다시 찾지 않도록 따로 받는다.
 */
export function hiddenMarkRanges(
  doc: Text,
  tree: Tree,
  frontMatter: number,
  selection: readonly TextRange[],
  visible: readonly TextRange[] = [{ from: 0, to: doc.length }]
): HiddenMark[] {
  const ranges: HiddenMark[] = []
  const touched = (from: number, to: number) => selection.some((range) => range.from <= to && range.to >= from)
  const touchedLine = (pos: number) => {
    const line = doc.lineAt(pos)
    return touched(line.from, line.to)
  }
  // 보이는 범위가 여러 개면 둘에 걸친 요소를 두 번 만나므로, 시작 위치로 한 번만 넣는다.
  const added = new Set<number>()
  // 지금 커서가 닿은 꾸밈 요소 안에 몇 겹 들어와 있는지. 0보다 크면 꾸밈 기호를 숨기지 않는다.
  let revealed = 0
  // 콜아웃 첫 줄은 통째로 제목으로 바꾸므로, 그 안의 > 는 따로 숨기지 않는다.
  const callouts: TextRange[] = []
  const hide = (from: number, to: number, widget?: MarkWidget) => {
    if (added.has(from) || callouts.some((range) => range.from <= from && from < range.to)) return
    added.add(from)
    ranges.push(widget ? { from, to, widget } : { from, to })
  }

  /** 순서 없는 목록 기호는 글머리표로, 체크박스는 체크박스 모양으로 바꾼다. 순서 있는 목록의 번호는 그대로 둔다. */
  const listItem = (item: SyntaxNode) => {
    const mark = item.getChild('ListMark')
    if (!mark || touchedLine(mark.from)) return
    const bullet = item.parent?.name === 'BulletList'
    const task = item.getChild('Task')?.getChild('TaskMarker')
    if (task) {
      // PDF처럼 체크박스 줄엔 글머리표를 그리지 않는다.
      if (bullet) hide(mark.from, task.from)
      hide(task.from, task.to, { kind: 'task', checked: doc.sliceString(task.from + 1, task.from + 2) !== ' ' })
    } else if (bullet) {
      const level = depth(item, 'BulletList') + depth(item, 'OrderedList') - 1
      hide(mark.from, mark.to, { kind: 'bullet', symbol: BULLETS[Math.min(level, BULLETS.length - 1)] })
    }
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
        // front matter 안에서 시작한 요소는 기호를 하나도 숨기지 않는다.
        if (node.from < frontMatter && (heading || markName || BLOCKS.has(node.name) || SETEXT_HEADING.test(node.name))) {
          return false
        }
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
        if (SETEXT_HEADING.test(node.name)) {
          // 아래 줄(=== / ---)만 숨기고, 안쪽 굵게 등은 따로 판단한다.
          if (touched(node.from, node.to)) return
          for (const mark of node.node.getChildren('HeaderMark')) hide(mark.from, mark.to)
          return
        }
        if (markName) {
          // 커서가 닿은 요소는 안쪽 요소의 기호까지 모두 보여준다.
          // 여러 줄에 걸친 요소 안의 > 같은 줄 단위 기호는 줄마다 따로 판단하도록 안쪽까지 내려간다.
          if (revealed > 0 || touched(node.from, node.to)) {
            revealed++
            return
          }
          for (const mark of node.node.getChildren(markName)) hide(mark.from, mark.to)
          return
        }
        switch (node.name) {
          case 'HorizontalRule':
            if (!touchedLine(node.from)) hide(node.from, node.to)
            return false
          case 'Blockquote': {
            // 맨 바깥 인용의 첫 줄이 [!NOTE] 면 > 와 [!NOTE] 를 PDF처럼 제목으로 바꾼다.
            const line = doc.lineAt(node.from)
            const callout = CALLOUT.exec(line.text)
            if (callout && !isInside(node.node, 'Blockquote') && !touched(line.from, line.to)) {
              const kind = callout[1].toLowerCase()
              const title = line.text.slice(callout[0].length).trim() || kind[0].toUpperCase() + kind.slice(1)
              hide(node.from, line.to, { kind: 'callout', title })
              callouts.push({ from: node.from, to: line.to })
            }
            return
          }
          case 'QuoteMark':
            // > 뒤의 띄어쓰기 하나도 함께 숨긴다.
            if (!touchedLine(node.from)) hide(node.from, node.to + (/[ \t]/.test(doc.sliceString(node.to, node.to + 1)) ? 1 : 0))
            return
          case 'ListItem':
            listItem(node.node)
            return
        }
        return
      },
      leave: (node) => {
        if (INLINE_MARKS[node.name] && revealed > 0) revealed--
      }
    })
  }
  return ranges
}

function isInside(node: SyntaxNode, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === name) return true
  return false
}

function depth(node: SyntaxNode, name: string): number {
  let count = 0
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === name) count++
  return count
}
