import type { MdApi } from '../../shared/api'

declare global {
  interface Window {
    api: MdApi
  }
}
