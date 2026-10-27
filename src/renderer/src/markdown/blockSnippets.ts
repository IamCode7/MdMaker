/** 줄 맨 앞(들여쓰기 공백만 앞에 있어도 됨)에서 친 | 또는 < 와 그 앞 들여쓰기. 줄에 다른 글자가 있으면 null. */
export function typedBlockTrigger(lineBefore: string, atLineEnd: boolean): { mark: '|' | '<'; indent: string } | null {
  if (!atLineEnd) return null
  const match = /^([ \t]*)([|<])$/.exec(lineBefore)
  return match ? { mark: match[2] as '|' | '<', indent: match[1] } : null
}

export interface Snippet {
  text: string
  /** 넣은 뒤 선택할 범위 (text 안의 위치). 같으면 커서만 둔다. */
  anchor: number
  head: number
}

/** 머리글 1행 + 구분선 + 본문 2행의 3열 표. 커서는 첫 칸. 둘째 줄부터 같은 들여쓰기를 붙인다. */
export function tableSnippet(indent: string): Snippet {
  const row = '|  |  |  |'
  const text = [row, '|---|---|---|', row, row].join('\n' + indent)
  return { text, anchor: 2, head: 2 }
}

/** 기본 접기 상자. "제목" 글자를 선택해 둔다. */
export function detailsSnippet(indent: string): Snippet {
  const text = ['<details>', '<summary>제목</summary>', '', '내용', '', '</details>']
    .map((line, index) => (index === 0 || line === '' ? line : indent + line))
    .join('\n')
  const anchor = text.indexOf('제목')
  return { text, anchor, head: anchor + 2 }
}
