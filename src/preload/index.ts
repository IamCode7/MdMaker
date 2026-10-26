import { contextBridge, ipcRenderer } from 'electron'
import type { MdApi, MenuCommand, OpenedFile } from '../shared/api'

const api: MdApi = {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  save: (path, content) => ipcRenderer.invoke('save', path, content),
  saveAs: (content, defaultName, defaultDir) => ipcRenderer.invoke('save-as', content, defaultName, defaultDir),
  confirmClose: (names) => ipcRenderer.invoke('confirm-close', names),
  exportPDF: (html, defaultName, defaultDir) => ipcRenderer.invoke('export-pdf', html, defaultName, defaultDir),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setWindowState: (title, edited) => ipcRenderer.send('window-state', title, edited),
  resizeWindowBy: (delta) => ipcRenderer.invoke('resize-window-by', delta),
  closeWindow: () => ipcRenderer.send('close-window'),
  onMenu: (listener) => {
    ipcRenderer.on('menu', (_event, command: MenuCommand) => listener(command))
  },
  onOpenFile: (listener) => {
    ipcRenderer.on('open-file', (_event, file: OpenedFile) => listener(file))
  },
  onCloseRequest: (listener) => {
    ipcRenderer.on('close-request', () => listener())
  }
}

contextBridge.exposeInMainWorld('api', api)
