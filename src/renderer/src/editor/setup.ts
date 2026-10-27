import { history, indentWithTab, defaultKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { clickHandlers } from './commands'
import { languageCompletion } from './completion'
import { codeLanguages, markdownHighlight } from './highlight'
import { documentDirField, followColorScheme, hideMarks, livePreview, previews, setDocumentDir } from './livePreview'

/** CodeMirror 기본 스타일(고정폭 글꼴 등)을 덮어쓴다. 색은 style.css의 변수를 쓴다. */
const editorTheme = EditorView.theme({
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.65', padding: '28px 0 40vh' },
  '.cm-content': { maxWidth: '860px', margin: '0 auto', padding: '0 40px', caretColor: 'var(--text)' }
})

// MARK: - 원문 보기

/** 편집 화면의 꾸미기 묶음. 원문 보기에선 통째로 빼서 마크다운 글자만 보여준다. */
const decorations = new Compartment()
const decorationExtensions: Extension = [syntaxHighlighting(markdownHighlight), livePreview, hideMarks, previews]

/** 원문 보기를 켜거나 끄는 효과. 열린 탭마다 이 효과를 보내 같은 상태로 맞춘다. */
export const setSourceMode = (on: boolean): StateEffect<unknown> => decorations.reconfigure(on ? [] : decorationExtensions)

/** 이 상태가 원문 보기(꾸미기를 뺀 상태)인지 */
export const isSourceMode = (state: EditorState): boolean => decorations.get(state) !== decorationExtensions

/** 탭 하나(문서 하나)의 편집기 상태를 만든다. 실행 취소 기록도 탭마다 따로 갖는다. */
export function createEditorState(content: string, documentDir: string | null, sourceMode: boolean, onChange: () => void): EditorState {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    indentUnit.of('    '),
    markdown({ base: markdownLanguage, codeLanguages }),
    documentDirField,
    decorations.of(sourceMode ? [] : decorationExtensions),
    followColorScheme,
    clickHandlers,
    languageCompletion,
    editorTheme,
    search({ top: true }),
    // 실행 취소·서식 단축키는 메뉴에서 보내 준다. (Mac은 ⌘, Windows는 Ctrl)
    // ⌘/ 는 원문 보기 메뉴 단축키라서 기본 키맵의 주석 넣기(toggleComment)를 뺀다.
    keymap.of([indentWithTab, ...searchKeymap, ...defaultKeymap.filter((binding) => binding.key !== 'Mod-/')]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange()
    })
  ]
  const state = EditorState.create({ doc: content, extensions })
  return documentDir ? state.update({ effects: setDocumentDir.of(documentDir) }).state : state
}
