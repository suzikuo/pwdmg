/// <reference types="vite/client" />

declare global {
  interface TauriWindow {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onResized(handler: () => void): Promise<() => void>
  }

  interface Window {
    pywebview?: {
      api?: Record<string, (...args: any[]) => Promise<any>>
    }
    androidPasswordApi?: Record<string, (...args: any[]) => string>
    __TAURI_INTERNALS__?: {
      invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
    }
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
      }
      window?: {
        getCurrentWindow(): TauriWindow
      }
      event?: {
        listen?: <T = unknown>(
          event: string,
          handler: (event: { event?: string; payload?: T }) => void
        ) => Promise<() => void> | (() => void)
      }
    }
    __mypwdmgAsyncDesktopUnlock?: boolean
    __mypwdmgAsyncDesktopUpdateMethods?: readonly string[]
    __mypwdmgDesktopTitleBar?: boolean
    __mypwdmgHandleNativeBack?: () => boolean
    __mypwdmgHandleNativeLock?: () => boolean
    __mypwdmgHandleNativeAutofillIntent?: () => boolean
  }
}

export {}
