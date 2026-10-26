/** 문서 첫 줄이 `---`이고 아래에 닫는 `---`(또는 `...`) 줄이 있으면, 닫는 줄 끝까지의 길이. 없으면 null. */
export function frontMatterLength(text: string): number | null {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return null
  let offset = lines[0].length + 1
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, '').trim()
    if (line === '---' || line === '...') return offset + lines[index].length
    offset += lines[index].length + 1
  }
  return null
}

/** PDF용: 문서 정보를 뺀 본문 */
export function stripFrontMatter(text: string): string {
  const length = frontMatterLength(text)
  return length === null ? text : text.slice(length)
}
