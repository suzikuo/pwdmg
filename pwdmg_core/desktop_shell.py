from __future__ import annotations

import ctypes
import logging
import os
import sys
import threading
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

QUICK_ACCESS_COMMAND = "quick-access"
SHOW_MAIN_COMMAND = "show-main"
RESET_POSITION_COMMAND = "reset-position"
LOCK_COMMAND = "lock"
EXIT_COMMAND = "exit"
DESKTOP_INSTANCE_MUTEX_NAME = "Local\\MyPasswordManager.Desktop.SingleInstance.v1"
SHOW_MAIN_MESSAGE_NAME = "MyPasswordManager.Desktop.ShowMain.v1"
ERROR_ALREADY_EXISTS = 183
HWND_BROADCAST = 0xFFFF


@dataclass(frozen=True)
class DesktopShellStatus:
    supported: bool = False
    tray_available: bool = False
    hotkey_registered: bool = False
    error: str = ""


@dataclass(frozen=True)
class DesktopShellActions:
    quick_access: Callable[[], None]
    show_main: Callable[[], None]
    reset_position: Callable[[], None]
    lock: Callable[[], None]
    exit: Callable[[], None]

    def dispatch(self, command: str) -> bool:
        action = {
            QUICK_ACCESS_COMMAND: self.quick_access,
            SHOW_MAIN_COMMAND: self.show_main,
            RESET_POSITION_COMMAND: self.reset_position,
            LOCK_COMMAND: self.lock,
            EXIT_COMMAND: self.exit,
        }.get(command)
        if action is None:
            return False
        action()
        return True


class WindowsSingleInstance:
    def __init__(self, mutex_name: str = DESKTOP_INSTANCE_MUTEX_NAME) -> None:
        self.mutex_name = mutex_name
        self._handle = 0

    def acquire(self) -> bool:
        if os.name != "nt":
            return True
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [
            wintypes.LPVOID,
            wintypes.BOOL,
            wintypes.LPCWSTR,
        ]
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, self.mutex_name)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        self._handle = int(handle)
        return True

    def notify_existing(self) -> bool:
        if os.name != "nt":
            return False
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
        user32.RegisterWindowMessageW.restype = wintypes.UINT
        user32.PostMessageW.argtypes = [
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        user32.PostMessageW.restype = wintypes.BOOL
        message = int(user32.RegisterWindowMessageW(SHOW_MAIN_MESSAGE_NAME))
        return bool(
            message
            and user32.PostMessageW(HWND_BROADCAST, message, 0, 0)
        )

    def release(self) -> None:
        handle = self._handle
        self._handle = 0
        if not handle or os.name != "nt":
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.CloseHandle(handle)


class WindowsDesktopShell:
    def __init__(
        self,
        actions: DesktopShellActions,
        icon_path: Path | None = None,
        tray_enabled: bool = True,
    ) -> None:
        self.actions = actions
        self.icon_path = icon_path
        self._tray_enabled = bool(tray_enabled)
        self.status = DesktopShellStatus(supported=os.name == "nt")
        self._ready = threading.Event()
        self._tray_updated = threading.Event()
        self._thread: threading.Thread | None = None
        self._hwnd = 0
        self._wnd_proc = None

    @property
    def tray_enabled(self) -> bool:
        return self._tray_enabled

    def start(self, timeout: float = 4.0) -> DesktopShellStatus:
        if os.name != "nt":
            return self.status
        if self._thread and self._thread.is_alive():
            return self.status
        self._ready.clear()
        self._thread = threading.Thread(target=self._run, name="mypwdmg-desktop-shell", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            self.status = DesktopShellStatus(supported=True, error="Desktop shell startup timed out")
        return self.status

    def stop(self, timeout: float = 2.0) -> None:
        hwnd = self._hwnd
        if hwnd and os.name == "nt":
            try:
                ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)
            except Exception:
                pass
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout)

    def set_tray_enabled(
        self, enabled: bool, timeout: float = 2.0
    ) -> DesktopShellStatus:
        self._tray_enabled = bool(enabled)
        hwnd = self._hwnd
        if not hwnd or os.name != "nt":
            return self.status
        self._tray_updated.clear()
        try:
            posted = bool(
                ctypes.windll.user32.PostMessageW(hwnd, 0x0801, int(enabled), 0)
            )
        except Exception as exc:
            self.status = DesktopShellStatus(
                supported=True,
                tray_available=self.status.tray_available,
                hotkey_registered=self.status.hotkey_registered,
                error=str(exc),
            )
            return self.status
        if not posted:
            self.status = DesktopShellStatus(
                supported=True,
                tray_available=self.status.tray_available,
                hotkey_registered=self.status.hotkey_registered,
                error="Could not update tray icon",
            )
            return self.status
        if self._thread is not threading.current_thread():
            self._tray_updated.wait(timeout)
        return self.status

    def _run(self) -> None:
        try:
            self._run_windows()
        except Exception as exc:
            logger.exception("Desktop shell failed")
            self.status = DesktopShellStatus(supported=True, error=str(exc))
            self._ready.set()
        finally:
            self._hwnd = 0

    def _run_windows(self) -> None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        lresult = ctypes.c_ssize_t
        wnd_proc_type = ctypes.WINFUNCTYPE(
            lresult,
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        )

        class WindowClass(ctypes.Structure):
            _fields_ = [
                ("style", wintypes.UINT),
                ("lpfnWndProc", wnd_proc_type),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", wintypes.HINSTANCE),
                ("hIcon", wintypes.HICON),
                ("hCursor", wintypes.HANDLE),
                ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR),
                ("lpszClassName", wintypes.LPCWSTR),
            ]

        class Guid(ctypes.Structure):
            _fields_ = [
                ("Data1", wintypes.DWORD),
                ("Data2", wintypes.WORD),
                ("Data3", wintypes.WORD),
                ("Data4", ctypes.c_ubyte * 8),
            ]

        class NotifyTimeout(ctypes.Union):
            _fields_ = [("uTimeout", wintypes.UINT), ("uVersion", wintypes.UINT)]

        class NotifyIconData(ctypes.Structure):
            _anonymous_ = ("timeout",)
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("hWnd", wintypes.HWND),
                ("uID", wintypes.UINT),
                ("uFlags", wintypes.UINT),
                ("uCallbackMessage", wintypes.UINT),
                ("hIcon", wintypes.HICON),
                ("szTip", wintypes.WCHAR * 128),
                ("dwState", wintypes.DWORD),
                ("dwStateMask", wintypes.DWORD),
                ("szInfo", wintypes.WCHAR * 256),
                ("timeout", NotifyTimeout),
                ("szInfoTitle", wintypes.WCHAR * 64),
                ("dwInfoFlags", wintypes.DWORD),
                ("guidItem", Guid),
                ("hBalloonIcon", wintypes.HICON),
            ]

        class Point(ctypes.Structure):
            _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

        wm_close = 0x0010
        wm_destroy = 0x0002
        wm_hotkey = 0x0312
        wm_contextmenu = 0x007B
        wm_lbutton_up = 0x0202
        wm_rbutton_up = 0x0205
        nin_select = 0x0400
        nin_keyselect = 0x0401
        tray_message = 0x0800
        tray_control_message = 0x0801
        hotkey_id = 0x504D
        mod_control = 0x0002
        mod_shift = 0x0004
        mod_norepeat = 0x4000
        vk_space = 0x20
        nim_add = 0x00000000
        nim_delete = 0x00000002
        nim_setversion = 0x00000004
        notify_icon_version_4 = 4
        nif_message = 0x00000001
        nif_icon = 0x00000002
        nif_tip = 0x00000004
        image_icon = 1
        lr_load_from_file = 0x0010
        lr_default_size = 0x0040
        mf_string = 0x0000
        mf_separator = 0x0800
        tpm_right_button = 0x0002
        tpm_nonotify = 0x0080
        tpm_return_command = 0x0100
        command_quick_access = 1001
        command_show_main = 1002
        command_lock = 1003
        command_exit = 1004
        command_reset_position = 1005

        kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        user32.RegisterClassW.argtypes = [ctypes.POINTER(WindowClass)]
        user32.RegisterClassW.restype = wintypes.ATOM
        user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
        user32.UnregisterClassW.restype = wintypes.BOOL
        user32.CreateWindowExW.argtypes = [
            wintypes.DWORD,
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.HMENU,
            wintypes.HINSTANCE,
            wintypes.LPVOID,
        ]
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.DefWindowProcW.restype = lresult
        user32.DestroyWindow.argtypes = [wintypes.HWND]
        user32.DestroyWindow.restype = wintypes.BOOL
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.PostMessageW.restype = wintypes.BOOL
        user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
        user32.RegisterHotKey.restype = wintypes.BOOL
        user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.UnregisterHotKey.restype = wintypes.BOOL
        user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
        user32.RegisterWindowMessageW.restype = wintypes.UINT
        user32.LoadImageW.argtypes = [
            wintypes.HINSTANCE,
            wintypes.LPCWSTR,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.UINT,
        ]
        user32.LoadImageW.restype = wintypes.HANDLE
        user32.DestroyIcon.argtypes = [wintypes.HICON]
        user32.DestroyIcon.restype = wintypes.BOOL
        user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, wintypes.WPARAM, wintypes.LPCWSTR]
        user32.AppendMenuW.restype = wintypes.BOOL
        user32.GetCursorPos.argtypes = [ctypes.POINTER(Point)]
        user32.GetCursorPos.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.TrackPopupMenu.argtypes = [
            wintypes.HMENU,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.LPVOID,
        ]
        shell32.ExtractIconW.restype = wintypes.HICON
        shell32.ExtractIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT]
        shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NotifyIconData)]
        shell32.Shell_NotifyIconW.restype = wintypes.BOOL
        user32.CreatePopupMenu.restype = wintypes.HMENU
        user32.TrackPopupMenu.restype = wintypes.UINT
        user32.DestroyMenu.argtypes = [wintypes.HMENU]
        user32.DestroyMenu.restype = wintypes.BOOL
        user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        user32.GetMessageW.restype = wintypes.BOOL
        user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.restype = lresult

        hinstance = kernel32.GetModuleHandleW(None)
        class_name = f"MyPasswordDesktopShell-{os.getpid()}-{id(self)}"
        taskbar_created_message = int(user32.RegisterWindowMessageW("TaskbarCreated"))
        show_main_message = int(user32.RegisterWindowMessageW(SHOW_MAIN_MESSAGE_NAME))
        state: dict[str, object] = {
            "notify": None,
            "cleaned": False,
            "icon": 0,
            "tray_available": False,
            "hotkey_registered": False,
        }

        def dispatch(command: str) -> None:
            def invoke() -> None:
                try:
                    self.actions.dispatch(command)
                except Exception:
                    logger.exception("Desktop shell command failed: %s", command)

            threading.Thread(target=invoke, name=f"mypwdmg-{command}", daemon=True).start()

        def show_context_menu(hwnd: int) -> None:
            menu = user32.CreatePopupMenu()
            if not menu:
                return
            try:
                user32.AppendMenuW(menu, mf_string, command_quick_access, "快速访问")
                user32.AppendMenuW(menu, mf_string, command_show_main, "打开主窗口")
                user32.AppendMenuW(menu, mf_string, command_reset_position, "重置窗口位置")
                user32.AppendMenuW(menu, mf_string, command_lock, "锁定保险库")
                user32.AppendMenuW(menu, mf_separator, 0, None)
                user32.AppendMenuW(menu, mf_string, command_exit, "退出")
                point = Point()
                user32.GetCursorPos(ctypes.byref(point))
                user32.SetForegroundWindow(hwnd)
                selected = user32.TrackPopupMenu(
                    menu,
                    tpm_right_button | tpm_nonotify | tpm_return_command,
                    point.x,
                    point.y,
                    0,
                    hwnd,
                    None,
                )
                command = {
                    command_quick_access: QUICK_ACCESS_COMMAND,
                    command_show_main: SHOW_MAIN_COMMAND,
                    command_reset_position: RESET_POSITION_COMMAND,
                    command_lock: LOCK_COMMAND,
                    command_exit: EXIT_COMMAND,
                }.get(selected)
                if command:
                    dispatch(command)
            finally:
                user32.DestroyMenu(menu)

        def cleanup(hwnd: int) -> None:
            if state["cleaned"]:
                return
            state["cleaned"] = True
            user32.UnregisterHotKey(hwnd, hotkey_id)
            notify = state["notify"]
            if notify is not None and state["tray_available"]:
                shell32.Shell_NotifyIconW(nim_delete, ctypes.byref(notify))
                state["tray_available"] = False
            icon = int(state["icon"] or 0)
            if icon:
                user32.DestroyIcon(icon)
            self._tray_updated.set()

        def add_tray_icon() -> tuple[bool, int]:
            notify = state["notify"]
            if notify is None:
                return False, 0
            notify.cbSize = ctypes.sizeof(NotifyIconData)
            ctypes.set_last_error(0)
            added = bool(shell32.Shell_NotifyIconW(nim_add, ctypes.byref(notify)))
            if not added:
                # The 952-byte prefix is the WinForms-compatible Vista layout on x64.
                notify.cbSize = NotifyIconData.guidItem.offset
                ctypes.set_last_error(0)
                added = bool(shell32.Shell_NotifyIconW(nim_add, ctypes.byref(notify)))
            error = ctypes.get_last_error()
            if added:
                notify.uVersion = notify_icon_version_4
                shell32.Shell_NotifyIconW(nim_setversion, ctypes.byref(notify))
            state["tray_available"] = added
            return added, error

        def remove_tray_icon() -> None:
            notify = state["notify"]
            if notify is not None and state["tray_available"]:
                shell32.Shell_NotifyIconW(nim_delete, ctypes.byref(notify))
            state["tray_available"] = False

        def update_status(tray_available: bool, tray_error: int = 0) -> None:
            self.status = DesktopShellStatus(
                supported=True,
                tray_available=tray_available,
                hotkey_registered=bool(state["hotkey_registered"]),
                error=(
                    ""
                    if tray_available or not self._tray_enabled
                    else f"Tray icon unavailable (winerror={tray_error})"
                ),
            )

        def window_proc(hwnd, message, wparam, lparam):
            if show_main_message and message == show_main_message:
                dispatch(SHOW_MAIN_COMMAND)
                return 0
            if message == wm_hotkey and int(wparam) == hotkey_id:
                dispatch(QUICK_ACCESS_COMMAND)
                return 0
            if taskbar_created_message and message == taskbar_created_message:
                if self._tray_enabled:
                    tray_available, tray_error = add_tray_icon()
                    update_status(tray_available, tray_error)
                else:
                    remove_tray_icon()
                    update_status(False)
                return 0
            if message == tray_control_message:
                if bool(wparam):
                    tray_available, tray_error = add_tray_icon()
                    update_status(tray_available, tray_error)
                else:
                    remove_tray_icon()
                    update_status(False)
                self._tray_updated.set()
                return 0
            if message == tray_message:
                mouse_message = int(lparam) & 0xFFFF
                if mouse_message in {wm_lbutton_up, nin_select, nin_keyselect}:
                    dispatch(QUICK_ACCESS_COMMAND)
                elif mouse_message in {wm_rbutton_up, wm_contextmenu}:
                    show_context_menu(hwnd)
                return 0
            if message == wm_close:
                cleanup(hwnd)
                user32.DestroyWindow(hwnd)
                return 0
            if message == wm_destroy:
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, message, wparam, lparam)

        self._wnd_proc = wnd_proc_type(window_proc)
        window_class = WindowClass()
        window_class.lpfnWndProc = self._wnd_proc
        window_class.hInstance = hinstance
        window_class.lpszClassName = class_name
        if not user32.RegisterClassW(ctypes.byref(window_class)):
            raise ctypes.WinError()

        hwnd = user32.CreateWindowExW(
            0,
            class_name,
            "My Password Desktop Shell",
            0,
            0,
            0,
            0,
            0,
            None,
            None,
            hinstance,
            None,
        )
        if not hwnd:
            user32.UnregisterClassW(class_name, hinstance)
            raise ctypes.WinError()
        self._hwnd = int(hwnd)

        icon = 0
        if self.icon_path and self.icon_path.is_file():
            icon = int(
                user32.LoadImageW(
                    None,
                    str(self.icon_path),
                    image_icon,
                    0,
                    0,
                    lr_load_from_file | lr_default_size,
                )
                or 0
            )
        if not icon:
            icon = int(shell32.ExtractIconW(hinstance, sys.executable, 0) or 0)
        state["icon"] = icon

        notify = NotifyIconData()
        notify.cbSize = ctypes.sizeof(NotifyIconData)
        notify.hWnd = hwnd
        notify.uID = 1
        notify.uFlags = nif_message | nif_tip | (nif_icon if icon else 0)
        notify.uCallbackMessage = tray_message
        notify.hIcon = icon
        notify.szTip = "My Password"
        state["notify"] = notify
        tray_available = False
        tray_error = 0
        if self._tray_enabled:
            tray_available, tray_error = add_tray_icon()
        hotkey_registered = bool(
            user32.RegisterHotKey(
                hwnd,
                hotkey_id,
                mod_control | mod_shift | mod_norepeat,
                vk_space,
            )
        )
        state["hotkey_registered"] = hotkey_registered
        update_status(tray_available, tray_error)
        self._ready.set()

        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))

        cleanup(hwnd)
        user32.UnregisterClassW(class_name, hinstance)
