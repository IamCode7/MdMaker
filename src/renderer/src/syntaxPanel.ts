import type { MenuCommand } from '../../shared/api'
import { formatAccelerator, menuAccelerators } from '../../shared/shortcuts'

interface SyntaxItem {
  title: string
  description: string
  example: string
}

// MARK: - 문법 목록

const SYNTAX: SyntaxItem[] = [
  { title: '제목', description: '# 개수가 단계 (1~6단계)', example: '# 제목 1\n## 제목 2\n### 제목 3' },
  { title: '제목 (밑줄식)', description: '다음 줄에 = 는 1단계, - 는 2단계', example: '제목 1\n===\n\n제목 2\n---' },
  {
    title: '굵게 · 기울임 · 취소선 · 코드',
    description: '글자 양쪽을 기호로 감싼다',
    example: '**굵게**  *기울임*\n~~취소선~~  `인라인 코드`'
  },
  { title: '링크', description: '주소만 적어도 링크가 된다', example: '[이름](https://example.com)\nhttps://example.com' },
  { title: '이미지', description: '문서 폴더 기준 경로나 웹 주소', example: '![설명](그림.png)' },
  { title: '목록', description: '들여쓰기(Tab)로 안쪽 목록', example: '- 항목\n    - 안쪽 항목\n\n1. 첫째\n2. 둘째' },
  { title: '체크박스', description: '[ ] 를 클릭하면 체크된다', example: '- [ ] 할 일\n- [x] 한 일' },
  { title: '인용', description: '> 를 겹치면 안쪽 인용', example: '> 인용문\n>> 안쪽 인용' },
  {
    title: '콜아웃',
    description: 'NOTE · TIP · IMPORTANT · WARNING · CAUTION. 뒤에 제목을 붙일 수 있다',
    example: '> [!NOTE]\n> 참고할 내용\n\n> [!WARNING] 주의\n> 조심할 내용'
  },
  { title: '각주', description: '본문에 번호를 달고 아래에 내용', example: '본문 문장[^1]\n\n[^1]: 각주 내용' },
  {
    title: '표',
    description: ':--- 왼쪽, :---: 가운데, ---: 오른쪽 정렬',
    example: '| 이름 | 나이 |\n|:---|---:|\n| 철수 | 20 |'
  },
  { title: '코드 블록', description: '``` 뒤에 언어 이름을 쓰면 색칠된다', example: '```js\nconst a = 1\n```' },
  { title: 'Mermaid 다이어그램', description: '순서도·원 그래프 등을 그림으로', example: '```mermaid\nflowchart TD\n    A --> B\n```' },
  {
    title: '접기 상자',
    description: 'PDF에는 펼친 채로 나온다',
    example: '<details>\n<summary>제목</summary>\n\n접힌 내용\n\n</details>'
  },
  { title: '수평선', description: '빈 줄 다음에 --- 만 쓴 줄', example: '---' },
  { title: '문서 정보 (front matter)', description: '문서 맨 위에 둔다. PDF에는 나오지 않는다', example: '---\ntitle: 문서 제목\n---' }
]

// MARK: - 단축키 목록

/** 이름과 메뉴 명령. 단축키 글자는 메뉴와 같은 표(shared/shortcuts)에서 가져온다. */
const SHORTCUTS: [string, MenuCommand[]][] = [
  ['굵게 / 기울임', ['bold', 'italic']],
  ['취소선 / 코드', ['strikethrough', 'code']],
  ['링크', ['link']],
  ['저장 / 다른 이름으로', ['save', 'saveAs']],
  ['새 탭 / 탭 닫기', ['new', 'closeTab']],
  ['다음 탭 / 이전 탭', ['nextTab', 'previousTab']],
  ['PDF 미리보기', ['togglePreview']],
  ['PDF로 내보내기', ['exportPDF']],
  ['글씨 크게 / 작게', ['increaseFontSize', 'decreaseFontSize']],
  ['글씨 기본 크기', ['resetFontSize']],
  ['문법 창', ['toggleSyntaxPanel']],
  ['원문 보기', ['toggleSourceMode']]
]

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 문법 창 내용을 채운다. 단축키는 지금 OS에 맞는 모양(⌘ 기호 / Ctrl 글자)으로 보여준다. */
export function renderSyntaxPanel(panel: HTMLElement, isMac: boolean): void {
  const accelerators = menuAccelerators(isMac)
  const syntax = SYNTAX.map((item) => {
    const section = element('section', 'syntax-item')
    const example = element('pre', 'syntax-example')
    example.textContent = item.example
    section.append(element('h3', 'syntax-title', item.title), element('p', 'syntax-description', item.description), example)
    return section
  })

  const table = element('table', 'syntax-shortcuts')
  for (const [name, commands] of SHORTCUTS) {
    const row = table.insertRow()
    row.insertCell().textContent = name
    const keys = row.insertCell()
    commands.forEach((command, index) => {
      if (index > 0) keys.append(' / ')
      keys.append(element('kbd', '', formatAccelerator(accelerators[command], isMac)))
    })
  }
  const modifier = isMac ? '⌘' : 'Ctrl'
  const linkTip = element('p', 'syntax-description', `링크는 ${modifier} + 클릭으로 브라우저에서 연다.`)

  panel.replaceChildren(
    element('h2', 'syntax-heading', '문법'),
    ...syntax,
    element('h2', 'syntax-heading', '단축키'),
    table,
    linkTip
  )
}
