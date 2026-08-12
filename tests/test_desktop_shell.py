from __future__ import annotations

import os
import unittest
import uuid

from pwdmg_core.desktop_shell import (
    DesktopShellActions,
    EXIT_COMMAND,
    LOCK_COMMAND,
    QUICK_ACCESS_COMMAND,
    RESET_POSITION_COMMAND,
    SHOW_MAIN_COMMAND,
    WindowsDesktopShell,
    WindowsSingleInstance,
)


class DesktopShellActionsTest(unittest.TestCase):
    def test_dispatch_routes_only_known_commands(self):
        calls: list[str] = []
        actions = DesktopShellActions(
            quick_access=lambda: calls.append("quick"),
            show_main=lambda: calls.append("show"),
            reset_position=lambda: calls.append("reset"),
            lock=lambda: calls.append("lock"),
            exit=lambda: calls.append("exit"),
        )

        self.assertTrue(actions.dispatch(QUICK_ACCESS_COMMAND))
        self.assertTrue(actions.dispatch(SHOW_MAIN_COMMAND))
        self.assertTrue(actions.dispatch(RESET_POSITION_COMMAND))
        self.assertTrue(actions.dispatch(LOCK_COMMAND))
        self.assertTrue(actions.dispatch(EXIT_COMMAND))
        self.assertFalse(actions.dispatch("unknown"))
        self.assertEqual(calls, ["quick", "show", "reset", "lock", "exit"])

    def test_tray_preference_can_change_before_shell_start(self):
        actions = DesktopShellActions(
            quick_access=lambda: None,
            show_main=lambda: None,
            reset_position=lambda: None,
            lock=lambda: None,
            exit=lambda: None,
        )
        shell = WindowsDesktopShell(actions, tray_enabled=False)

        self.assertFalse(shell.tray_enabled)
        shell.set_tray_enabled(True)
        self.assertTrue(shell.tray_enabled)

    @unittest.skipUnless(os.name == "nt", "Windows mutex behavior")
    def test_single_instance_mutex_is_released_with_its_owner(self):
        mutex_name = f"Local\\MyPasswordManager.Test.{uuid.uuid4().hex}"
        first = WindowsSingleInstance(mutex_name)
        second = WindowsSingleInstance(mutex_name)
        replacement = WindowsSingleInstance(mutex_name)
        try:
            self.assertTrue(first.acquire())
            self.assertFalse(second.acquire())
            first.release()
            self.assertTrue(replacement.acquire())
        finally:
            first.release()
            second.release()
            replacement.release()


if __name__ == "__main__":
    unittest.main()
