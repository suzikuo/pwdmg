"""Core services shared by the desktop app and browser native host."""

__all__ = ["VaultService"]


def __getattr__(name: str):
    if name == "VaultService":
        from .vault import VaultService

        return VaultService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
