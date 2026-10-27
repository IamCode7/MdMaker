import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionStatus,
  selectedCompletion,
  startCompletion
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { type Snippet, detailsSnippet, tableSnippet, typedBlockTrigger } from '../markdown/blockSnippets'
import { MERMAID_TEMPLATES, type MermaidTemplate, languageSuggestions, typedLanguage } from '../markdown/languages'

/** 목록에서 › 항목(mermaid · 표)을 고르면 열리는 하위 목록의 위치 (그 항목이 바꿀 범위) */
interface SubMenu {
  kind: 'mermaid' | 'table'
  from: number
  to: number
}

const setSubMenu = StateEffect.define<SubMenu | null>()

const subMenu = StateField.define<SubMenu | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSubMenu)) return effect.value
    return tr.docChanged || tr.selection ? null : value
  }
})

const openSubMenu =
  (kind: SubMenu['kind']) =>
  (view: EditorView, _completion: Completion, from: number, to: number): void => {
    view.dispatch({ effects: setSubMenu.of({ kind, from, to }) })
    queueMicrotask(() => startCompletion(view))
  }

function completionSource(context: CompletionContext): CompletionResult | null {
  const menu = context.state.field(subMenu, false)
  if (menu && context.pos === menu.to) {
    if (menu.kind === 'table') {
      return {
        from: menu.from,
        to: menu.to,
        filter: false,
        options: [
          {
            label: '3×3',
            apply: (view: EditorView) => insertSnippet(view, menu.from, menu.to, tableSnippet(indentAt(view.state, menu.from)))
          }
        ]
      }
    }
    return {
      from: menu.from,
      to: menu.to,
      filter: false,
      options: MERMAID_TEMPLATES.map((template) => ({
        label: template.title,
        apply: (view: EditorView) => insertMermaidTemplate(view, menu, template)
      }))
    }
  }
  return languageSource(context) ?? blockSource(context)
}

// MARK: - ``` 뒤 언어 목록

function languageSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const typed = typedLanguage(line.text.slice(0, context.pos - line.from), context.pos === line.to)
  if (!typed) return null
  const items = languageSuggestions(typed)
  if (items.length === 0) return null
  return {
    from: context.pos - typed.length,
    to: context.pos,
    filter: false,
    options: items.map((label) =>
      label === 'mermaid' ? { label, detail: '›', apply: openSubMenu('mermaid'), boost: 0 } : { label }
    )
  }
}

/** ```me 를 ```mermaid + 기본 문법 + 닫는 ``` 로 바꾼다. 이미 닫힌 블록이면 닫는 ```는 더하지 않는다. */
function insertMermaidTemplate(view: EditorView, menu: SubMenu, template: MermaidTemplate): void {
  const state = view.state
  const line = state.doc.lineAt(menu.from)
  const fence = line.text.slice(0, menu.from - line.from).trim()
  const closed = isFenceClosed(state, line.from)

  let insert = 'mermaid'
  let cursor: number
  if (template.body === '') {
    cursor = menu.from + (closed ? 7 : 8) // 무제: 빈 줄에 커서
    if (!closed) insert += '\n\n' + fence
  } else {
    insert += '\n' + template.body
    cursor = menu.from + insert.length
    if (!closed) insert += '\n' + fence
  }
  view.dispatch({
    changes: { from: menu.from, to: line.to, insert },
    selection: { anchor: cursor },
    effects: setSubMenu.of(null),
    scrollIntoView: true
  })
}

function isFenceClosed(state: EditorState, lineFrom: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
    if (node.name === 'FencedCode') return node.getChildren('CodeMark').length >= 2
  }
  return false
}

// MARK: - 줄 맨 앞 | (표) · < (접기 상자)

function blockSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const typed = typedBlockTrigger(line.text.slice(0, context.pos - line.from), context.pos === line.to)
  if (!typed || isInside(context.state, context.pos, ['FencedCode', 'CodeBlock'])) return null
  // 바로 위 줄이 표면 표 행을 이어 쓰는 중이니 띄우지 않는다. (Enter가 줄바꿈으로 가야 한다)
  if (typed.mark === '|' && line.number > 1 && isInside(context.state, line.from - 1, ['Table'])) return null
  const from = context.pos - 1
  const option: Completion =
    typed.mark === '|'
      ? { label: '표', detail: '›', apply: openSubMenu('table'), boost: 0 }
      : { label: '접기 상자', apply: (view: EditorView) => insertSnippet(view, from, context.pos, detailsSnippet(typed.indent)) }
  return { from, to: context.pos, filter: false, options: [option] }
}

/** pos 바로 앞 글자가 names 중 하나(코드 블록, 표 등) 안인지 */
function isInside(state: EditorState, pos: number, names: string[]): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (names.includes(node.name)) return true
  }
  return false
}

const indentAt = (state: EditorState, pos: number): string => /^[ \t]*/.exec(state.doc.lineAt(pos).text)![0]

function insertSnippet(view: EditorView, from: number, to: number, snippet: Snippet): void {
  view.dispatch({
    changes: { from, to, insert: snippet.text },
    selection: { anchor: from + snippet.anchor, head: from + snippet.head },
    effects: setSubMenu.of(null),
    scrollIntoView: true
  })
}

const completionKeys = Prec.highest(
  keymap.of([
    {
      // 언어 목록의 mermaid, | 목록의 표처럼 › 가 붙은 항목에서 → 를 누르면 하위 목록을 연다.
      key: 'ArrowRight',
      run: (view) =>
        completionStatus(view.state) === 'active' && selectedCompletion(view.state)?.detail === '›'
          ? acceptCompletion(view)
          : false
    },
    {
      // 하위 목록에서 ← 를 누르면 앞 목록으로 돌아간다.
      key: 'ArrowLeft',
      run: (view) => {
        if (!view.state.field(subMenu, false) || completionStatus(view.state) !== 'active') return false
        view.dispatch({ effects: setSubMenu.of(null) })
        queueMicrotask(() => startCompletion(view))
        return true
      }
    },
    { key: 'Tab', run: (view) => (completionStatus(view.state) === 'active' ? acceptCompletion(view) : false) }
  ])
)

export const languageCompletion = [
  subMenu,
  completionKeys,
  autocompletion({ override: [completionSource], icons: false, closeOnBlur: true })
]
