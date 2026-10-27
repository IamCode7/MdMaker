import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { insertLink, type TextEdit, toggleWrap } from '../markdown/editing'

function applyEdit(view: EditorView, edit: TextEdit): boolean {
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
    userEvent: 'input.format'
  })
  view.focus()
  return true
}

export const wrapWith = (marker: string) => (view: EditorView): boolean => {
  const { from, to } = view.state.selection.main
  return applyEdit(view, toggleWrap(view.state.doc.toString(), from, to, marker))
}

export const insertLinkCommand = (view: EditorView): boolean => {
  const { from, to } = view.state.selection.main
  return applyEdit(view, insertLink(view.state.doc.toString(), from, to))
}

// MARK: - 클릭: ⌘/Ctrl+클릭으로 링크 열기, 체크박스 클릭으로 체크

/** 위치에 있는 링크의 주소. `[글](주소)`, `<주소>`, 괄호 없는 주소, 참조식 `[글][이름]`, 이미지를 모두 다룬다. */
export function linkAt(state: EditorState, pos: number): string | null {
  const text = (node: SyntaxNode) => state.doc.sliceString(node.from, node.to)
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'URL' && !node.parent?.name.match(/^(Link|Image|Autolink|LinkReference)$/)) {
      return normalizeURL(text(node))
    }
    if (node.name === 'Autolink') {
      return normalizeURL(text(node).replace(/^<|>$/g, ''))
    }
    if (node.name === 'Link' || node.name === 'Image') {
      const url = node.getChild('URL')
      if (url) return normalizeURL(text(url))
      // 참조식 링크: [글][이름] 또는 [이름]
      const label = node.getChild('LinkLabel')
      const name = label ? text(label).slice(1, -1) : text(node).replace(/^!?\[|\]$/g, '')
      return referenceURL(state, name)
    }
  }
  return null
}

function referenceURL(state: EditorState, name: string): string | null {
  let found: string | null = null
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found || node.name !== 'LinkReference') return
      const label = node.node.getChild('LinkLabel')
      const url = node.node.getChild('URL')
      if (label && url && state.doc.sliceString(label.from + 1, label.to - 1).toLowerCase() === name.toLowerCase()) {
        found = normalizeURL(state.doc.sliceString(url.from, url.to))
      }
    }
  })
  return found
}

const normalizeURL = (url: string): string => (/^www\./i.test(url) ? `https://${url}` : url)

function taskMarkerAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'TaskMarker') return node
  }
  const before = syntaxTree(state).resolveInner(pos, -1)
  return before.name === 'TaskMarker' ? before : null
}

export const clickHandlers = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    const modifier = event.metaKey || event.ctrlKey

    if (modifier && target.closest('.md-link, .md-url, .cm-bare-url')) {
      const url = linkAt(view.state, pos)
      if (url) {
        event.preventDefault()
        void window.api.openExternal(url)
        return true
      }
    }

    const task = target.closest('.cm-task')
    if (!modifier && !event.shiftKey && !event.altKey && task) {
      // 체크박스 모양은 원문 [ ] 자리를 대신하므로, 누른 좌표 대신 그 자리에서 찾는다.
      const marker = taskMarkerAt(view.state, task.classList.contains('cm-checkbox') ? view.posAtDOM(task) : pos)
      if (marker) {
        event.preventDefault()
        const checked = view.state.doc.sliceString(marker.from + 1, marker.from + 2) !== ' '
        view.dispatch({ changes: { from: marker.from + 1, to: marker.from + 2, insert: checked ? ' ' : 'x' }, userEvent: 'input.toggle' })
        return true
      }
    }
    return false
  }
})
