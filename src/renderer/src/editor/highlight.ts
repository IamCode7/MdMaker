import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'

/** MD 문법과 코드 블록 속 코드에 CSS 클래스를 붙인다. 색은 style.css에서 라이트/다크별로 정한다. */
export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'md-h md-h1' },
  { tag: tags.heading2, class: 'md-h md-h2' },
  { tag: tags.heading3, class: 'md-h md-h3' },
  { tag: tags.heading4, class: 'md-h md-h4' },
  { tag: tags.heading5, class: 'md-h md-h5' },
  { tag: tags.heading6, class: 'md-h md-h6' },
  { tag: tags.strong, class: 'md-strong' },
  { tag: tags.emphasis, class: 'md-em' },
  { tag: tags.strikethrough, class: 'md-strike' },
  { tag: tags.monospace, class: 'md-code' },
  { tag: tags.link, class: 'md-link' },
  { tag: tags.url, class: 'md-url' },
  { tag: tags.quote, class: 'md-quote' },
  { tag: [tags.processingInstruction, tags.labelName, tags.escape], class: 'md-mark' },
  // 코드 블록 속 코드 (Xcode 기본 테마와 비슷한 색)
  { tag: [tags.keyword, tags.bool, tags.null, tags.self], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'tok-string' },
  { tag: tags.character, class: 'tok-string md-char' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'tok-comment' },
  { tag: [tags.number, tags.integer, tags.float], class: 'tok-number' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-function' },
  { tag: [tags.typeName, tags.className], class: 'tok-type' },
  { tag: tags.tagName, class: 'tok-keyword' }
])

const MERMAID_KEYWORDS = new Set(
  ('flowchart graph sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie journey gitGraph ' +
    'mindmap timeline participant actor as loop alt else opt par and end note over left right of subgraph ' +
    'direction title section dateFormat class state TD TB BT RL LR').split(' ')
)

/** ```mermaid 코드 색칠 (예약어·문자열·%% 주석) */
const mermaidLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"[^"]*"?/)) return 'string'
    if (stream.match(/^[A-Za-z][\w-]*/)) return MERMAID_KEYWORDS.has(stream.current()) ? 'keyword' : null
    stream.next()
    return null
  }
})

/** ``` 뒤 언어 이름으로 코드 색칠 규칙을 고른다. (필요할 때 불러온다) */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: 'mermaid', support: new LanguageSupport(mermaidLanguage) }),
  ...languages
]
