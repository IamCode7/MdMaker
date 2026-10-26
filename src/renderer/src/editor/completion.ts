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
import { MERMAID_TEMPLATES, type MermaidTemplate, languageSuggestions, typedLanguage } from '../markdown/languages'

/** 언어 목록에서 mermaid를 고르면 열리는 "다이어그램 종류" 목록의 위치 (입력 중인 언어 이름 범위) */
interface MermaidMenu {
  from: number
  to: number
}

const setMermaidMenu = StateEffect.define<MermaidMenu | null>()

const mermaidMenu = StateField.define<MermaidMenu | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMermaidMenu)) return effect.value
    return tr.docChanged || tr.selection ? null : value
  }
})

function openMermaidMenu(view: EditorView, _completion: Completion, from: number, to: number): void {
  view.dispatch({ effects: setMermaidMenu.of({ from, to }) })
  queueMicrotask(() => startCompletion(view))
}

function languageSource(context: CompletionContext): CompletionResult | null {
  const menu = context.state.field(mermaidMenu, false)
  if (menu && context.pos === menu.to) {
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
      label === 'mermaid' ? { label, detail: '›', apply: openMermaidMenu, boost: 0 } : { label }
    )
  }
}

/** ```me 를 ```mermaid + 기본 문법 + 닫는 ``` 로 바꾼다. 이미 닫힌 블록이면 닫는 ```는 더하지 않는다. */
function insertMermaidTemplate(view: EditorView, menu: MermaidMenu, template: MermaidTemplate): void {
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
    effects: setMermaidMenu.of(null),
    scrollIntoView: true
  })
}

function isFenceClosed(state: EditorState, lineFrom: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
    if (node.name === 'FencedCode') return node.getChildren('CodeMark').length >= 2
  }
  return false
}

const completionKeys = Prec.highest(
  keymap.of([
    {
      // 언어 목록의 mermaid에서 → 를 누르면 다이어그램 종류 목록을 연다.
      key: 'ArrowRight',
      run: (view) =>
        completionStatus(view.state) === 'active' && selectedCompletion(view.state)?.label === 'mermaid'
          ? acceptCompletion(view)
          : false
    },
    {
      // 다이어그램 종류 목록에서 ← 를 누르면 언어 목록으로 돌아간다.
      key: 'ArrowLeft',
      run: (view) => {
        if (!view.state.field(mermaidMenu, false) || completionStatus(view.state) !== 'active') return false
        view.dispatch({ effects: setMermaidMenu.of(null) })
        queueMicrotask(() => startCompletion(view))
        return true
      }
    },
    { key: 'Tab', run: (view) => (completionStatus(view.state) === 'active' ? acceptCompletion(view) : false) }
  ])
)

export const languageCompletion = [
  mermaidMenu,
  completionKeys,
  autocompletion({ override: [languageSource], icons: false, closeOnBlur: true })
]
