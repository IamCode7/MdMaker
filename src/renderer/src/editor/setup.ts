import { history, indentWithTab, defaultKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
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

/** 탭 하나(문서 하나)의 편집기 상태를 만든다. 실행 취소 기록도 탭마다 따로 갖는다. */
export function createEditorState(content: string, documentDir: string | null, onChange: () => void): EditorState {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    indentUnit.of('    '),
    markdown({ base: markdownLanguage, codeLanguages }),
    syntaxHighlighting(markdownHighlight),
    documentDirField,
    livePreview,
    hideMarks,
    previews,
    followColorScheme,
    clickHandlers,
    languageCompletion,
    editorTheme,
    search({ top: true }),
    // 실행 취소·서식 단축키는 메뉴에서 보내 준다. (Mac은 ⌘, Windows는 Ctrl)
    keymap.of([indentWithTab, ...searchKeymap, ...defaultKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange()
    })
  ]
  const state = EditorState.create({ doc: content, extensions })
  return documentDir ? state.update({ effects: setDocumentDir.of(documentDir) }).state : state
}
