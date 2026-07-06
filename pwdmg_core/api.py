from __future__ import annotations

from typing import Any, Dict

from .vault import VaultService, call_result


class PasswordManagerApi:
    def __init__(self, service: VaultService | None = None) -> None:
        self.service = service or VaultService()

    def getState(self) -> Dict[str, Any]:
        return call_result(self.service.state)

    def getStorageState(self) -> Dict[str, Any]:
        return call_result(self.service.storage_state)

    def readVaultEnvelope(self) -> Dict[str, Any]:
        return call_result(self.service.read_vault_envelope)

    def writeVaultEnvelope(self, envelopeText: str, protectBackup: bool = False) -> Dict[str, Any]:
        return call_result(lambda: self.service.write_vault_envelope(envelopeText, protect_backup=bool(protectBackup)))

    def readLegacyLocalStorage(self) -> Dict[str, Any]:
        return call_result(self.service.read_legacy_local_storage)

    def createVault(self, password: str, importLegacy: bool = True) -> Dict[str, Any]:
        return call_result(lambda: self.service.create_vault(password, import_legacy=bool(importLegacy)))

    def unlock(self, password: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.unlock(password))

    def lock(self) -> Dict[str, Any]:
        return call_result(lambda: self.service.lock() or self.service.state())

    def getVault(self) -> Dict[str, Any]:
        return call_result(self.service.get_vault)

    def saveVault(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return call_result(lambda: self.service.save_vault(payload))

    def changePassword(self, newPassword: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.change_password(newPassword))

    def exportVaultBackup(self) -> Dict[str, Any]:
        return call_result(self.service.export_backup)

    def importVaultBackup(self, envelopeText: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.import_backup(envelopeText))

    def queryMatches(self, hostname: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.query_matches(hostname))

    def getFillPayload(self, entryId: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.get_fill_payload(entryId))

    def generateTotp(self, entryId: str) -> Dict[str, Any]:
        return call_result(lambda: self.service.generate_totp(entryId))
