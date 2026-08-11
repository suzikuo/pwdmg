from __future__ import annotations

import unittest

from pwdmg_core.desktop_shell import (
    DesktopShellActions,
    EXIT_COMMAND,
    LOCK_COMMAND,
    QUICK_ACCESS_COMMAND,
    RESET_POSITION_COMMAND,
    SHOW_MAIN_COMMAND,
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


if __name__ == "__main__":
    unittest.main()
