import hljs from 'highlight.js/lib/common'
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type Token } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import { stripFrontMatter } from './frontMatter'
import { resolveImage } from './paths'

export interface RenderOptions {
  /** mermaid 코드 → 미리 그려둔 SVG. 없는 코드는 일반 코드 블록으로 나온다. */
  mermaidSVGs?: Record<string, string>
  /** 문서가 있는 폴더 (상대 경로 이미지용) */
  documentDir?: string | null
  /** 문서 속 HTML(<br> 등)을 그대로 쓸지. 표 미리보기처럼 화면에 바로 넣을 땐 끈다. */
  allowRawHTML?: boolean
  /** 블록마다 원문 줄 번호(data-line)를 붙인다. PDF 미리보기를 편집 위치에 맞춰 스크롤할 때 쓴다. */
  sourceLines?: boolean
}

/** PDF 쪽 크기와 여백 (main의 printToPDF와 같은 값) */
export const PAGE = { widthMM: 210, heightMM: 297, marginInch: 0.75 }

const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const

function createRenderer(allowRawHTML: boolean): MarkdownItInstance {
  const md: MarkdownItInstance = new MarkdownIt({
    html: allowRawHTML,
    linkify: true,
    highlight: (code, language): string => {
      const name = language.toLowerCase()
      if (!name || !hljs.getLanguage(name)) return ''
      const colored = hljs.highlight(code, { language: name, ignoreIllegals: true }).value
      return `<pre><code class="hljs language-${md.utils.escapeHtml(name)}">${colored}</code></pre>`
    }
  })
  md.use(footnote)
  md.renderer.rules.footnote_caption = (tokens, index) => String(Number(tokens[index].meta?.id ?? 0) + 1)
  md.core.ruler.after('inline', 'task-lists', (state) => addTaskCheckboxes(state.tokens))
  md.core.ruler.push('source-lines', (state) => {
    const env = state.env as RenderOptions & { lineOffset?: number }
    if (!env.sourceLines) return
    for (const token of state.tokens) {
      if (token.map && token.level === 0 && token.nesting === 1) {
        token.attrSet('data-line', String(token.map[0] + (env.lineOffset ?? 0)))
      }
    }
  })

  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const language = token.info.trim().split(/\s+/)[0]?.toLowerCase()
    const svg = language === 'mermaid' ? (env as RenderOptions | undefined)?.mermaidSVGs?.[token.content] : undefined
    const line = (env as RenderOptions | undefined)?.sourceLines && token.map ? ` data-line="${token.map[0] + ((env as { lineOffset?: number }).lineOffset ?? 0)}"` : ''
    return svg ? `<div class="mermaid"${line}>${svg}</div>\n` : fence(tokens, index, options, env, self)
  }

  const image = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const source = token.attrGet('src')
    if (source) {
      const resolved = resolveImage(String(source), (env as RenderOptions | undefined)?.documentDir ?? null)
      if ('url' in resolved) token.attrSet('src', resolved.url)
    }
    return image(tokens, index, options, env, self)
  }
  return md
}

/** `- [ ] 할 일` → 체크박스. (markdown-it 기본엔 없어서 직접 붙인다) */
function addTaskCheckboxes(tokens: Token[]): void {
  for (let index = 2; index < tokens.length; index++) {
    const inline = tokens[index]
    if (inline.type !== 'inline' || tokens[index - 1].type !== 'paragraph_open' || tokens[index - 2].type !== 'list_item_open') {
      continue
    }
    const match = /^\[([ xX])\]\s+/.exec(inline.content)
    const first = inline.children?.[0]
    if (!match || !first || first.type !== 'text') continue

    first.content = first.content.slice(match[0].length)
    const checkbox = new (inline.constructor as typeof Token)('html_inline', '', 0)
    checkbox.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `
    inline.children!.unshift(checkbox)
    tokens[index - 2].attrJoin('class', 'task-list-item')
  }
}

/** GitHub 콜아웃: `<blockquote><p>[!NOTE]`를 찾아 색 상자로 바꾼다. */
function addCallouts(html: string): string {
  // 미리보기에선 <blockquote data-line="3">처럼 속성이 붙어 있으니 그대로 살린다.
  const pattern = new RegExp(`<blockquote([^>]*)>\\n<p>\\[!(${CALLOUT_KINDS.join('|')})\\]([^\\n<]*)(\\n|</p>\\n)`, 'gi')
  return html.replace(pattern, (_match, attributes: string, kind: string, title: string, end: string) => {
    const name = kind.toLowerCase()
    const label = title.trim() || name[0].toUpperCase() + name.slice(1)
    return `<blockquote class="callout callout-${name}"${attributes}>\n<p class="callout-title">${label}</p>\n${end === '\n' ? '<p>' : ''}`
  })
}

/** PDF에선 접기 상자를 펼칠 수 없으니 항상 펼친 채로 넣는다. */
const openDetails = (html: string): string => html.replace(/<details(\s|>)/gi, '<details open$1')

export function renderBody(markdown: string, options: RenderOptions = {}): string {
  const md = createRenderer(options.allowRawHTML ?? true)
  const body = stripFrontMatter(markdown)
  // 문서 정보를 뺀 만큼 줄 번호가 밀리므로 원래 줄 번호로 되돌린다.
  const lineOffset = markdown.slice(0, markdown.length - body.length).split('\n').length - 1
  return openDetails(addCallouts(md.render(body, { ...options, lineOffset })))
}

/** 문서 속 ```mermaid 블록의 코드들 (PDF에 넣을 SVG를 미리 그릴 때 쓴다) */
export function mermaidBlocks(markdown: string): string[] {
  return new MarkdownIt()
    .parse(stripFrontMatter(markdown), {})
    .filter((token) => token.type === 'fence' && token.info.trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid')
    .map((token) => token.content)
}

export function renderPage(markdown: string, options: RenderOptions = {}): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><style>${PDF_CSS}</style></head>
<body>${renderBody(markdown, options)}</body></html>`
}

export const PDF_CSS = `
* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
body { font: 11pt/1.6 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif; color: #1d1d1f; word-wrap: break-word; }
/* 쪽 맨 위에 온 제목은 margin이 없어지므로, 위 간격 일부를 padding으로 둬서 종이 위에 딱 붙지 않게 한다. */
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 0.6em 0 0.5em; padding-top: 0.8em; break-after: avoid; }
h1 { font-size: 22pt; } h2 { font-size: 18pt; } h3 { font-size: 15pt; } h4 { font-size: 13pt; }
h1, h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
p, ul, ol, blockquote, pre, table, details { margin: 0 0 0.9em; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.6em 0; }
blockquote { color: #555; border-left: 3px solid #ccc; padding-left: 1em; margin-left: 0; }
code { font: 0.92em ui-monospace, "SF Mono", Menlo, Consolas, monospace; background: #f2f2f4; padding: 0.1em 0.3em; border-radius: 4px; }
pre { background: #f2f2f4; padding: 0.8em 1em; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 0.3em 0.7em; }
th { background: #f2f2f4; }
li.task-list-item { list-style: none; }
li.task-list-item > input { margin: 0 0.4em 0 -1.4em; }
img { max-width: 100%; }
a { color: #0a63c9; }
details { border: 1px solid #ddd; border-radius: 6px; padding: 0.5em 1em; }
details > summary { font-weight: 600; }
.callout { color: #1d1d1f; border-left: 4px solid; border-radius: 4px; padding: 0.5em 1em; break-inside: avoid; }
.callout > :last-child { margin-bottom: 0; }
.callout-title { font-weight: 700; margin-bottom: 0.3em; }
.callout-note { border-color: #0969DA; background: #0969DA14; } .callout-note .callout-title { color: #0969DA; }
.callout-tip { border-color: #1A7F37; background: #1A7F3714; } .callout-tip .callout-title { color: #1A7F37; }
.callout-important { border-color: #8250DF; background: #8250DF14; } .callout-important .callout-title { color: #8250DF; }
.callout-warning { border-color: #9A6700; background: #9A670014; } .callout-warning .callout-title { color: #9A6700; }
.callout-caution { border-color: #CF222E; background: #CF222E14; } .callout-caution .callout-title { color: #CF222E; }
.footnotes-sep { display: none; }
.footnotes { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid #ddd; font-size: 9.5pt; color: #444; }
.footnote-ref a, .footnote-backref { text-decoration: none; }
.mermaid { margin: 0 0 0.9em; break-inside: avoid; }
.mermaid svg { max-width: 100%; height: auto; }
.hljs-keyword, .hljs-literal, .hljs-built_in, .hljs-selector-tag { color: #AD3DA4; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #C41A16; }
.hljs-comment, .hljs-quote, .hljs-meta { color: #707F8C; }
.hljs-number { color: #1C00CF; }
.hljs-title, .hljs-title.function_, .hljs-function .hljs-title { color: #326D74; }
.hljs-type, .hljs-title.class_ { color: #3900A0; }
`
