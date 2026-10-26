/** Mac(/)과 Windows(\, C:\) 경로를 모두 다룬다. */
const isAbsolutePath = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path.slice(0, index + 1) : path.slice(0, index)
}

export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** 내 컴퓨터 파일을 화면·PDF에서 불러올 주소 (메인 프로세스가 mdfile:// 요청을 파일로 바꿔 준다) */
export function fileURL(path: string): string {
  return `mdfile://local/${encodeURIComponent(path)}`
}

export type ResolvedImage = { url: string } | { error: string }

/** MD에 쓴 이미지 주소를 실제로 불러올 주소로 바꾼다. 상대 경로는 문서가 있는 폴더 기준이다. */
export function resolveImage(source: string, documentDir: string | null): ResolvedImage {
  const trimmed = source.trim()
  if (/^(https?|data|mdfile):/i.test(trimmed)) return { url: trimmed }
  if (/^file:\/\//i.test(trimmed)) return { url: fileURL(decodeURIComponent(new URL(trimmed).pathname)) }

  const path = safeDecode(trimmed)
  if (isAbsolutePath(path)) return { url: fileURL(path) }
  if (!documentDir) return { error: '문서를 먼저 저장해야 상대 경로 이미지를 불러올 수 있습니다.' }

  const separator = documentDir.includes('\\') && !documentDir.includes('/') ? '\\' : '/'
  const relative = path.replace(/^\.[\\/]/, '')
  return { url: fileURL(documentDir.replace(/[\\/]$/, '') + separator + relative) }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
