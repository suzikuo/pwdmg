<template>
  <main class="app-shell">
    <AuthScreen
      v-if="!unlocked"
      :state-loading="stateLoading"
      :state-error="stateError"
      :has-vault="state.hasVault"
      :busy="busy"
      :password="password"
      :new-password="newPassword"
      :confirm-password="confirmPassword"
      :import-legacy="importLegacy"
      :device-unlock-enabled="deviceUnlockState.enabled"
      @retry="loadState"
      @unlock="unlockVault"
      @create="createVault"
      @quick-unlock="unlockWithDevice"
      @update:password="password = $event"
      @update:new-password="newPassword = $event"
      @update:confirm-password="confirmPassword = $event"
      @update:import-legacy="importLegacy = $event"
    />

    <section v-else class="workspace">
      <WorkspaceHeader
        :search-open="searchOpen"
        :keyword="keyword"
        :entry-filter="entryFilter"
        :drag-mode="dragMode"
        :selection-mode="batchSelectionMode"
        :selection-count="batchSelectedEntryIds.size"
        :all-visible-selected="allVisibleBatchEntriesSelected"
        :all-selected-favorite="allBatchEntriesFavorited"
        :create-menu-open="createMenuOpen"
        :more-menu-open="moreMenuOpen"
        :create-menu-actions="createMenuActions"
        :more-actions="moreActions"
        @open-drawer="openDrawer"
        @toggle-search="toggleSearch"
        @update:keyword="keyword = $event"
        @update:entry-filter="entryFilter = $event"
        @update:create-menu-open="createMenuOpen = $event"
        @update:more-menu-open="moreMenuOpen = $event"
        @select-create="handleTopCreateAction"
        @select-more="handleMoreAction"
        @close-create-menu="createMenuOpen = false"
        @close-more-menu="moreMenuOpen = false"
        @exit-drag="toggleDragMode"
        @exit-selection="exitBatchSelection"
        @toggle-select-all="toggleAllVisibleBatchEntries"
        @batch-move="openBatchMoveSheet"
        @batch-favorite="applyBatchFavorite"
        @batch-archive="archiveSelectedEntries"
        @batch-trash="trashSelectedEntries"
      />

      <div ref="workspaceGrid" class="workspace-grid-host">
        <VaultWorkspace
        :entries="filteredEntries"
        :selected-entry="selectedEntry"
        :stats="stats"
        :auto-expand="Boolean(keyword.trim()) || entryFilter !== 'all'"
        :draggable-enabled="dragMode && !keyword.trim() && entryFilter === 'all'"
        :favorite-ids="favoriteEntryIds"
        :selection-mode="batchSelectionMode"
        :selected-ids="batchSelectedEntryIds"
        :grid-style="desktopGridStyle"
        :pane-width="paneWidth"
        :pane-width-min="PANE_WIDTH_MIN"
        :pane-width-max="paneWidthMax"
        :show-password="showPassword"
        :password-mask="passwordMask"
        :totp-code="totpCode"
        :totp-remaining="totpRemaining"
        :totp-progress="totpProgress"
        :linked-passkeys="selectedEntryPasskeys"
        :attachment-busy="attachmentBusy"
        :attachment-actions-supported="!isAndroidRuntime"
        @view="openView"
        @edit="openEdit"
        @move="openMoveSheet"
        @duplicate="duplicateEntry"
        @delete="deleteEntry"
        @create="openCreateSheet"
        @move-entry="moveEntry"
        @context-menu="openEntryContextMenu"
        @toggle-favorite="toggleEntryFavorite"
        @toggle-selection="toggleBatchEntrySelection"
        @disable="disableEntry"
        @restore="restoreEntry"
        @purge="purgeEntry"
        @restore-history="restoreEntryHistory"
        @clear-history="clearEntryHistory"
        @copy="copyText"
        @toggle-password="showPassword = !showPassword"
        @refresh-totp="refreshTotp()"
        @open-passkey="openPasskeyManager"
        @unlink-passkey="unlinkPasskeyFromEntry"
        @add-attachment="addEntryAttachment"
        @save-attachment="saveEntryAttachment"
        @remove-attachment="removeEntryAttachment"
        @resize-keyboard="resizePaneWithKeyboard"
        @resize-pointer="startPaneResize"
        />
      </div>
    </section>

    <van-popup v-model:show="detailOpen" position="bottom" round class="detail-sheet" :duration="0.12" lazy-render>
      <div class="sheet-inner" v-if="selectedEntry">
        <EntryDetailPane
          :entry="selectedEntry"
          :show-password="showPassword"
          :password-mask="passwordMask"
          :totp-code="totpCode"
          :totp-remaining="totpRemaining"
          :totp-progress="totpProgress"
          :linked-passkeys="selectedEntryPasskeys"
          :attachment-busy="attachmentBusy"
          :attachment-actions-supported="!isAndroidRuntime"
          @edit="openEdit"
          @move="openMoveSheet"
          @duplicate="duplicateEntry"
          @delete="deleteEntry"
          @disable="disableEntry"
          @restore="restoreEntry"
          @purge="purgeEntry"
          @restore-history="restoreEntryHistory"
          @clear-history="clearEntryHistory"
          @copy="copyText"
          @toggle-password="showPassword = !showPassword"
          @refresh-totp="refreshTotp()"
          @open-passkey="openPasskeyManager"
          @unlink-passkey="unlinkPasskeyFromEntry"
          @add-attachment="addEntryAttachment"
          @save-attachment="saveEntryAttachment"
          @remove-attachment="removeEntryAttachment"
        />
      </div>
    </van-popup>

    <van-action-sheet
      v-model:show="createSheetOpen"
      :actions="createActions"
      cancel-text="取消"
      close-on-click-action
      @select="handleCreateAction"
    />

    <van-action-sheet
      v-model:show="moveSheetOpen"
      class="move-destination-sheet"
      title="移动到"
      :actions="moveDestinationActions"
      cancel-text="取消"
      close-on-click-action
      @select="selectMoveDestination"
      @closed="moveEntryId = ''"
    />

    <van-action-sheet
      v-model:show="batchMoveSheetOpen"
      class="move-destination-sheet"
      title="批量移动到"
      :actions="batchMoveDestinationActions"
      cancel-text="取消"
      close-on-click-action
      @select="selectBatchMoveDestination"
    />

    <QuickAccess
      :open="quickAccessOpen"
      :entries="vault?.entries || []"
      :favorite-ids="favoriteEntryIds"
      :recent-ids="recentEntryIds"
      @update:open="quickAccessOpen = $event"
      @open-entry="openQuickAccessEntry"
      @copy="copyText"
      @copy-totp="copyQuickAccessTotp"
      @open-website="openQuickAccessWebsite"
    />

    <div
      v-if="entryContextMenuOpen"
      class="entry-context-menu"
      :style="entryContextMenuStyle"
      role="menu"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <button
        v-for="action in entryContextActions"
        :key="action.key"
        type="button"
        role="menuitem"
        :class="{ danger: action.color === '#ee0a24' }"
        @click="handleEntryContextAction(action)"
      >
        {{ action.name }}
      </button>
    </div>

    <EntryEditor
      :open="editorOpen"
      :form="form"
      :domain-text="domainText"
      :editing-id="editingId"
      :busy="busy"
      :totp-code="totpCode"
      :autofill-match-mode-options="autofillMatchModeOptions"
      :login-account-source-options="loginAccountSourceOptions"
      @update:open="editorOpen = $event"
      @update-field="updateEditorField"
      @update-domain="domainText = $event"
      @submit="saveEntry"
      @focus-field="scrollFocusedEditorFieldIntoView"
      @refresh-totp="refreshTotp()"
      @open-generator="openCredentialGenerator(true)"
      @update-custom-fields="form.customFields = $event"
    />

    <CredentialGenerator
      :open="generatorOpen"
      :allow-apply="generatorApplyToPassword"
      :reset-key="generatorResetKey"
      @update:open="generatorOpen = $event"
      @copy="copyGeneratedCredential"
      @apply="applyGeneratedCredential"
    />

    <ImportWizard
      :open="importOpen"
      :entries="vault?.entries || []"
      :busy="busy"
      :reset-key="importResetKey"
      @update:open="importOpen = $event"
      @import="importVaultRecords"
    />

    <SettingsDrawer
      :open="drawerOpen"
      :detail-open="drawerDetailOpen"
      :section="drawerSection"
      :section-title="drawerSectionTitle"
      :display-app-version="displayAppVersion"
      :stats="{ logins: stats.logins, folders: stats.folders }"
      :theme="theme"
      :ui-scale-percent="uiScalePercent"
      :font-size-percent="fontSizePercent"
      :ui-scale-min="UI_SCALE_MIN_PERCENT"
      :ui-scale-max="UI_SCALE_MAX_PERCENT"
      :session-timeout-minutes="sessionTimeoutMinutes"
      :session-timeout-min="SESSION_TIMEOUT_MIN_MINUTES"
      :session-timeout-max="SESSION_TIMEOUT_MAX_MINUTES"
      :session-timeout-default="SESSION_TIMEOUT_DEFAULT_MINUTES"
      :password-health-label="passwordHealthSettingsLabel"
      :password-health-score="passwordHealthScoreLabel"
      :passkey-count="passkeyPresentationItems.length"
      :device-unlock-supported="deviceUnlockState.supported"
      :device-unlock-enabled="deviceUnlockState.enabled"
      :device-unlock-label="deviceUnlockSettingsLabel"
      :show-android-autofill-settings="showAndroidAutofillSettings"
      :android-autofill-enabled="androidAutofill?.enabled === true"
      :android-autofill-status="androidAutofillStatus"
      :show-plugin-settings="showPluginSettings"
      :plugin-enabled="pluginListener?.enabled === true"
      :plugin-status="pluginListenerStatus"
      :show-update-settings="showUpdateSettings"
      :update-manifest-url="updateManifestUrl"
      :default-update-manifest-url="DEFAULT_UPDATE_MANIFEST_URL"
      :update-busy="updateBusy"
      :update-available="updateInfo?.updateAvailable === true"
      :downloaded-update-path="downloadedUpdatePath"
      :can-apply-update="updateInfo?.canApply === true"
      :update-install-button-text="updateInstallButtonText"
      :update-info="updateInfo"
      :update-install-mode-text="updateInstallModeText"
      :update-progress="updateProgress"
      :update-progress-label="updateProgressLabel"
      :update-progress-percent="updateProgressPercent"
      :update-status="updateStatus"
      :oss="settings.oss"
      :auto-sync-interval-min="AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES"
      :auto-sync-interval-max="AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES"
      :cloud-busy="cloudBusy"
      :cloud-info="cloudInfo"
      :cloud-backups="cloudBackups"
      :backup-status="backupStatus"
      :portable-backup-supported="isDesktopRuntime"
      :portable-backup-busy="portableBackupBusy"
      :portable-backup-status="portableBackupStatus"
      :cloud-sync-log-limit="cloudSyncLogLimit"
      :cloud-sync-log-limit-min="CLOUD_SYNC_LOG_LIMIT_MIN"
      :cloud-sync-log-limit-max="CLOUD_SYNC_LOG_LIMIT_MAX"
      :cloud-sync-logs="cloudSyncLogs"
      :system-groups="systemGroups"
      :system-group-key="systemGroupKey"
      :current-system-group="currentSystemGroup"
      :system-group-entries="systemGroupEntries"
      :format-bytes="formatBytes"
      :format-date-time="formatDateTime"
      :direction-label="cloudSyncDirectionLabel"
      :status-label="cloudSyncLogStatusLabel"
      :log-title="cloudSyncLogTitle"
      :log-summary="cloudSyncLogSummary"
      :archive-entry-meta="archiveEntryMeta"
      @update:open="drawerOpen = $event"
      @update:detail-open="drawerDetailOpen = $event"
      @select-section="selectDrawerSection"
      @update-theme="setTheme"
      @update-ui-scale="setUiScaleDraft"
      @commit-ui-scale="commitUiScale"
      @update-font-size="setFontSizeDraft"
      @commit-font-size="commitFontSize"
      @update-session-timeout="updateSessionTimeout"
      @open-password-sheet="openPasswordSheet"
      @open-password-health="openPasswordHealth"
      @open-passkeys="openPasskeyManager()"
      @toggle-device-unlock="toggleDeviceUnlock"
      @open-android-settings="openAndroidAutofillSettings"
      @open-plugin="openPluginDetail"
      @update-manifest-url="updateManifestUrl = $event"
      @check-update="checkAppUpdate"
      @download-update="downloadAppUpdate"
      @apply-update="applyAppUpdate"
      @update-oss="updateOssSetting"
      @update-auto-sync="settings.oss.autoSync = $event"
      @update-auto-sync-interval="setAutoSyncIntervalMinutes"
      @save-settings="saveSettings"
      @check-cloud="checkCloudBackupInfo"
      @upload-cloud="uploadCloudBackup"
      @backup-cloud="backupCloudVault"
      @download-cloud="downloadCloudBackup"
      @refresh-cloud-list="refreshCloudBackupList"
      @select-cloud-backup="selectCloudBackup"
      @export-portable-backup="exportPortableBackupPackage"
      @import-portable-backup="beginPortableBackupImport"
      @update-log-limit="setCloudSyncLogLimit"
      @clear-logs="clearCloudSyncLogs"
      @update-system-group="systemGroupKey = $event"
      @restore-entry="restoreEntry"
      @trash-entry="trashEntry"
      @purge-entry="purgeEntry"
      @purge-all-entries="purgeAllTrashedEntries"
      @restore-entries="restoreEntries"
      @trash-entries="trashEntries"
      @purge-entries="purgeEntries"
    />


    <van-popup v-model:show="passwordSheetOpen" round class="password-popup" :duration="0.14" @closed="resetPasswordDraft">
      <div class="password-popup-inner">
        <van-nav-bar safe-area-inset-top title="修改主密码" left-arrow @click-left="passwordSheetOpen = false" />
        <van-form class="password-popup-form" @submit="changeMasterPassword">
          <p class="settings-note compact-note">新主密码可以留空。留空后打开保险库时可直接进入，适合你确认安全的单机环境。</p>
          <van-field v-model="changePasswordValue" type="password" label="新密码" placeholder="可留空" />
          <van-field v-model="changePasswordConfirm" type="password" label="确认" placeholder="再次输入，可留空" />
          <van-button block type="primary" native-type="submit" :loading="busy">保存修改</van-button>
        </van-form>
      </div>
    </van-popup>

    <van-popup v-model:show="deviceUnlockSheetOpen" round class="password-popup" :duration="0.14" @closed="resetDeviceUnlockDraft">
      <div class="password-popup-inner">
        <van-nav-bar safe-area-inset-top title="启用设备快速解锁" left-arrow @click-left="deviceUnlockSheetOpen = false" />
        <van-form class="password-popup-form" @submit="enableDeviceUnlock">
          <p class="settings-note compact-note">使用 Windows 当前用户保护设备密钥。主密码不会保存，超过所选期限后需重新输入。</p>
          <van-field v-model="deviceUnlockPassword" type="password" label="当前主密码" autocomplete="current-password" />
          <label class="device-unlock-interval-field">
            <span>重新验证</span>
            <select v-model.number="deviceUnlockReauthSeconds" aria-label="设备快速解锁重新验证周期">
              <option :value="86400">1 天</option>
              <option :value="604800">7 天</option>
              <option :value="2592000">30 天</option>
            </select>
          </label>
          <van-button block type="primary" native-type="submit" :loading="busy">启用</van-button>
        </van-form>
      </div>
    </van-popup>

    <CloudPasswordPrompt
      :open="cloudPasswordPromptOpen"
      :password="cloudPasswordPromptValue"
      @update:open="cloudPasswordPromptOpen = $event"
      @update:password="cloudPasswordPromptValue = $event"
      @submit="submitCloudPasswordPrompt"
      @cancel="cancelCloudPasswordPrompt"
      @closed="handleCloudPasswordPromptClosed"
    />

    <CloudPasswordPrompt
      :open="portableBackupPasswordOpen"
      :password="portableBackupPassword"
      :busy="portableBackupBusy"
      title="恢复完整备份"
      :note="portableBackupPasswordNote"
      label="备份密码"
      placeholder="备份未设置主密码可留空"
      @update:open="portableBackupPasswordOpen = $event"
      @update:password="portableBackupPassword = $event"
      @submit="submitPortableBackupImport"
      @cancel="cancelPortableBackupImport"
      @closed="handlePortableBackupPromptClosed"
    />

    <CloudSyncReview
      :open="cloudSyncReviewOpen"
      :preview="cloudSyncPreview"
      :title="cloudSyncReviewTitle"
      :diff-counts="cloudSyncDiffCounts"
      :selected-count="cloudSyncSelectedCount"
      :action-text="cloudSyncReviewActionText"
      :busy="cloudBusy"
      :is-item-checked="isCloudSyncItemChecked"
      :change-label="cloudSyncChangeLabel"
      :item-summary="cloudSyncItemSummary"
      @update:open="cloudSyncReviewOpen = $event"
      @close="hideCloudSyncReview"
      @select-all="setAllCloudSyncDiffs"
      @discard="discardCloudSyncReview"
      @item-checked="setCloudSyncItemChecked"
      @detail-checked="setCloudSyncDetailChecked"
      @apply="applyCloudSyncPreview"
    />

    <van-popup v-if="showPluginSettings" v-model:show="pluginDetailOpen" position="right" class="plugin-detail-popup" :duration="0.16" lazy-render>
      <section class="plugin-detail-shell">
        <van-nav-bar safe-area-inset-top title="插件监听" left-arrow @click-left="pluginDetailOpen = false" />
        <div class="plugin-detail-body">
          <div class="plugin-setting">
            <div class="scale-setting-head">
              <span>当前状态</span>
              <strong :class="['plugin-status-pill', pluginListener?.enabled ? 'is-on' : 'is-off']">{{ pluginListenerStatus }}</strong>
            </div>
            <div class="plugin-status-grid" v-if="pluginListener">
              <span>Chrome</span>
              <strong>{{ pluginListener.enabled && pluginListener.chromeRegistered ? '已注册' : '未注册' }}</strong>
              <span>Edge</span>
              <strong>{{ pluginListener.enabled && pluginListener.edgeRegistered ? '已注册' : '未注册' }}</strong>
              <span>Host</span>
              <strong>{{ pluginListener.mode === 'packaged' ? (pluginListener.hostExecutableExists ? '已找到' : '缺少程序') : '开发模式' }}</strong>
            </div>
            <p class="settings-note compact-note">开启后浏览器会按需启动后台 Host；关闭后已有连接也会停止返回填充数据。</p>
          </div>
          <div class="plugin-setting">
            <van-field v-model="pluginExtensionId" label="插件 ID" placeholder="扩展管理页里的 32 位 ID" />
            <div class="plugin-actions">
              <van-button size="small" type="primary" :disabled="pluginListener?.enabled" :loading="pluginBusy" @click="enablePluginListener">开启</van-button>
              <van-button size="small" plain type="primary" :disabled="!pluginListener?.enabled" :loading="pluginBusy" @click="disablePluginListener">关闭</van-button>
              <van-button size="small" plain type="default" :loading="pluginBusy" @click="loadPluginListenerState">刷新</van-button>
            </div>
          </div>
          <p v-if="pluginListener?.manifestPath" class="settings-note compact-note">Manifest：{{ pluginListener.manifestPath }}</p>
        </div>
      </section>
    </van-popup>

    <PasswordHealthCenter
      :open="passwordHealthOpen"
      :report="passwordHealthReport"
      :expected-totp-ids="expectedTotpEntryIds"
      :ignored-findings="ignoredHealthFindings"
      @update:open="passwordHealthOpen = $event"
      @open-entry="openPasswordHealthEntry"
      @remediate="remediatePasswordHealthFinding"
      @ignore-finding="handleIgnoreHealthFinding"
      @restore-finding="handleRestoreHealthFinding"
      @toggle-totp-expected="handleToggleExpectedTotp"
    />
    <PasskeyManager
      :open="passkeyManagerOpen"
      :items="passkeyPresentationItems"
      :login-options="passkeyLoginOptions"
      :busy="busy"
      :initial-id="passkeyManagerInitialId"
      @update:open="passkeyManagerOpen = $event"
      @save="saveManagedPasskey"
      @delete="deleteManagedPasskey"
      @open-entry="openPasskeyLinkedEntry"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import AuthScreen from './components/auth/AuthScreen.vue'
import EntryEditor from './components/editor/EntryEditor.vue'
import CredentialGenerator from './components/tools/CredentialGenerator.vue'
import ImportWizard from './components/tools/ImportWizard.vue'
import PasskeyManager from './components/tools/PasskeyManager.vue'
import PasswordHealthCenter from './components/tools/PasswordHealthCenter.vue'
import CloudPasswordPrompt from './components/sync/CloudPasswordPrompt.vue'
import CloudSyncReview from './components/sync/CloudSyncReview.vue'
import EntryDetailPane from './components/workspace/EntryDetailPane.vue'
import QuickAccess from './components/workspace/QuickAccess.vue'
import SettingsDrawer from './components/settings/SettingsDrawer.vue'
import WorkspaceHeader from './components/workspace/WorkspaceHeader.vue'
import VaultWorkspace from './components/workspace/VaultWorkspace.vue'
import {
  useCloudSync,
  type CloudBackupInfo,
  type CloudOperationDirection,
  type CloudOperationHandle,
  type CloudOperationKind,
  type CloudOperationStage,
  type CloudSyncLogEntry,
  type CloudSyncLogStatus
} from './composables/useCloudSync'
import { useEntryWorkspace } from './composables/useEntryWorkspace'
import { useSettingsPanel, type DrawerSection, type SystemGroupKey } from './composables/useSettingsPanel'
import { useVaultSession } from './composables/useVaultSession'
import { DEFAULT_OSS_OBJECT_NAME, normalizeObjectName } from './services/aliyunOss'
import { normalizeAutofillMatchMode, normalizeAutofillRuleValues } from './services/autofillRules.ts'
import { api } from './services/api'
import { MAX_ATTACHMENT_BYTES } from './services/attachmentCrypto.ts'
import { createAliyunOssVaultStore } from './services/cloud/aliyunOssVaultStore'
import {
  RemoteVaultStatus,
  type RemoteVaultObjectInfo,
  type RemoteVaultResult,
  type RemoteVaultStore
} from './services/cloud/remoteVaultStore'
import {
  appendRemoteVaultCommit,
  loadAppendOnlyVault,
  type AppendOnlyVaultRead
} from './services/sync/appendOnlyRemoteVault'
import { canonicalJson } from './services/sync/canonicalJson'
import {
  autoCloudSyncManualReviewLabels,
  buildCloudSyncDiff,
  cloudSyncChangeLabel,
  comparableCloudSyncEntry,
  cloudSyncDiffCountsForItems,
  cloudSyncEntryLabel,
  cloudSyncItemSummary,
  cloudSyncSelectionStats,
  countCloudSyncSelections,
  type CloudSyncChangeDetail,
  type CloudSyncDiffItem,
  type CloudSyncDirection,
  type CloudSyncPreview
} from './services/sync/legacyDiff'
import { validateLegacyRemoteObjectRevision } from './services/sync/legacyRemoteValidation'
import {
  buildCloudSyncTargetPayload,
  createCloudSyncPlan,
  hasLocalCloudChanges,
  isCloudSyncDownloadTargetApplied
} from './services/sync/cloudSyncPlan'
import { readSyncCheckpoint, writeSyncCheckpoint } from './services/sync/syncCheckpointStore'
import { mergeVaultPayloads, type VaultMergeConflict } from './services/sync/threeWayVaultMerge'
import {
  collectAttachmentReferences,
  ensureLocalAttachmentObjects,
  ensureRemoteAttachmentObjects
} from './services/sync/attachmentObjectSync.ts'
import {
  canonicalVaultReadCandidates,
  passkeyStateFingerprint,
  versionedVaultObjectName
} from './services/sync/passkeyRemoteGate'
import {
  analyzePasswordHealth,
  type PasswordHealthIssue
} from './services/passwordHealth'
import {
  clearIgnoredHealthFindingsForEntry,
  healthFindingKey,
  ignoreHealthFinding,
  loadExpectedTotpEntryIds,
  loadIgnoredHealthFindings,
  pruneHealthPreferences,
  restoreHealthFinding,
  setExpectedTotpEntryId
} from './services/healthPreferences.ts'
import { clearSensitiveClipboard, copySensitiveText } from './services/clipboardSecurity'
import { insertDuplicateEntry } from './services/entryDuplication.ts'
import {
  collectEntryIds,
  isEntryInsideAny,
  moveSelectedEntries,
  normalizeSelectedRootIds,
  removeSelectedEntries
} from './services/entryBatchOperations.ts'
import { filterVaultEntries } from './services/entryWorkspace.ts'
import { removeTrashedEntries } from './services/entryTrash.ts'
import { updatePasskeyMetadata } from './services/passkeyManagement.ts'
import { buildPasskeyLoginOptions, buildPasskeyPresentationItems } from './services/passkeyPresentation.ts'
import {
  loadFavoriteEntryIds,
  loadRecentEntryIds,
  pruneEntryPreferenceIds,
  rememberRecentEntryId,
  setFavoriteEntryIds,
  toggleFavoriteEntryId
} from './services/entryListPreferences.ts'
import { ENTRY_KIND_OPTIONS, entryKindLabel, starterCustomFields } from './services/entryKinds.ts'
import type { ImportedVaultRecord } from './services/vaultImport.ts'
import { AutoSyncPasswordGate } from './services/autoSyncPasswordGate'
import {
  buildEntryHistoryChanges,
  clearEntryHistoryRecords,
  createEntrySnapshot,
  limitEntryHistory,
  restoreEntrySnapshot,
  shouldRecordEntryHistory
} from './services/entryHistory'
import { generateTotp, readTotpPeriod } from './services/totp'
import { secureRandomId } from './services/secureRandom'
import {
  SESSION_TIMEOUT_DEFAULT_MINUTES,
  SESSION_TIMEOUT_MAX_MINUTES,
  SESSION_TIMEOUT_MIN_MINUTES,
  loadSessionTimeoutMinutes,
  sessionTimeoutMilliseconds
} from './services/sessionTimeout.ts'
import {
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  loadUiScalePercent
} from './services/uiScale'
import type {
  AndroidAutofillState,
  AutofillMatchMode,
  ApiResult,
  AppState,
  AppUpdateCheck,
  AppUpdateProgress,
  DeviceUnlockState,
  EntryHistoryAction,
  EntryKind,
  EntryStatus,
  LoginAccountSource,
  PluginListenerState,
  PortableBackupSelection,
  VaultEntry,
  VaultAttachment,
  VaultPayload
} from './types'

type ThemeMode = 'light' | 'dark'
type CssVars = Record<string, string>
type MoveEntryPayload = {
  entryId: string
  targetParentId: string
  targetIndex: number
}
type MoveDestinationAction = {
  name: string
  subname?: string
  icon?: string
  targetParentId: string
}
type AndroidAutofillLaunchContext = {
  active: boolean
  target?: string
  searchTerm?: string
  includeAll?: boolean
}
type SystemGroupInfo = {
  key: SystemGroupKey
  title: string
  description: string
  emptyText: string
  icon: string
  count: number
}
type CloudSyncStateRecord = {
  remoteUpdatedAt: number
  remoteFingerprint: string
  localFingerprint: string
  recordedAt: number
}

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])
const ENTRY_STATUSES = new Set<EntryStatus>(['active', 'disabled', 'trashed'])

const DESKTOP_QUERY = '(min-width: 820px)'
const PANE_WIDTH_KEY = 'mypwdmg.desktopPaneWidth'
const PANE_WIDTH_MIN = 340
const PANE_WIDTH_MAX = 640
const PANE_WIDTH_KEYBOARD_STEP = 20
const UI_SCALE_KEY = 'mypwdmg.uiScalePercent.v3'
const LEGACY_UI_SCALE_KEY = 'mypwdmg.uiScaleLevel.v2'
const FONT_SIZE_KEY = 'mypwdmg.fontSizePercent'
const SESSION_TIMEOUT_KEY = 'mypwdmg.sessionTimeoutMinutes'
const UPDATE_MANIFEST_URL_KEY = 'mypwdmg.updateManifestUrl'
const CLOUD_SYNC_LOGS_KEY = 'mypwdmg.cloudSyncLogs.v1'
const CLOUD_SYNC_LOG_LIMIT_KEY = 'mypwdmg.cloudSyncLogLimit'
const LEGACY_CLOUD_SYNC_STATE_KEY = 'mypwdmg.cloudSyncState.v1'
const CLOUD_SYNC_STATE_KEY = 'mypwdmg.cloudSyncState.v2'
const CLOUD_SYNC_LOG_LIMIT_DEFAULT = 50
const CLOUD_SYNC_LOG_LIMIT_MIN = 10
const CLOUD_SYNC_LOG_LIMIT_MAX = 200
const AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES = 1
const AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES = 1
const AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES = 1440
const GITHUB_UPDATE_MANIFEST_URL = 'https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json'
const DEFAULT_UPDATE_MANIFEST_URL = GITHUB_UPDATE_MANIFEST_URL
const BUILT_IN_MANIFEST_URL_PATTERN =
  /^(?:https:\/\/ghproxy\.net\/)?https:\/\/github\.com\/suzikuo\/pwdmg\/releases\/(?:latest\/download|download\/[^/]+)\/update-manifest\.json$/i
const packagedAppVersion = String(import.meta.env.PACKAGE_VERSION || '').trim()
const runtimeMode = String(import.meta.env.VITE_STORAGE_MODE || import.meta.env.VITE_API_MODE || import.meta.env.MODE || '').toLowerCase()
const isDesktopRuntime = ['desktop', 'pywebview', 'native'].includes(runtimeMode)
const isAndroidRuntime = runtimeMode === 'android'
const isExternalNativeRuntime = isDesktopRuntime || isAndroidRuntime
const appVersion = ref('')
const displayAppVersion = computed(() => appVersion.value || packagedAppVersion || '0.0.0')
const FONT_SIZE_MIN = 80
const FONT_SIZE_MAX = 130
const TOTP_PERIOD_SECONDS = 30
const BACK_EXIT_INTERVAL = 1600
const EXTERNAL_VAULT_REFRESH_DELAY_MS = 180
const EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS = 900
const AUTO_CLOUD_SYNC_UPLOAD_DELAY_MS = 700
const AUTO_CLOUD_SYNC_DOWNLOAD_DELAY_MS = 1200
const TEXT_EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .van-field__control'

const state = reactive<AppState>({
  hasVault: false,
  locked: true,
  expiresAt: 0,
  legacyAvailable: false,
  vaultPath: '',
  passwordless: false
})
const stateLoading = ref(true)
const stateError = ref('')
const busy = ref(false)
const attachmentBusy = ref(false)
const pluginBusy = ref(false)
const androidAutofillBusy = ref(false)
const updateBusy = ref<'check' | 'download' | 'apply' | ''>('')
const updateStatus = ref('')
const updateManifestUrl = ref(resolveUpdateManifestUrl(localStorage.getItem(UPDATE_MANIFEST_URL_KEY)))
const updateInfo = ref<AppUpdateCheck | null>(null)
const updateProgress = ref<AppUpdateProgress | null>(null)
const downloadedUpdatePath = ref('')
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const cloudPasswordPromptOpen = ref(false)
const cloudPasswordPromptValue = ref('')
const portableBackupBusy = ref(false)
const portableBackupStatus = ref('')
const portableBackupSelection = ref<PortableBackupSelection | null>(null)
const portableBackupPasswordOpen = ref(false)
const portableBackupPassword = ref('')
const changePasswordValue = ref('')
const changePasswordConfirm = ref('')
const pluginExtensionId = ref('')
const importLegacy = ref(true)
const vault = ref<VaultPayload | null>(null)
const favoriteEntryIds = ref<Set<string>>(loadFavoriteEntryIds())
const recentEntryIds = ref<string[]>(loadRecentEntryIds())
const expectedTotpEntryIds = ref<Set<string>>(loadExpectedTotpEntryIds())
const ignoredHealthFindings = ref(loadIgnoredHealthFindings())
const moveSheetOpen = ref(false)
const moveEntryId = ref('')
const batchSelectionMode = ref(false)
const batchSelectedEntryIds = ref<Set<string>>(new Set())
const batchMoveSheetOpen = ref(false)
const quickAccessOpen = ref(false)
const entryContextMenuOpen = ref(false)
const createParentId = ref('')
const searchOpen = ref(false)
const uiScalePercent = ref(loadUiScale())
const fontSizePercent = ref(loadFontSize())
const sessionTimeoutMinutes = ref(loadSessionTimeoutMinutes(localStorage.getItem(SESSION_TIMEOUT_KEY)))
const contextEntryId = ref('')
const entryContextMenuX = ref(0)
const entryContextMenuY = ref(0)
const domainText = ref('')
const totpCode = ref('')
const pluginListener = ref<PluginListenerState | null>(null)
const androidAutofill = ref<AndroidAutofillState | null>(null)
const androidAutofillLaunch = ref<AndroidAutofillLaunchContext | null>(null)
const cloudSyncRuntime = useCloudSync({
  initialLogs: loadCloudSyncLogs(),
  initialLogLimit: loadCloudSyncLogLimit()
})
const {
  busy: cloudBusy,
  status: backupStatus,
  info: cloudInfo,
  backups: cloudBackups,
  selectedObjectName: selectedCloudObjectName,
  reviewOpen: cloudSyncReviewOpen,
  preview: cloudSyncPreview,
  logs: cloudSyncLogs,
  logLimit: cloudSyncLogLimit
} = cloudSyncRuntime
const showPassword = ref(false)
const generatorOpen = ref(false)
const generatorApplyToPassword = ref(false)
const generatorResetKey = ref(0)
const importOpen = ref(false)
const importResetKey = ref(0)
const deviceUnlockState = ref<DeviceUnlockState>({ supported: false, enabled: false, expiresAt: 0 })
const deviceUnlockSheetOpen = ref(false)
const deviceUnlockPassword = ref('')
const deviceUnlockReauthSeconds = ref(7 * 24 * 60 * 60)
const passkeyManagerOpen = ref(false)
const passkeyManagerInitialId = ref('')
const totpRemaining = ref(TOTP_PERIOD_SECONDS)
const totpPeriodSeconds = ref(TOTP_PERIOD_SECONDS)
const totpRequestId = ref(0)
const isWide = ref(false)
const isDrawerWide = ref(false)
const paneWidth = ref(loadPaneWidth())
const workspaceGrid = ref<HTMLElement | null>(null)
const theme = ref<ThemeMode>((localStorage.getItem('mypwdmg.theme') as ThemeMode) || defaultTheme())
const form = reactive<VaultEntry>(emptyEntry('login'))
const settings = reactive({
  oss: {
    bucketName: '',
    accessKeyId: '',
    accessKeySecret: '',
    region: '',
    objectName: DEFAULT_OSS_OBJECT_NAME,
    autoSync: false,
    autoSyncIntervalMinutes: AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES
  }
})
const {
  drawerOpen,
  drawerDetailOpen,
  drawerSection,
  systemGroupKey,
  passwordSheetOpen,
  pluginDetailOpen,
  passwordHealthOpen
} = useSettingsPanel()
let cloudPasswordPromptResolve: ((value: string | null) => void) | null = null
const createActions = ENTRY_KIND_OPTIONS.map((option) => ({
  name: option.label,
  subname: option.description,
  kind: option.kind
}))
const createMenuActions = ENTRY_KIND_OPTIONS.map((option) => ({
  text: option.label,
  icon: option.icon,
  kind: option.kind
}))
const moveDestinationActions = computed<MoveDestinationAction[]>(() => {
  const source = findEntry(vault.value?.entries || [], moveEntryId.value)
  if (!source || !isActiveEntry(source)) return []

  const actions: MoveDestinationAction[] = [
    { name: '根目录', subname: '顶层条目', icon: 'home-o', targetParentId: '' }
  ]
  appendMoveDestinationActions(activeTree(vault.value?.entries || []), [], source, actions)
  return actions
})
const {
  keyword,
  entryFilter,
  editorOpen,
  detailOpen,
  createSheetOpen,
  createMenuOpen,
  moreMenuOpen,
  dragMode,
  editingId,
  editingParentId,
  selectedEntry,
  filteredEntries,
  clearSelection: clearWorkspaceSelection
} = useEntryWorkspace(
  () => vault.value?.entries || [],
  activeTree,
  (entries, term, mode) => filterVaultEntries(entries, term, mode, {
    favoriteIds: favoriteEntryIds.value,
    recentIds: recentEntryIds.value
  })
)
const visibleBatchEntryIds = computed(() => collectEntryIds(filteredEntries.value))
const allVisibleBatchEntriesSelected = computed(() => {
  const visibleIds = visibleBatchEntryIds.value
  return visibleIds.length > 0 && visibleIds.every((id) => batchSelectedEntryIds.value.has(id))
})
const allBatchEntriesFavorited = computed(() => {
  const selectedIds = [...batchSelectedEntryIds.value]
  return selectedIds.length > 0 && selectedIds.every((id) => favoriteEntryIds.value.has(id))
})
const batchMoveDestinationActions = computed<MoveDestinationAction[]>(() => {
  if (!vault.value || batchSelectedEntryIds.value.size === 0) return []
  const actions: MoveDestinationAction[] = [
    { name: '根目录', subname: '顶层条目', icon: 'home-o', targetParentId: '' }
  ]
  appendBatchMoveDestinationActions(activeTree(vault.value.entries), [], actions)
  return actions
})
const entryContextActions = computed(() => {
  const entry = findEntry(vault.value?.entries || [], contextEntryId.value)
  if (!entry) return []
  if (entry.status === 'trashed') {
    return [
      { name: '恢复', key: 'restore', color: '#0f766e' },
      { name: '彻底删除', key: 'purge', color: '#ee0a24' }
    ]
  }
  const actions: Array<{ name: string; key: string; color?: string }> = []
  if (entry.kind === 'folder') {
    actions.push(
      { name: '新建登录', key: 'create-login' },
      { name: '新建分组', key: 'create-folder' },
      { name: '创建副本', key: 'duplicate' },
      { name: '编辑分组', key: 'edit' },
      { name: '归档分组', key: 'archive', color: '#ee0a24' },
      { name: '移入回收站', key: 'trash', color: '#ee0a24' }
    )
  } else {
    const label = entryKindLabel(entry.kind)
    actions.push(
      { name: '创建副本', key: 'duplicate' },
      { name: `编辑${label}`, key: 'edit' },
      { name: `归档${label}`, key: 'archive', color: '#ee0a24' },
      { name: '移入回收站', key: 'trash', color: '#ee0a24' }
    )
  }
  return actions
})
const entryContextMenuStyle = computed<CssVars>(() => ({
  left: `${entryContextMenuX.value}px`,
  top: `${entryContextMenuY.value}px`
}))
const moreActions = computed(() => [
  { text: '快速访问', icon: 'search', key: 'quick-access' },
  { text: '凭据生成器', icon: 'replay', key: 'generator' },
  { text: '导入数据', icon: 'upgrade', key: 'import' },
  {
    text: batchSelectionMode.value ? '退出批量选择' : '批量选择',
    icon: 'passed',
    key: 'select'
  },
  {
    text: dragMode.value ? '退出拖拽模式' : '拖拽模式',
    icon: 'sort',
    key: 'drag'
  },
  { text: '锁定', icon: 'lock', key: 'lock' },
  ...(isExternalNativeRuntime
    ? [{ text: '安全退出', icon: 'cross', key: 'safe-exit', color: '#ee0a24' }]
    : [])
])
const loginAccountSourceOptions: Array<{ label: string; value: LoginAccountSource }> = [
  { label: '自动', value: 'auto' },
  { label: '账号', value: 'username' },
  { label: '邮箱', value: 'email' },
  { label: '手机', value: 'phone' }
]
const autofillMatchModeOptions: Array<{ label: string; value: AutofillMatchMode }> = [
  { label: '根域及子域', value: 'base-domain' },
  { label: '仅精确主机', value: 'exact-host' },
  { label: '仅下级子域', value: 'subdomain' },
  { label: 'URL 前缀', value: 'url-prefix' },
  { label: '永不填充', value: 'never' }
]

const unlocked = computed(() => Boolean(vault.value) && !state.locked)
const vaultSession = useVaultSession(() => {
  if (unlocked.value) lockVault()
}, () => sessionTimeoutMilliseconds(sessionTimeoutMinutes.value))
const passwordMask = computed(() => selectedEntry.value?.password ? '••••••••••••' : '未设置')
const deviceUnlockSettingsLabel = computed(() => {
  if (!deviceUnlockState.value.enabled) return '使用 Windows 当前用户保护'
  const expiresAt = deviceUnlockState.value.expiresAt
  return expiresAt > 0 ? `有效至 ${new Date(expiresAt * 1000).toLocaleDateString()}` : '已启用'
})
const passkeyPresentationItems = computed(() => buildPasskeyPresentationItems(
  vault.value?.passkeys || [],
  vault.value?.entries || []
))
const passkeyLoginOptions = computed(() => buildPasskeyLoginOptions(vault.value?.entries || []))
const selectedEntryPasskeys = computed(() => {
  const entryId = selectedEntry.value?.kind === 'login' ? selectedEntry.value.id : ''
  return entryId
    ? passkeyPresentationItems.value.filter((item) => item.linkedEntryId === entryId)
    : []
})
const totpProgress = computed(() => Math.round((totpRemaining.value / totpPeriodSeconds.value) * 100))
const passwordHealthReport = computed(() => analyzePasswordHealth(vault.value?.entries || [], {
  totpExpectedIds: expectedTotpEntryIds.value
}))
const passwordHealthPendingEntryCount = computed(() => new Set(
  passwordHealthReport.value.entries.flatMap((entry) => entry.issues
    .filter((issue) => !ignoredHealthFindings.value.has(healthFindingKey(entry.entryId, issue)))
    .map(() => entry.entryId))
).size)
const passwordHealthSettingsLabel = computed(() => {
  const summary = passwordHealthReport.value.summary
  if (!summary.scannedEntryCount) return '暂无可检查条目'
  return passwordHealthPendingEntryCount.value
    ? `${passwordHealthPendingEntryCount.value} 项需处理`
    : `已检查 ${summary.scannedEntryCount} 项`
})
const passwordHealthScoreLabel = computed(() => {
  const summary = passwordHealthReport.value.summary
  return summary.analyzedCount ? `${summary.averageScore.toFixed(1)} / 4` : '-'
})
const drawerSectionTitle = computed(() => {
  if (drawerSection.value === 'settings') return '设置'
  if (drawerSection.value === 'updates') return '更新'
  if (drawerSection.value === 'system') return '系统分组'
  return '备份'
})
const portableBackupPasswordNote = computed(() => {
  const selected = portableBackupSelection.value
  if (!selected) return '请输入备份包创建时使用的主密码；未设置主密码可留空。'
  const details = [
    selected.name || '已选择备份包',
    `${selected.attachmentCount || 0} 个附件`,
    selected.packageBytes ? formatBytes(selected.packageBytes) : ''
  ].filter(Boolean).join(' · ')
  return `${details}。恢复会替换当前保险库，请输入该备份包的主密码；未设置可留空。`
})
const pluginListenerStatus = computed(() => {
  const listener = pluginListener.value
  if (!listener) return '未检测'
  if (!listener.supported) return '仅 Windows 支持'
  if (!listener.enabled) return '未开启'
  if (listener.mode === 'packaged' && !listener.hostExecutableExists) return '缺少 Host'
  const browsers = [
    listener.chromeRegistered ? 'Chrome' : '',
    listener.edgeRegistered ? 'Edge' : ''
  ].filter(Boolean)
  return browsers.length ? `${browsers.join('/')} 已开启` : '未开启'
})
const isDesktopMode = computed(() => isDesktopRuntime)
const isAndroidMode = computed(() => isAndroidRuntime)
const isExternalNativeVaultMode = computed(() => isExternalNativeRuntime)
const showUpdateSettings = computed(() => isExternalNativeRuntime)
const showPluginSettings = computed(() => isDesktopMode.value && pluginListener.value?.supported !== false)
const showAndroidAutofillSettings = computed(() => androidAutofill.value?.supported === true)
const androidAutofillStatus = computed(() => {
  const state = androidAutofill.value
  if (!state) return '未检测'
  if (!state.supported) return '不支持'
  return state.enabled ? '已开启' : '去设置'
})
const updatePlatform = computed(() => updateInfo.value?.platform || (isAndroidMode.value ? 'android' : 'desktop'))
const updateInstallButtonText = computed(() => updatePlatform.value === 'android' ? '打开安装器' : '安装并重启')
const updateInstallModeText = computed(() => {
  if (!updateInfo.value?.canApply) return '仅检查/下载'
  return updatePlatform.value === 'android' ? '系统安装器' : '自动安装'
})
const updateProgressPercent = computed(() => {
  const progress = updateProgress.value?.progress || 0
  return Math.max(0, Math.min(100, Math.round(progress)))
})
const updateProgressLabel = computed(() => {
  const progress = updateProgress.value
  if (!progress) return ''
  if (progress.message) return progress.message
  if (progress.phase === 'download') return '正在下载更新包'
  if (progress.phase === 'verify') return '正在校验更新包'
  return '正在检查更新'
})
const desktopGridStyle = computed<CssVars>(() => {
  if (!isWide.value) return {} as CssVars
  return { '--vault-pane-width': `${paneWidth.value}px` }
})
const paneWidthMax = computed(() => getPaneWidthMax())
const stats = computed(() => {
  const flat = flattenEntries(vault.value?.entries || [])
  const active = flat.filter(isActiveEntry)
  return {
    items: active.filter((entry) => entry.kind !== 'folder').length,
    logins: active.filter((entry) => entry.kind === 'login').length,
    folders: active.filter((entry) => entry.kind === 'folder').length,
    totp: active.filter((entry) => entry.kind === 'login' && entry.totpSecret).length,
    archived: collectSystemGroupEntries(vault.value?.entries || [], 'disabled').length,
    trashed: collectSystemGroupEntries(vault.value?.entries || [], 'trashed').length
  }
})
const systemGroups = computed<SystemGroupInfo[]>(() => [
  {
    key: 'archived',
    title: '已归档',
    description: '隐藏但保留原分组位置，恢复后回到原处',
    emptyText: '没有归档条目',
    icon: 'closed-eye',
    count: stats.value.archived
  },
  {
    key: 'trashed',
    title: '回收站',
    description: '准备删除的条目，彻底删除前还能恢复',
    emptyText: '回收站为空',
    icon: 'delete-o',
    count: stats.value.trashed
  }
])
const currentSystemGroup = computed(() => {
  return systemGroups.value.find((group) => group.key === systemGroupKey.value) || systemGroups.value[0]
})
const systemGroupEntries = computed(() => {
  const status: EntryStatus = systemGroupKey.value === 'archived' ? 'disabled' : 'trashed'
  return collectSystemGroupEntries(vault.value?.entries || [], status)
})
const cloudSyncDiffCounts = computed(() => {
  const items = cloudSyncPreview.value?.items || []
  return {
    added: items.filter((item) => item.changeType === 'added').length,
    modified: items.filter((item) => item.changeType === 'modified').length,
    deleted: items.filter((item) => item.changeType === 'deleted').length
  }
})
const cloudSyncSelectedCount = computed(() => countCloudSyncSelections(cloudSyncPreview.value?.items || []))
const cloudSyncReviewTitle = computed(() => {
  if (cloudSyncPreview.value?.direction === 'download') return '下载校验'
  return '上传校验'
})
const cloudSyncReviewActionText = computed(() => {
  const preview = cloudSyncPreview.value
  if (!preview) return '应用'
  return preview.direction === 'download' ? '下载勾选项' : '上传勾选项'
})

let desktopMediaQuery: MediaQueryList | null = null
let drawerMediaQuery: MediaQueryList | null = null
let resizingPane = false
let totpTimer = 0
let autoCloudUploadTimer = 0
let autoCloudDownloadTimer = 0
let lastAutoCloudDownloadCheckAt = 0
let totpCurrentStep = -1
let lastBackRequestAt = 0
let externalVaultRefreshTimer = 0
let busyOperationId = 0
const autoSyncPasswordGate = new AutoSyncPasswordGate()
let lastExternalVaultRefreshAt = 0
let externalVaultRefreshing = false

onMounted(() => {
  purgeLegacyCloudSyncState()
  applyTheme()
  applyLayoutScale(false)
  applyFontSize(false)
  desktopMediaQuery = window.matchMedia(DESKTOP_QUERY)
  drawerMediaQuery = window.matchMedia('(min-width: 680px)')
  syncDesktopMode()
  syncDrawerMode()
  desktopMediaQuery.addEventListener('change', syncDesktopMode)
  drawerMediaQuery.addEventListener('change', syncDrawerMode)
  window.addEventListener('resize', clampPaneToViewport)
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('pointerdown', handleSessionActivity, true)
  window.addEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.addEventListener('scroll', closeEntryContextMenu, true)
  window.addEventListener('resize', closeEntryContextMenu)
  window.addEventListener('focus', loadAndroidAutofillState)
  window.addEventListener('focus', resetAndroidInstallBusy)
  window.addEventListener('focus', scheduleExternalVaultRefresh)
  window.addEventListener('focus', scheduleAutoCloudDownloadCheck)
  window.addEventListener('mypwdmg:quick-access', openQuickAccess)
  window.addEventListener('mypwdmg:lock-request', handleDesktopLockRequest)
  document.addEventListener('selectstart', suppressNonEditableSelection)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.__mypwdmgHandleNativeBack = handleNativeBack
  window.__mypwdmgHandleNativeLock = () => {
    applyLockedUiState()
    return true
  }
  loadAppInfo()
  loadAndroidAutofillLaunchContext()
  loadState()
  loadAndroidAutofillState()
})

watch(drawerOpen, (open) => {
  if (!open) drawerDetailOpen.value = false
})
watch(entryContextMenuOpen, (open) => {
  if (!open) contextEntryId.value = ''
})
watch(() => [keyword.value, entryFilter.value], ([value, filter]) => {
  if (String(value).trim() || filter !== 'all') dragMode.value = false
})
watch(() => [selectedEntry.value?.id, selectedEntry.value?.totpSecret], syncSelectedTotpTimer)
watch(unlocked, scheduleSessionLock, { immediate: true })

onUnmounted(() => {
  desktopMediaQuery?.removeEventListener('change', syncDesktopMode)
  drawerMediaQuery?.removeEventListener('change', syncDrawerMode)
  window.removeEventListener('resize', clampPaneToViewport)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('pointerdown', handleSessionActivity, true)
  window.removeEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.removeEventListener('scroll', closeEntryContextMenu, true)
  window.removeEventListener('resize', closeEntryContextMenu)
  window.removeEventListener('focus', loadAndroidAutofillState)
  window.removeEventListener('focus', resetAndroidInstallBusy)
  window.removeEventListener('focus', scheduleExternalVaultRefresh)
  window.removeEventListener('focus', scheduleAutoCloudDownloadCheck)
  window.removeEventListener('mypwdmg:quick-access', openQuickAccess)
  window.removeEventListener('mypwdmg:lock-request', handleDesktopLockRequest)
  document.removeEventListener('selectstart', suppressNonEditableSelection)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (externalVaultRefreshTimer) window.clearTimeout(externalVaultRefreshTimer)
  if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
  if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
  vaultSession.cancel()
  delete window.__mypwdmgHandleNativeBack
  delete window.__mypwdmgHandleNativeLock
  stopPaneResize()
  stopTotpTimer()
})

function handleNativeBack() {
  if (closeTopLayer()) return true

  const now = Date.now()
  if (now - lastBackRequestAt < BACK_EXIT_INTERVAL) {
    safeExit()
    return true
  }

  lastBackRequestAt = now
  showToast('再按一次退出')
  return true
}

function handleGlobalKeydown(event: KeyboardEvent) {
  handleSessionActivity(event)
  if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
    event.preventDefault()
    event.stopPropagation()
    openQuickAccess()
    return
  }
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (document.querySelector('.van-dialog')) return
  if (!closeTopLayer()) return
  event.preventDefault()
  event.stopPropagation()
}

function handleSessionActivity(event: Event) {
  if (!event.isTrusted || !unlocked.value) return
  scheduleSessionLock()
}

function closeTopLayer() {
  if (cloudSyncReviewOpen.value && cloudBusy.value) {
    showToast('正在应用同步，请稍候')
    return true
  }
  if ((editorOpen.value || passwordSheetOpen.value) && busy.value) {
    showToast('正在保存，请稍候')
    return true
  }
  if (cloudSyncReviewOpen.value) {
    hideCloudSyncReview()
    return true
  }
  if (quickAccessOpen.value) {
    quickAccessOpen.value = false
    return true
  }
  if (passkeyManagerOpen.value) {
    passkeyManagerOpen.value = false
    return true
  }
  if (pluginDetailOpen.value) {
    pluginDetailOpen.value = false
    return true
  }
  if (passwordHealthOpen.value) {
    passwordHealthOpen.value = false
    return true
  }
  if (passwordSheetOpen.value) {
    passwordSheetOpen.value = false
    return true
  }
  if (deviceUnlockSheetOpen.value) {
    deviceUnlockSheetOpen.value = false
    return true
  }
  if (editorOpen.value) {
    blurActiveElement()
    editorOpen.value = false
    return true
  }
  if (entryContextMenuOpen.value) {
    entryContextMenuOpen.value = false
    return true
  }
  if (createSheetOpen.value) {
    createSheetOpen.value = false
    return true
  }
  if (moveSheetOpen.value) {
    moveSheetOpen.value = false
    moveEntryId.value = ''
    return true
  }
  if (batchMoveSheetOpen.value) {
    batchMoveSheetOpen.value = false
    return true
  }
  if (detailOpen.value) {
    detailOpen.value = false
    return true
  }
  if (drawerOpen.value) {
    if (drawerDetailOpen.value && !isDrawerWide.value) drawerDetailOpen.value = false
    else drawerOpen.value = false
    return true
  }
  if (createMenuOpen.value || moreMenuOpen.value) {
    createMenuOpen.value = false
    moreMenuOpen.value = false
    return true
  }
  if (searchOpen.value || keyword.value || entryFilter.value !== 'all') {
    searchOpen.value = false
    keyword.value = ''
    entryFilter.value = 'all'
    return true
  }
  if (dragMode.value) {
    dragMode.value = false
    return true
  }
  if (batchSelectionMode.value) {
    exitBatchSelection()
    return true
  }
  return false
}

function openQuickAccess() {
  if (!unlocked.value) {
    showToast('请先解锁保险库')
    return
  }
  if (busy.value) {
    showToast('正在处理，请稍候')
    return
  }
  if (editorOpen.value) {
    showToast('请先完成或关闭当前编辑')
    return
  }
  exitBatchSelection()
  detailOpen.value = false
  drawerOpen.value = false
  createSheetOpen.value = false
  moveSheetOpen.value = false
  entryContextMenuOpen.value = false
  createMenuOpen.value = false
  moreMenuOpen.value = false
  quickAccessOpen.value = true
}

function openQuickAccessEntry(entry: VaultEntry) {
  quickAccessOpen.value = false
  showEntryDetail(entry)
}

async function copyQuickAccessTotp(entry: VaultEntry) {
  if (!entry.totpSecret) return showToast('该条目没有 TOTP')
  try {
    const code = await generateTotp(entry.totpSecret)
    await copyText(code)
  } catch {
    showFailToast('TOTP 生成失败')
  }
}

async function openQuickAccessWebsite(domain: string) {
  const target = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
  const result = await api.openExternalUrl(target)
  if (!result.ok) showFailToast(result.message || '打开网站失败')
}

function handleDesktopLockRequest() {
  if (unlocked.value) void lockVault()
}

function blurActiveElement() {
  const active = document.activeElement as HTMLElement | null
  active?.blur?.()
}

function scrollFocusedEditorFieldIntoView(event: FocusEvent) {
  if (!editorOpen.value) return
  const target = event.target as HTMLElement | null
  const field = target?.closest?.('.van-field') as HTMLElement | null
  const element = field || target
  if (!element) return
  const scroller = element.closest('.editor-form') as HTMLElement | null
  if (!scroller) return
  window.setTimeout(() => scrollEditorElementIntoView(scroller, element, 'smooth'), 80)
  window.setTimeout(() => scrollEditorElementIntoView(scroller, element, 'auto'), 260)
}

function beginBusyOperation() {
  busyOperationId += 1
  busy.value = true
  return busyOperationId
}

function finishBusyOperation(operationId: number) {
  if (operationId !== busyOperationId) return
  busy.value = false
}

function resetBusyOperation() {
  busyOperationId += 1
  busy.value = false
}

function scrollEditorElementIntoView(scroller: HTMLElement, element: HTMLElement, behavior: ScrollBehavior) {
  const scrollerRect = scroller.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const usableScrollerHeight = Math.max(120, scroller.clientHeight)
  const centeredTop = scroller.scrollTop
    + elementRect.top
    - scrollerRect.top
    - Math.max(0, (usableScrollerHeight - elementRect.height) / 2)
  scroller.scrollTo({
    top: Math.max(0, centeredTop),
    behavior
  })
}

function suppressNonEditableSelection(event: Event) {
  if (!isTextEditableTarget(event.target)) event.preventDefault()
}

function isTextEditableTarget(target: EventTarget | null) {
  let element: Element | null = null
  if (target instanceof Element) element = target
  else if (target instanceof Node) element = target.parentElement
  return Boolean(element?.closest(TEXT_EDITABLE_SELECTOR))
}

async function loadState() {
  const generation = vaultSession.capture()
  stateLoading.value = true
  stateError.value = ''
  let shouldAutoUnlock = false
  try {
    const result = await api.getStartupData()
    if (!vaultSession.isCurrent(generation)) return
    if (result.ok && result.data) {
      Object.assign(state, result.data.state)
      if (result.data.vault) {
        if (!activateVaultSession(result.data.vault, generation)) return
        applyAndroidAutofillSearch()
        scheduleAutoCloudDownloadCheck(true)
      } else if (state.hasVault) {
        if (state.locked && state.passwordless) shouldAutoUnlock = true
        else if (!state.locked) await loadUnlockedVault()
      }
    } else {
      stateError.value = result.message || '无法连接本地保险库'
    }
    await refreshDeviceUnlockState()
  } finally {
    stateLoading.value = false
  }

  if (shouldAutoUnlock) {
    window.setTimeout(() => {
      unlockWithPassword('', true)
    }, 0)
  }
}

async function loadAppInfo() {
  const result = await api.getAppInfo()
  if (result.ok) syncAppVersion(result.data?.version)
}

function syncAppVersion(value: unknown) {
  const version = String(value || '').trim()
  if (version) appVersion.value = version
}

async function createVault() {
  if (busy.value) return
  const generation = vaultSession.capture()
  if (newPassword.value !== confirmPassword.value) return showFailToast('两次密码不一致')
  const operationId = beginBusyOperation()
  try {
    const result = await api.createVault(newPassword.value, importLegacy.value)
    if (!result.ok || !result.data) return showFailToast(result.message || '创建失败')
    if (!vaultSession.isCurrent(generation)) return
    state.hasVault = true
    if (!activateVaultSession(result.data.vault, generation)) return
    newPassword.value = ''
    confirmPassword.value = ''
    applyAndroidAutofillSearch()
    if (result.data.legacyCleanupPending) {
      showFailToast(`已迁移 ${result.data.migrated} 条，但旧数据清理失败；请暂时保留并手动检查旧文件`)
    } else {
      showSuccessToast(result.data.migrated ? `已迁移 ${result.data.migrated} 条并清理旧数据` : '保险库已创建')
    }
  } catch {
    showFailToast('创建失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function unlockVault() {
  await unlockWithPassword(password.value)
}

async function refreshDeviceUnlockState() {
  const result = await api.getDeviceUnlockState()
  deviceUnlockState.value = result.ok && result.data
    ? result.data
    : { supported: false, enabled: false, expiresAt: 0 }
}

async function unlockWithDevice() {
  if (busy.value || !deviceUnlockState.value.enabled) return
  const generation = vaultSession.capture()
  const operationId = beginBusyOperation()
  try {
    const result = await api.quickUnlock()
    if (!result.ok || !result.data) {
      await refreshDeviceUnlockState()
      return showFailToast(result.message || '设备快速解锁失败')
    }
    if (!activateVaultSession(result.data, generation)) return
    password.value = ''
    scheduleAutoCloudDownloadCheck(true)
    showSuccessToast('已使用设备密钥解锁')
  } catch {
    await refreshDeviceUnlockState()
    showFailToast('设备快速解锁失败，请使用主密码')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function unlockWithPassword(candidate: string, silent = false) {
  if (!silent && busy.value) return false
  const generation = vaultSession.capture()
  const operationId = silent ? 0 : beginBusyOperation()
  try {
    const result = await api.unlock(candidate)
    if (!result.ok || !result.data) {
      if (!silent) showFailToast(result.message || '解锁失败')
      return false
    }
    if (!activateVaultSession(result.data, generation)) return false
    password.value = ''
    applyAndroidAutofillSearch()
    scheduleAutoCloudDownloadCheck(true)
    return true
  } catch {
    if (!silent) showFailToast('解锁失败，请重试')
    return false
  } finally {
    if (operationId) finishBusyOperation(operationId)
  }
}

async function loadUnlockedVault() {
  const generation = vaultSession.capture()
  const result = await api.getVault()
  if (!result.ok || !result.data) {
    applyLockedUiState()
    return false
  }
  if (!activateVaultSession(result.data, generation)) return false
  applyAndroidAutofillSearch()
  scheduleAutoCloudDownloadCheck(true)
  return true
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    scheduleExternalVaultRefresh()
    scheduleAutoCloudDownloadCheck()
  }
}

function scheduleExternalVaultRefresh() {
  if (!isExternalNativeVaultMode.value || !vault.value || state.locked) return
  if (externalVaultRefreshTimer) window.clearTimeout(externalVaultRefreshTimer)
  const now = Date.now()
  const delay =
    now - lastExternalVaultRefreshAt < EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS
      ? EXTERNAL_VAULT_REFRESH_MIN_INTERVAL_MS
      : EXTERNAL_VAULT_REFRESH_DELAY_MS
  externalVaultRefreshTimer = window.setTimeout(() => {
    externalVaultRefreshTimer = 0
    refreshVaultFromDisk()
  }, delay)
}

async function refreshVaultFromDisk() {
  if (!isExternalNativeVaultMode.value || externalVaultRefreshing || !vault.value || state.locked) return
  if (busy.value || cloudBusy.value || pluginBusy.value || updateBusy.value) return
  if (editorOpen.value || passwordSheetOpen.value || createSheetOpen.value || passkeyManagerOpen.value) return

  externalVaultRefreshing = true
  const generation = vaultSession.capture()
  lastExternalVaultRefreshAt = Date.now()
  const selectedEntryId = selectedEntry.value?.id || ''
  const previousRevision = vault.value.revision
  try {
    const result = await api.getVault()
    if (!vaultSession.isCurrent(generation)) return
    if (!result.ok || !result.data) {
      if (result.code === 'LOCKED') {
        applyLockedUiState()
      }
      return
    }

    if (!publishVaultPayload(result.data)) return
    if (vault.value.revision !== previousRevision) scheduleAutoCloudUpload()
    if (selectedEntryId) {
      selectedEntry.value = findEntry(vault.value.entries, selectedEntryId)
      if (!selectedEntry.value) {
        detailOpen.value = false
        stopTotpTimer()
      } else {
        syncSelectedTotpTimer()
      }
    }
  } finally {
    externalVaultRefreshing = false
  }
}

async function lockVault() {
  applyLockedUiState()
  try {
    const result = await api.lock()
    if (result.ok) return
    stateError.value = result.message || '后端锁定失败'
    showFailToast('本地敏感内容已清除，但后端锁定失败；请安全退出应用')
  } catch {
    stateError.value = '后端锁定失败'
    showFailToast('本地敏感内容已清除，但后端锁定失败；请安全退出应用')
  }
}

function publishVaultPayload(next: VaultPayload) {
  if (state.locked) return false
  vault.value = next
  pruneLocalEntryPreferences(next.entries)
  pruneBatchEntrySelection(next.entries)
  syncSettings(next.settings)
  void collectLocalAttachmentObjects(next).catch(() => {})
  return true
}

function pruneBatchEntrySelection(entries: VaultEntry[]) {
  if (!batchSelectionMode.value) return
  const validIds = new Set(collectEntryIds(activeTree(entries)))
  batchSelectedEntryIds.value = new Set([...batchSelectedEntryIds.value].filter((id) => validIds.has(id)))
}

function pruneLocalEntryPreferences(entries: VaultEntry[]) {
  const activeEntries = flattenEntries(activeTree(entries))
  const validIds = new Set(activeEntries.map((entry) => entry.id))
  const validLoginIds = new Set(activeEntries.filter((entry) => entry.kind === 'login').map((entry) => entry.id))
  const next = pruneEntryPreferenceIds(validIds, favoriteEntryIds.value, recentEntryIds.value)
  favoriteEntryIds.value = next.favoriteIds
  recentEntryIds.value = next.recentIds
  const health = pruneHealthPreferences(
    validIds,
    validLoginIds,
    expectedTotpEntryIds.value,
    ignoredHealthFindings.value
  )
  expectedTotpEntryIds.value = health.expectedTotpIds
  ignoredHealthFindings.value = health.ignoredFindings
}

async function saveVaultForCurrentSession(next: VaultPayload): Promise<ApiResult<VaultPayload>> {
  const generation = vaultSession.capture()
  const result = await api.saveVault(next)
  if (!vaultSession.isCurrent(generation) || state.locked) {
    return { ok: false, code: 'LOCKED', message: '保险库会话已变化，已丢弃过期保存结果' }
  }
  return result
}

function activateVaultSession(next: VaultPayload, expectedGeneration: number) {
  if (!vaultSession.isCurrent(expectedGeneration)) return false
  vaultSession.invalidate()
  state.locked = false
  return publishVaultPayload(next)
}

function scheduleSessionLock() {
  vaultSession.schedule(unlocked.value)
}

function applyLockedUiState() {
  if (vault.value) pruneLocalEntryPreferences(vault.value.entries)
  cancelCloudOperation()
  resetBusyOperation()
  autoSyncPasswordGate.clearAll()
  vaultSession.invalidate()
  state.locked = true
  state.expiresAt = 0
  vault.value = null
  quickAccessOpen.value = false
  exitBatchSelection()
  selectedEntry.value = null
  stopTotpTimer()
  totpRequestId.value += 1
  totpCode.value = ''
  showPassword.value = false
  generatorOpen.value = false
  generatorApplyToPassword.value = false
  generatorResetKey.value += 1
  importOpen.value = false
  importResetKey.value += 1
  passkeyManagerOpen.value = false
  passkeyManagerInitialId.value = ''
  Object.assign(form, emptyEntry('login'))
  domainText.value = ''
  editingId.value = ''
  editingParentId.value = ''
  createParentId.value = ''
  contextEntryId.value = ''
  keyword.value = ''
  entryFilter.value = 'all'
  password.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  changePasswordValue.value = ''
  changePasswordConfirm.value = ''
  pluginExtensionId.value = ''
  androidAutofillLaunch.value = null
  cloudInfo.value = null
  cloudBackups.value = []
  selectedCloudObjectName.value = ''
  cloudSyncPreview.value = null
  backupStatus.value = ''
  portableBackupStatus.value = ''
  portableBackupBusy.value = false
  clearPortableBackupSelection()
  resolveCloudPasswordPrompt(null)
  syncSettings()
  editorOpen.value = false
  detailOpen.value = false
  createSheetOpen.value = false
  moveSheetOpen.value = false
  moveEntryId.value = ''
  entryContextMenuOpen.value = false
  passwordSheetOpen.value = false
  pluginDetailOpen.value = false
  passwordHealthOpen.value = false
  deviceUnlockSheetOpen.value = false
  resetDeviceUnlockDraft()
  cloudSyncReviewOpen.value = false
  dragMode.value = false
  createMenuOpen.value = false
  moreMenuOpen.value = false
  drawerOpen.value = false
  drawerDetailOpen.value = false
  searchOpen.value = false
  if (externalVaultRefreshTimer) window.clearTimeout(externalVaultRefreshTimer)
  if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
  if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
  vaultSession.cancel()
  externalVaultRefreshTimer = 0
  autoCloudUploadTimer = 0
  autoCloudDownloadTimer = 0
  blurActiveElement()
  clearSensitiveClipboard().catch(() => {})
}

function emptyEntry(kind: EntryKind): VaultEntry {
  return {
    id: makeId(),
    kind,
    title: '',
    status: 'active',
    statusReason: '',
    statusUpdatedAt: 0,
    deletedAt: 0,
    domains: [],
    autofillMatchMode: 'base-domain',
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    customFields: starterCustomFields(kind, makeId),
    attachments: [],
    history: [],
    children: []
  }
}

function makeId() {
  return secureRandomId()
}

function resetForm(entry: VaultEntry) {
  Object.assign(form, emptyEntry(entry.kind), JSON.parse(JSON.stringify(entry)))
  form.status = normalizeEntryStatus(form.status)
  form.autofillMatchMode = normalizeAutofillMatchMode(form.autofillMatchMode)
  form.loginAccountSource = normalizeLoginAccountSource(form.loginAccountSource)
  domainText.value = (entry.domains || []).join('\n')
  totpCode.value = ''
}

function updateEditorField(field: string, value: unknown) {
  const text = String(value ?? '')
  if (field === 'loginAccountSource') {
    form.loginAccountSource = normalizeLoginAccountSource(value)
    return
  }
  if (field === 'autofillMatchMode') {
    form.autofillMatchMode = normalizeAutofillMatchMode(value)
    return
  }
  if (field === 'title' || field === 'username' || field === 'email' || field === 'password' || field === 'phone' || field === 'totpSecret' || field === 'note') {
    form[field] = text
  }
}

function openCreate(kind: EntryKind, parentId = '') {
  createMenuOpen.value = false
  editingId.value = ''
  editingParentId.value = parentId
  resetForm(emptyEntry(kind))
  detailOpen.value = false
  editorOpen.value = true
}

function openCreateSheet(parentId = '') {
  createParentId.value = parentId
  createSheetOpen.value = true
}

function handleCreateAction(action: { kind?: EntryKind }) {
  if (!action.kind) {
    createParentId.value = ''
    return
  }
  const parentId = createParentId.value
  createParentId.value = ''
  openCreate(action.kind, parentId)
}

function handleTopCreateAction(action: { kind?: EntryKind }) {
  createMenuOpen.value = false
  if (!action.kind) return
  createParentId.value = ''
  openCreate(action.kind, '')
}

function openEntryContextMenu(payload: { entry: VaultEntry; x: number; y: number }) {
  if (dragMode.value) return
  contextEntryId.value = payload.entry.id
  const position = clampEntryContextMenuPosition(payload.x, payload.y)
  entryContextMenuX.value = position.x
  entryContextMenuY.value = position.y
  createMenuOpen.value = false
  moreMenuOpen.value = false
  entryContextMenuOpen.value = true
}

function handleEntryContextAction(action: { key?: string }) {
  const entry = findEntry(vault.value?.entries || [], contextEntryId.value)
  entryContextMenuOpen.value = false
  contextEntryId.value = ''
  if (!entry || !action.key) return
  if (action.key === 'create-login') return openCreate('login', entry.id)
  if (action.key === 'create-folder') return openCreate('folder', entry.id)
  if (action.key === 'duplicate') return duplicateEntry(entry.id)
  if (action.key === 'edit') return openEdit(entry)
  if (action.key === 'archive') return archiveEntry(entry.id)
  if (action.key === 'trash') return trashEntry(entry.id)
  if (action.key === 'restore') return restoreEntry(entry.id)
  if (action.key === 'purge') return purgeEntry(entry.id)
}

function closeEntryContextMenu() {
  if (entryContextMenuOpen.value) entryContextMenuOpen.value = false
}

function clampEntryContextMenuPosition(x: number, y: number) {
  const menuWidth = 156
  const menuHeight = 236
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin))
  }
}

function handleMoreAction(action: { key?: string }) {
  moreMenuOpen.value = false
  if (action.key === 'quick-access') {
    openQuickAccess()
    return
  }
  if (action.key === 'generator') {
    openCredentialGenerator(false)
    return
  }
  if (action.key === 'import') {
    importOpen.value = true
    return
  }
  if (action.key === 'select') {
    if (batchSelectionMode.value) exitBatchSelection()
    else enterBatchSelection()
    return
  }
  if (action.key === 'drag') {
    toggleDragMode()
    return
  }
  if (action.key === 'lock') lockVault()
  if (action.key === 'safe-exit') safeExit()
}

function toggleDragMode() {
  if (!dragMode.value && keyword.value.trim()) {
    showToast('搜索时不能拖拽')
    return
  }
  dragMode.value = !dragMode.value
  moreMenuOpen.value = false
  if (dragMode.value) {
    exitBatchSelection()
    searchOpen.value = false
    detailOpen.value = false
    showToast('拖拽模式：长按条目移动')
  }
}

async function safeExit() {
  moreMenuOpen.value = false
  try {
    const result = await api.safeExit()
    if (!result.ok) showFailToast(result.message || '安全退出失败')
  } catch {
    showFailToast('安全退出失败，请手动关闭应用')
  }
}

function enterBatchSelection() {
  batchSelectionMode.value = true
  batchSelectedEntryIds.value = new Set()
  batchMoveSheetOpen.value = false
  dragMode.value = false
  detailOpen.value = false
  entryContextMenuOpen.value = false
  createMenuOpen.value = false
  moreMenuOpen.value = false
  clearSelectedEntry()
}

function exitBatchSelection() {
  batchSelectionMode.value = false
  batchSelectedEntryIds.value = new Set()
  batchMoveSheetOpen.value = false
}

function toggleBatchEntrySelection(entryId: string) {
  if (!batchSelectionMode.value) return
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || !isActiveEntry(entry)) return
  const next = new Set(batchSelectedEntryIds.value)
  if (next.has(entryId)) next.delete(entryId)
  else next.add(entryId)
  batchSelectedEntryIds.value = next
}

function toggleAllVisibleBatchEntries() {
  if (!batchSelectionMode.value) return
  const next = new Set(batchSelectedEntryIds.value)
  if (allVisibleBatchEntriesSelected.value) {
    for (const entryId of visibleBatchEntryIds.value) next.delete(entryId)
  } else {
    for (const entryId of visibleBatchEntryIds.value) next.add(entryId)
  }
  batchSelectedEntryIds.value = next
}

function applyBatchFavorite() {
  const selectedIds = validActiveSelectedIds(batchSelectedEntryIds.value)
  if (selectedIds.length === 0) return showToast('请先选择条目')
  const favorite = !selectedIds.every((id) => favoriteEntryIds.value.has(id))
  favoriteEntryIds.value = setFavoriteEntryIds(selectedIds, favorite, favoriteEntryIds.value)
  showSuccessToast(favorite ? `已收藏 ${selectedIds.length} 项` : `已取消收藏 ${selectedIds.length} 项`)
}

function openBatchMoveSheet() {
  if (validActiveSelectedIds(batchSelectedEntryIds.value).length === 0) return showToast('请先选择条目')
  batchMoveSheetOpen.value = true
}

async function selectBatchMoveDestination(action: MoveDestinationAction) {
  if (!vault.value || !action) return
  const payload = cloneVault()
  const moved = moveSelectedEntries(payload.entries, batchSelectedEntryIds.value, action.targetParentId)
  if (moved.error === 'invalid-destination') return showFailToast('不能移动到所选分组或其子分组')
  if (moved.error || moved.movedIds.length === 0) return showFailToast('所选条目已变化，请重新选择')

  batchMoveSheetOpen.value = false
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '批量移动失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  exitBatchSelection()
  showSuccessToast(`已移动 ${moved.movedIds.length} 项`)
}

async function archiveSelectedEntries() {
  await archiveEntries([...batchSelectedEntryIds.value], true)
}

async function trashSelectedEntries() {
  await trashEntries([...batchSelectedEntryIds.value], true)
}

async function archiveEntries(entryIds: string[], exitSelection = false) {
  if (!vault.value || busy.value) return
  const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['active']))
  if (roots.length === 0) return showToast('没有可归档的条目')
  try {
    await showConfirmDialog({
      title: '批量归档',
      message: `归档所选 ${roots.length} 项？分组内的内容会一并归档，可在系统分组中恢复。`,
      confirmButtonText: '归档',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const payload = cloneVault()
  for (const entryId of roots) {
    updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'disabled', '已批量归档'))
  }
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '批量归档失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (exitSelection) exitBatchSelection()
  drawerSection.value = 'system'
  systemGroupKey.value = 'archived'
  showSuccessToast(`已归档 ${roots.length} 项`)
}

async function trashEntries(entryIds: string[], exitSelection = false) {
  if (!vault.value || busy.value) return
  const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['active', 'disabled']))
  if (roots.length === 0) return showToast('没有可移入回收站的条目')
  try {
    await showConfirmDialog({
      title: '批量移入回收站',
      message: `将所选 ${roots.length} 项移入回收站？分组内的内容会一并处理。`,
      confirmButtonText: '移入回收站',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const payload = cloneVault()
  for (const entryId of roots) {
    updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已批量移入回收站'))
  }
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '批量删除失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (exitSelection) exitBatchSelection()
  drawerSection.value = 'system'
  systemGroupKey.value = 'trashed'
  showSuccessToast(`已移入回收站 ${roots.length} 项`)
}

async function restoreEntries(entryIds: string[]) {
  if (!vault.value || busy.value) return
  const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['disabled', 'trashed']))
  if (roots.length === 0) return showToast('没有可恢复的条目')
  const payload = cloneVault()
  for (const entryId of roots) {
    const target = findEntry(payload.entries, entryId)
    if (!target) continue
    const updater = target.kind === 'folder'
      ? (entry: VaultEntry) => markEntryStatus(entry, 'active', '批量恢复为正常条目')
      : (entry: VaultEntry) => markEntrySelfStatus(entry, 'active', '批量恢复为正常条目')
    updateEntryAndAncestorsById(
      payload.entries,
      entryId,
      updater,
      (entry) => markEntrySelfStatus(entry, 'active', '恢复上级分组')
    )
  }
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '批量恢复失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  showSuccessToast(`已恢复 ${roots.length} 项`)
}

async function purgeEntries(entryIds: string[]) {
  if (!vault.value || busy.value) return
  const roots = selectedRootsWithStatus(entryIds, new Set<EntryStatus>(['trashed']))
  if (roots.length === 0) return showToast('没有可永久删除的条目')
  try {
    await showConfirmDialog({
      title: '批量彻底删除',
      message: `将永久删除所选 ${roots.length} 项及其分组内容，删除后无法恢复。`,
      confirmButtonText: '继续',
      confirmButtonColor: '#ee0a24'
    })
    await showConfirmDialog({
      title: '再次确认',
      message: '这会从加密保险库中永久移除所选内容。',
      confirmButtonText: '永久删除',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const payload = cloneVault()
  const removedCount = removeSelectedEntries(payload.entries, roots)
  if (removedCount === 0) return showToast('所选条目已变化')
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '批量彻底删除失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  showSuccessToast(`已永久删除 ${removedCount} 个条目`)
}

function validActiveSelectedIds(entryIds: Iterable<string>) {
  const selectedIds = new Set(entryIds)
  return collectEntryIds(activeTree(vault.value?.entries || [])).filter((id) => selectedIds.has(id))
}

function selectedRootsWithStatus(entryIds: Iterable<string>, statuses: ReadonlySet<EntryStatus>) {
  if (!vault.value) return []
  return normalizeSelectedRootIds(vault.value.entries, entryIds).filter((entryId) => {
    const entry = findEntry(vault.value?.entries || [], entryId)
    return Boolean(entry && statuses.has(normalizeEntryStatus(entry.status)))
  })
}

function openCredentialGenerator(applyToPassword: boolean) {
  generatorApplyToPassword.value = applyToPassword
  generatorOpen.value = true
}

function copyGeneratedCredential(value: string) {
  copyText(value)
}

function applyGeneratedCredential(value: string) {
  if (!generatorApplyToPassword.value) return copyGeneratedCredential(value)
  form.password = value
  generatorOpen.value = false
  showSuccessToast('已用于当前条目')
}

function openView(entry: VaultEntry) {
  if (entry.kind === 'folder') return
  if (androidAutofillLaunch.value?.active) {
    if (entry.kind !== 'login') return
    completeAndroidAutofill(entry)
    return
  }
  showEntryDetail(entry)
}

function showEntryDetail(entry: VaultEntry) {
  recentEntryIds.value = rememberRecentEntryId(entry.id, recentEntryIds.value)
  selectedEntry.value = entry
  showPassword.value = false
  totpCode.value = ''
  detailOpen.value = !isWide.value
  syncSelectedTotpTimer()
}

function toggleEntryFavorite(entryId: string) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || !isActiveEntry(entry)) return
  favoriteEntryIds.value = toggleFavoriteEntryId(entryId, favoriteEntryIds.value)
}

function openEdit(entry: VaultEntry) {
  editingId.value = entry.id
  editingParentId.value = ''
  resetForm(entry)
  editorOpen.value = true
  detailOpen.value = false
  if (entry.kind === 'login' && entry.totpSecret) scheduleTotpRefresh(entry.id)
}

async function handleVaultWriteError(result: ApiResult<unknown>, fallback: string) {
  if (result.code === 'CONFLICT') {
    const selectedId = selectedEntry.value?.id || ''
    const latest = await api.getVault()
    if (latest.ok && latest.data && publishVaultPayload(latest.data)) {
      selectedEntry.value = selectedId ? findEntry(latest.data.entries, selectedId) : null
    }
    showFailToast('保险库已被其他窗口或插件更新，已重新载入；当前操作未保存，请重试')
    return
  }
  showFailToast(result.message || fallback)
}

async function saveEntry() {
  if (!vault.value || busy.value) return
  const operationId = beginBusyOperation()
  try {
    const payload = cloneVault()
    const entry = normalizeForm()
    if (editingId.value) {
      const previous = findEntry(payload.entries, editingId.value)
      appendEntryHistory(entry, 'updated', '手动编辑', previous || entry)
      replaceEntry(payload.entries, editingId.value, entry)
    } else {
      appendEntryHistory(entry, 'created', '手动创建')
      insertEntry(payload.entries, editingParentId.value, entry)
    }
    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '保存失败')
    if (!publishVaultPayload(result.data)) return
    selectedEntry.value = findEntry(vault.value.entries, entry.id)
    ignoredHealthFindings.value = clearIgnoredHealthFindingsForEntry(
      entry.id,
      ignoredHealthFindings.value
    )
    editorOpen.value = false
    scheduleAutoCloudUpload()
    showSuccessToast('已保存')
  } catch {
    showFailToast('保存失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function addEntryAttachment(entryId: string, file: File) {
  if (!vault.value || attachmentBusy.value) return
  const currentEntry = findEntry(vault.value.entries, entryId)
  if (!currentEntry || currentEntry.kind === 'folder' || currentEntry.status === 'trashed') return
  if ((currentEntry.attachments?.length || 0) >= 100) return showFailToast('每个条目最多保存 100 个附件')
  if (file.size > MAX_ATTACHMENT_BYTES) return showFailToast('单个附件不能超过 10 MB')

  attachmentBusy.value = true
  let bytes: Uint8Array | null = null
  let created: VaultAttachment | null = null
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
    const createResult = await api.createAttachmentObject(file.name, file.type || 'application/octet-stream', bytes)
    if (!createResult.ok || !createResult.data) {
      return showFailToast(createResult.message || '附件加密保存失败')
    }
    created = createResult.data.reference

    const payload = JSON.parse(JSON.stringify(createResult.data.vault)) as VaultPayload
    const entry = findEntry(payload.entries, entryId)
    if (!entry || entry.status === 'trashed') throw new Error('条目已发生变化')
    const before = JSON.parse(JSON.stringify(entry)) as VaultEntry
    entry.attachments = [...(entry.attachments || []), created]
    appendEntryHistory(entry, 'updated', '添加附件', before)
    const saveResult = await saveVaultForCurrentSession(payload)
    if (!saveResult.ok || !saveResult.data) {
      await api.retainAttachmentObject(created.id)
      return handleVaultWriteError(saveResult, '附件引用保存失败')
    }
    if (!publishVaultPayload(saveResult.data)) return
    selectedEntry.value = findEntry(vault.value.entries, entryId)
    scheduleAutoCloudUpload()
    showSuccessToast('附件已添加')
  } catch (error) {
    if (created) await api.retainAttachmentObject(created.id)
    showFailToast(error instanceof Error ? error.message : '附件添加失败')
  } finally {
    bytes?.fill(0)
    attachmentBusy.value = false
  }
}

async function saveEntryAttachment(entryId: string, attachmentId: string) {
  if (!vault.value || attachmentBusy.value) return
  const entry = findEntry(vault.value.entries, entryId)
  const attachment = entry?.attachments?.find((item) => item.id === attachmentId)
  if (!attachment) return showFailToast('附件引用不存在')

  attachmentBusy.value = true
  try {
    const result = await api.saveAttachmentToFile(attachment)
    if (!result.ok || !result.data) return showFailToast(result.message || '附件保存失败')
    if (result.data.saved) showSuccessToast('附件已保存')
  } finally {
    attachmentBusy.value = false
  }
}

async function removeEntryAttachment(entryId: string, attachmentId: string) {
  if (!vault.value || attachmentBusy.value) return
  const currentEntry = findEntry(vault.value.entries, entryId)
  const attachment = currentEntry?.attachments?.find((item) => item.id === attachmentId)
  if (!currentEntry || !attachment || currentEntry.status === 'trashed') return
  try {
    await showConfirmDialog({
      title: '删除附件',
      message: `从“${currentEntry.title}”移除 ${attachment.name}？`,
      confirmButtonText: '删除',
      confirmButtonColor: '#dc2626'
    })
  } catch {
    return
  }

  attachmentBusy.value = true
  try {
    const payload = cloneVault()
    const entry = findEntry(payload.entries, entryId)
    if (!entry) throw new Error('条目已发生变化')
    const before = JSON.parse(JSON.stringify(entry)) as VaultEntry
    entry.attachments = (entry.attachments || []).filter((item) => item.id !== attachmentId)
    appendEntryHistory(entry, 'updated', '删除附件', before)
    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '删除附件失败')
    if (!publishVaultPayload(result.data)) return
    selectedEntry.value = findEntry(vault.value.entries, entryId)
    if (!vaultReferencesAttachment(result.data.entries, attachmentId)) {
      const retained = await api.retainAttachmentObject(attachmentId)
      if (!retained.ok) showToast('附件引用已删除，本地密文将在后续清理')
    }
    scheduleAutoCloudUpload()
    showSuccessToast('附件已删除')
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '删除附件失败')
  } finally {
    attachmentBusy.value = false
  }
}

async function importVaultRecords(records: ImportedVaultRecord[]) {
  if (!vault.value || busy.value || records.length === 0) return
  const operationId = beginBusyOperation()
  try {
    const payload = cloneVault()
    const importedEntries = records.map((record) => {
      const entry: VaultEntry = {
        ...emptyEntry(record.kind),
        title: record.title,
        domains: record.kind === 'login' ? record.domains : [],
        username: record.username,
        email: record.email,
        password: record.password,
        phone: record.phone,
        note: record.note,
        totpSecret: record.kind === 'login' ? record.totpSecret : '',
        customFields: [
          ...record.customFields.map((field) => ({ ...field, id: makeId() })),
          ...(record.folderPath ? [{ id: makeId(), label: '原分组', value: record.folderPath, type: 'text' as const, protected: false }] : [])
        ]
      }
      appendEntryHistory(entry, 'created', '外部导入')
      return entry
    })
    const stamp = new Date().toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const folder: VaultEntry = {
      ...emptyEntry('folder'),
      title: `导入 ${stamp}`,
      children: importedEntries
    }
    appendEntryHistory(folder, 'created', '外部导入')
    payload.entries.unshift(folder)

    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '导入失败')
    if (!publishVaultPayload(result.data)) return
    importOpen.value = false
    importResetKey.value += 1
    scheduleAutoCloudUpload()
    showSuccessToast(`已导入 ${importedEntries.length} 项`)
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '导入失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function duplicateEntry(entryId: string) {
  if (!vault.value || busy.value) return
  const source = findEntry(vault.value.entries, entryId)
  if (!source || source.status === 'trashed') return showFailToast('该条目无法创建副本')

  const operationId = beginBusyOperation()
  try {
    const payload = cloneVault()
    const duplicate = insertDuplicateEntry(payload.entries, entryId, makeId)
    if (!duplicate) return showFailToast('原条目已变化，请重试')

    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '创建副本失败')
    if (!publishVaultPayload(result.data)) return

    const savedDuplicate = findEntry(vault.value.entries, duplicate.id)
    if (savedDuplicate && savedDuplicate.kind !== 'folder') showEntryDetail(savedDuplicate)
    scheduleAutoCloudUpload()
    showSuccessToast(`已创建「${duplicate.title}」`)
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '创建副本失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function deleteEntry(entryId: string) {
  await trashEntry(entryId)
}

async function restoreEntryHistory(entryId: string, historyId: string) {
  if (!vault.value) return
  const source = findEntry(vault.value.entries, entryId)
  const history = source?.history?.find((item) => item.id === historyId)
  if (!source || !history?.snapshot) return showFailToast('该历史记录不包含可恢复快照')
  try {
    await showConfirmDialog({
      title: '恢复历史版本',
      message: `恢复「${source.title || '未命名条目'}」到 ${formatUnixTime(history.at)} 的内容？当前内容会保留为新的历史快照。`,
      confirmButtonText: '恢复',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  const payload = cloneVault()
  const target = findEntry(payload.entries, entryId)
  const targetHistory = target?.history?.find((item) => item.id === historyId)
  if (!target || !targetHistory?.snapshot) return showFailToast('历史记录已变化，请重试')
  const current = createEntrySnapshot(target)
  restoreEntrySnapshot(target, targetHistory.snapshot)
  appendEntryHistory(target, 'updated', '恢复历史版本', current)
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '恢复历史版本失败')
  if (!publishVaultPayload(result.data)) return
  selectedEntry.value = findEntry(vault.value.entries, entryId)
  scheduleAutoCloudUpload()
  showSuccessToast('历史版本已恢复')
}

async function clearEntryHistory(entryId: string) {
  if (!vault.value) return
  if (busy.value) return showToast('请等待当前操作完成')
  const source = findEntry(vault.value.entries, entryId)
  if (!source?.history?.length) return showToast('没有可清理的历史记录')
  try {
    await showConfirmDialog({
      title: '清空历史记录',
      message: `清空「${source.title || '未命名条目'}」的全部历史快照？当前条目内容不会改变，但清理后无法恢复到旧版本。`,
      confirmButtonText: '清空历史',
      confirmButtonColor: '#ee0a24',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  const operationId = beginBusyOperation()
  try {
    const payload = cloneVault()
    const target = findEntry(payload.entries, entryId)
    if (!target || clearEntryHistoryRecords(target) === 0) return showToast('历史记录已变化')
    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '清理历史记录失败')
    if (!publishVaultPayload(result.data)) return
    selectedEntry.value = findEntry(vault.value.entries, entryId)
    scheduleAutoCloudUpload()
    showSuccessToast('历史记录已清空')
  } catch {
    showFailToast('清理历史记录失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function disableEntry(entryId: string) {
  await archiveEntry(entryId)
}

async function archiveEntry(entryId: string) {
  if (!vault.value) return
  const target = findEntry(vault.value.entries, entryId)
  if (!target) return showToast('条目不存在')
  const title = target.title || '未命名'
  const childCount = target.kind === 'folder' ? flattenEntries(target.children || []).filter((entry) => entry.status !== 'disabled').length : 0
  const itemLabel = entryKindLabel(target.kind)
  const message = target.kind === 'folder'
    ? childCount > 0
      ? `分组「${title}」和其中 ${childCount} 项内容会从正常列表中隐藏，之后可以在归档里恢复。`
      : `分组「${title}」会从正常列表中隐藏，之后可以在归档里恢复。`
    : `「${title}」会从正常列表${target.kind === 'login' ? '和自动填充' : ''}中隐藏，之后可以在归档里恢复。`
  try {
    await showConfirmDialog({
      title: `归档${itemLabel}`,
      message,
      confirmButtonText: `归档${itemLabel}`,
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }
  const payload = cloneVault()
  const reason = `${itemLabel}已归档，暂不在正常列表使用`
  if (!updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'disabled', reason))) return
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '归档失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (selectedEntry.value && (selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id))) {
    clearSelectedEntry()
  }
  drawerSection.value = 'system'
  systemGroupKey.value = 'archived'
  showSuccessToast(`${itemLabel}已归档`)
}

async function trashEntry(entryId: string) {
  if (!vault.value) return
  const target = findEntry(vault.value.entries, entryId)
  if (!target) return showToast('条目不存在')
  const title = target.title || '未命名'
  const childCount = target.kind === 'folder' ? flattenEntries(target.children || []).filter((entry) => entry.status !== 'trashed').length : 0
  const message = target.kind === 'folder'
    ? childCount > 0
      ? `分组「${title}」下的 ${childCount} 项内容也会一起移入回收站，之后可以恢复。`
      : `将空分组「${title}」移入回收站？`
    : `将${entryKindLabel(target.kind)}「${title}」移入回收站？之后可以恢复。`
  try {
    await showConfirmDialog({
      title: '移入回收站',
      message,
      confirmButtonText: '移入回收站',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const shouldClearSelection = selectedEntry.value
    ? selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id)
    : false
  const payload = cloneVault()
  if (!updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已移入回收站'))) return
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '删除失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (shouldClearSelection) {
    selectedEntry.value = null
    detailOpen.value = false
    stopTotpTimer()
  }
  drawerSection.value = 'system'
  systemGroupKey.value = 'trashed'
  showSuccessToast('已移入回收站')
}

async function restoreEntry(entryId: string) {
  if (!vault.value) return
  const target = findEntry(vault.value.entries, entryId)
  if (!target) return showToast('条目不存在')
  const payload = cloneVault()
  const updater = target.kind === 'folder'
    ? (entry: VaultEntry) => markEntryStatus(entry, 'active', '恢复为正常条目')
    : (entry: VaultEntry) => markEntrySelfStatus(entry, 'active', '恢复为正常条目')
  if (!updateEntryAndAncestorsById(payload.entries, entryId, updater, (entry) => markEntrySelfStatus(entry, 'active', '恢复上级分组'))) {
    return showToast('条目不存在')
  }
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '恢复失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  selectedEntry.value = findEntry(vault.value.entries, entryId)
  if (selectedEntry.value && selectedEntry.value.kind !== 'folder') showEntryDetail(selectedEntry.value)
  showSuccessToast('已恢复')
}

async function purgeEntry(entryId: string) {
  if (!vault.value) return
  const target = findEntry(vault.value.entries, entryId)
  if (!target) return showToast('条目不存在')
  const title = target.title || '未命名'
  try {
    await showConfirmDialog({
      title: '彻底删除',
      message: `彻底删除「${title}」后无法从保险库恢复，确定继续吗？`,
      confirmButtonText: '彻底删除',
      confirmButtonColor: '#ee0a24'
    })
    await showConfirmDialog({
      title: '再次确认',
      message: '这会从加密保险库中永久移除该条目。',
      confirmButtonText: '永久删除',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const shouldClearSelection = selectedEntry.value
    ? selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id)
    : false
  const payload = cloneVault()
  removeEntry(payload.entries, entryId)
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '彻底删除失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (shouldClearSelection) clearSelectedEntry()
  showSuccessToast('已彻底删除')
}

async function purgeAllTrashedEntries() {
  if (!vault.value || busy.value) return
  const payload = cloneVault()
  const removedCount = removeTrashedEntries(payload.entries)
  if (removedCount === 0) return showToast('回收站为空')

  try {
    await showConfirmDialog({
      title: '全部删除',
      message: `将永久删除回收站中的 ${removedCount} 个条目，删除后无法恢复。`,
      confirmButtonText: '全部删除',
      confirmButtonColor: '#ee0a24'
    })
    await showConfirmDialog({
      title: '再次确认',
      message: '这会永久清空回收站。此操作无法撤销。',
      confirmButtonText: '永久删除全部',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const selectedId = selectedEntry.value?.id || ''
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '清空回收站失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (selectedId && !findEntry(vault.value.entries, selectedId)) clearSelectedEntry()
  showSuccessToast(`已永久删除 ${removedCount} 个条目`)
}

async function moveEntry(payload: MoveEntryPayload) {
  if (!vault.value || payload.entryId === payload.targetParentId) return
  const currentEntry = findEntry(vault.value.entries, payload.entryId)
  if (!currentEntry) return
  if (currentEntry.kind === 'folder' && isDescendant(currentEntry, payload.targetParentId)) {
    showToast('不能移动到自己的子分组')
    return
  }

  const nextVault = cloneVault()
  const moved = takeEntry(nextVault.entries, payload.entryId)
  if (!moved) return
  removeEntryCopies(nextVault.entries, payload.entryId)

  const targetIndex =
    moved.parentId === payload.targetParentId && moved.index < payload.targetIndex
      ? payload.targetIndex - 1
      : payload.targetIndex
  insertEntryAt(nextVault.entries, payload.targetParentId, moved.entry, targetIndex)

  const result = await saveVaultForCurrentSession(nextVault)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '移动失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  if (selectedEntry.value) selectedEntry.value = findEntry(vault.value.entries, selectedEntry.value.id)
}

function openMoveSheet(entryId: string) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || !isActiveEntry(entry)) return
  moveEntryId.value = entryId
  moveSheetOpen.value = true
}

function selectMoveDestination(action: MoveDestinationAction) {
  const entryId = moveEntryId.value
  if (!entryId || !action) return
  moveSheetOpen.value = false
  moveEntryId.value = ''
  void moveEntry({
    entryId,
    targetParentId: action.targetParentId,
    targetIndex: Number.MAX_SAFE_INTEGER
  })
}

function appendMoveDestinationActions(
  entries: VaultEntry[],
  parentPath: string[],
  source: VaultEntry,
  actions: MoveDestinationAction[]
) {
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue
    if (entry.id === source.id || (source.kind === 'folder' && isDescendant(source, entry.id))) continue
    const title = entry.title.trim() || '未命名分组'
    const path = [...parentPath, title]
    actions.push({
      name: title,
      subname: path.join(' / '),
      icon: 'cluster-o',
      targetParentId: entry.id
    })
    appendMoveDestinationActions(entry.children || [], path, source, actions)
  }
}

function appendBatchMoveDestinationActions(
  entries: VaultEntry[],
  parentPath: string[],
  actions: MoveDestinationAction[]
) {
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue
    if (isEntryInsideAny(vault.value?.entries || [], batchSelectedEntryIds.value, entry.id)) continue
    const title = entry.title.trim() || '未命名分组'
    const path = [...parentPath, title]
    actions.push({
      name: title,
      subname: path.join(' / '),
      icon: 'cluster-o',
      targetParentId: entry.id
    })
    appendBatchMoveDestinationActions(entry.children || [], path, actions)
  }
}

function resolveUpdateManifestUrl(value: string | null) {
  const url = (value || '').trim()
  if (!url || url.includes('OWNER/REPO') || BUILT_IN_MANIFEST_URL_PATTERN.test(url)) {
    return DEFAULT_UPDATE_MANIFEST_URL
  }
  return url
}

function currentUpdateManifestUrl() {
  const url = resolveUpdateManifestUrl(updateManifestUrl.value)
  updateManifestUrl.value = url
  localStorage.setItem(UPDATE_MANIFEST_URL_KEY, url)
  return url
}

async function checkAppUpdate() {
  if (updateBusy.value) return
  const manifestUrl = currentUpdateManifestUrl()
  if (!manifestUrl) return

  updateBusy.value = 'check'
  updateProgress.value = { action: 'check', phase: 'check', progress: 8, message: '正在获取版本信息' }
  updateStatus.value = '正在获取版本信息'
  downloadedUpdatePath.value = ''
  try {
    const result = await api.checkAppUpdate(manifestUrl, handleUpdateProgress)
    if (!result.ok || !result.data) {
      showFailToast(result.message || '检查更新失败')
      return
    }
    updateInfo.value = result.data
    syncAppVersion(result.data.currentVersion)
    updateStatus.value = result.data.updateAvailable
      ? `发现新版本 ${result.data.latestVersion}`
      : '当前已是最新版本'
    showToast(updateStatus.value)
  } catch {
    updateStatus.value = '检查更新失败'
    showFailToast(updateStatus.value)
  } finally {
    updateBusy.value = ''
    updateProgress.value = null
  }
}

async function downloadAppUpdate() {
  if (updateBusy.value) return
  const manifestUrl = currentUpdateManifestUrl()
  if (!manifestUrl) return

  updateBusy.value = 'download'
  updateProgress.value = { action: 'download', phase: 'download', progress: 3, message: '正在准备下载' }
  updateStatus.value = '正在准备下载'
  try {
    const result = await api.downloadAppUpdate(manifestUrl, handleUpdateProgress)
    if (!result.ok || !result.data) {
      showFailToast(result.message || '下载更新失败')
      return
    }
    updateInfo.value = result.data.update
    syncAppVersion(result.data.update.currentVersion)
    downloadedUpdatePath.value = result.data.packagePath
    updateStatus.value = `更新包已下载并校验通过，大小 ${formatBytes(result.data.size)}`
    showSuccessToast('更新包已下载')
  } catch {
    updateStatus.value = '下载更新失败'
    showFailToast(updateStatus.value)
  } finally {
    updateBusy.value = ''
    updateProgress.value = null
  }
}

function handleUpdateProgress(progress: AppUpdateProgress) {
  updateProgress.value = progress
  const label = formatUpdateProgress(progress)
  if (label) updateStatus.value = label
}

function formatUpdateProgress(progress: AppUpdateProgress) {
  if (progress.phase === 'download') {
    const downloaded = progress.downloaded ? formatBytes(progress.downloaded) : ''
    const total = progress.total ? formatBytes(progress.total) : ''
    const percent = progress.progress ? `${Math.round(progress.progress)}%` : ''
    if (downloaded && total) return `正在下载 ${downloaded} / ${total}${percent ? ` (${percent})` : ''}`
    if (downloaded) return `正在下载 ${downloaded}`
    return progress.message || '正在下载更新包'
  }
  if (progress.phase === 'verify') return progress.message || '正在校验更新包'
  return progress.message || '正在检查更新'
}

function resetAndroidInstallBusy() {
  if (updateBusy.value === 'apply' && updatePlatform.value === 'android') {
    updateBusy.value = ''
    updateStatus.value = downloadedUpdatePath.value ? '安装未完成，可再次打开安装器' : updateStatus.value
  }
}

async function applyAppUpdate() {
  if (updateBusy.value || !downloadedUpdatePath.value) return
  const isAndroidUpdate = updatePlatform.value === 'android'
  try {
    await showConfirmDialog({
      title: isAndroidUpdate ? '安装 Android 更新' : '安装更新',
      message: isAndroidUpdate
        ? '将打开系统安装器。Android 会要求你确认安装，安装完成后重新打开应用即可。继续吗？'
        : '将临时关闭浏览器插件 Host，关闭当前桌面端，覆盖当前安装目录里的程序文件，然后自动重启。更新脚本只会清理更新缓存目录，不会删除保险库数据。继续吗？',
      confirmButtonText: isAndroidUpdate ? '打开安装器' : '安装并重启',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  updateBusy.value = 'apply'
  let keepBusyUntilExit = false
  try {
    const result = await api.applyAppUpdate(downloadedUpdatePath.value)
    if (!result.ok) {
      showFailToast(result.message || '安装更新失败')
      return
    }
    if (result.data?.permissionRequired) {
      updateStatus.value = '请在系统页面允许安装未知应用，返回后再次点击打开安装器'
      showToast('请先允许安装未知应用')
      return
    }
    keepBusyUntilExit = !isAndroidUpdate && result.data?.willRestart !== false
    updateStatus.value = isAndroidUpdate ? '已打开系统安装器' : '正在关闭并安装更新'
    showSuccessToast(isAndroidUpdate ? '请在系统安装器中确认' : '正在安装更新')
  } catch {
    updateStatus.value = '安装更新失败'
    showFailToast(updateStatus.value)
  } finally {
    if (!keepBusyUntilExit) updateBusy.value = ''
  }
}

async function saveSettings() {
  await persistSettings({ closeDrawer: true, toast: true })
}

async function changeMasterPassword() {
  if (busy.value) return
  if (changePasswordValue.value !== changePasswordConfirm.value) {
    showFailToast('两次密码不一致')
    return
  }
  if (cloudBusy.value) return showToast('请等待当前云端操作完成')

  try {
    await showConfirmDialog({
      title: changePasswordValue.value ? '修改主密码' : '清空主密码',
      message: changePasswordValue.value
        ? '将使用新主密码重新加密当前保险库，确认继续吗？'
        : '清空后打开保险库时可留空进入，确认继续吗？',
      confirmButtonText: '确认修改',
      confirmButtonColor: changePasswordValue.value ? undefined : '#ee0a24'
    })
  } catch {
    return
  }

  if (cloudBusy.value) return showToast('请等待当前云端操作完成')
  const generation = vaultSession.capture()
  const newPassword = changePasswordValue.value
  const cloudOperation = hasCompleteOssSettings()
    ? beginCloudOperation('password-rewrite', { message: '正在准备云端重新加密' })
    : null
  const operationId = beginBusyOperation()
  let localPasswordChanged = false
  try {
    const cloudRewrite: {
      objectName: string
      remoteHeadIds: string[]
      legacyObjectNames: string[]
    } | null = await prepareCloudRewriteForPasswordChange()
    if (!vaultSession.isCurrent(generation) || state.locked) return

    const result = await api.changePassword(newPassword)
    if (!vaultSession.isCurrent(generation) || state.locked) return
    if (!result.ok || !result.data) return showFailToast(result.message || '修改失败')
    localPasswordChanged = true
    Object.assign(state, result.data)
    await refreshDeviceUnlockState()
    const refreshedVault = await api.getVault()
    if (!vaultSession.isCurrent(generation) || state.locked) return
    if (!refreshedVault.ok || !refreshedVault.data || !publishVaultPayload(refreshedVault.data)) {
      applyLockedUiState()
      await api.lock()
      showFailToast('主密码已修改，但无法重新载入保险库；请使用新密码解锁')
      return
    }

    let cloudRewriteError = ''
    if (cloudRewrite && vault.value) {
      const exported = await api.exportVaultBackup()
      if (!vaultSession.isCurrent(generation) || state.locked) return
      if (!exported.ok || !exported.data) {
        cloudRewriteError = exported.message || '无法生成使用新主密码加密的云端文件'
      } else {
        const client = createRemoteVaultStore()
        const response = await writeManagedCloudVault(
          client,
          cloudRewrite.objectName,
          exported.data.content,
          cloudRewrite.remoteHeadIds,
          cloudRewrite.legacyObjectNames
        )
        if (!vaultSession.isCurrent(generation) || state.locked) return
        if (response.status !== 'success') {
          cloudRewriteError = response.message || '云端保险库重新加密失败'
        } else {
          clearAutoSyncPasswordGate(cloudRewrite.objectName)
          await rememberCloudSyncState(
            cloudRewrite.objectName,
            vault.value,
            vault.value,
            exported.data.content,
            response.commitId ? [response.commitId] : []
          )
          if (!vaultSession.isCurrent(generation) || state.locked) return
        }
      }
    }

    changePasswordValue.value = ''
    changePasswordConfirm.value = ''
    passwordSheetOpen.value = false
    if (cloudRewriteError) {
      backupStatus.value = `本地主密码已修改，但${cloudRewriteError}`
      showFailToast(backupStatus.value)
    } else {
      showSuccessToast(cloudRewrite ? '主密码及云端保险库已重新加密' : '主密码已修改')
    }
  } catch (error) {
    if (!vaultSession.isCurrent(generation) || state.locked) return
    const message = error instanceof Error ? error.message : String(error)
    showFailToast(localPasswordChanged ? `本地主密码已修改，但${message}` : message)
  } finally {
    finishBusyOperation(operationId)
    if (cloudOperation) finishCloudOperation(cloudOperation)
  }
}

async function prepareCloudRewriteForPasswordChange() {
  if (!vault.value || !hasCompleteOssSettings()) return null
  const client = createRemoteVaultStore()
  const configuredObjectName = normalizeObjectName(settings.oss.objectName)
  const preferred = await readCloudVaultForSync(
    client,
    configuredObjectName,
    configuredObjectName
  )
  const { objectName, response } = preferred
  if (response.status === RemoteVaultStatus.NotFound) return null
  if (response.status !== RemoteVaultStatus.Success || typeof response.content !== 'string') {
    throw new Error(String(response.content || '无法检查云端保险库'))
  }

  const remote = await api.previewVaultBackup(response.content)
  if (!remote.ok || !remote.data) {
    throw new Error('云端保险库无法用当前主密码解密，请先完成云同步再修改主密码')
  }
  if (await cloudSyncPayloadFingerprint(remote.data) !== await cloudSyncPayloadFingerprint(vault.value)) {
    throw new Error('云端与本地保险库存在差异，请先完成同步再修改主密码')
  }
  return {
    objectName,
    remoteHeadIds: preferred.remoteHeadIds,
    legacyObjectNames: preferred.legacyObjectNames
  }
}

async function loadPluginListenerState() {
  const result = await api.getPluginListenerState()
  if (!result.ok || !result.data) return
  pluginListener.value = result.data
  if (!result.data.supported) pluginDetailOpen.value = false
  if (!pluginExtensionId.value) pluginExtensionId.value = result.data.extensionId || ''
}

async function loadAndroidAutofillState() {
  const result = await api.getAndroidAutofillState()
  if (result.ok && result.data) androidAutofill.value = result.data
}

async function loadAndroidAutofillLaunchContext() {
  const result = await androidBridgeCall<AndroidAutofillLaunchContext>('getAutofillLaunchContext')
  if (!result.ok || !result.data?.active) return
  androidAutofillLaunch.value = result.data
  applyAndroidAutofillSearch()
}

function applyAndroidAutofillSearch() {
  const context = androidAutofillLaunch.value
  if (!context?.active) return
  const term = String(context.searchTerm || context.target || '').trim()
  if (!term) return
  keyword.value = term
  searchOpen.value = true
  dragMode.value = false
  detailOpen.value = false
  drawerOpen.value = false
}

async function completeAndroidAutofill(entry: VaultEntry) {
  const result = await androidBridgeCall<{ filled: boolean }>('completeAutofillWithEntry', entry.id)
  if (!result.ok) {
    androidAutofillLaunch.value = null
    showFailToast(result.message || '自动填充失败')
    showEntryDetail(entry)
    return
  }
  showSuccessToast('已发送到自动填充')
}

async function androidBridgeCall<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const nativeApi = window.androidPasswordApi
  if (!nativeApi?.[method]) return { ok: false, code: 'ANDROID_API_NOT_READY', message: 'Android 本地 API 未就绪。' }
  try {
    return JSON.parse(String(nativeApi[method](...args))) as ApiResult<T>
  } catch (error) {
    return {
      ok: false,
      code: 'ANDROID_API_ERROR',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function openAndroidAutofillSettings() {
  if (androidAutofillBusy.value) return
  androidAutofillBusy.value = true
  try {
    const result = await api.openAndroidAutofillSettings()
    if (!result.ok || !result.data) {
      showFailToast(result.message || '无法打开自动填充设置')
      return
    }
    androidAutofill.value = result.data
    showToast('请在系统页面选择 My Password')
    window.setTimeout(loadAndroidAutofillState, 1000)
  } catch {
    showFailToast('无法打开自动填充设置')
  } finally {
    androidAutofillBusy.value = false
  }
}

async function enablePluginListener() {
  const extensionId = pluginExtensionId.value.trim()
  if (!extensionId) {
    showFailToast('请先填写插件 ID')
    return
  }

  try {
    await showConfirmDialog({
      title: '开启插件监听',
      message: '将为当前用户注册 Chrome/Edge Native Host。之后浏览器会自动启动后台 Host，不需要手动运行脚本。',
      confirmButtonText: '开启'
    })
  } catch {
    return
  }

  pluginBusy.value = true
  try {
    const result = await api.enablePluginListener(extensionId, ['chrome', 'edge'])
    if (!result.ok || !result.data) return showFailToast(result.message || '开启失败')
    pluginListener.value = result.data
    pluginExtensionId.value = result.data.extensionId || extensionId
    showSuccessToast('插件监听已开启，重载扩展或浏览器后生效')
  } catch {
    showFailToast('开启插件监听失败')
  } finally {
    pluginBusy.value = false
  }
}

async function disablePluginListener() {
  try {
    await showConfirmDialog({
      title: '关闭插件监听',
      message: '将移除当前用户的 Chrome/Edge Native Host 注册。确认关闭吗？',
      confirmButtonText: '关闭',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  pluginBusy.value = true
  try {
    const result = await api.disablePluginListener()
    if (!result.ok || !result.data) return showFailToast(result.message || '关闭失败')
    pluginListener.value = result.data
    showSuccessToast('插件监听已关闭')
  } catch {
    showFailToast('关闭插件监听失败')
  } finally {
    pluginBusy.value = false
  }
}

async function persistSettings(options: { closeDrawer?: boolean; toast?: boolean; skipAutoSync?: boolean } = {}) {
  if (!vault.value) return
  const payload = cloneVault()
  payload.settings = normalizeSettings(settings)
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) {
    await handleVaultWriteError(result, '保存失败')
    return false
  }
  if (!publishVaultPayload(result.data)) return false
  if (options.closeDrawer) drawerOpen.value = false
  if (options.toast) showSuccessToast('设置已保存')
  if (!options.skipAutoSync) {
    scheduleAutoCloudDownloadCheck(true)
    scheduleAutoCloudUpload()
  }
  return true
}

async function uploadCloudBackup() {
  await startCloudUpload()
}

async function backupCloudVault() {
  await createDatedCloudBackup()
}

async function exportPortableBackupPackage() {
  if (!vault.value || portableBackupBusy.value || !isDesktopRuntime) return
  portableBackupBusy.value = true
  portableBackupStatus.value = '正在生成完整备份包'
  try {
    const result = await api.exportPortableBackupPackage()
    if (!result.ok || !result.data) {
      portableBackupStatus.value = result.message || '完整备份导出失败'
      return showFailToast(portableBackupStatus.value)
    }
    if (!result.data.saved) {
      portableBackupStatus.value = ''
      return
    }
    portableBackupStatus.value = `已导出 ${result.data.attachmentCount || 0} 个附件 · ${formatBytes(result.data.packageBytes || 0)}`
    showSuccessToast('完整备份已导出')
  } catch (error) {
    portableBackupStatus.value = error instanceof Error ? error.message : '完整备份导出失败'
    showFailToast(portableBackupStatus.value)
  } finally {
    portableBackupBusy.value = false
  }
}

async function beginPortableBackupImport() {
  if (!vault.value || portableBackupBusy.value || !isDesktopRuntime) return
  try {
    await showConfirmDialog({
      title: '恢复完整备份',
      message: '恢复会替换当前保险库，并保留一份替换前的本地保险库备份。确认选择备份包吗？',
      confirmButtonText: '选择备份包'
    })
  } catch {
    return
  }
  portableBackupBusy.value = true
  portableBackupStatus.value = '正在校验备份包'
  try {
    const result = await api.selectPortableBackupPackage()
    if (!result.ok || !result.data) {
      portableBackupStatus.value = result.message || '备份包校验失败'
      return showFailToast(portableBackupStatus.value)
    }
    if (!result.data.selected || !result.data.selectionToken) {
      portableBackupStatus.value = ''
      return
    }
    portableBackupSelection.value = result.data
    portableBackupPassword.value = ''
    portableBackupPasswordOpen.value = true
    portableBackupStatus.value = `已校验 ${result.data.attachmentCount || 0} 个附件，等待密码确认`
  } catch (error) {
    portableBackupStatus.value = error instanceof Error ? error.message : '备份包校验失败'
    showFailToast(portableBackupStatus.value)
  } finally {
    portableBackupBusy.value = false
  }
}

async function submitPortableBackupImport() {
  const token = portableBackupSelection.value?.selectionToken
  if (!token || portableBackupBusy.value) return
  portableBackupBusy.value = true
  portableBackupStatus.value = '正在验证并恢复完整备份'
  try {
    const result = await api.importPortableBackupPackage(token, portableBackupPassword.value)
    if (!result.ok || !result.data) {
      portableBackupStatus.value = result.message || '完整备份恢复失败'
      return showFailToast(result.code === 'BAD_PASSWORD' ? '备份密码错误或文件已损坏' : portableBackupStatus.value)
    }
    portableBackupPasswordOpen.value = false
    portableBackupSelection.value = null
    portableBackupPassword.value = ''
    applyLockedUiState()
    showSuccessToast(`已恢复 ${result.data.attachmentCount} 个附件，请重新解锁`)
  } catch (error) {
    portableBackupStatus.value = error instanceof Error ? error.message : '完整备份恢复失败'
    showFailToast(portableBackupStatus.value)
  } finally {
    portableBackupBusy.value = false
  }
}

function cancelPortableBackupImport() {
  portableBackupPasswordOpen.value = false
  clearPortableBackupSelection()
  portableBackupStatus.value = ''
}

function handlePortableBackupPromptClosed() {
  if (portableBackupSelection.value && !portableBackupBusy.value) clearPortableBackupSelection()
}

function clearPortableBackupSelection() {
  const token = portableBackupSelection.value?.selectionToken
  portableBackupSelection.value = null
  portableBackupPasswordOpen.value = false
  portableBackupPassword.value = ''
  if (token && isDesktopRuntime) void api.discardPortableBackupSelection(token)
}

async function checkCloudBackupInfo() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return
  const cloudOperation = beginCloudOperation('inspect', { message: '正在检查云端文件' })
  backupStatus.value = ''
  try {
    markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) {
      finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
      return
    }
    markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端文件')
    const client = createRemoteVaultStore()
    const configuredObjectName = normalizeObjectName(settings.oss.objectName)
    const preferred = await readCloudVaultForSync(
      client,
      configuredObjectName,
      configuredObjectName
    )
    const response = preferred.response
    if (response.status === RemoteVaultStatus.Success && typeof response.content === 'string') {
      cloudInfo.value = {
        name: configuredObjectName,
        exists: true,
        size: new TextEncoder().encode(response.content).byteLength,
        lastModified: new Date().toISOString()
      }
      backupStatus.value = `云端文件已存在：${formatBytes(cloudInfo.value.size)}`
      showSuccessToast('云端文件可用')
      return
    }
    if (response.status === RemoteVaultStatus.NotFound) {
      cloudInfo.value = { name: configuredObjectName, exists: false, size: 0, lastModified: '' }
      backupStatus.value = '云端固定文件不存在'
      showToast('云端文件不存在')
      return
    }
    const message = String(response.content || '检测失败')
    finishCloudOperation(cloudOperation, 'error', message)
    showFailToast(message)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '检测失败')
    finishCloudOperation(cloudOperation, 'error', message)
    showFailToast(message)
  } finally {
    finishCloudOperation(cloudOperation)
  }
}

async function refreshCloudBackupList() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return
  const cloudOperation = beginCloudOperation('list', { message: '正在读取云端备份列表' })
  backupStatus.value = ''
  try {
    markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) {
      finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
      return
    }
    markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端备份列表')
    const client = createRemoteVaultStore()
    const response = await client.listObjects(settings.oss.objectName, 50)
    if (response.status !== RemoteVaultStatus.Success || !Array.isArray(response.content)) {
      const message = String(response.content || '读取备份列表失败')
      finishCloudOperation(cloudOperation, 'error', message)
      showFailToast(message)
      return
    }
    const fixedName = normalizeObjectName(settings.oss.objectName)
    const v2FixedName = versionedVaultObjectName(fixedName, 2)
    cloudBackups.value = response.content
      .map(toCloudBackupInfo)
      .filter((item) =>
        item.name !== fixedName &&
        item.name !== v2FixedName &&
        !item.name.startsWith(`${fixedName}.sync-v3/`) &&
        item.name.startsWith(`${fixedName}.`)
      )
      .sort((left, right) => String(right.lastModified).localeCompare(String(left.lastModified)))
    backupStatus.value = cloudBackups.value.length ? `找到 ${cloudBackups.value.length} 个云端日期备份` : '没有找到日期备份'
    showToast(backupStatus.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '读取备份列表失败')
    finishCloudOperation(cloudOperation, 'error', message)
    showFailToast(message)
  } finally {
    finishCloudOperation(cloudOperation)
  }
}

function selectCloudBackup(objectName: string) {
  selectedCloudObjectName.value = normalizeObjectName(objectName)
  backupStatus.value = `本次下载将使用：${selectedCloudObjectName.value}`
}

function archiveEntryMeta(entry: VaultEntry) {
  if (entry.kind === 'folder') {
    const count = flattenEntries(entry.children || []).length
    const time = entry.statusUpdatedAt ? formatUnixTime(entry.statusUpdatedAt) : ''
    return [`分组`, `${count} 项`, time].filter(Boolean).join(' · ')
  }
  const account = entry.username || entry.email || entry.phone || '未设置账号'
  const domain = entry.domains?.[0] || '未设置域名'
  const time = entry.statusUpdatedAt ? formatUnixTime(entry.statusUpdatedAt) : ''
  return [account, domain, time].filter(Boolean).join(' · ')
}

async function createDatedCloudBackup() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return

  const configuredObjectName = normalizeObjectName(settings.oss.objectName)
  const versionedObjectName = versionedVaultObjectName(configuredObjectName, vault.value.version)
  const objectName = makeDatedBackupName(versionedObjectName)

  try {
    await confirmTwice({
      title: '创建云端备份',
      message: '将当前加密保险库上传到 OSS：' + objectName + '。继续吗？',
      secondTitle: '再次确认备份',
      secondMessage: '会上传一个新的不可变云端日期备份文件，不会在本地额外留存。',
      confirmButtonText: '确认备份'
    })
  } catch {
    return
  }

  const cloudOperation = beginCloudOperation('backup', {
    direction: 'backup',
    message: '正在创建云端备份'
  })
  backupStatus.value = ''
  try {
    markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) {
      finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
      return
    }

    markCloudOperation(cloudOperation, 'exporting', '正在导出加密保险库')
    const currentVault = await api.getVault()
    if (!currentVault.ok || !currentVault.data) throw new Error(currentVault.message || '读取保险库失败')
    await ensureRemoteAttachmentObjects(
      createRemoteVaultStore(),
      normalizeObjectName(settings.oss.objectName),
      currentVault.data,
      api
    )
    const exported = await api.exportVaultBackup()
    if (!exported.ok || !exported.data) {
      const message = exported.message || '导出保险库失败'
      finishCloudOperation(cloudOperation, 'error', message)
      appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'error',
        objectName,
        message
      })
      showFailToast(message)
      return
    }

    markCloudOperation(cloudOperation, 'writing-remote', '正在写入不可变备份')
    const response = await createRemoteVaultStore().writeObject(
      objectName,
      exported.data.content,
      'application/json',
      { forbidOverwrite: true }
    )
    if (response.status !== RemoteVaultStatus.Success) {
      const message = String(response.content || '备份失败')
      finishCloudOperation(cloudOperation, 'error', message)
      appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'error',
        objectName,
        message
      })
      showFailToast(message)
      return
    }

    backupStatus.value = '已上传到 ' + settings.oss.bucketName + '/' + objectName
    appendCloudSyncLog({
      direction: 'backup',
      automatic: false,
      status: 'success',
      objectName,
      message: '云端备份已创建'
    })
    showSuccessToast('云端备份已创建')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '云端备份失败')
    finishCloudOperation(cloudOperation, 'error', message)
    backupStatus.value = message
    appendCloudSyncLog({
      direction: 'backup',
      automatic: false,
      status: 'error',
      objectName,
      message
    })
    showFailToast(message)
  } finally {
    finishCloudOperation(cloudOperation)
  }
}


async function downloadCloudBackup() {
  await startCloudDownload()
}

function requestCloudVaultPassword() {
  if (cloudPasswordPromptResolve) cloudPasswordPromptResolve(null)
  cloudPasswordPromptValue.value = ''
  cloudPasswordPromptOpen.value = true
  return new Promise<string | null>((resolve) => {
    cloudPasswordPromptResolve = resolve
  })
}

function submitCloudPasswordPrompt() {
  resolveCloudPasswordPrompt(cloudPasswordPromptValue.value)
}

function cancelCloudPasswordPrompt() {
  resolveCloudPasswordPrompt(null)
}

function handleCloudPasswordPromptClosed() {
  if (cloudPasswordPromptResolve) resolveCloudPasswordPrompt(null)
}

function resolveCloudPasswordPrompt(value: string | null) {
  const resolve = cloudPasswordPromptResolve
  cloudPasswordPromptResolve = null
  cloudPasswordPromptOpen.value = false
  cloudPasswordPromptValue.value = ''
  if (resolve) resolve(value)
}

function isVaultPasswordChangedResult(result: ApiResult<unknown>) {
  const message = `${result.code || ''} ${result.message || ''}`
  return result.code === 'BAD_PASSWORD' && /vault password changed/i.test(message)
}

type CloudSyncRemoteSnapshot = {
  payload: VaultPayload
  envelopeText: string
  usedAlternatePassword: boolean
}

async function loadVerifiedCloudRemote(options: {
  direction: CloudSyncDirection
  automatic: boolean
  requestedObjectName: string
  objectName: string
  preferred: CloudVaultRead
  ancestorPayload: VaultPayload | null
  operation: CloudOperationHandle | null
  sessionIsCurrent: () => boolean
  operationGateKeys: (...objectNames: string[]) => string[]
}): Promise<CloudSyncRemoteSnapshot | null> {
  const {
    direction,
    automatic,
    requestedObjectName,
    objectName,
    preferred,
    ancestorPayload,
    operation,
    sessionIsCurrent,
    operationGateKeys
  } = options
  const response = preferred.response
  let alternatePassword: string | null | undefined
  let usedAlternatePassword = false

  const previewEnvelope = async (content: string) => {
    let result = await api.previewVaultBackup(content)
    if (!sessionIsCurrent() || result.ok || !isVaultPasswordChangedResult(result) || automatic) return result
    autoSyncPasswordGate.block(...operationGateKeys(requestedObjectName, objectName))
    backupStatus.value = '云端文件需要输入云端主密码校验'
    if (alternatePassword === undefined) alternatePassword = await requestCloudVaultPassword()
    if (!sessionIsCurrent() || alternatePassword === null) return result
    result = await api.previewVaultBackupWithPassword(content, alternatePassword)
    if (result.ok && result.data) usedAlternatePassword = true
    return result
  }

  const pauseAutomaticPasswordMismatch = (result: ApiResult<unknown>) => {
    if (!automatic || !isVaultPasswordChangedResult(result)) return false
    if (!sessionIsCurrent()) return true
    const message = '云端保险库主密码与当前会话不同，已暂停自动同步；请手动下载校验并上传以恢复'
    backupStatus.value = message
    if (autoSyncPasswordGate.block(...operationGateKeys(requestedObjectName, objectName))) {
      appendCloudSyncLog({
        direction,
        automatic: true,
        status: 'review',
        objectName,
        message
      })
    }
    return true
  }

  const passwordPromptWasCancelled = () => {
    if (alternatePassword !== null) return false
    backupStatus.value = '已取消云端校验'
    appendCloudSyncLog({
      direction,
      automatic: false,
      status: 'skipped',
      objectName,
      message: '已取消云端校验'
    })
    return true
  }

  let payload: VaultPayload | null = null
  let envelopeText = response.status === RemoteVaultStatus.Success && typeof response.content === 'string'
    ? response.content
    : ''

  if (response.status === RemoteVaultStatus.Conflict && preferred.appendOnlyRead?.heads.length) {
    if (!ancestorPayload) {
      const message = '检测到并发远端分支，但本机没有可验证的共同祖先；所有代际已保留，请先选择可信备份恢复'
      finishCloudOperation(operation, 'error', message)
      backupStatus.value = message
      appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
      if (!automatic) showFailToast(message)
      return null
    }

    const branchPayloads: VaultPayload[] = []
    for (const head of preferred.appendOnlyRead.heads) {
      const result = await previewEnvelope(head.content)
      if (!sessionIsCurrent()) return null
      if (pauseAutomaticPasswordMismatch(result) || passwordPromptWasCancelled()) return null
      if (!result.ok || !result.data) {
        const message = '远端分支无法用当前保险库密钥验证，已停止自动合并'
        finishCloudOperation(operation, 'error', message)
        backupStatus.value = message
        appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
        if (!automatic) showFailToast(message)
        return null
      }
      branchPayloads.push(result.data)
    }

    let mergedBranches = branchPayloads[0]
    const branchConflicts: VaultMergeConflict[] = []
    for (const branch of branchPayloads.slice(1)) {
      const merged = mergeVaultPayloads(ancestorPayload, mergedBranches, branch)
      mergedBranches = merged.payload
      branchConflicts.push(...merged.conflicts)
    }
    if (branchConflicts.length) {
      const message = `远端分支存在 ${branchConflicts.length} 项真实冲突，已停止自动合并`
      finishCloudOperation(operation, 'error', message)
      backupStatus.value = message
      appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
      if (!automatic) showFailToast(message)
      return null
    }

    payload = mergedBranches
    const mergedEnvelope = await api.exportVaultBackupForPayload(mergedBranches)
    if (!sessionIsCurrent()) return null
    if (!mergedEnvelope.ok || !mergedEnvelope.data) {
      const message = mergedEnvelope.message || '无法生成远端分支合并检查点'
      finishCloudOperation(operation, 'error', message)
      appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
      return null
    }
    envelopeText = mergedEnvelope.data.content
    if (!usedAlternatePassword) autoSyncPasswordGate.clear(...operationGateKeys(requestedObjectName, objectName))
  } else if (response.status === RemoteVaultStatus.Success && typeof response.content === 'string') {
    const result = await previewEnvelope(response.content)
    if (!sessionIsCurrent()) return null
    if (pauseAutomaticPasswordMismatch(result) || passwordPromptWasCancelled()) return null
    if (!result.ok || !result.data) {
      finishCloudOperation(operation, 'error', result.message || '云端文件无法用当前会话解密')
      if (!automatic) showFailToast(result.message || '云端文件无法用当前会话解密')
      backupStatus.value = '云端文件无法校验，请确认它来自当前保险库'
      appendCloudSyncLog({
        direction,
        automatic,
        status: 'error',
        objectName,
        message: result.message || '云端文件无法用当前会话解密'
      })
      return null
    }
    payload = result.data
    if (!usedAlternatePassword) autoSyncPasswordGate.clear(...operationGateKeys(requestedObjectName, objectName))
  } else if (response.status === RemoteVaultStatus.NotFound) {
    if (direction === 'download') {
      if (!automatic) showFailToast('云端文件不存在')
      backupStatus.value = '云端文件不存在'
      appendCloudSyncLog({ direction, automatic, status: 'skipped', objectName, message: '云端文件不存在' })
      return null
    }
    payload = emptyCloudPayload()
  } else {
    const message = String(response.content || '读取云端文件失败')
    finishCloudOperation(operation, 'error', message)
    if (!automatic) showFailToast(message)
    appendCloudSyncLog({ direction, automatic, status: 'error', objectName, message })
    return null
  }

  if (!payload) return null
  if (usedAlternatePassword) {
    autoSyncPasswordGate.block(...operationGateKeys(requestedObjectName, objectName))
    const checkpointEnvelope = await api.exportVaultBackupForPayload(payload)
    if (!sessionIsCurrent()) return null
    envelopeText = checkpointEnvelope.ok && checkpointEnvelope.data ? checkpointEnvelope.data.content : ''
  }
  return { payload, envelopeText, usedAlternatePassword }
}

function canScheduleAutoCloudSync() {
  if (!vault.value || !settings.oss.autoSync || state.locked) return
  if (cloudBusy.value || cloudSyncReviewOpen.value || hasPendingCloudSyncReview()) return
  if (!hasCompleteOssSettings()) {
    backupStatus.value = '自动同步已开启，请补全 OSS 配置'
    return
  }
  if (!crypto.subtle) return
  return true
}

function scheduleAutoCloudUpload() {
  if (!cloudSyncRuntime.canScheduleAutomaticUpload()) return
  if (!canScheduleAutoCloudSync()) return
  const objectName = normalizeObjectName(settings.oss.objectName)
  if (isAutoSyncPasswordBlocked(objectName)) return
  if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
  autoCloudUploadTimer = window.setTimeout(() => {
    autoCloudUploadTimer = 0
    if (
      cloudSyncRuntime.canScheduleAutomaticUpload() &&
      canScheduleAutoCloudSync() &&
      !isAutoSyncPasswordBlocked(objectName)
    ) {
      startCloudUpload({ automatic: true, skipPersist: true, objectName })
    }
  }, AUTO_CLOUD_SYNC_UPLOAD_DELAY_MS)
}

function scheduleAutoCloudDownloadCheck(forceOrEvent: boolean | Event = false) {
  if (!canScheduleAutoCloudSync()) return
  const objectName = normalizeObjectName(settings.oss.objectName)
  if (isAutoSyncPasswordBlocked(objectName)) return
  const force = forceOrEvent === true
  if (force) {
    cloudSyncRuntime.requireInitialDownload()
    if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
    autoCloudUploadTimer = 0
  }
  const now = Date.now()
  const elapsed = now - lastAutoCloudDownloadCheckAt
  const minInterval = autoCloudDownloadMinIntervalMs()
  const delay = force || elapsed >= minInterval
    ? AUTO_CLOUD_SYNC_DOWNLOAD_DELAY_MS
    : minInterval - elapsed

  if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
  autoCloudDownloadTimer = window.setTimeout(() => {
    autoCloudDownloadTimer = 0
    lastAutoCloudDownloadCheckAt = Date.now()
    if (canScheduleAutoCloudSync() && !isAutoSyncPasswordBlocked(objectName)) {
      cloudSyncRuntime.releaseInitialDownloadBarrier()
      startCloudDownload({ automatic: true, skipPersist: true, objectName })
    }
  }, delay)
}

type CloudSyncReviewOptions = {
  automatic?: boolean
  skipPersist?: boolean
  objectName?: string
}

function startCloudUpload(options: CloudSyncReviewOptions = {}) {
  return prepareCloudSyncReview({ ...options, direction: 'upload' })
}

function startCloudDownload(options: CloudSyncReviewOptions = {}) {
  return prepareCloudSyncReview({ ...options, direction: 'download' })
}

async function prepareCloudSyncReview(request: CloudSyncReviewOptions & { direction: CloudSyncDirection }) {
  const { direction, ...options } = request
  if (!vault.value || cloudBusy.value) return
  if (hasPendingCloudSyncReview()) {
    if (!options.automatic) {
      showCloudSyncReview()
      backupStatus.value = '有未处理同步差异，请先确认'
      showToast('有未处理同步差异，请先确认')
    }
    return
  }
  syncSettings(settings)
  if (options.automatic) {
    if (!hasCompleteOssSettings() || !crypto.subtle) return
  } else if (!validateOssSettings()) {
    return
  }

  const requestedObjectName = normalizeObjectName(
    options.objectName ||
    (direction === 'download' && !options.automatic ? selectedCloudObjectName.value || settings.oss.objectName : settings.oss.objectName)
  )
  if (options.automatic && isAutoSyncPasswordBlocked(requestedObjectName)) return
  const operationOss = normalizeSettings(settings).oss
  const operationCloudScopeId = JSON.stringify([operationOss.region, operationOss.bucketName])
  const operationGateKeys = (...objectNames: string[]) => objectNames.map((name) => (
    JSON.stringify([operationOss.region, operationOss.bucketName, normalizeObjectName(name)])
  ))
  const generation = vaultSession.capture()
  const sessionIsCurrent = () => (
    vaultSession.isCurrent(generation) &&
    !state.locked &&
    operationCloudScopeId === currentCloudScopeId()
  )
  let objectName = requestedObjectName

  if (!options.automatic) {
    appendCloudSyncLog({
      direction,
      automatic: false,
      status: 'started',
      objectName,
      message: direction === 'download' ? '开始下载校验' : '开始上传校验'
    })
  }

  const cloudOperation = beginCloudOperation('review', { direction, automatic: options.automatic === true })
  backupStatus.value = direction === 'download' ? '正在生成下载差异' : '正在生成上传差异'
  try {
    const localPayloadBeforePersist = clonePayload(vault.value)
    if (!options.skipPersist) {
      markCloudOperation(cloudOperation, 'persisting-settings', '正在保存云配置')
      const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
      if (!sessionIsCurrent()) return
      if (!saved || !vault.value) {
        finishCloudOperation(cloudOperation, 'error', '保存云配置失败')
        appendCloudSyncLog({
          direction,
          automatic: options.automatic === true,
          status: 'error',
          objectName,
          message: '保存云配置失败'
        })
        return
      }
    }

    const localPayload = clonePayload(vault.value)
    markCloudOperation(cloudOperation, 'reading-remote', '正在读取云端保险库')
    const client = createRemoteVaultStore()
    const preferred = await readCloudVaultForSync(
      client,
      normalizeObjectName(settings.oss.objectName),
      requestedObjectName
    )
    if (!sessionIsCurrent()) return
    objectName = preferred.objectName
    const response = preferred.response
    const ancestorPayload = await loadCloudSyncAncestor(objectName)
    if (!sessionIsCurrent()) return

    markCloudOperation(cloudOperation, 'decrypting', '正在校验云端保险库')
    const remoteSnapshot = await loadVerifiedCloudRemote({
      direction,
      automatic: options.automatic === true,
      requestedObjectName,
      objectName,
      preferred,
      ancestorPayload,
      operation: cloudOperation,
      sessionIsCurrent,
      operationGateKeys
    })
    if (!remoteSnapshot || !sessionIsCurrent()) return
    const remotePayload = remoteSnapshot.payload
    const remoteEnvelopeText = remoteSnapshot.envelopeText
    const usedAlternateRemotePassword = remoteSnapshot.usedAlternatePassword


    markCloudOperation(cloudOperation, 'building-diff', '正在计算两端差异')
    const remoteBaselinePayload = clonePayload(remotePayload)
    const planResult = await createCloudSyncPlan({
      requestedDirection: direction,
      localPayload,
      remotePayload,
      ancestorPayload,
      pullStrategy: options.automatic ? 'integrate' : 'snapshot',
      fingerprint: cloudSyncPayloadFingerprint
    })
    if (!sessionIsCurrent()) return
    if (!planResult.ok) {
      finishCloudOperation(cloudOperation, 'error', planResult.message)
      backupStatus.value = planResult.message
      appendCloudSyncLog({
        direction,
        automatic: options.automatic === true,
        status: planResult.code === 'pull-required' ? 'skipped' : 'error',
        objectName,
        message: planResult.message
      })
      if (!options.automatic) showFailToast(planResult.message)
      return
    }

    const activePlan = planResult.plan
    const {
      resolvedPasskeyState,
      usedAncestor,
      localChangedSinceBase,
      remoteChangedSinceBase
    } = activePlan
    const effectiveDirection = activePlan.direction
    const sourcePayload = activePlan.sourcePayload
    const basePayload = activePlan.basePayload
    let targetNeedsWrite = activePlan.targetNeedsWrite
    const items = activePlan.items

    if (!usedAncestor && direction === 'upload' && await shouldPreferCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)) {
      if (!sessionIsCurrent()) return
      const message = '云端数据较新，已停止上传；请先执行下载校验'
      backupStatus.value = message
      appendCloudSyncLog({
        direction: 'upload',
        automatic: options.automatic === true,
        status: 'skipped',
        objectName,
        message
      })
      if (!options.automatic) showToast(message)
      return
    }
    if (!sessionIsCurrent()) return


    const needsSessionKeyRewrite = usedAlternateRemotePassword && effectiveDirection === 'upload'
    if (needsSessionKeyRewrite) targetNeedsWrite = true

    const configuredObjectName = normalizeObjectName(settings.oss.objectName)
    const canonicalRequest = canonicalVaultReadCandidates(configuredObjectName, requestedObjectName).length > 1
    const uploadObjectName = preferred.managedRemote
      ? configuredObjectName
      : canonicalRequest
        ? versionedVaultObjectName(configuredObjectName, resolvedPasskeyState.version)
        : objectName

    if (
      options.automatic &&
      !usedAncestor &&
      effectiveDirection === 'download' &&
      items.length > 0 &&
      await shouldSkipAutomaticCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)
    ) {
      if (!sessionIsCurrent()) return
      cloudSyncPreview.value = null
      const message = '检测到本地待上传变更，已暂停自动下载；启动时不会自动上传'
      backupStatus.value = message
      appendCloudSyncLog({
        direction: 'download',
        automatic: true,
        status: 'skipped',
        objectName,
        message,
        total: items.length,
        ...cloudSyncDiffCountsForItems(items)
      })
      return
    }
    if (!sessionIsCurrent()) return

    if (!items.length && !targetNeedsWrite) {
      cloudSyncPreview.value = null
      await rememberCloudSyncState(
        objectName,
        remotePayload,
        localPayload,
        remoteEnvelopeText,
        preferred.remoteHeadIds
      )
      if (!sessionIsCurrent()) return
      const message = usedAlternateRemotePassword
        ? '校验完成；自动同步仍暂停，请手动上传以更新云端主密码'
        : direction === 'download' && localChangedSinceBase && !remoteChangedSinceBase
          ? '云端没有新变更；本地有待上传内容'
          : '当前方向没有待同步变更'
      backupStatus.value = message
      if (!options.automatic) showToast(message)
      appendCloudSyncLog({
        direction: effectiveDirection,
        automatic: options.automatic === true,
        status: 'success',
        objectName,
        message
      })
      return
    }

    const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
    const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
    const remoteObjectFingerprint = response.status === RemoteVaultStatus.Success && typeof response.content === 'string'
      ? response.revision || await sha256Text(response.content)
      : 'missing'
    if (!sessionIsCurrent()) return
    const preview: CloudSyncPreview = {
      direction: effectiveDirection,
      objectName,
      uploadObjectName,
      uploadTargetWasMissing: uploadObjectName !== objectName,
      resolvedPasskeyState,
      sourcePayload,
      basePayload,
      remoteBaselinePayload,
      items,
      automatic: options.automatic === true,
      sessionGeneration: generation,
      cloudScopeId: operationCloudScopeId,
      passwordGateScopeKeys: operationGateKeys(requestedObjectName, objectName, uploadObjectName),
      localFingerprint,
      remoteFingerprint,
      remoteObjectFingerprint,
      remoteExists: response.status === RemoteVaultStatus.Success || response.status === RemoteVaultStatus.Conflict,
      managedRemote: preferred.managedRemote,
      remoteHeadIds: preferred.remoteHeadIds,
      legacyObjectNames: preferred.legacyObjectNames,
      remoteEnvelopeText,
      remoteNeedsSessionKeyRewrite: usedAlternateRemotePassword
    }
    await routePreparedCloudSyncPreview(preview, options, cloudOperation, needsSessionKeyRewrite)
  } catch (error) {
    if (!sessionIsCurrent()) return
    const message = error instanceof Error ? error.message : String(error || '同步校验失败')
    finishCloudOperation(cloudOperation, 'error', message)
    if (!options.automatic) showFailToast(message)
    appendCloudSyncLog({
      direction,
      automatic: options.automatic === true,
      status: 'error',
      objectName,
      message
    })
  } finally {
    finishCloudOperation(cloudOperation)
  }
}

async function routePreparedCloudSyncPreview(
  preview: CloudSyncPreview,
  options: CloudSyncReviewOptions,
  operation: CloudOperationHandle | null,
  needsSessionKeyRewrite: boolean
) {
  cloudSyncPreview.value = preview
  const items = preview.items

  if (!items.length) {
    await applyCloudSyncItems(preview, [], {
      operation,
      clearPreview: true,
      showSuccess: !options.automatic,
      showErrors: !options.automatic,
      successMessage: needsSessionKeyRewrite
        ? '云端主密码已更新，自动同步已恢复'
        : '通行密钥状态已同步'
    })
    return
  }

  if (options.automatic) {
    const autoDecision = resolveAutoCloudSyncDecision(preview)
    if (autoDecision.apply) {
      await applyCloudSyncItems(preview, items, {
        operation,
        clearPreview: true,
        showSuccess: false,
        showErrors: false,
        successMessage: autoDecision.message
      })
      return
    }

    markCloudOperation(operation, 'waiting-review', autoDecision.message)
    showCloudSyncReview()
    backupStatus.value = autoDecision.message
    appendCloudSyncLog({
      direction: preview.direction,
      automatic: true,
      status: 'review',
      objectName: preview.objectName,
      message: autoDecision.message,
      total: items.length,
      ...cloudSyncDiffCountsForItems(items)
    })
    return
  }

  const message = `发现 ${items.length} 项差异`
  markCloudOperation(operation, 'waiting-review', message)
  showCloudSyncReview()
  backupStatus.value = message
  appendCloudSyncLog({
    direction: preview.direction,
    automatic: false,
    status: 'review',
    objectName: preview.objectName,
    message,
    total: items.length,
    ...cloudSyncDiffCountsForItems(items)
  })
}

async function applyCloudSyncPreview() {
  const preview = cloudSyncPreview.value
  if (!preview || cloudBusy.value) return
  const selectedItems = getCloudSyncSelectedItems(preview.items)
  if (!selectedItems.length) return showToast('没有选中差异')

  const cloudOperation = beginCloudOperation('apply', { direction: preview.direction, automatic: preview.automatic })
  try {
    await applyCloudSyncItems(preview, selectedItems, {
      operation: cloudOperation,
      closeReview: true,
      showSuccess: true,
      showErrors: true
    })
  } finally {
    finishCloudOperation(cloudOperation)
  }
}

type CloudSyncApplyOptions = {
  operation?: CloudOperationHandle | null
  closeReview?: boolean
  clearPreview?: boolean
  showSuccess?: boolean
  showErrors?: boolean
  successMessage?: string
}

type CloudSyncPreviewValidation =
  | { ok: true; message: ''; currentLocal: VaultPayload; localAlreadyApplied: boolean }
  | { ok: false; message: string }

async function validateCloudSyncPreview(
  preview: CloudSyncPreview,
  targetPayload: VaultPayload
): Promise<CloudSyncPreviewValidation> {
  if (!isCloudSyncPreviewCurrent(preview)) {
    return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
  }
  const currentLocal = await api.getVault()
  if (!isCloudSyncPreviewCurrent(preview)) {
    return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
  }
  if (!currentLocal.ok || !currentLocal.data) {
    return { ok: false, message: currentLocal.message || '无法重新读取本地保险库' }
  }
  const currentLocalFingerprint = await cloudSyncPayloadFingerprint(currentLocal.data)
  let localAlreadyApplied = false
  if (currentLocalFingerprint !== preview.localFingerprint) {
    localAlreadyApplied = await isCloudSyncDownloadTargetApplied({
      direction: preview.direction,
      currentPayload: currentLocal.data,
      targetPayload,
      fingerprint: cloudSyncPayloadFingerprint
    })
    if (!localAlreadyApplied) {
      return { ok: false, message: '本地保险库在确认期间已变化，请重新检测同步差异' }
    }
  }

  const success = (): CloudSyncPreviewValidation => ({
    ok: true,
    message: '',
    currentLocal: currentLocal.data as VaultPayload,
    localAlreadyApplied
  })

  if (preview.managedRemote) {
    const currentRemote = await loadAppendOnlyVault(
      createRemoteVaultStore(),
      preview.uploadObjectName,
      { legacyObjectNames: preview.legacyObjectNames }
    )
    if (!isCloudSyncPreviewCurrent(preview)) {
      return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
    }
    if (currentRemote.status === 'error') return { ok: false, message: currentRemote.message }
    if (currentRemote.status === 'conflict' && preview.remoteHeadIds.length < 2) {
      return { ok: false, message: currentRemote.message }
    }
    const currentHeadIds = currentRemote.heads.map((head) => head.id).sort()
    if (JSON.stringify(currentHeadIds) !== JSON.stringify([...preview.remoteHeadIds].sort())) {
      return { ok: false, message: '远端提交头在确认期间已变化，请重新检测同步差异' }
    }
    if (preview.remoteExists && currentRemote.heads.length === 1) {
      const currentHead = currentRemote.heads[0]
      if (!currentHead || currentHead.revision !== preview.remoteObjectFingerprint) {
        return { ok: false, message: '远端保险库内容在确认期间已变化，请重新检测同步差异' }
      }
    } else if (currentRemote.status !== 'not-found') {
      return { ok: false, message: '远端保险库在确认期间已创建，请重新检测同步差异' }
    }
    return success()
  }

  const sourceValidation = await validateLegacyRemoteObjectRevision(
    createRemoteVaultStore(),
    preview.objectName,
    preview.remoteObjectFingerprint,
    preview.remoteExists
  )
  if (!isCloudSyncPreviewCurrent(preview)) {
    return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
  }
  if (!sourceValidation.ok || preview.direction !== 'upload' || !preview.uploadTargetWasMissing) {
    return sourceValidation.ok ? success() : { ok: false, message: sourceValidation.message }
  }
  const targetValidation = await validateLegacyRemoteObjectRevision(
    createRemoteVaultStore(),
    preview.uploadObjectName,
    'missing',
    false
  )
  if (!isCloudSyncPreviewCurrent(preview)) {
    return { ok: false, message: '保险库会话或云配置已变化，请重新检测同步差异' }
  }
  return targetValidation.ok ? success() : { ok: false, message: targetValidation.message }
}

function isCloudSyncPreviewCurrent(preview: CloudSyncPreview) {
  return !state.locked &&
    preview.sessionGeneration === vaultSession.current() &&
    preview.cloudScopeId === currentCloudScopeId()
}

type CloudSyncApplyContext = {
  preview: CloudSyncPreview
  selectedItems: CloudSyncDiffItem[]
  options: CloudSyncApplyOptions
  remoteClient: RemoteVaultStore
  nextPayload: VaultPayload
  localAlreadyApplied: VaultPayload | null
  previewStats: ReturnType<typeof cloudSyncSelectionStats>
  selectedStats: ReturnType<typeof cloudSyncSelectionStats>
}

async function applyCloudSyncItems(preview: CloudSyncPreview, selectedItems: CloudSyncDiffItem[], options: CloudSyncApplyOptions = {}) {
  backupStatus.value = preview.direction === 'download' ? '正在应用下载差异' : '正在应用上传差异'
  try {
    const nextPayload = buildCloudSyncTargetPayload(preview, selectedItems, normalizeSettings(settings))
    markCloudOperation(options.operation || null, 'validating', '正在确认本地与远端版本')
    const validation = await validateCloudSyncPreview(preview, nextPayload)
    if (!validation.ok) {
      finishCloudOperation(options.operation || null, 'error', validation.message)
      backupStatus.value = validation.message
      appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'error',
        objectName: preview.objectName,
        message: validation.message,
        total: preview.items.length
      })
      if (cloudSyncPreview.value === preview) cloudSyncPreview.value = null
      cloudSyncReviewOpen.value = false
      if (options.showErrors !== false) showFailToast(validation.message)
      return false
    }
    if (!isCloudSyncPreviewCurrent(preview)) return false
    if (preview.direction === 'download') nextPayload.revision = validation.currentLocal.revision

    const context: CloudSyncApplyContext = {
      preview,
      selectedItems,
      options,
      remoteClient: createRemoteVaultStore(),
      nextPayload,
      localAlreadyApplied: validation.localAlreadyApplied ? validation.currentLocal : null,
      previewStats: cloudSyncSelectionStats(preview.items),
      selectedStats: cloudSyncSelectionStats(selectedItems)
    }
    return preview.direction === 'download'
      ? await applyCloudDownload(context)
      : await applyCloudUpload(context)
  } catch (error) {
    if (!isCloudSyncPreviewCurrent(preview)) return false
    const message = error instanceof Error ? error.message : String(error || '应用同步差异失败')
    finishCloudOperation(options.operation || null, 'error', message)
    const previewStats = cloudSyncSelectionStats(preview.items)
    const selectedStats = cloudSyncSelectionStats(selectedItems)
    appendCloudSyncLog({
      direction: preview.direction,
      automatic: preview.automatic,
      status: 'error',
      objectName: preview.objectName,
      message,
      selected: selectedStats.selected,
      total: previewStats.total,
      ...cloudSyncDiffCountsForItems(selectedItems)
    })
    if (options.showErrors !== false) showFailToast(message)
    backupStatus.value = message
    if (options.clearPreview && cloudSyncPreview.value === preview) cloudSyncPreview.value = null
    return false
  }
}

async function applyCloudDownload(context: CloudSyncApplyContext) {
  const { preview, selectedItems, options, remoteClient, nextPayload, localAlreadyApplied, previewStats, selectedStats } = context
  markCloudOperation(options.operation || null, 'applying-local', '正在校验附件对象')
  await ensureLocalAttachmentObjects(
    remoteClient,
    normalizeObjectName(settings.oss.objectName),
    nextPayload,
    api
  )
  if (!isCloudSyncPreviewCurrent(preview)) return false
  let appliedVault = localAlreadyApplied
  if (!appliedVault) {
    markCloudOperation(options.operation || null, 'applying-local', '正在写入本地保险库')
    const result = await saveVaultForCurrentSession(nextPayload)
    if (!result.ok || !result.data) {
      const message = result.code === 'CONFLICT'
        ? '本地保险库在应用同步期间已变化，请重新检测差异'
        : result.message || '应用下载差异失败'
      if (result.code === 'CONFLICT') await handleVaultWriteError(result, message)
      return failCloudSyncApply(context, message, { showToast: result.code !== 'CONFLICT' })
    }
    appliedVault = result.data
  }

  if (!publishVaultPayload(appliedVault)) return false
  void collectLocalAttachmentObjects(appliedVault)
  if (!isCloudSyncPreviewCurrent(preview) || vault.value !== appliedVault) return false

  markCloudOperation(options.operation || null, 'recording-checkpoint', '正在记录同步检查点')
  await rememberCloudSyncState(
    preview.objectName,
    preview.remoteBaselinePayload,
    appliedVault,
    preview.remoteEnvelopeText,
    preview.remoteHeadIds
  )
  if (!isCloudSyncPreviewCurrent(preview) || vault.value !== appliedVault) return false

  if (selectedEntry.value) {
    selectedEntry.value = findEntry(appliedVault.entries, selectedEntry.value.id)
    if (!selectedEntry.value) clearSelectedEntry()
  }
  selectedCloudObjectName.value = ''
  const message = options.successMessage || (preview.remoteNeedsSessionKeyRewrite
    ? '已下载 ' + selectedItems.length + ' 项差异；自动同步仍暂停，请手动上传以更新云端主密码'
    : '已下载 ' + selectedItems.length + ' 项差异')
  backupStatus.value = message
  appendCloudSyncLog({
    direction: 'download',
    automatic: preview.automatic,
    status: 'success',
    objectName: preview.objectName,
    message,
    selected: selectedStats.selected,
    total: previewStats.total,
    ...cloudSyncDiffCountsForItems(selectedItems)
  })
  finishCloudSyncApplyPreview(preview, options)
  if (options.showSuccess) showSuccessToast('下载差异已应用')
  return true
}

async function applyCloudUpload(context: CloudSyncApplyContext) {
  const { preview, selectedItems, options, remoteClient, nextPayload, previewStats, selectedStats } = context
  markCloudOperation(options.operation || null, 'writing-remote', '正在校验并上传附件对象')
  await ensureRemoteAttachmentObjects(
    remoteClient,
    normalizeObjectName(settings.oss.objectName),
    nextPayload,
    api
  )
  if (!isCloudSyncPreviewCurrent(preview)) return false
  markCloudOperation(options.operation || null, 'exporting', '正在生成上传内容')
  const exported = await api.exportVaultBackupForPayload(nextPayload)
  if (!isCloudSyncPreviewCurrent(preview)) return false
  if (!exported.ok || !exported.data) {
    return failCloudSyncApply(context, exported.message || '生成上传内容失败')
  }

  markCloudOperation(options.operation || null, 'writing-remote', '正在写入云端保险库')
  const managedWrite = preview.managedRemote
    ? await writeManagedCloudVault(
        remoteClient,
        preview.uploadObjectName,
        exported.data.content,
        preview.remoteHeadIds,
        preview.legacyObjectNames
      )
    : null
  const directWrite = preview.managedRemote
    ? null
    : await remoteClient.writeObject(preview.uploadObjectName, exported.data.content, 'application/json')
  if (!isCloudSyncPreviewCurrent(preview)) return false

  const writeSucceeded = managedWrite
    ? managedWrite.status === 'success'
    : directWrite?.status === RemoteVaultStatus.Success
  const writeMessage = managedWrite?.message || String(directWrite?.content || '上传失败')
  if (!writeSucceeded) {
    return failCloudSyncApply(context, writeMessage, { objectName: preview.uploadObjectName })
  }

  autoSyncPasswordGate.clear(...preview.passwordGateScopeKeys)
  cloudInfo.value = {
    name: preview.uploadObjectName,
    exists: true,
    size: exported.data.content.length,
    lastModified: new Date().toISOString()
  }
  const uploadedPayload = clonePayload(nextPayload)
  uploadedPayload.updatedAt = Number(exported.data.updatedAt || uploadedPayload.updatedAt || 0)
  markCloudOperation(options.operation || null, 'recording-checkpoint', '正在记录同步检查点')
  await rememberCloudSyncState(
    preview.uploadObjectName,
    uploadedPayload,
    vault.value || uploadedPayload,
    exported.data.content,
    managedWrite?.commitId ? [managedWrite.commitId] : []
  )
  if (!isCloudSyncPreviewCurrent(preview)) return false

  const message = options.successMessage || '已上传 ' + selectedItems.length + ' 项差异'
  backupStatus.value = options.successMessage || '已上传 ' + selectedItems.length + ' 项差异到 ' + settings.oss.bucketName + '/' + preview.uploadObjectName
  appendCloudSyncLog({
    direction: 'upload',
    automatic: preview.automatic,
    status: 'success',
    objectName: preview.uploadObjectName,
    message,
    selected: selectedStats.selected,
    total: previewStats.total,
    ...cloudSyncDiffCountsForItems(selectedItems)
  })
  finishCloudSyncApplyPreview(preview, options)
  if (options.showSuccess) showSuccessToast('上传差异已应用')
  return true
}

async function collectLocalAttachmentObjects(payload: VaultPayload) {
  const ids = collectAttachmentReferences(payload.entries).map((reference) => reference.id)
  await api.collectAttachmentObjects(ids)
}

function failCloudSyncApply(
  context: CloudSyncApplyContext,
  message: string,
  failure: { objectName?: string; showToast?: boolean } = {}
) {
  const { preview, selectedItems, options, previewStats, selectedStats } = context
  finishCloudOperation(options.operation || null, 'error', message)
  backupStatus.value = message
  appendCloudSyncLog({
    direction: preview.direction,
    automatic: preview.automatic,
    status: 'error',
    objectName: failure.objectName || preview.objectName,
    message,
    selected: selectedStats.selected,
    total: previewStats.total,
    ...cloudSyncDiffCountsForItems(selectedItems)
  })
  if (failure.showToast !== false && options.showErrors !== false) showFailToast(message)
  if (options.clearPreview && cloudSyncPreview.value === preview) cloudSyncPreview.value = null
  return false
}


function finishCloudSyncApplyPreview(preview: CloudSyncPreview, options: CloudSyncApplyOptions) {
  if (options.closeReview) {
    closeCloudSyncReview()
  } else if (options.clearPreview && cloudSyncPreview.value === preview) {
    cloudSyncPreview.value = null
  }
}

function closeCloudSyncReview() {
  cloudSyncReviewOpen.value = false
  cloudSyncPreview.value = null
}

function showCloudSyncReview() {
  drawerOpen.value = false
  drawerDetailOpen.value = false
  cloudSyncReviewOpen.value = true
}

function hideCloudSyncReview() {
  cloudSyncReviewOpen.value = false
}

async function discardCloudSyncReview() {
  const preview = cloudSyncPreview.value
  if (!preview) return
  try {
    await showConfirmDialog({
      title: '放弃同步确认',
      message: '本次差异不会应用，也不会删除两端数据。之后可以重新检测生成新的同步差异。',
      confirmButtonText: '放弃本次',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }
  const stats = cloudSyncSelectionStats(preview.items)
  appendCloudSyncLog({
    direction: preview.direction,
    automatic: preview.automatic,
    status: 'skipped',
    objectName: preview.objectName,
    message: '已放弃本次同步差异',
    selected: 0,
    total: stats.total,
    ...cloudSyncDiffCountsForItems(preview.items)
  })
  backupStatus.value = '已放弃本次同步差异'
  closeCloudSyncReview()
}

function hasPendingCloudSyncReview() {
  return Boolean(cloudSyncPreview.value?.items.length)
}

function readCheckboxChecked(event: Event) {
  return (event.target as HTMLInputElement | null)?.checked === true
}

function isCloudSyncItemChecked(item: CloudSyncDiffItem) {
  if (item.changeType !== 'modified') return item.checked
  return item.details.length > 0 && item.details.every((detail) => detail.checked)
}

function setCloudSyncItemChecked(item: CloudSyncDiffItem, checked: boolean) {
  item.checked = checked
  if (item.changeType !== 'modified') return
  for (const detail of item.details) detail.checked = checked
}

function setCloudSyncDetailChecked(item: CloudSyncDiffItem, detail: CloudSyncChangeDetail, checked: boolean) {
  detail.checked = checked
  item.checked = item.details.length > 0 && item.details.every((itemDetail) => itemDetail.checked)
}

function getCloudSyncSelectedItems(items: CloudSyncDiffItem[]) {
  return items.filter((item) => (item.changeType === 'modified' ? item.details.some((detail) => detail.checked) : item.checked))
}

function setAllCloudSyncDiffs(checked: boolean) {
  for (const item of cloudSyncPreview.value?.items || []) setCloudSyncItemChecked(item, checked)
}

function resolveAutoCloudSyncDecision(preview: CloudSyncPreview) {
  const items = preview.items
  const action = preview.direction === 'download' ? '下载' : '上传'
  if (items.some((item) => item.changeType !== 'added')) {
    const manualFields = autoCloudSyncManualReviewLabels(items)
    return {
      apply: false,
      message: manualFields.length
        ? `发现修改/删除差异（${manualFields.join('、')}），等待手动确认`
        : '发现修改/删除差异，等待手动确认'
    }
  }

  if (items.every((item) => item.changeType === 'added')) {
    return { apply: true, message: `仅新增 ${items.length} 项，已自动${action}` }
  }
  return { apply: true, message: `低风险差异 ${items.length} 项，已自动${action}` }
}

function appendCloudSyncLog(input: Partial<CloudSyncLogEntry> & Pick<CloudSyncLogEntry, 'direction' | 'status' | 'objectName' | 'message'>) {
  const entry: CloudSyncLogEntry = {
    id: makeId(),
    at: Date.now(),
    direction: input.direction,
    automatic: input.automatic === true,
    status: input.status,
    objectName: input.objectName,
    message: input.message,
    added: Number(input.added || 0),
    modified: Number(input.modified || 0),
    deleted: Number(input.deleted || 0),
    selected: Number(input.selected || 0),
    total: Number(input.total || 0)
  }
  cloudSyncLogs.value = [entry, ...cloudSyncLogs.value].slice(0, cloudSyncLogLimit.value)
  persistCloudSyncLogs()
}

function loadCloudSyncLogs(): CloudSyncLogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_SYNC_LOGS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeCloudSyncLog).filter(Boolean).slice(0, loadCloudSyncLogLimit()) as CloudSyncLogEntry[]
  } catch {
    return []
  }
}

function normalizeCloudSyncLog(value: unknown): CloudSyncLogEntry | null {
  const item = value as Partial<CloudSyncLogEntry>
  if (!item || typeof item !== 'object') return null
  const direction = item.direction === 'download' || item.direction === 'upload' || item.direction === 'backup'
    ? item.direction
    : 'upload'
  const status = item.status === 'started' || item.status === 'success' || item.status === 'review' || item.status === 'error' || item.status === 'skipped'
    ? item.status
    : 'success'
  return {
    id: String(item.id || makeId()),
    at: Number(item.at || Date.now()),
    direction,
    automatic: item.automatic === true,
    status,
    objectName: String(item.objectName || ''),
    message: String(item.message || ''),
    added: Number(item.added || 0),
    modified: Number(item.modified || 0),
    deleted: Number(item.deleted || 0),
    selected: Number(item.selected || 0),
    total: Number(item.total || 0)
  }
}

function persistCloudSyncLogs() {
  localStorage.setItem(CLOUD_SYNC_LOGS_KEY, JSON.stringify(cloudSyncLogs.value.slice(0, cloudSyncLogLimit.value)))
}

function loadCloudSyncLogLimit() {
  return clampCloudSyncLogLimit(localStorage.getItem(CLOUD_SYNC_LOG_LIMIT_KEY))
}

function setCloudSyncLogLimit(value: number | string) {
  cloudSyncLogLimit.value = clampCloudSyncLogLimit(value)
  localStorage.setItem(CLOUD_SYNC_LOG_LIMIT_KEY, String(cloudSyncLogLimit.value))
  cloudSyncLogs.value = cloudSyncLogs.value.slice(0, cloudSyncLogLimit.value)
  persistCloudSyncLogs()
}

function clampCloudSyncLogLimit(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return CLOUD_SYNC_LOG_LIMIT_DEFAULT
  return Math.min(Math.max(Math.round(numberValue), CLOUD_SYNC_LOG_LIMIT_MIN), CLOUD_SYNC_LOG_LIMIT_MAX)
}

function clearCloudSyncLogs() {
  cloudSyncLogs.value = []
  persistCloudSyncLogs()
  showToast('同步记录已清空')
}

async function shouldPreferCloudDownload(
  objectName: string,
  localPayload: VaultPayload,
  remotePayload: VaultPayload,
  localFreshnessPayload: VaultPayload
) {
  const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
  const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
  if (remoteFingerprint === localFingerprint) return false
  if (isLocalPayloadNewerThanRemote(localFreshnessPayload, remotePayload)) return false

  const state = readCloudSyncState(objectName)
  if (state) {
    const remoteChanged = Boolean(state.remoteFingerprint && remoteFingerprint !== state.remoteFingerprint)
    const localChanged = Boolean(state.localFingerprint && localFingerprint !== state.localFingerprint)
    return remoteChanged && !localChanged
  }

  const remoteUpdatedAt = cloudSyncPayloadUpdatedAt(remotePayload)
  const localUpdatedAt = cloudSyncPayloadUpdatedAt(localFreshnessPayload)
  return remoteUpdatedAt > 0 && localUpdatedAt > 0 && remoteUpdatedAt > localUpdatedAt
}

async function shouldSkipAutomaticCloudDownload(
  objectName: string,
  localPayload: VaultPayload,
  remotePayload: VaultPayload,
  localFreshnessPayload: VaultPayload
) {
  return hasLocalCloudSyncChanges(objectName, localPayload, remotePayload, localFreshnessPayload)
}

async function hasLocalCloudSyncChanges(
  objectName: string,
  localPayload: VaultPayload,
  remotePayload: VaultPayload,
  localFreshnessPayload: VaultPayload
) {
  const [localFingerprint, remoteFingerprint] = await Promise.all([
    cloudSyncPayloadFingerprint(localPayload),
    cloudSyncPayloadFingerprint(remotePayload)
  ])
  const state = readCloudSyncState(objectName)
  return hasLocalCloudChanges({
    localFingerprint,
    remoteFingerprint,
    checkpointLocalFingerprint: state?.localFingerprint,
    localUpdatedAt: cloudSyncPayloadUpdatedAt(localFreshnessPayload),
    remoteUpdatedAt: cloudSyncPayloadUpdatedAt(remotePayload)
  })
}

function isLocalPayloadNewerThanRemote(localPayload: VaultPayload, remotePayload: VaultPayload) {
  const localUpdatedAt = cloudSyncPayloadUpdatedAt(localPayload)
  const remoteUpdatedAt = cloudSyncPayloadUpdatedAt(remotePayload)
  return localUpdatedAt > 0 && (remoteUpdatedAt <= 0 || localUpdatedAt > remoteUpdatedAt)
}

async function rememberCloudSyncState(
  objectName: string,
  remotePayload: VaultPayload,
  localPayload: VaultPayload = remotePayload,
  ancestorEnvelope = '',
  remoteHeadIds: string[] = []
) {
  try {
    const remoteFingerprint = await cloudSyncPayloadFingerprint(remotePayload)
    const state = loadCloudSyncStateMap()
    state[cloudSyncStateKey(objectName)] = {
      remoteUpdatedAt: cloudSyncPayloadUpdatedAt(remotePayload),
      remoteFingerprint,
      localFingerprint: await cloudSyncPayloadFingerprint(localPayload),
      recordedAt: Date.now()
    }
    localStorage.setItem(CLOUD_SYNC_STATE_KEY, JSON.stringify(state))
    if (ancestorEnvelope) {
      await writeSyncCheckpoint({
        key: cloudSyncStateKey(objectName),
        envelope: ancestorEnvelope,
        payloadFingerprint: remoteFingerprint,
        remoteHeadIds,
        recordedAt: Date.now()
      })
    }
  } catch {
    // Sync state is only a safety hint; failing to persist it must not block vault use.
  }
}

async function loadCloudSyncAncestor(objectName: string): Promise<VaultPayload | null> {
  try {
    const checkpoint = await readSyncCheckpoint(cloudSyncStateKey(objectName))
    if (!checkpoint) return null
    const preview = await api.previewVaultBackup(checkpoint.envelope)
    if (!preview.ok || !preview.data) return null
    if (await cloudSyncPayloadFingerprint(preview.data) !== checkpoint.payloadFingerprint) return null
    return preview.data
  } catch {
    return null
  }
}

function purgeLegacyCloudSyncState() {
  try {
    localStorage.removeItem(LEGACY_CLOUD_SYNC_STATE_KEY)
  } catch {
    // A storage failure must not block vault startup.
  }
}

function readCloudSyncState(objectName: string): CloudSyncStateRecord | null {
  return loadCloudSyncStateMap()[cloudSyncStateKey(objectName)] || null
}

function loadCloudSyncStateMap(): Record<string, CloudSyncStateRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_SYNC_STATE_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const result: Record<string, CloudSyncStateRecord> = {}
    for (const [key, value] of Object.entries(raw)) {
      const record = normalizeCloudSyncStateRecord(value)
      if (record) result[key] = record
    }
    return result
  } catch {
    return {}
  }
}

function normalizeCloudSyncStateRecord(value: unknown): CloudSyncStateRecord | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<CloudSyncStateRecord>
  const remoteUpdatedAt = Number(item.remoteUpdatedAt || 0)
  const recordedAt = Number(item.recordedAt || 0)
  const remoteFingerprint = String(item.remoteFingerprint || '')
  const localFingerprint = String(item.localFingerprint || '')
  if (!isSha256(remoteFingerprint) || !isSha256(localFingerprint)) return null
  return {
    remoteUpdatedAt: Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0,
    remoteFingerprint,
    localFingerprint,
    recordedAt: Number.isFinite(recordedAt) ? recordedAt : 0
  }
}

function cloudSyncStateKey(objectName: string) {
  const oss = normalizeSettings(settings).oss
  return JSON.stringify([oss.region, oss.bucketName, normalizeObjectName(objectName)])
}

function currentCloudScopeId() {
  const oss = normalizeSettings(settings).oss
  return JSON.stringify([oss.region, oss.bucketName])
}

function autoSyncPasswordGateKeys(...objectNames: string[]) {
  return objectNames.map(cloudSyncStateKey)
}

function isAutoSyncPasswordBlocked(...objectNames: string[]) {
  return autoSyncPasswordGate.isBlocked(...autoSyncPasswordGateKeys(...objectNames))
}

function clearAutoSyncPasswordGate(...objectNames: string[]) {
  autoSyncPasswordGate.clear(...autoSyncPasswordGateKeys(...objectNames))
}

function cloudSyncPayloadUpdatedAt(payload: VaultPayload | null | undefined) {
  const value = Number(payload?.updatedAt || 0)
  return Number.isFinite(value) ? value : 0
}

async function cloudSyncPayloadFingerprint(payload: VaultPayload) {
  return sha256Text(canonicalJson({
    version: payload.version,
    passkeySchemaVersion: payload.passkeySchemaVersion,
    entries: (payload.entries || []).map(cloudSyncEntryFingerprint),
    passkeyState: passkeyStateFingerprint(payload)
  }))
}

async function sha256Text(value: string) {
  if (!crypto.subtle) throw new Error('当前环境不支持安全的 SHA-256 同步摘要')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/i.test(value)
}

function cloudSyncEntryFingerprint(entry: VaultEntry): unknown {
  return {
    id: entry.id || '',
    ...comparableCloudSyncEntry(entry),
    children: (entry.children || []).map(cloudSyncEntryFingerprint)
  }
}

function cloudSyncDirectionLabel(direction: CloudSyncLogEntry['direction']) {
  if (direction === 'download') return '下载'
  if (direction === 'backup') return '备份'
  return '上传'
}

function cloudSyncLogStatusLabel(status: CloudSyncLogStatus) {
  if (status === 'started') return '开始'
  if (status === 'review') return '待确认'
  if (status === 'error') return '失败'
  if (status === 'skipped') return '跳过'
  return '完成'
}

function cloudSyncLogTitle(item: CloudSyncLogEntry) {
  return item.message || cloudSyncLogStatusLabel(item.status)
}

function cloudSyncLogSummary(item: CloudSyncLogEntry) {
  const diffText = [
    item.added ? `新增 ${item.added}` : '',
    item.modified ? `修改 ${item.modified}` : '',
    item.deleted ? `删除 ${item.deleted}` : ''
  ].filter(Boolean).join(' · ')
  const selectedText = item.selected ? `已选 ${item.selected}/${item.total || item.selected}` : ''
  const detail = [selectedText, diffText || (item.total ? `差异 ${item.total}` : '')].filter(Boolean).join(' · ')
  if (detail) return detail
  if (item.status === 'started') return '校验中'
  if (item.status === 'review') return '需要手动处理'
  if (item.status === 'error') return '校验未完成'
  if (item.status === 'skipped') return '未执行'
  return '无差异'
}

function emptyCloudPayload(): VaultPayload {
  return {
    version: 1,
    revision: 1,
    entries: [],
    passkeys: [],
    passkeyTombstones: [],
    settings: normalizeSettings(settings),
    updatedAt: 0
  }
}

function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function refreshTotp(entryIdOverride = '') {
  const secret = resolveTotpSecret(entryIdOverride)
  if (!secret) {
    totpCode.value = ''
    return
  }
  const requestId = ++totpRequestId.value
  try {
    const code = await generateTotp(secret)
    if (requestId !== totpRequestId.value) return
    totpCode.value = code
    if (!code) showToast('无法生成验证码')
  } catch {
    if (requestId !== totpRequestId.value) return
    totpCode.value = ''
    showToast('无法生成验证码')
  }
}

function resolveTotpSecret(entryIdOverride = '') {
  if (entryIdOverride && vault.value) {
    return findEntry(vault.value.entries, entryIdOverride)?.totpSecret || ''
  }
  if (editingId.value) return form.totpSecret || ''
  return selectedEntry.value?.totpSecret || ''
}

function syncSelectedTotpTimer() {
  const entry = selectedEntry.value
  if (entry?.totpSecret) startTotpTimer(entry.id)
  else stopTotpTimer()
}

function startTotpTimer(entryId: string) {
  stopTotpTimer(false)
  updateTotpClock(entryId)
  totpTimer = window.setInterval(() => updateTotpClock(entryId), 1000)
}

function stopTotpTimer(reset = true) {
  if (totpTimer) window.clearInterval(totpTimer)
  totpTimer = 0
  totpCurrentStep = -1
  if (reset) {
    totpPeriodSeconds.value = TOTP_PERIOD_SECONDS
    totpRemaining.value = TOTP_PERIOD_SECONDS
  }
}

function updateTotpClock(entryId: string) {
  if (selectedEntry.value?.id !== entryId || !selectedEntry.value?.totpSecret) {
    stopTotpTimer()
    return
  }
  const period = readTotpPeriod(selectedEntry.value.totpSecret)
  totpPeriodSeconds.value = period
  const nowSeconds = Math.floor(Date.now() / 1000)
  const elapsed = nowSeconds % period
  const step = Math.floor(nowSeconds / period)
  totpRemaining.value = elapsed === 0 ? period : period - elapsed
  if (step !== totpCurrentStep || !totpCode.value) {
    totpCurrentStep = step
    refreshTotp(entryId)
  }
}

function scheduleTotpRefresh(entryId: string) {
  const scheduledEntryId = entryId
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (selectedEntry.value?.id === scheduledEntryId || editingId.value === scheduledEntryId) {
        refreshTotp(scheduledEntryId)
      }
    }, 80)
  })
}

async function copyText(value: string) {
  if (!value) return showToast('没有可复制的内容')
  try {
    await copySensitiveText(value)
    showSuccessToast('已复制，30 秒后清除')
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '复制失败')
  }
}

function updateOssSetting(field: keyof typeof settings.oss, value: string) {
  if (field === 'bucketName' || field === 'accessKeyId' || field === 'accessKeySecret' || field === 'region' || field === 'objectName') {
    settings.oss[field] = value
  }
}

function syncSettings(nextSettings?: Partial<VaultPayload['settings']>) {
  const normalized = normalizeSettings(nextSettings)
  Object.assign(settings.oss, normalized.oss)
}

function normalizeSettings(nextSettings?: Partial<VaultPayload['settings']> | typeof settings): VaultPayload['settings'] {
  const oss = (nextSettings?.oss || {}) as Partial<VaultPayload['settings']['oss']>
  return {
    oss: {
      bucketName: String(oss.bucketName || '').trim(),
      accessKeyId: String(oss.accessKeyId || '').trim(),
      accessKeySecret: String(oss.accessKeySecret || ''),
      region: String(oss.region || '').trim(),
      objectName: normalizeObjectName(String(oss.objectName || DEFAULT_OSS_OBJECT_NAME)),
      autoSync: oss.autoSync === true,
      autoSyncIntervalMinutes: normalizeAutoSyncIntervalMinutes(oss.autoSyncIntervalMinutes)
    }
  }
}

function setAutoSyncIntervalMinutes(value: number | string) {
  settings.oss.autoSyncIntervalMinutes = normalizeAutoSyncIntervalMinutes(value)
}

function normalizeAutoSyncIntervalMinutes(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return AUTO_CLOUD_SYNC_INTERVAL_DEFAULT_MINUTES
  return Math.min(
    Math.max(Math.round(numberValue), AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES),
    AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES
  )
}

function autoCloudDownloadMinIntervalMs() {
  return normalizeAutoSyncIntervalMinutes(settings.oss.autoSyncIntervalMinutes) * 60 * 1000
}

function validateOssSettings() {
  syncSettings(settings)
  if (!hasCompleteOssSettings()) {
    showFailToast('请先填写完整 OSS 配置')
    return false
  }
  if (!crypto.subtle) {
    showFailToast('当前环境不支持 Web Crypto')
    return false
  }
  return true
}

function hasCompleteOssSettings() {
  return Boolean(settings.oss.bucketName && settings.oss.accessKeyId && settings.oss.accessKeySecret && settings.oss.region)
}

function createRemoteVaultStore() {
  const oss = normalizeSettings(settings).oss
  return createAliyunOssVaultStore(oss, cloudSyncRuntime.signal())
}

function beginCloudOperation(
  kind: CloudOperationKind = 'review',
  options: { direction?: CloudOperationDirection; automatic?: boolean; message?: string } = {}
) {
  return cloudSyncRuntime.begin(kind, options)
}

function markCloudOperation(
  operation: CloudOperationHandle | null,
  stage: CloudOperationStage,
  message = ''
) {
  return cloudSyncRuntime.stage(operation, stage, message)
}

function finishCloudOperation(
  operation: CloudOperationHandle | null,
  stage: Extract<CloudOperationStage, 'success' | 'error' | 'cancelled'> = 'success',
  message = ''
) {
  cloudSyncRuntime.finish(operation, stage, message)
}

function cancelCloudOperation() {
  cloudSyncRuntime.cancel()
}

type CloudVaultRead = {
  objectName: string
  response: RemoteVaultResult<string>
  managedRemote: boolean
  remoteHeadIds: string[]
  legacyObjectNames: string[]
  appendOnlyRead?: AppendOnlyVaultRead
}

async function readCloudVaultForSync(
  client: RemoteVaultStore,
  configuredObjectName: string,
  requestedObjectName: string
): Promise<CloudVaultRead> {
  const configured = normalizeObjectName(configuredObjectName)
  const requested = normalizeObjectName(requestedObjectName)
  const v2LegacyName = versionedVaultObjectName(configured, 2)
  const canonicalRequest = requested === configured || requested === v2LegacyName
  if (!canonicalRequest) {
    return {
      objectName: requested,
      response: await client.readObject(requested),
      managedRemote: false,
      remoteHeadIds: [],
      legacyObjectNames: []
    }
  }

  const legacyObjectNames = [v2LegacyName, configured]
  const appendOnlyRead = await loadAppendOnlyVault(client, configured, { legacyObjectNames })
  if (appendOnlyRead.status === 'success') {
    const head = appendOnlyRead.heads[0]
    return {
      objectName: configured,
      response: {
        status: RemoteVaultStatus.Success,
        content: head.content,
        revision: head.revision
      },
      managedRemote: true,
      remoteHeadIds: appendOnlyRead.heads.map((item) => item.id).sort(),
      legacyObjectNames,
      appendOnlyRead
    }
  }
  if (appendOnlyRead.status === 'not-found') {
    return {
      objectName: configured,
      response: { status: RemoteVaultStatus.NotFound, content: appendOnlyRead.message },
      managedRemote: true,
      remoteHeadIds: [],
      legacyObjectNames,
      appendOnlyRead
    }
  }
  return {
    objectName: configured,
    response: {
      status: appendOnlyRead.status === 'conflict' ? RemoteVaultStatus.Conflict : RemoteVaultStatus.Error,
      content: appendOnlyRead.message
    },
    managedRemote: true,
    remoteHeadIds: appendOnlyRead.heads.map((item) => item.id).sort(),
    legacyObjectNames,
    appendOnlyRead
  }
}

async function writeManagedCloudVault(
  client: RemoteVaultStore,
  objectName: string,
  content: string,
  expectedHeadIds: string[],
  legacyObjectNames: string[]
) {
  return appendRemoteVaultCommit(client, normalizeObjectName(objectName), content, {
    expectedHeadIds,
    legacyObjectNames,
    clientId: cloudSyncClientId()
  })
}

function cloudSyncClientId() {
  const key = 'mypwdmg.cloud-sync.client-id.v1'
  try {
    const existing = localStorage.getItem(key)
    if (existing && /^[A-Za-z0-9._-]{8,128}$/.test(existing)) return existing
    const created = `client-${secureRandomId()}`
    localStorage.setItem(key, created)
    return created
  } catch {
    return `ephemeral-${secureRandomId()}`
  }
}

function makeDatedBackupName(fileName: string) {
  const objectName = normalizeObjectName(fileName)
  const now = new Date()
  const datePart = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate())
  ].join('-')
  const timePart = [padDatePart(now.getHours()), padDatePart(now.getMinutes()), padDatePart(now.getSeconds())].join('')
  const millisecondPart = String(now.getMilliseconds()).padStart(3, '0')
  return `${objectName}.${datePart}-${timePart}-${millisecondPart}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function formatBytes(value: number) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
}

function formatDateTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatUnixTime(value: number) {
  const seconds = Number(value) || 0
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleString()
}

function toCloudBackupInfo(value: RemoteVaultObjectInfo): CloudBackupInfo {
  return {
    name: value.name,
    exists: Boolean(value.exists),
    size: Number(value.size || 0),
    lastModified: value.lastModified || ''
  }
}

async function confirmTwice(options: {
  title: string
  message: string
  secondTitle: string
  secondMessage: string
  confirmButtonText: string
}) {
  await showConfirmDialog({
    title: options.title,
    message: options.message,
    confirmButtonText: '继续',
    confirmButtonColor: '#ee0a24'
  })
  await showConfirmDialog({
    title: options.secondTitle,
    message: options.secondMessage,
    confirmButtonText: options.confirmButtonText,
    confirmButtonColor: '#ee0a24'
  })
}

function normalizeForm(): VaultEntry {
  const entry: VaultEntry = JSON.parse(JSON.stringify(form))
  entry.username = entry.username?.trim() || ''
  entry.email = entry.email?.trim() || ''
  entry.phone = entry.phone?.trim() || ''
  entry.autofillMatchMode = normalizeAutofillMatchMode(entry.autofillMatchMode)
  entry.loginAccountSource = normalizeLoginAccountSource(entry.loginAccountSource)
  entry.customFields = (entry.customFields || [])
    .map((field) => ({
      ...field,
      label: String(field.label || '').trim(),
      value: String(field.value || ''),
      protected: field.type === 'secret' || field.protected === true
    }))
    .filter((field) => field.label || field.value)
  entry.domains = entry.kind === 'login'
    ? normalizeAutofillRuleValues(domainText.value, entry.autofillMatchMode)
    : []
  if (entry.kind === 'folder') {
    entry.domains = []
    entry.customFields = []
    entry.children = entry.children || []
  } else {
    entry.children = []
  }
  return entry
}

function normalizeLoginAccountSource(value: unknown): LoginAccountSource {
  return typeof value === 'string' && LOGIN_ACCOUNT_SOURCES.has(value as LoginAccountSource)
    ? (value as LoginAccountSource)
    : 'auto'
}

function normalizeEntryStatus(value: unknown): EntryStatus {
  return typeof value === 'string' && ENTRY_STATUSES.has(value as EntryStatus)
    ? (value as EntryStatus)
    : 'active'
}

function cloneVault(): VaultPayload {
  return JSON.parse(JSON.stringify(vault.value))
}

function isActiveEntry(entry: VaultEntry) {
  return normalizeEntryStatus(entry.status) === 'active'
}

function isVisibleInMainList(entry: VaultEntry) {
  return isActiveEntry(entry)
}

function activeTree(entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter(isVisibleInMainList)
    .map((entry) => entry.kind === 'folder' ? { ...entry, children: activeTree(entry.children || []) } : entry)
}

function collectSystemGroupEntries(entries: VaultEntry[], status: EntryStatus, ancestorHidden = false): VaultEntry[] {
  const result: VaultEntry[] = []
  for (const entry of entries) {
    const entryStatus = normalizeEntryStatus(entry.status)
    if (!ancestorHidden && entryStatus === status) result.push(entry)
    const nextAncestorHidden = ancestorHidden || entryStatus !== 'active'
    result.push(...collectSystemGroupEntries(entry.children || [], status, nextAncestorHidden))
  }
  return result
}

function markEntryStatus(entry: VaultEntry, status: EntryStatus, reason = '') {
  markEntrySelfStatus(entry, status, reason)
  for (const child of entry.children || []) markEntryStatus(child, status, reason)
}

function markEntrySelfStatus(entry: VaultEntry, status: EntryStatus, reason = '') {
  const previous = createEntrySnapshot(entry)
  const now = Math.floor(Date.now() / 1000)
  const nextStatus = normalizeEntryStatus(status)
  entry.status = nextStatus
  entry.statusReason = nextStatus === 'active' ? '' : reason
  entry.statusUpdatedAt = now
  entry.deletedAt = nextStatus === 'trashed' ? now : 0
  appendEntryHistory(entry, nextStatus === 'active' ? 'restored' : nextStatus, reason, previous)
}

function appendEntryHistory(
  entry: VaultEntry,
  action: EntryHistoryAction,
  note = '',
  snapshotSource: VaultEntry = entry
) {
  const history = Array.isArray(entry.history) ? entry.history : []
  const changes = action === 'created' ? [] : buildEntryHistoryChanges(snapshotSource, entry)
  if (!shouldRecordEntryHistory(action, changes.length)) {
    entry.history = limitEntryHistory(history)
    return
  }
  history.unshift({
    id: makeId(),
    action,
    at: Math.floor(Date.now() / 1000),
    title: snapshotSource.title || '',
    username: snapshotSource.username || '',
    email: snapshotSource.email || '',
    phone: snapshotSource.phone || '',
    domains: [...(snapshotSource.domains || [])],
    note,
    changes,
    snapshot: createEntrySnapshot(snapshotSource)
  })
  entry.history = limitEntryHistory(history)
}

function updateEntryById(entries: VaultEntry[], entryId: string, updater: (entry: VaultEntry) => void): boolean {
  for (const entry of entries) {
    if (entry.id === entryId) {
      updater(entry)
      return true
    }
    if (updateEntryById(entry.children || [], entryId, updater)) return true
  }
  return false
}

function updateEntryAndAncestorsById(
  entries: VaultEntry[],
  entryId: string,
  updater: (entry: VaultEntry) => void,
  ancestorUpdater: (entry: VaultEntry) => void
): boolean {
  for (const entry of entries) {
    if (entry.id === entryId) {
      updater(entry)
      return true
    }
    if (updateEntryAndAncestorsById(entry.children || [], entryId, updater, ancestorUpdater)) {
      ancestorUpdater(entry)
      return true
    }
  }
  return false
}

function clearSelectedEntry() {
  clearWorkspaceSelection()
  stopTotpTimer()
}

function clearSelectedEntryIf(entryId: string) {
  if (selectedEntry.value?.id === entryId) clearSelectedEntry()
}

function replaceEntry(entries: VaultEntry[], entryId: string, next: VaultEntry): boolean {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].id === entryId) {
      next.id = entryId
      if (next.kind === 'folder') next.children = entries[index].children || next.children || []
      entries[index] = next
      return true
    }
    if (replaceEntry(entries[index].children || [], entryId, next)) return true
  }
  return false
}

function insertEntry(entries: VaultEntry[], parentId: string, entry: VaultEntry): boolean {
  if (!parentId) {
    entries.unshift(entry)
    return true
  }

  if (insertEntryIntoParent(entries, parentId, entry)) return true
  entries.unshift(entry)
  return false
}

function insertEntryIntoParent(entries: VaultEntry[], parentId: string, entry: VaultEntry): boolean {
  for (const item of entries) {
    if (item.id === parentId && item.kind === 'folder') {
      item.children = item.children || []
      item.children.unshift(entry)
      return true
    }
    if (item.children && insertEntryIntoParent(item.children, parentId, entry)) return true
  }
  return false
}

function removeEntry(entries: VaultEntry[], entryId: string): boolean {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    entries.splice(index, 1)
    return true
  }
  return entries.some((entry) => removeEntry(entry.children || [], entryId))
}

function removeEntryCopies(entries: VaultEntry[], entryId: string) {
  while (removeEntry(entries, entryId)) {
    // Keep removing stale duplicate IDs left by older drag operations.
  }
}

function takeEntry(entries: VaultEntry[], entryId: string, parentId = ''): { entry: VaultEntry; parentId: string; index: number } | null {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index >= 0) {
    const [entry] = entries.splice(index, 1)
    return { entry, parentId, index }
  }
  for (const entry of entries) {
    const result = takeEntry(entry.children || [], entryId, entry.id)
    if (result) return result
  }
  return null
}

function insertEntryAt(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  if (!parentId) {
    entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
    return true
  }

  if (insertEntryAtParent(entries, parentId, entry, targetIndex)) return true
  entries.splice(clampIndex(targetIndex, entries.length), 0, entry)
  return false
}

function insertEntryAtParent(entries: VaultEntry[], parentId: string, entry: VaultEntry, targetIndex: number): boolean {
  for (const item of entries) {
    if (item.id === parentId && item.kind === 'folder') {
      item.children = item.children || []
      item.children.splice(clampIndex(targetIndex, item.children.length), 0, entry)
      return true
    }
    if (item.children && insertEntryAtParent(item.children, parentId, entry, targetIndex)) return true
  }
  return false
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(0, index), length)
}

function isDescendant(entry: VaultEntry, targetEntryId: string): boolean {
  if (!targetEntryId) return false
  for (const child of entry.children || []) {
    if (child.id === targetEntryId || isDescendant(child, targetEntryId)) return true
  }
  return false
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children || [])])
}

function vaultReferencesAttachment(entries: VaultEntry[], attachmentId: string) {
  return flattenEntries(entries).some((entry) =>
    (entry.attachments || []).some((attachment) => attachment.id === attachmentId)
  )
}

function findEntry(entries: VaultEntry[], entryId: string): VaultEntry | null {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    const child = findEntry(entry.children || [], entryId)
    if (child) return child
  }
  return null
}

function defaultTheme(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('mypwdmg.theme', theme.value)
  syncAndroidSystemBarsTheme()
}

function syncAndroidSystemBarsTheme() {
  androidBridgeCall('setSystemBarsTheme', theme.value)
}

function setTheme(next: ThemeMode) {
  theme.value = next
  applyTheme()
}

function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

function loadUiScale() {
  return loadUiScalePercent(
    localStorage.getItem(UI_SCALE_KEY),
    localStorage.getItem(LEGACY_UI_SCALE_KEY)
  )
}

function loadFontSize() {
  const rawValue = localStorage.getItem(FONT_SIZE_KEY)
  if (rawValue === null || rawValue === '') return 100
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return 100
  return clampSliderValue(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
}

function setUiScaleDraft(value: number | number[]) {
  uiScalePercent.value = clampSliderValue(value, UI_SCALE_MIN_PERCENT, UI_SCALE_MAX_PERCENT)
  applyLayoutScale(false)
}

function commitUiScale(value: number | number[]) {
  setUiScaleDraft(value)
  applyLayoutScale(true)
}

function setFontSizeDraft(value: number | number[]) {
  fontSizePercent.value = clampSliderValue(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
  applyFontSize(false)
}

function commitFontSize(value: number | number[]) {
  setFontSizeDraft(value)
  applyFontSize(true)
}

function updateSessionTimeout(value: number | string) {
  const next = loadSessionTimeoutMinutes(value)
  sessionTimeoutMinutes.value = next
  localStorage.setItem(SESSION_TIMEOUT_KEY, String(next))
  scheduleSessionLock()
}

function applyLayoutScale(save = true) {
  if (save) localStorage.setItem(UI_SCALE_KEY, String(uiScalePercent.value))
  document.documentElement.style.setProperty('--ui-scale', String(uiScalePercent.value / 100))
  applyTypographyScale()
}

function applyFontSize(save = true) {
  if (save) localStorage.setItem(FONT_SIZE_KEY, String(fontSizePercent.value))
  applyTypographyScale()
}

function applyTypographyScale() {
  const scale = (uiScalePercent.value / 100) * (fontSizePercent.value / 100)
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--font-scale', String(fontSizePercent.value / 100))
  rootStyle.setProperty('--app-font-sm', px(12 * scale))
  rootStyle.setProperty('--app-font-md', px(14 * scale))
  rootStyle.setProperty('--app-font-lg', px(16 * scale))
  rootStyle.setProperty('--app-font-xl', px(22 * scale))
}

function clampSliderValue(value: number | number[], min: number, max: number) {
  const raw = Array.isArray(value) ? value[0] : value
  const next = Number(raw)
  if (!Number.isFinite(next)) return min
  return Math.min(Math.max(Math.round(next), min), max)
}

function px(value: number) {
  return `${Math.round(value * 100) / 100}px`
}

function toggleSearch() {
  createMenuOpen.value = false
  moreMenuOpen.value = false
  if (searchOpen.value || keyword.value || entryFilter.value !== 'all') {
    keyword.value = ''
    entryFilter.value = 'all'
    searchOpen.value = false
    return
  }
  dragMode.value = false
  searchOpen.value = true
}

function openDrawer() {
  createMenuOpen.value = false
  moreMenuOpen.value = false
  drawerOpen.value = true
  loadAppInfo()
  if (drawerSection.value === 'settings' && showPluginSettings.value) loadPluginListenerState()
  loadAndroidAutofillState()
  if (!isDrawerWide.value) drawerDetailOpen.value = false
}

function closeTopMenusOnOutside(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (entryContextMenuOpen.value && !target?.closest('.entry-context-menu')) closeEntryContextMenu()
  if (!createMenuOpen.value && !moreMenuOpen.value) return
  if (!target?.closest('.top-menu-popover, .top-menu-trigger')) {
    createMenuOpen.value = false
    moreMenuOpen.value = false
  }
}

function openPasswordSheet() {
  resetPasswordDraft()
  passwordSheetOpen.value = true
}

function toggleDeviceUnlock(enabled: boolean) {
  if (enabled) {
    if (state.passwordless) return showToast('当前保险库未设置主密码，无需设备快速解锁')
    resetDeviceUnlockDraft()
    deviceUnlockSheetOpen.value = true
    return
  }
  void disableDeviceUnlock()
}

async function enableDeviceUnlock() {
  if (busy.value || !deviceUnlockPassword.value) return showToast('请输入当前主密码')
  const operationId = beginBusyOperation()
  try {
    const result = await api.enableDeviceUnlock(deviceUnlockPassword.value, deviceUnlockReauthSeconds.value)
    if (!result.ok || !result.data) return showFailToast(result.message || '启用设备快速解锁失败')
    deviceUnlockState.value = result.data
    deviceUnlockSheetOpen.value = false
    resetDeviceUnlockDraft()
    showSuccessToast('设备快速解锁已启用')
  } catch {
    showFailToast('启用设备快速解锁失败')
  } finally {
    finishBusyOperation(operationId)
  }
}

async function disableDeviceUnlock() {
  try {
    await showConfirmDialog({
      title: '关闭设备快速解锁',
      message: '关闭后，下次锁定只能使用主密码解锁。',
      confirmButtonText: '关闭'
    })
  } catch {
    return
  }
  const result = await api.disableDeviceUnlock()
  if (!result.ok || !result.data) return showFailToast(result.message || '关闭失败')
  deviceUnlockState.value = result.data
  showSuccessToast('设备快速解锁已关闭')
}

function resetDeviceUnlockDraft() {
  deviceUnlockPassword.value = ''
  deviceUnlockReauthSeconds.value = 7 * 24 * 60 * 60
}

function resetPasswordDraft() {
  changePasswordValue.value = ''
  changePasswordConfirm.value = ''
}

function openPluginDetail() {
  pluginDetailOpen.value = true
  loadPluginListenerState()
}

function openPasswordHealth() {
  passwordHealthOpen.value = true
}

function openPasskeyManager(passkeyId = '') {
  passkeyManagerInitialId.value = passkeyId
  passkeyManagerOpen.value = true
  drawerOpen.value = false
}

async function saveManagedPasskey(
  update: { id: string; label: string; entryId: string },
  successMessage = '通行密钥已更新'
) {
  if (!vault.value || busy.value) return
  const operationId = beginBusyOperation()
  try {
    const payload = cloneVault()
    const validLoginIds = new Set(buildPasskeyLoginOptions(payload.entries).map((option) => option.id))
    const changed = updatePasskeyMetadata(
      payload,
      update.id,
      { label: update.label, entryId: update.entryId },
      Math.floor(Date.now() / 1000),
      validLoginIds
    )
    if (!changed) return showToast('没有需要保存的更改')
    const result = await saveVaultForCurrentSession(payload)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '更新通行密钥失败')
    if (!publishVaultPayload(result.data)) return
    passkeyManagerInitialId.value = update.id
    scheduleAutoCloudUpload()
    showSuccessToast(successMessage)
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '更新通行密钥失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

function unlinkPasskeyFromEntry(passkeyId: string) {
  const item = passkeyPresentationItems.value.find((candidate) => candidate.id === passkeyId)
  if (!item || !item.linkedEntryId) return showToast('关联已变化')
  void saveManagedPasskey({ id: item.id, label: item.userLabel, entryId: '' }, '已解除通行密钥关联')
}

async function deleteManagedPasskey(passkeyId: string) {
  if (!vault.value || busy.value) return
  const item = passkeyPresentationItems.value.find((candidate) => candidate.id === passkeyId)
  if (!item) return showToast('通行密钥不存在')
  try {
    await showConfirmDialog({
      title: '删除通行密钥',
      message: `将删除「${item.displayLabel}」。删除后无法再用它登录 ${item.rpId}。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#dc2626'
    })
  } catch {
    return
  }

  const operationId = beginBusyOperation()
  try {
    const result = await api.deletePasskey(passkeyId)
    if (!result.ok || !result.data) return handleVaultWriteError(result, '删除通行密钥失败')
    if (!publishVaultPayload(result.data)) return
    if (passkeyManagerInitialId.value === passkeyId) passkeyManagerInitialId.value = ''
    scheduleAutoCloudUpload()
    showSuccessToast('通行密钥已删除')
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '删除通行密钥失败，请重试')
  } finally {
    finishBusyOperation(operationId)
  }
}

function openPasskeyLinkedEntry(entryId: string) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || entry.kind !== 'login' || !isActiveEntry(entry)) {
    showFailToast('关联登录项不存在或已失效')
    return
  }
  passkeyManagerOpen.value = false
  showEntryDetail(entry)
}

function openPasswordHealthEntry(entryId: string) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || entry.kind === 'folder' || !isActiveEntry(entry)) {
    showFailToast('条目不存在或已失效')
    return
  }
  passwordHealthOpen.value = false
  drawerOpen.value = false
  showEntryDetail(entry)
}

function handleIgnoreHealthFinding(entryId: string, issue: PasswordHealthIssue, reason: string) {
  const findingExists = passwordHealthReport.value.entries.some((entry) =>
    entry.entryId === entryId && entry.issues.includes(issue)
  )
  if (!findingExists) return showToast('该风险已变化')
  ignoredHealthFindings.value = ignoreHealthFinding(
    entryId,
    issue,
    reason,
    ignoredHealthFindings.value
  )
  showSuccessToast('已在此设备忽略')
}

function handleRestoreHealthFinding(entryId: string, issue: PasswordHealthIssue) {
  ignoredHealthFindings.value = restoreHealthFinding(
    entryId,
    issue,
    ignoredHealthFindings.value
  )
  showSuccessToast('已恢复检查')
}

function handleToggleExpectedTotp(entryId: string, expected: boolean) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || entry.kind !== 'login' || !isActiveEntry(entry)) return
  expectedTotpEntryIds.value = setExpectedTotpEntryId(
    entryId,
    expected,
    expectedTotpEntryIds.value
  )
}

function remediatePasswordHealthFinding(entryId: string, issue: PasswordHealthIssue) {
  const entry = findEntry(vault.value?.entries || [], entryId)
  if (!entry || entry.kind === 'folder' || !isActiveEntry(entry)) {
    showFailToast('条目不存在或已失效')
    return
  }
  if (issue === 'duplicate') {
    void mergePasswordHealthDuplicates(entryId)
    return
  }

  passwordHealthOpen.value = false
  drawerOpen.value = false
  openEdit(entry)
  if (issue === 'missing-totp') {
    showToast('请填写 TOTP 密钥')
    return
  }
  if (['missing', 'weak', 'reused', 'stale'].includes(issue)) {
    void nextTick(() => openCredentialGenerator(true))
  }
}

async function mergePasswordHealthDuplicates(keepEntryId: string) {
  if (!vault.value || busy.value) return
  const keepResult = passwordHealthReport.value.entries.find((entry) => entry.entryId === keepEntryId)
  const group = keepResult?.duplicateGroupId
    ? passwordHealthReport.value.duplicateGroups.find((item) => item.id === keepResult.duplicateGroupId)
    : undefined
  const keepEntry = findEntry(vault.value.entries, keepEntryId)
  const removeIds = (group?.entries || [])
    .map((entry) => entry.entryId)
    .filter((entryId) => {
      const entry = findEntry(vault.value?.entries || [], entryId)
      return entryId !== keepEntryId && Boolean(entry && isActiveEntry(entry))
    })
  if (!keepEntry || removeIds.length === 0) return showToast('重复项已变化')

  try {
    await showConfirmDialog({
      title: '合并精确重复项',
      message: `保留“${keepEntry.title || '未命名条目'}”，并将其余 ${removeIds.length} 项移入回收站？`,
      confirmButtonText: '合并',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }

  const currentKeepResult = passwordHealthReport.value.entries.find((entry) => entry.entryId === keepEntryId)
  const currentGroup = currentKeepResult?.duplicateGroupId
    ? passwordHealthReport.value.duplicateGroups.find((item) => item.id === currentKeepResult.duplicateGroupId)
    : undefined
  const currentRemoveIds = (currentGroup?.entries || [])
    .map((entry) => entry.entryId)
    .filter((entryId) => entryId !== keepEntryId)
  if (
    currentRemoveIds.length !== removeIds.length
    || currentRemoveIds.some((entryId) => !removeIds.includes(entryId))
  ) {
    return showToast('重复项已变化，请重新检查')
  }

  const payload = cloneVault()
  let removedCount = 0
  for (const entryId of currentRemoveIds) {
    if (updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'trashed', '已合并精确重复项'))) {
      removedCount += 1
    }
  }
  if (!removedCount) return showToast('重复项已变化')
  const result = await saveVaultForCurrentSession(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '合并重复项失败')
  if (!publishVaultPayload(result.data)) return
  scheduleAutoCloudUpload()
  showSuccessToast(`已合并 ${removedCount} 个重复项`)
}

function selectDrawerSection(section: typeof drawerSection.value) {
  if (section === 'updates' && !showUpdateSettings.value) return
  drawerSection.value = section
  if (section === 'settings' && showPluginSettings.value) loadPluginListenerState()
  if (!isDrawerWide.value) drawerDetailOpen.value = true
}

function syncDesktopMode() {
  isWide.value = Boolean(desktopMediaQuery?.matches)
  if (isWide.value) detailOpen.value = false
  clampPaneToViewport()
}

function syncDrawerMode() {
  isDrawerWide.value = Boolean(drawerMediaQuery?.matches)
  if (isDrawerWide.value) drawerDetailOpen.value = false
}

function loadPaneWidth() {
  const value = Number(localStorage.getItem(PANE_WIDTH_KEY))
  return Number.isFinite(value) && value > 0 ? value : 450
}

function clampPaneWidth(value: number) {
  return Math.round(Math.min(Math.max(PANE_WIDTH_MIN, value), getPaneWidthMax()))
}

function getPaneWidthMax() {
  const available = workspaceGrid.value?.clientWidth || window.innerWidth
  return Math.max(PANE_WIDTH_MIN, Math.min(PANE_WIDTH_MAX, available - 420))
}

function clampPaneToViewport() {
  if (!isWide.value) return
  paneWidth.value = clampPaneWidth(paneWidth.value)
}

function startPaneResize(event: PointerEvent) {
  if (!isWide.value) return
  event.preventDefault()
  resizingPane = true
  document.body.classList.add('is-resizing-pane')
  window.addEventListener('pointermove', resizePane)
  window.addEventListener('pointerup', stopPaneResize, { once: true })
}

function resizePane(event: PointerEvent) {
  if (!resizingPane) return
  const rect = workspaceGrid.value?.getBoundingClientRect()
  if (!rect) return
  paneWidth.value = clampPaneWidth(event.clientX - rect.left)
}

function resizePaneWithKeyboard(event: KeyboardEvent) {
  if (!isWide.value) return
  let next = paneWidth.value
  if (event.key === 'ArrowLeft') next -= PANE_WIDTH_KEYBOARD_STEP
  else if (event.key === 'ArrowRight') next += PANE_WIDTH_KEYBOARD_STEP
  else if (event.key === 'Home') next = PANE_WIDTH_MIN
  else if (event.key === 'End') next = getPaneWidthMax()
  else return

  event.preventDefault()
  paneWidth.value = clampPaneWidth(next)
  localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth.value))
}

function stopPaneResize() {
  if (!resizingPane) return
  resizingPane = false
  localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth.value))
  document.body.classList.remove('is-resizing-pane')
  window.removeEventListener('pointermove', resizePane)
}
</script>
