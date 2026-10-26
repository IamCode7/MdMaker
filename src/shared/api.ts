/** 메뉴에서 화면(renderer)으로 보내는 명령 */
export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'closeTab'
  | 'exportPDF'
  | 'undo'
  | 'redo'
  | 'find'
  | 'replace'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'nextTab'
  | 'previousTab'
  | 'togglePreview'

export interface OpenedFile {
  path: string
  content: string
}

/** 창을 닫으려는데 저장 안 한 문서가 있을 때 고른 답 */
export type CloseChoice = 'save' | 'discard' | 'cancel'

/** preload가 화면 쪽 `window.api`로 열어 주는 기능 */
export interface MdApi {
  platform: string
  openDialog(): Promise<OpenedFile[]>
  readFile(path: string): Promise<OpenedFile>
  save(path: string, content: string): Promise<void>
  saveAs(content: string, defaultName: string, defaultDir?: string): Promise<string | null>
  confirmClose(names: string[]): Promise<CloseChoice>
  exportPDF(html: string, defaultName: string, defaultDir?: string): Promise<string | null>
  openExternal(url: string): Promise<void>
  setWindowState(title: string, edited: boolean): void
  /** 창 폭을 늘리거나 줄인다. 화면 밖으로 나가지 않게 맞춘 뒤 실제로 바뀐 폭을 돌려준다. */
  resizeWindowBy(delta: number): Promise<number>
  /** 창을 닫아도 된다고 알린다 (저장할 것이 남지 않았을 때) */
  closeWindow(): void
  onMenu(listener: (command: MenuCommand) => void): void
  onOpenFile(listener: (file: OpenedFile) => void): void
  /** 메인이 "창을 닫으려 한다"고 알릴 때 */
  onCloseRequest(listener: () => void): void
}
