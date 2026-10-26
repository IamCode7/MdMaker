export const CODE_LANGUAGES = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'diff', 'dockerfile', 'go', 'graphql',
  'html', 'java', 'javascript', 'json', 'kotlin', 'latex', 'lua', 'makefile', 'markdown', 'mermaid',
  'objectivec', 'perl', 'php', 'plaintext', 'powershell', 'python', 'r', 'ruby', 'rust', 'scala',
  'scss', 'shell', 'sql', 'swift', 'toml', 'typescript', 'xml', 'yaml'
]

/** 여는 ``` 줄 끝에서 입력 중인 언어 이름. `lineBefore`는 커서 앞까지의 줄 내용이다. */
export function typedLanguage(lineBefore: string, atLineEnd: boolean): string | null {
  if (!atLineEnd) return null
  const match = /^ {0,3}(?:`{3,}|~{3,})([A-Za-z0-9_+#.-]+)$/.exec(lineBefore)
  return match ? match[1] : null
}

/** 입력한 글자로 시작하는 언어들. 이미 다 입력해서 더 고를 게 없으면 빈 목록. */
export function languageSuggestions(typed: string): string[] {
  const prefix = typed.toLowerCase()
  const matches = CODE_LANGUAGES.filter((language) => language.startsWith(prefix))
  return matches.length === 1 && matches[0] === prefix ? [] : matches
}

export interface MermaidTemplate {
  title: string
  /** 비어 있으면 빈 블록(무제) */
  body: string
}

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  { title: '무제 (빈 다이어그램)', body: '' },
  {
    title: '순서도 (flowchart)',
    body: 'flowchart TD\n    A[시작] --> B{조건}\n    B -->|예| C[처리]\n    B -->|아니오| D[종료]'
  },
  {
    title: '순서 다이어그램 (sequence)',
    body: 'sequenceDiagram\n    participant U as 사용자\n    participant S as 서버\n    U->>S: 요청\n    S-->>U: 응답'
  },
  {
    title: '클래스 (class)',
    body: 'classDiagram\n    class Animal {\n        +String name\n        +speak()\n    }\n    class Dog\n    Animal <|-- Dog'
  },
  {
    title: '상태 (state)',
    body: 'stateDiagram-v2\n    [*] --> Draft\n    Draft --> Saved : 저장\n    Saved --> Draft : 수정\n    Saved --> [*]'
  },
  {
    title: 'ER 다이어그램 (er)',
    body:
      'erDiagram\n    USER ||--o{ POST : writes\n    USER {\n        int id\n        string name\n    }\n' +
      '    POST {\n        int id\n        string title\n    }'
  },
  {
    title: '일정표 (gantt)',
    body: 'gantt\n    title 일정\n    dateFormat YYYY-MM-DD\n    section 준비\n    기획 :a1, 2026-11-02, 3d\n    개발 :a2, after a1, 5d'
  },
  { title: '원 그래프 (pie)', body: 'pie title 비율\n    "A" : 40\n    "B" : 35\n    "C" : 25' },
  { title: '마인드맵 (mindmap)', body: 'mindmap\n  root((주제))\n    아이디어 1\n      세부 내용\n    아이디어 2' },
  { title: '타임라인 (timeline)', body: 'timeline\n    title 연혁\n    2024 : 시작\n    2025 : 성장\n    2026 : 확장' }
]
