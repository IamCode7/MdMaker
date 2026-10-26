import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { frontMatterLength } from '../markdown/frontMatter'
import { renderBody } from '../markdown/html'
import { mermaidConfig } from '../markdown/mermaidTheme'
import { resolveImage } from '../markdown/paths'

const CALLOUT = /^\s*(?:>\s*)+\[!(note|tip|important|warning|caution)\]/i

// MARK: - 문서 폴더 (상대 경로 이미지용)

export const setDocumentDir = StateEffect.define<string | null>()

export const documentDirField = StateField.define<string | null>({
  create: () => null,
  update: (value, tr) => tr.effects.find((effect) => effect.is(setDocumentDir))?.value ?? value
})

// MARK: - 줄·글자 꾸미기

const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

/** 여러 줄에 걸친 블록에 줄마다 클래스를 붙인다. 첫 줄·끝 줄엔 둥근 모서리용 클래스를 더한다. */
function addBlockLines(ranges: Range<Decoration>[], state: EditorState, from: number, to: number, cls: string): void {
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(Math.max(from, to - 1)).number
  for (let number = first; number <= last; number++) {
    const extra = (number === first ? ` ${cls}-first` : '') + (number === last ? ` ${cls}-last` : '')
    ranges.push(line(cls + extra).range(state.doc.line(number).from))
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const text = doc.toString()
  const skipped: [number, number][] = []

  // 문서 맨 위 `---` 사이의 문서 정보: 제목·수평선으로 보이지 않게 회색 상자로
  const frontMatter = frontMatterLength(text)
  if (frontMatter !== null) {
    addBlockLines(ranges, state, 0, frontMatter, 'cm-frontmatter')
    skipped.push([0, frontMatter])
  }
  const inFrontMatter = (pos: number) => frontMatter !== null && pos < frontMatter

  syntaxTree(state).iterate({
    enter: (node) => {
      if (inFrontMatter(node.from)) return node.name === 'Document' ? undefined : false
      switch (node.name) {
        case 'FencedCode':
        case 'CodeBlock':
          addBlockLines(ranges, state, node.from, node.to, 'cm-codeblock')
          skipped.push([node.from, node.to])
          return
        case 'InlineCode':
          skipped.push([node.from, node.to])
          return
        case 'Blockquote': {
          const firstLine = doc.lineAt(node.from).text
          const callout = CALLOUT.exec(firstLine)
          if (callout && !isInside(node.node, 'Blockquote')) {
            addBlockLines(ranges, state, node.from, node.to, `cm-callout cm-callout-${callout[1].toLowerCase()}`)
            const label = firstLine.indexOf('[!')
            const labelEnd = firstLine.indexOf(']', label) + 1
            const start = doc.lineAt(node.from).from
            ranges.push(mark('cm-callout-label').range(start + label, start + labelEnd))
          } else if (!isInsideCallout(node.node, doc)) {
            addBlockLines(ranges, state, node.from, node.to, `cm-quote cm-quote-${Math.min(depth(node.node, 'Blockquote') + 1, 3)}`)
          }
          return
        }
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'SetextHeading1':
        case 'SetextHeading2':
          // PDF처럼 큰 제목 아래에 밑줄
          ranges.push(line('cm-heading-rule').range(doc.lineAt(node.to).from))
          return
        case 'HorizontalRule':
          ranges.push(line('cm-hr').range(doc.lineAt(node.from).from))
          return
        case 'ListMark':
          ranges.push(mark('cm-listmark').range(node.from, node.to))
          return
        case 'TaskMarker':
          ranges.push(mark('cm-task').range(node.from, node.to))
          return
        case 'URL':
          // 괄호 없이 쓴 주소(https://...)와 <주소>는 링크 색으로
          if (!isInside(node.node, 'Link') && !isInside(node.node, 'Image') && !isInside(node.node, 'LinkReference')) {
            ranges.push(mark('cm-bare-url').range(node.from, node.to))
          }
          return
      }
      return
    }
  })

  const isSkipped = (from: number, to: number) => skipped.some(([start, end]) => from < end && to > start)

  // 각주 `[^1]`: 본문에선 작게 위로, 설명 줄 맨 앞에선 강조색
  for (const match of text.matchAll(/\[\^[^\]\s]+\]/g)) {
    const from = match.index
    const to = from + match[0].length
    if (isSkipped(from, to)) continue
    const lineStart = doc.lineAt(from).from
    const isDefinition = text[to] === ':' && /^ *$/.test(text.slice(lineStart, from))
    ranges.push(mark(isDefinition ? 'cm-footnote-def' : 'cm-footnote-ref').range(from, to))
  }

  // 접기 상자 <details>: 테두리 상자, 태그는 흐리게, <summary> 안은 굵게
  for (const match of text.matchAll(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi)) {
    const from = match.index
    const to = from + match[0].length
    if (isSkipped(from, to)) continue
    addBlockLines(ranges, state, from, to, 'cm-details')
    for (const tag of match[0].matchAll(/<\/?(?:details|summary)\b[^>]*>/gi)) {
      ranges.push(mark('md-mark').range(from + tag.index, from + tag.index + tag[0].length))
    }
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(match[0])
    if (summary && summary[1].length > 0) {
      const start = from + summary.index + summary[0].indexOf('>') + 1
      ranges.push(mark('md-strong').range(start, start + summary[1].length))
    }
  }

  return Decoration.set(ranges, true)
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

function isInsideCallout(node: SyntaxNode, doc: EditorState['doc']): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Blockquote' && CALLOUT.test(doc.lineAt(parent.from).text)) return true
  }
  return false
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = buildDecorations(update.state)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

// MARK: - 아래에 그려 보여주는 그림 (Mermaid · 표 · 이미지)

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const refreshPreviews = StateEffect.define<null>()

/** 블록 순서별로 마지막에 그린 다이어그램. 코드를 고치는 동안엔 이전 그림을 먼저 보여준다. */
const lastMermaidSVG = new Map<string, string>()
let mermaidQueue: Promise<unknown> = Promise.resolve()
let mermaidCount = 0

export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  // 다이어그램 하나를 그리는 동안 다른 것과 섞이지 않게 차례로 그린다.
  const job = mermaidQueue.then(async () => {
    mermaid.initialize(mermaidConfig(dark) as Parameters<typeof mermaid.initialize>[0])
    const id = `mermaid-${++mermaidCount}`
    try {
      return (await mermaid.render(id, code)).svg
    } finally {
      document.getElementById(`d${id}`)?.remove()
    }
  })
  mermaidQueue = job.catch(() => undefined)
  return job
}

class MermaidWidget extends WidgetType {
  private timer = 0
  constructor(readonly code: string, readonly key: string, readonly dark: boolean) {
    super()
  }
  eq(other: MermaidWidget) {
    return other.code === this.code && other.dark === this.dark && other.key === this.key
  }
  toDOM() {
    const dom = document.createElement('div')
    dom.className = 'cm-preview cm-preview-mermaid'
    dom.innerHTML = lastMermaidSVG.get(this.key) ?? ''
    // 입력이 0.3초 멈추면 다시 그린다.
    this.timer = window.setTimeout(async () => {
      try {
        const svg = await renderMermaid(this.code, this.dark)
        lastMermaidSVG.set(this.key, svg)
        dom.innerHTML = svg
        dom.dataset.state = 'ok'
      } catch (error) {
        const message = String((error as Error)?.message ?? error).split('\n')[0]
        dom.innerHTML = ''
        const text = document.createElement('div')
        text.className = 'cm-preview-error'
        text.textContent = `Mermaid 문법 오류: ${message}`
        dom.append(text)
        dom.dataset.state = 'error'
      }
    }, 300)
    return dom
  }
  destroy() {
    window.clearTimeout(this.timer)
  }
  ignoreEvent() {
    return true
  }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(other: TableWidget) {
    return other.source === this.source
  }
  toDOM() {
    const dom = document.createElement('div')
    dom.className = 'cm-preview cm-preview-table'
    dom.innerHTML = renderBody(this.source, { allowRawHTML: false })
    dom.dataset.state = 'ok'
    return dom
  }
  ignoreEvent() {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly source: string, readonly documentDir: string | null) {
    super()
  }
  eq(other: ImageWidget) {
    return other.source === this.source && other.documentDir === this.documentDir
  }
  toDOM() {
    const dom = document.createElement('div')
    dom.className = 'cm-preview cm-preview-image'
    const resolved = resolveImage(this.source, this.documentDir)
    const showError = (message: string) => {
      dom.textContent = ''
      const text = document.createElement('div')
      text.className = 'cm-preview-error'
      text.textContent = message
      dom.append(text)
      dom.dataset.state = 'error'
    }
    if ('error' in resolved) {
      showError(resolved.error)
    } else {
      const image = document.createElement('img')
      image.src = resolved.url
      image.onload = () => (dom.dataset.state = 'ok')
      image.onerror = () => showError(`이미지를 불러올 수 없습니다: ${this.source}`)
      dom.append(image)
    }
    return dom
  }
  ignoreEvent() {
    return true
  }
}

function buildPreviews(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const dark = darkQuery.matches
  const documentDir = state.field(documentDirField, false) ?? null
  const frontMatter = frontMatterLength(doc.toString())
  let mermaidIndex = 0
  const widget = (pos: number, value: WidgetType, order: number) =>
    ranges.push(Decoration.widget({ widget: value, block: true, side: 1 + order }).range(doc.lineAt(pos).to))

  syntaxTree(state).iterate({
    enter: (node) => {
      if (frontMatter !== null && node.from < frontMatter) return node.name === 'Document' ? undefined : false
      if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        if (info && doc.sliceString(info.from, info.to).trim().toLowerCase() === 'mermaid') {
          const text = node.node.getChild('CodeText')
          const code = text ? doc.sliceString(text.from, text.to) + '\n' : ''
          widget(node.to, new MermaidWidget(code, `mermaid#${mermaidIndex++}`, dark), 0)
        }
        return false
      }
      if (node.name === 'Table') {
        widget(node.to, new TableWidget(doc.sliceString(node.from, node.to)), 0)
        return false
      }
      if (node.name === 'Image') {
        const url = node.node.getChild('URL')
        if (url) widget(node.to, new ImageWidget(doc.sliceString(url.from, url.to), documentDir), node.from)
        return false
      }
      return
    }
  })
  return Decoration.set(ranges, true)
}

export const previews = StateField.define<DecorationSet>({
  create: buildPreviews,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.effects.some((effect) => effect.is(refreshPreviews) || effect.is(setDocumentDir))
    return changed ? buildPreviews(tr.state) : value
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** 다크 모드가 바뀌면 다이어그램을 다시 그린다. */
export const followColorScheme = ViewPlugin.fromClass(
  class {
    private readonly listener: () => void
    constructor(readonly view: EditorView) {
      this.listener = () => view.dispatch({ effects: refreshPreviews.of(null) })
      darkQuery.addEventListener('change', this.listener)
    }
    destroy() {
      darkQuery.removeEventListener('change', this.listener)
    }
  }
)
