/** `from`~`to`를 `insert`로 바꾸고 나서 `anchor`~`head`를 선택한다. */
export interface TextEdit {
  from: number
  to: number
  insert: string
  anchor: number
  head: number
}

const runBefore = (text: string, end: number, char: string): number => {
  let count = 0
  while (end - count - 1 >= 0 && text[end - count - 1] === char) count++
  return count
}

const runAfter = (text: string, start: number, char: string): number => {
  let count = 0
  while (start + count < text.length && text[start + count] === char) count++
  return count
}

/** 감싼 기호가 `length`개 이상이고, `*` 한 개짜리는 `**`(굵게)와 헷갈리지 않게 홀수 개일 때만 감싼 것으로 본다. */
const isWrapped = (before: number, after: number, length: number): boolean =>
  before >= length && after >= length && (length > 1 || (before % 2 === 1 && after % 2 === 1))

/** 선택 영역을 `marker`로 감싸거나, 이미 감싸져 있으면 벗긴다. (⌘B, ⌘I 등) */
export function toggleWrap(text: string, from: number, to: number, marker: string): TextEdit {
  const length = marker.length
  const char = marker[0]
  const selected = text.slice(from, to)

  // **[굵게]** — 선택 영역 바깥에 기호가 있는 경우
  if (isWrapped(runBefore(text, from, char), runAfter(text, to, char), length)) {
    return { from: from - length, to: to + length, insert: selected, anchor: from - length, head: to - length }
  }

  // [**굵게**] — 선택 영역 안쪽 양끝에 기호가 있는 경우
  if (selected.length >= length * 2) {
    const before = runAfter(selected, 0, char)
    const after = runBefore(selected, selected.length, char)
    if (before < selected.length && isWrapped(before, after, length)) {
      const inner = selected.slice(length, selected.length - length)
      return { from, to, insert: inner, anchor: from, head: from + inner.length }
    }
  }

  return { from, to, insert: marker + selected + marker, anchor: from + length, head: to + length }
}

/** 선택한 글자를 `[글자]()`로 만들고 커서를 괄호 안에 둔다. 선택이 없으면 `[]()`를 넣고 대괄호 안에 둔다. */
export function insertLink(text: string, from: number, to: number): TextEdit {
  const selected = text.slice(from, to)
  const insert = `[${selected}]()`
  const cursor = from === to ? from + 1 : from + insert.length - 1
  return { from, to, insert, anchor: cursor, head: cursor }
}
