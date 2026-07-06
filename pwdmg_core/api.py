from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from .vault import VaultService


class PasswordManagerApi:
    def __init__(self, service: "VaultService | None" = None) -> None:
        self._service = service

    @property
    def service(self) -> "VaultService":
        if self._service is None:
            from .vault import VaultService

            self._service = VaultService()
        return self._service

    @staticmethod
    def _call_result(fn):
        from .vault import call_result

        return call_result(fn)

    def getState(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.state())

    def getStorageState(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.storage_state())

    def readVaultEnvelope(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.read_vault_envelope())

    def writeVaultEnvelope(self, envelopeText: str, protectBackup: bool = False) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.write_vault_envelope(envelopeText, protect_backup=bool(protectBackup)))

    def readLegacyLocalStorage(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.read_legacy_local_storage())

    def createVault(self, password: str, importLegacy: bool = True) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.create_vault(password, import_legacy=bool(importLegacy)))

    def unlock(self, password: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.unlock(password))

    def lock(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.lock() or self.service.state())

    def getVault(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.get_vault())

    def saveVault(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.save_vault(payload))

    def changePassword(self, newPassword: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.change_password(newPassword))

    def exportVaultBackup(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.export_backup())

    def importVaultBackup(self, envelopeText: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.import_backup(envelopeText))

    def queryMatches(self, hostname: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.query_matches(hostname))

    def getFillPayload(self, entryId: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.get_fill_payload(entryId))

    def listSaveTargets(self) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.list_save_targets())

    def previewCapturedLogin(self, capture: Dict[str, Any]) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.preview_captured_login(capture))

    def saveCapturedLogin(
        self,
        capture: Dict[str, Any],
        parentId: str = "",
        updateEntryId: str = "",
    ) -> Dict[str, Any]:
        return self._call_result(
            lambda: self.service.save_captured_login(
                capture,
                parentId=parentId,
                updateEntryId=updateEntryId,
            )
        )

    def generateTotp(self, entryId: str) -> Dict[str, Any]:
        return self._call_result(lambda: self.service.generate_totp(entryId))
