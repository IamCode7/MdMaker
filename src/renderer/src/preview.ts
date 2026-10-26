import { renderMermaid } from './editor/livePreview'
import { PAGE, PDF_CSS, mermaidBlocks, renderBody } from './markdown/html'

const PX_PER_MM = 96 / 25.4
const PAGE_WIDTH = PAGE.widthMM * PX_PER_MM
const MARGIN = PAGE.marginInch * 96
/** 한 쪽에 들어가는 글 높이 (A4 높이 − 위아래 여백) */
const PAGE_CONTENT_HEIGHT = PAGE.heightMM * PX_PER_MM - MARGIN * 2

/** 미리보기에서 쪽과 쪽 사이 회색 틈 */
const PAGE_GAP = 16

/** 미리보기에만 쓰는 꾸밈. 종이 여백과 쪽 나눔 표시. (PDF용 CSS는 그대로 쓴다) */
const PREVIEW_CSS = `
html { background: #fff; padding: ${MARGIN}px; width: ${PAGE_WIDTH}px; box-sizing: border-box; position: relative; }
a { pointer-events: none; }
.page-gap { position: relative; }
.page-gap-band { position: absolute; width: ${PAGE_WIDTH}px; height: ${PAGE_GAP}px; }
.page-break { position: absolute; left: 0; width: ${PAGE_WIDTH}px; height: 0; border-top: 1px dashed #b8b8bd; }
.page-label { position: absolute; right: 12px; top: -9px; padding: 0 6px; background: #fff; color: #8e8e93; font: 11px -apple-system, "Malgun Gothic", sans-serif; }
.page-gap-band .page-label { top: 2px; background: none; }
`

/**
 * 오른쪽 PDF 미리보기. PDF와 같은 변환기·같은 CSS로 A4 폭에 그린 뒤, 창 폭에 맞춰 통째로 줄인다.
 * (글자를 다시 배치하지 않으니 줄바꿈 위치가 PDF와 같다)
 */
export class PdfPreview {
  private readonly frame: HTMLIFrameElement
  /** 쪽 나눔을 재는 보이지 않는 틀 */
  private readonly measureFrame: HTMLIFrameElement
  private readonly sheet: HTMLDivElement
  private readonly svgCache = new Map<string, string>()
  private markdown = ''
  private documentDir: string | null = null
  private timer = 0
  private renderCount = 0
  private scale = 1
  private lines: { line: number; top: number }[] = []

  constructor(private readonly container: HTMLElement) {
    this.sheet = document.createElement('div')
    this.sheet.className = 'preview-sheet'
    this.frame = document.createElement('iframe')
    // 미리보기 안에서는 스크립트를 실행하지 않는다. (부모가 높이·위치를 재려고 같은 출처만 허용)
    this.frame.setAttribute('sandbox', 'allow-same-origin')
    this.frame.title = 'PDF 미리보기'
    this.sheet.append(this.frame)
    container.append(this.sheet)
    this.measureFrame = document.createElement('iframe')
    this.measureFrame.setAttribute('sandbox', 'allow-same-origin')
    this.measureFrame.setAttribute('aria-hidden', 'true')
    this.measureFrame.className = 'preview-measure'
    document.body.append(this.measureFrame)
    new ResizeObserver(() => this.fit()).observe(container)
  }

  /** 입력이 잠깐 멈추면 다시 그린다. */
  update(markdown: string, documentDir: string | null, immediately = false): void {
    this.markdown = markdown
    this.documentDir = documentDir
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.render(), immediately ? 0 : 200)
  }

  /** 편집 화면 맨 위에 보이는 줄(0부터)에 맞춰 미리보기를 스크롤한다. */
  syncTo(line: number): void {
    if (this.lines.length === 0) return
    let before = this.lines[0]
    let after: (typeof this.lines)[number] | undefined
    for (const item of this.lines) {
      if (item.line <= line) before = item
      else {
        after = item
        break
      }
    }
    const ratio = after && after.line > before.line ? (line - before.line) / (after.line - before.line) : 0
    const top = before.top + (after ? (after.top - before.top) * Math.min(Math.max(ratio, 0), 1) : 0)
    this.container.scrollTop = top * this.scale
  }

  private async render(): Promise<void> {
    const count = ++this.renderCount
    const markdown = this.markdown

    // 다이어그램은 PDF처럼 라이트 테마로 미리 그려 둔다. 아직 안 그린 건 그린 뒤 다시 그린다.
    const missing = [...new Set(mermaidBlocks(markdown))].filter((code) => !this.svgCache.has(code))
    if (missing.length > 0) {
      void Promise.all(
        missing.map((code) => renderMermaid(code, false).then((svg) => this.svgCache.set(code, svg), () => this.svgCache.set(code, '')))
      ).then(() => {
        if (count === this.renderCount) void this.render()
      })
    }
    const mermaidSVGs = Object.fromEntries([...this.svgCache].filter(([, svg]) => svg !== ''))
    const body = renderBody(markdown, { mermaidSVGs, documentDir: this.documentDir, sourceLines: true })

    const scrollTop = this.container.scrollTop
    const [doc, measureDoc] = await Promise.all([
      load(this.frame, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${PDF_CSS}${PREVIEW_CSS}</style></head><body>${body}</body></html>`),
      load(this.measureFrame, measureHTML(body))
    ])
    if (count !== this.renderCount || !doc || !measureDoc) return
    const starts = measurePageStarts(measureDoc)
    drawPages(doc, starts, getComputedStyle(this.container).backgroundColor)
    this.lines = Array.from(doc.querySelectorAll<HTMLElement>('[data-line]')).map((element) => ({
      line: Number(element.dataset.line),
      top: element.getBoundingClientRect().top + doc.documentElement.scrollTop
    }))
    this.frame.style.height = `${doc.documentElement.scrollHeight}px`
    this.fit()
    this.container.scrollTop = scrollTop
    this.container.dataset.pages = String(starts.length + 1)
  }

  /** 미리보기 폭에 맞춰 A4 종이를 통째로 줄인다. */
  private fit(): void {
    const available = this.container.clientWidth - 32
    this.scale = Math.min(1, Math.max(available, 100) / PAGE_WIDTH)
    const height = this.frame.offsetHeight
    this.frame.style.width = `${PAGE_WIDTH}px`
    this.frame.style.transform = `scale(${this.scale})`
    this.sheet.style.width = `${PAGE_WIDTH * this.scale}px`
    this.sheet.style.height = `${height * this.scale}px`
  }
}

/** 틀에 HTML을 넣고, 이미지까지 다 불러와 높이가 정해질 때까지 기다린다. */
async function load(frame: HTMLIFrameElement, html: string): Promise<Document | null> {
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve()
    frame.srcdoc = html
  })
  const doc = frame.contentDocument
  if (!doc) return null
  await Promise.all(
    Array.from(doc.images).map((image) => (image.complete ? undefined : new Promise((done) => (image.onload = image.onerror = done))))
  )
  return doc
}

/** 쪽 나눔 계산용 칸 사이 간격 (값은 결과에 영향 없음) */
const COLUMN_GAP = 100

/**
 * 쪽이 넘어가는 위치를 잰다. 같은 내용을 "한 쪽 높이짜리 칸"으로 이어 붙이는 다단 배치로 그리면,
 * 브라우저가 인쇄할 때와 같은 규칙(제목 홀로 두지 않기, 코드 블록·콜아웃 안 자르기, 표 줄 안 자르기 등)으로
 * 칸을 나눈다. 칸 하나가 PDF 한 쪽이다.
 * 결과: 각 쪽이 시작되는 블록 번호와, 블록 중간에서 나뉘면 그 블록 안에서의 위치.
 */
function measurePageStarts(doc: Document): { block: number; offset: number }[] {
  const flow = doc.getElementById('flow')!
  const page = doc.getElementById('page')!
  const left = flow.getBoundingClientRect().left
  const contentWidth = PAGE_WIDTH - MARGIN * 2
  const starts: { block: number; offset: number }[] = []
  let lastColumn = 0
  Array.from(page.children).forEach((block, index) => {
    let offset = 0
    for (const rect of Array.from(block.getClientRects())) {
      const column = Math.round((rect.left - left) / (contentWidth + COLUMN_GAP))
      while (column > lastColumn) {
        lastColumn++
        starts.push({ block: index, offset })
      }
      offset += rect.height
    }
  })
  return starts
}

const measureHTML = (body: string): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${PDF_CSS}
html, body { margin: 0; padding: 0; }
#flow { width: ${PAGE_WIDTH - MARGIN * 2}px; height: ${PAGE_CONTENT_HEIGHT}px; column-width: ${PAGE_WIDTH - MARGIN * 2}px;
  column-gap: ${COLUMN_GAP}px; column-fill: auto; }
#page { margin: 8px; } /* 인쇄할 때 body의 기본 여백과 같게 */
</style></head><body><div id="flow"><div id="page">${body}</div></div></body></html>`

/**
 * 미리보기를 실제 종이처럼 보이게 한다. 쪽이 블록 사이에서 넘어가면 그 자리에
 * "앞 쪽의 남은 빈 공간 + 아래 여백 + 회색 틈 + 다음 쪽 위 여백"을 넣어, 각 쪽이 A4 한 장 크기가 되게 한다.
 * (인쇄할 때처럼 쪽 맨 위 블록의 margin은 없앤다) 문단이 쪽 사이에서 나뉘는 곳엔 점선만 긋는다.
 */
function drawPages(doc: Document, starts: { block: number; offset: number }[], gapColor: string): void {
  const html = doc.documentElement
  const blocks = Array.from(doc.body.children) as HTMLElement[]
  const yOf = (element: Element) => element.getBoundingClientRect().top - html.getBoundingClientRect().top
  const bodyLeft = parseFloat(getComputedStyle(doc.body).marginLeft) || 0
  const label = (text: string) => {
    const span = doc.createElement('span')
    span.className = 'page-label'
    span.textContent = text
    return span
  }
  let pageTop = MARGIN // 지금 쪽에서 글이 시작하는 높이

  starts.forEach(({ block, offset }, index) => {
    const element = blocks[block]
    if (!element) return
    const sheetBottom = pageTop + PAGE_CONTENT_HEIGHT + MARGIN // 지금 쪽 종이의 아래 끝
    if (offset > 0) {
      const line = doc.createElement('div')
      line.className = 'page-break'
      const y = yOf(element) + offset
      line.style.top = `${y}px`
      line.append(label(`${index + 2}쪽`))
      html.append(line)
      pageTop = y
      return
    }
    const gap = doc.createElement('div')
    gap.className = 'page-gap'
    element.before(gap)
    const gapTop = yOf(gap)
    const marginTop = parseFloat(getComputedStyle(element).marginTop) || 0
    const nextPageTop = sheetBottom + PAGE_GAP + MARGIN
    gap.style.height = `${Math.max(nextPageTop - gapTop - marginTop, 0)}px`
    const band = doc.createElement('div')
    band.className = 'page-gap-band'
    band.style.top = `${Math.max(sheetBottom - gapTop, 0)}px`
    band.style.left = `${-(MARGIN + bodyLeft)}px`
    band.style.background = gapColor
    band.append(label(`${index + 2}쪽`))
    gap.append(band)
    pageTop = nextPageTop
  })

  // 마지막 쪽도 A4 한 장 높이까지 채운다.
  const end = doc.createElement('div')
  doc.body.append(end)
  end.style.height = `${Math.max(pageTop + PAGE_CONTENT_HEIGHT - yOf(end), 0)}px`
}
