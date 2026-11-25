<template>
  <main class="app-shell">
    <div
      v-if="ui.wallpaperImageUrl"
      class="app-wallpaper-layer"
      aria-hidden="true"
    >
      <div
        class="app-wallpaper-layer__img"
        :style="{ backgroundImage: `url(${ui.wallpaperImageUrl})` }"
      />
      <div class="app-wallpaper-layer__scrim" />
    </div>

    <AuthScreen
      v-if="!session.unlocked"
      :state-loading="session.stateLoading"
      :state-error="session.stateError"
      :has-vault="session.state.hasVault"
      :busy="session.busy"
      :password="session.password"
      :new-password="session.newPassword"
      :confirm-password="session.confirmPassword"
      :device-unlock-enabled="session.deviceUnlockState.enabled"
      @retry="session.loadState"
      @unlock="session.unlockVault"
      @create="session.createVault"
      @quick-unlock="session.unlockWithDevice"
      @update:password="session.password = $event"
      @update:new-password="session.newPassword = $event"
      @update:confirm-password="session.confirmPassword = $event"
    />

    <section v-else class="workspace">
      <VaultWorkspace
        :is-desktop="ui.isWide"
        :editor-open="ui.editorOpen"
        :layout-mode="ui.activeLayout.mode"
        :list-style="ui.activeLayout.listStyle"
        :density="ui.activeLayout.density"
        :sidebar-view="vaultStore.sidebarView"
        :active-folder-id="vaultStore.activeFolderId"
        :active-folder-title="vaultStore.activeFolder?.title || ''"
        :entries="vaultStore.filteredEntries"
        :selected-entry="vaultStore.selectedEntry"
        :auto-expand="Boolean(vaultStore.keyword.trim()) || vaultStore.entryFilter !== 'all'"
        :draggable-enabled="vaultStore.dragMode && !vaultStore.keyword.trim() && vaultStore.entryFilter === 'all' && vaultStore.sidebarView === 'all'"
        :favorite-ids="vaultStore.favoriteEntryIds"
        :selection-mode="vaultStore.batchSelectionMode"
        :selected-ids="vaultStore.batchSelectedEntryIds"
        :expanded-ids="vaultStore.expandedFolderIds"
        :grid-style="ui.desktopGridStyle"
        :pane-width="ui.paneWidth"
        :pane-width-min="ui.PANE_WIDTH_MIN"
        :pane-width-max="ui.paneWidthMax"
        :show-password="vaultStore.showPassword"
        :password-mask="vaultStore.passwordMask"
        :totp-code="vaultStore.totpCode"
        :totp-remaining="vaultStore.totpRemaining"
        :totp-progress="vaultStore.totpProgress"
        :linked-passkeys="vaultStore.selectedEntryPasskeys"
        :attachment-busy="vaultStore.attachmentBusy"
        :attachment-actions-supported="true"
        @view="vaultStore.openView"
        @edit="vaultStore.openEdit"
        @move="vaultStore.openMoveSheet"
        @duplicate="vaultStore.duplicateEntry"
        @delete="vaultStore.deleteEntry"
        @create="vaultStore.openCreate('login', $event)"
        @create-login="vaultStore.openCreate('login')"
        @open-quick-access="vaultStore.openQuickAccess"
        @reset-view="vaultStore.selectSidebarView('all')"
        @purge-all-trashed="vaultStore.purgeAllTrashedEntries"
        @close-detail="vaultStore.clearSelectedEntry()"
        @move-entry="vaultStore.moveEntry"
        @context-menu="handleEntryContextMenu"
        @toggle-favorite="vaultStore.toggleEntryFavorite"
        @toggle-selection="vaultStore.toggleBatchEntrySelection"
        @toggle-expand="vaultStore.toggleFolderExpanded"
        @folder-action="handleEntryFolderAction"
        @disable="vaultStore.disableEntry"
        @restore="vaultStore.restoreEntry"
        @purge="vaultStore.purgeEntry"
        @restore-history="vaultStore.restoreEntryHistory"
        @clear-history="vaultStore.clearEntryHistory"
        @copy="vaultStore.copyText"
        @copy-password="vaultStore.copyEntryPassword"
        @open-website="vaultStore.openQuickAccessWebsite"
        @toggle-password="vaultStore.showPassword = !vaultStore.showPassword"
        @refresh-totp="vaultStore.refreshTotp()"
        @open-passkey="vaultStore.openPasskeyManager"
        @unlink-passkey="vaultStore.unlinkPasskeyFromEntry"
        @add-attachment="vaultStore.addEntryAttachment"
        @save-attachment="vaultStore.saveEntryAttachment"
        @remove-attachment="vaultStore.removeEntryAttachment"
        @resize-keyboard="ui.resizePaneWithKeyboard"
        @resize-pointer="ui.startPaneResize"
      >
        <template #topnav>
          <WorkspaceTopNav
            :active-view="vaultStore.sidebarView"
            :active-folder-id="vaultStore.activeFolderId"
            :active-folder-title="vaultStore.activeFolder?.title || ''"
            :folders="vaultStore.sidebarFolders"
            :counts="vaultStore.sidebarCounts"
            :cloud-status-text="sidebarCloudStatusText"
            :cloud-syncing="sync.cloudBusy"
            @select-view="handleSidebarSelectView"
            @select-folder="handleSidebarSelectFolder"
            @create-folder="vaultStore.openCreate('folder', $event)"
            @open-health="vaultStore.openPasswordHealth"
            @open-passkeys="vaultStore.openPasskeyManager()"
            @open-generator="vaultStore.openCredentialGenerator(false)"
            @open-import="ui.importOpen = true"
            @open-quick-access="vaultStore.openQuickAccess"
            @trigger-sync="handleSidebarSync"
            @open-settings="openDrawer"
            @lock="handleQuickLock"
          />
        </template>

        <template #sidebar>
          <WorkspaceSidebar
            :active-view="vaultStore.sidebarView"
            :active-folder-id="vaultStore.activeFolderId"
            :folders="vaultStore.sidebarFolders"
            :counts="vaultStore.sidebarCounts"
            :expanded-ids="vaultStore.expandedFolderIds"
            :cloud-status-text="sidebarCloudStatusText"
            :cloud-syncing="sync.cloudBusy"
            :collapsed="ui.sidebarCollapsed"
            @select-view="handleSidebarSelectView"
            @select-folder="handleSidebarSelectFolder"
            @create-folder="vaultStore.openCreate('folder', $event)"
            @folder-action="handleSidebarFolderAction"
            @toggle-expand="vaultStore.toggleFolderExpanded"
            @open-health="vaultStore.openPasswordHealth"
            @open-passkeys="vaultStore.openPasskeyManager()"
            @open-generator="vaultStore.openCredentialGenerator(false)"
            @open-import="ui.importOpen = true"
            @open-quick-access="vaultStore.openQuickAccess"
            @trigger-sync="handleSidebarSync"
            @open-settings="openDrawer"
            @lock="handleQuickLock"
            @toggle-collapse="ui.toggleSidebarCollapsed"
          />
        </template>

        <template #header>
          <WorkspaceHeader
            ref="headerRef"
            :is-desktop="ui.isWide"
            :show-sidebar-toggle="!ui.isWide"
            :search-open="ui.searchOpen"
            :keyword="vaultStore.keyword"
            :entry-filter="vaultStore.entryFilter"
            :drag-mode="vaultStore.dragMode"
            :selection-mode="vaultStore.batchSelectionMode"
            :selection-count="vaultStore.batchSelectedEntryIds.size"
            :all-visible-selected="vaultStore.allVisibleBatchEntriesSelected"
            :all-selected-favorite="vaultStore.allBatchEntriesFavorited"
            :more-menu-open="ui.moreMenuOpen"
            :more-actions="vaultStore.moreActions"
            @create-entry="vaultStore.openCreate('login')"
            @open-drawer="ui.mobileNavOpen = true"
            @open-quick-access="vaultStore.openQuickAccess"
            @toggle-search="vaultStore.toggleSearch"
            @update:keyword="vaultStore.keyword = $event"
            @update:entry-filter="vaultStore.entryFilter = $event"
            @update:more-menu-open="ui.moreMenuOpen = $event"
            @select-more="vaultStore.handleMoreAction"
            @close-more-menu="ui.moreMenuOpen = false"
            @exit-drag="vaultStore.toggleDragMode"
            @exit-selection="vaultStore.exitBatchSelection"
            @toggle-select-all="vaultStore.toggleAllVisibleBatchEntries"
            @batch-move="vaultStore.openBatchMoveSheet"
            @batch-favorite="vaultStore.applyBatchFavorite"
            @batch-archive="vaultStore.archiveSelectedEntries"
            @batch-trash="vaultStore.trashSelectedEntries"
          />
        </template>

        <template #editor>
          <EntryEditor
            v-if="ui.editorOpen && ui.isWide"
            :open="ui.editorOpen"
            :inline="true"
            :form="vaultStore.form"
            :domain-text="vaultStore.domainText"
            :editing-id="vaultStore.editingId"
            :busy="session.busy"
            :totp-code="vaultStore.totpCode"
            :autofill-match-mode-options="vaultStore.autofillMatchModeOptions"
            :login-account-source-options="vaultStore.loginAccountSourceOptions"
            :show-qr-image-picker="isDesktopRuntime || isAndroidRuntime"
            :qr-image-busy="vaultStore.qrImageBusy"
            @update:open="vaultStore.handleEditorOpenChange"
            @switch-kind="vaultStore.switchEditorKind"
            @update-field="vaultStore.updateEditorField"
            @update-domain="vaultStore.domainText = $event"
            @submit="vaultStore.saveEntry"
            @focus-field="scrollFocusedEditorFieldIntoView"
            @refresh-totp="vaultStore.refreshTotp()"
            @import-totp-qr-image="vaultStore.importTotpQrImage"
            @open-generator="vaultStore.openCredentialGenerator(true)"
            @update-custom-fields="vaultStore.form.customFields = $event"
          />
        </template>
      </VaultWorkspace>
    </section>

    <Teleport to="body">
      <Transition name="mobile-nav-fade">
        <div
          v-if="!ui.isWide && ui.mobileNavOpen"
          class="mobile-nav-backdrop"
          @mousedown.self="ui.mobileNavOpen = false"
        >
          <div class="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="保险库导航菜单">
            <WorkspaceSidebar
              :active-view="vaultStore.sidebarView"
              :active-folder-id="vaultStore.activeFolderId"
              :folders="vaultStore.sidebarFolders"
              :counts="vaultStore.sidebarCounts"
              :expanded-ids="vaultStore.expandedFolderIds"
              :cloud-status-text="sidebarCloudStatusText"
              :cloud-syncing="sync.cloudBusy"
              :collapsed="false"
              @select-view="handleMobileSidebarSelectView"
              @select-folder="handleMobileSidebarSelectFolder"
              @create-folder="handleMobileCreateFolder"
              @folder-action="handleMobileSidebarFolderAction"
              @toggle-expand="vaultStore.toggleFolderExpanded"
              @open-health="handleMobileOpenHealth"
              @open-passkeys="handleMobileOpenPasskeys"
              @open-generator="handleMobileOpenGenerator"
              @open-import="handleMobileOpenImport"
              @open-quick-access="handleMobileOpenQuickAccess"
              @trigger-sync="handleMobileSidebarSync"
              @open-settings="handleMobileOpenSettings"
              @lock="handleMobileLock"
              @toggle-collapse="ui.mobileNavOpen = false"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <UiModal
      :open="ui.detailOpen && !ui.isWide"
      :title="vaultStore.selectedEntry?.title || '条目详情'"
      size="lg"
      @close="ui.detailOpen = false"
    >
      <DetailContent
        v-if="vaultStore.selectedEntry"
        :entry="vaultStore.selectedEntry"
        :show-password="vaultStore.showPassword"
        :password-mask="vaultStore.passwordMask"
        :totp-code="vaultStore.totpCode"
        :totp-remaining="vaultStore.totpRemaining"
        :totp-progress="vaultStore.totpProgress"
        :linked-passkeys="vaultStore.selectedEntryPasskeys"
        :attachment-busy="vaultStore.attachmentBusy"
        :attachment-actions-supported="true"
        @edit="vaultStore.openEdit"
        @move="vaultStore.openMoveSheet"
        @duplicate="vaultStore.duplicateEntry"
        @delete="vaultStore.deleteEntry"
        @disable="vaultStore.disableEntry"
        @restore="vaultStore.restoreEntry"
        @purge="vaultStore.purgeEntry"
        @restore-history="vaultStore.restoreEntryHistory"
        @clear-history="vaultStore.clearEntryHistory"
        @copy="vaultStore.copyText"
        @open-website="vaultStore.openQuickAccessWebsite"
        @toggle-password="vaultStore.showPassword = !vaultStore.showPassword"
        @refresh-totp="vaultStore.refreshTotp()"
        @open-passkey="vaultStore.openPasskeyManager"
        @unlink-passkey="vaultStore.unlinkPasskeyFromEntry"
        @add-attachment="vaultStore.addEntryAttachment"
        @save-attachment="vaultStore.saveEntryAttachment"
        @remove-attachment="vaultStore.removeEntryAttachment"
      />
    </UiModal>

    <MoveDestinationModal
      v-if="ui.moveSheetOpen || ui.batchMoveSheetOpen"
      :open="ui.moveSheetOpen || ui.batchMoveSheetOpen"
      :title="ui.batchMoveSheetOpen ? '批量移动到' : '移动到'"
      :subtitle="vaultStore.moveModalSubtitle"
      :entries="vaultStore.vault?.entries || []"
      :moving-entry-ids="vaultStore.moveModalMovingEntryIds"
      @update:open="vaultStore.handleMoveModalOpenChange"
      @confirm="vaultStore.handleMoveModalConfirm"
    />

    <QuickAccess
      :open="ui.quickAccessOpen"
      :entries="vaultStore.vault?.entries || []"
      :search-index="vaultSearchIndex"
      :favorite-ids="vaultStore.favoriteEntryIds"
      :recent-ids="vaultStore.recentEntryIds"
      @update:open="ui.quickAccessOpen = $event"
      @open-entry="vaultStore.openQuickAccessEntry"
      @copy="vaultStore.copyText"
      @copy-password="vaultStore.copyEntryPassword"
      @copy-totp="vaultStore.copyQuickAccessTotp"
      @open-website="vaultStore.openQuickAccessWebsite"
      @run-command="handlePaletteCommand"
    />

    <UiContextMenu
      :open="ui.entryContextMenuOpen"
      :x="ui.contextMenuState.x"
      :y="ui.contextMenuState.y"
      :header="ui.contextMenuState.header"
      :items="ui.contextMenuState.items"
      @select="ui.handleContextMenuSelect"
      @close="ui.closeContextMenu()"
    />

    <EntryEditor
      v-if="ui.editorOpen && !ui.isWide"
      :open="ui.editorOpen"
      :inline="false"
      :form="vaultStore.form"
      :domain-text="vaultStore.domainText"
      :editing-id="vaultStore.editingId"
      :busy="session.busy"
      :totp-code="vaultStore.totpCode"
      :autofill-match-mode-options="vaultStore.autofillMatchModeOptions"
      :login-account-source-options="vaultStore.loginAccountSourceOptions"
      :show-qr-image-picker="isDesktopRuntime || isAndroidRuntime"
      :qr-image-busy="vaultStore.qrImageBusy"
      @update:open="vaultStore.handleEditorOpenChange"
      @switch-kind="vaultStore.switchEditorKind"
      @update-field="vaultStore.updateEditorField"
      @update-domain="vaultStore.domainText = $event"
      @submit="vaultStore.saveEntry"
      @focus-field="scrollFocusedEditorFieldIntoView"
      @refresh-totp="vaultStore.refreshTotp()"
      @import-totp-qr-image="vaultStore.importTotpQrImage"
      @open-generator="vaultStore.openCredentialGenerator(true)"
      @update-custom-fields="vaultStore.form.customFields = $event"
    />

    <CredentialGenerator
      v-if="generatorOpen"
      :open="generatorOpen"
      :allow-apply="vaultStore.generatorApplyToPassword"
      :reset-key="vaultStore.generatorResetKey"
      @update:open="generatorOpen = $event"
      @copy="vaultStore.copyGeneratedCredential"
      @apply="vaultStore.applyGeneratedCredential"
    />

    <ImportWizard
      v-if="ui.importOpen"
      :open="ui.importOpen"
      :entries="vaultStore.vault?.entries || []"
      :busy="session.busy"
      :reset-key="vaultStore.importResetKey"
      @update:open="ui.importOpen = $event"
      @import="vaultStore.importVaultRecords"
    />

    <SettingsDrawer
      v-if="drawerOpen"
      :open="drawerOpen"
      @update:open="drawerOpen = $event"
    />

    <UiModal
      :open="ui.passwordSheetOpen"
      title="修改主密码"
      size="sm"
      @close="ui.passwordSheetOpen = false"
      @closed="session.resetPasswordDraft"
    >
      <form id="master-password-form" class="modal-form" @submit.prevent="session.changeMasterPassword">
        <p class="modal-note">新主密码可以留空。留空后打开保险库时可直接进入，适合你确认安全的单机环境。</p>
        <UiInput
          v-model="session.changePasswordValue"
          type="password"
          label="新密码"
          autocomplete="new-password"
          placeholder="可留空"
        />
        <UiInput
          v-model="session.changePasswordConfirm"
          type="password"
          label="确认新密码"
          autocomplete="new-password"
          placeholder="再次输入，可留空"
        />
      </form>
      <template #footer>
        <UiButton variant="secondary" size="sm" :disabled="session.busy" @click="ui.passwordSheetOpen = false">
          取消
        </UiButton>
        <UiButton variant="primary" size="sm" type="submit" form="master-password-form" :loading="session.busy">
          保存修改
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="ui.deviceUnlockSheetOpen"
      title="启用设备快速解锁"
      size="sm"
      @close="ui.deviceUnlockSheetOpen = false"
      @closed="session.resetDeviceUnlockDraft"
    >
      <form id="device-unlock-form" class="modal-form" @submit.prevent="session.enableDeviceUnlock">
        <p class="modal-note">使用当前设备系统安全层加密缓存密钥。主密码不保存明文，在所选期限内可在本机快速免密解锁。</p>
        <UiInput
          v-model="session.deviceUnlockPassword"
          type="password"
          label="当前主密码"
          autocomplete="current-password"
          placeholder="请输入当前主密码"
        />
        <label class="device-unlock-interval-field">
          <span>有效周期</span>
          <select v-model.number="session.deviceUnlockReauthSeconds" aria-label="设备快速解锁有效周期">
            <option :value="86400">1 天</option>
            <option :value="604800">7 天</option>
            <option :value="2592000">30 天</option>
            <option :value="7776000">90 天</option>
            <option :value="15552000">180 天</option>
            <option :value="31536000">365 天（1 年）</option>
            <option :value="315360000">10 年（长期免密）</option>
          </select>
        </label>
      </form>
      <template #footer>
        <UiButton variant="secondary" size="sm" :disabled="session.busy" @click="ui.deviceUnlockSheetOpen = false">
          取消
        </UiButton>
        <UiButton variant="primary" size="sm" type="submit" form="device-unlock-form" :loading="session.busy">
          启用
        </UiButton>
      </template>
    </UiModal>

    <CloudPasswordPrompt
      v-if="ui.cloudPasswordPromptOpen"
      :open="ui.cloudPasswordPromptOpen"
      :password="sync.cloudPasswordPromptValue"
      :busy="sync.cloudPasswordPromptBusy"
      :note="sync.cloudPasswordPromptBusy ? '正在使用云端主密码校验保险库，请稍候…' : undefined"
      @update:open="ui.cloudPasswordPromptOpen = $event"
      @update:password="sync.cloudPasswordPromptValue = $event"
      @submit="sync.submitCloudPasswordPrompt"
      @cancel="sync.cancelCloudPasswordPrompt"
      @closed="sync.handleCloudPasswordPromptClosed"
    />

    <CloudPasswordPrompt
      :open="ui.portableBackupPasswordOpen"
      :password="sync.portableBackupPassword"
      :busy="sync.portableBackupBusy"
      title="恢复完整备份"
      :note="sync.portableBackupPasswordNote"
      label="备份密码"
      placeholder="备份未设置主密码可留空"
      @update:open="ui.portableBackupPasswordOpen = $event"
      @update:password="sync.portableBackupPassword = $event"
      @submit="sync.submitPortableBackupImport"
      @cancel="sync.cancelPortableBackupImport"
      @closed="sync.handlePortableBackupPromptClosed"
    />

    <CloudSyncReview
      v-if="ui.cloudSyncReviewOpen"
      :open="ui.cloudSyncReviewOpen"
      :preview="sync.cloudSyncPreview"
      :title="sync.cloudSyncReviewTitle"
      :diff-counts="sync.cloudSyncDiffCounts"
      :selected-count="sync.cloudSyncSelectedCount"
      :action-text="sync.cloudSyncReviewActionText"
      :busy="sync.cloudBusy"
      :is-item-checked="sync.isCloudSyncItemChecked"
      :change-label="sync.cloudSyncChangeLabel"
      :item-summary="sync.cloudSyncItemSummary"
      @update:open="if (!$event) sync.hideCloudSyncReview(); else ui.cloudSyncReviewOpen = true"
      @close="sync.hideCloudSyncReview"
      @select-all="sync.setAllCloudSyncDiffs"
      @discard="sync.discardCloudSyncReview"
      @item-checked="sync.setCloudSyncItemChecked"
      @detail-checked="sync.setCloudSyncDetailChecked"
      @apply="sync.applyCloudSyncPreview"
    />

    <UiModal
      v-if="showPluginSettings"
      :open="pluginDetailOpen"
      title="浏览器插件监听"
      size="md"
      @close="pluginDetailOpen = false"
    >
      <div class="plugin-detail-body">
        <div class="plugin-setting-card">
          <div class="plugin-setting-head">
            <span>当前状态</span>
            <UiBadge :tone="pluginListener?.enabled ? 'success' : 'neutral'" size="sm">
              {{ pluginListenerStatus }}
            </UiBadge>
          </div>
          <div v-if="pluginListener" class="plugin-status-grid">
            <span>Chrome</span>
            <strong>{{ pluginListener.enabled && pluginListener.chromeRegistered ? '已注册' : '未注册' }}</strong>
            <span>Edge</span>
            <strong>{{ pluginListener.enabled && pluginListener.edgeRegistered ? '已注册' : '未注册' }}</strong>
            <span>Host</span>
            <strong>{{ pluginListener.mode === 'packaged' ? (pluginListener.hostExecutableExists ? '已找到' : '缺少程序') : '开发模式' }}</strong>
          </div>
          <p class="modal-note">开启后浏览器会按需启动后台 Host；关闭后已有连接也会停止返回填充数据。</p>
        </div>

        <div class="plugin-setting-card">
          <UiInput
            v-model="pluginExtensionId"
            label="插件 ID"
            autocomplete="off"
            placeholder="扩展管理页里的 32 位 ID"
            monospace
          />
          <div class="plugin-actions">
            <UiButton variant="primary" size="sm" :disabled="pluginListener?.enabled" :loading="pluginBusy" @click="enablePluginListener">
              开启
            </UiButton>
            <UiButton variant="secondary" size="sm" :disabled="!pluginListener?.enabled" :loading="pluginBusy" @click="disablePluginListener">
              关闭
            </UiButton>
            <UiButton variant="ghost" size="sm" :loading="pluginBusy" @click="loadPluginListenerState">
              刷新
            </UiButton>
          </div>
        </div>

        <p v-if="pluginListener?.manifestPath" class="modal-note modal-note--mono">
          Manifest：{{ pluginListener.manifestPath }}
        </p>
      </div>
    </UiModal>

    <PasswordHealthCenter
      v-if="ui.passwordHealthOpen"
      :open="ui.passwordHealthOpen"
      :report="vaultStore.passwordHealthReport"
      :expected-totp-ids="vaultStore.expectedTotpEntryIds"
      :ignored-findings="vaultStore.ignoredHealthFindings"
      @update:open="ui.passwordHealthOpen = $event"
      @open-entry="vaultStore.openPasswordHealthEntry"
      @remediate="vaultStore.remediatePasswordHealthFinding"
      @ignore-finding="vaultStore.handleIgnoreHealthFinding"
      @restore-finding="vaultStore.handleRestoreHealthFinding"
      @toggle-totp-expected="vaultStore.handleToggleExpectedTotp"
    />

    <PasskeyManager
      v-if="passkeyManagerOpen"
      :open="passkeyManagerOpen"
      :items="vaultStore.passkeyPresentationItems"
      :login-options="vaultStore.passkeyLoginOptions"
      :busy="session.busy"
      :initial-id="vaultStore.passkeyManagerInitialId"
      @update:open="passkeyManagerOpen = $event"
      @save="vaultStore.saveManagedPasskey"
      @delete="vaultStore.deleteManagedPasskey"
      @open-entry="vaultStore.openPasskeyLinkedEntry"
    />

    <Transition name="snackbar-fade">
      <div v-if="vaultStore.trashUndoState" class="trash-undo-snackbar" role="alert">
        <span>已将「{{ vaultStore.trashUndoState.title }}」移入回收站</span>
        <button type="button" class="trash-undo-btn" @click="vaultStore.handleUndoTrash">撤销</button>
      </div>
    </Transition>

    <UiFeedbackHost />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref } from 'vue'
import AuthScreen from './components/auth/AuthScreen.vue'
import DetailContent from './components/DetailContent.vue'
import type { EntryFolderActionPayload } from './components/EntryList.vue'
import QuickAccess from './components/workspace/QuickAccess.vue'
import VaultWorkspace from './components/workspace/VaultWorkspace.vue'
import WorkspaceHeader from './components/workspace/WorkspaceHeader.vue'
import WorkspaceSidebar, { type WorkspaceSidebarFolderAction, type WorkspaceSidebarView } from './components/workspace/WorkspaceSidebar.vue'
import WorkspaceTopNav from './components/workspace/WorkspaceTopNav.vue'
import { UiBadge, UiButton, UiContextMenu, UiFeedbackHost, UiInput, UiModal, type UiContextMenuItem } from './components/ui'
import type { VaultEntry } from './types'
import { useAndroidAutofillSettings } from './composables/useAndroidAutofillSettings'
import { useAndroidPasskeyProviderSettings } from './composables/useAndroidPasskeyProviderSettings'
import { useDesktopTraySettings } from './composables/useDesktopTraySettings'
import { usePluginListenerSettings } from './composables/usePluginListenerSettings'
import { api } from './services/api'
import { isAndroidRuntime, isDesktopRuntime } from './services/runtime'
import { activeConfirm, clearAllFeedback, showToast, uiFeedback } from './services/uiFeedback'
import { createAppStores, provideAppStores } from './stores'

const EntryEditor = defineAsyncComponent(() => import('./components/editor/EntryEditor.vue'))
const CredentialGenerator = defineAsyncComponent(() => import('./components/tools/CredentialGenerator.vue'))
const ImportWizard = defineAsyncComponent(() => import('./components/tools/ImportWizard.vue'))
const PasskeyManager = defineAsyncComponent(() => import('./components/tools/PasskeyManager.vue'))
const PasswordHealthCenter = defineAsyncComponent(() => import('./components/tools/PasswordHealthCenter.vue'))
const CloudPasswordPrompt = defineAsyncComponent(() => import('./components/sync/CloudPasswordPrompt.vue'))
const CloudSyncReview = defineAsyncComponent(() => import('./components/sync/CloudSyncReview.vue'))
const MoveDestinationModal = defineAsyncComponent(() => import('./components/workspace/MoveDestinationModal.vue'))
const SettingsDrawer = defineAsyncComponent(() => import('./components/settings/SettingsDrawer.vue'))

const BACK_EXIT_INTERVAL = 1600

const androidAutofillSettings = useAndroidAutofillSettings()
const androidPasskeyProviderSettings = useAndroidPasskeyProviderSettings()
const pluginListenerSettings = usePluginListenerSettings(isDesktopRuntime)
const desktopTraySettingsComposable = useDesktopTraySettings(isDesktopRuntime)

const {
  state: pluginListener,
  busy: pluginBusy,
  extensionId: pluginExtensionId,
  detailOpen: pluginDetailOpen,
  showSettings: showPluginSettings,
  status: pluginListenerStatus,
  load: loadPluginListenerState,
  enable: enablePluginListener,
  disable: disablePluginListener,
  reset: resetPluginListenerSettings
} = pluginListenerSettings

const stores = createAppStores({
  feedback: uiFeedback,
  isPluginBusy: () => pluginBusy.value,
  pluginDetailOpen,
  resetPluginListenerSettings,
  platform: {
    desktopTray: desktopTraySettingsComposable,
    androidAutofill: androidAutofillSettings,
    androidPasskeyProvider: androidPasskeyProviderSettings,
    pluginListener: pluginListenerSettings
  }
})
provideAppStores(stores)

// Reactive wrappers unwrap nested refs seamlessly in template bindings
const ui = reactive(stores.ui)
const session = reactive(stores.session)
const vaultStore = reactive(stores.vault)
const sync = reactive(stores.sync)

// Top-level refs for shallowRef preservation and lazy-surface readability
const headerRef = ref<{ focusSearch: () => Promise<void> | void } | null>(null)
const vaultSearchIndex = stores.vault.vaultSearchIndex
const passkeyManagerOpen = stores.ui.passkeyManagerOpen
const generatorOpen = stores.ui.generatorOpen
const drawerOpen = stores.ui.drawerOpen

const sidebarCloudStatusText = computed(() => {
  if (sync.cloudBusy) return '正在同步…'
  if (!sync.hasCompleteOssSettings()) return '配置云同步'
  return sync.backupStatus || '云同步就绪'
})

let lastBackRequestAt = 0

function hasBlockingOverlay(): boolean {
  if (activeConfirm.value) return true
  return ui.topOverlay !== null
}

function handleQuickLock() {
  clearAllFeedback()
  void session.lockVault()
}

function handleSidebarSelectView(view: WorkspaceSidebarView) {
  vaultStore.selectSidebarView(view)
}

function handleSidebarSelectFolder(folderId: string) {
  vaultStore.selectSidebarFolder(folderId)
}

function handleSidebarFolderAction(payload: WorkspaceSidebarFolderAction) {
  if (payload.action === 'add-child') {
    vaultStore.openCreate('login', payload.folder.id)
    return
  }
  if (payload.action === 'edit') {
    vaultStore.openEdit(payload.folder)
    return
  }
  if (payload.action === 'move') {
    vaultStore.openMoveSheet(payload.folder.id)
    return
  }
  if (payload.action === 'delete') {
    void vaultStore.deleteEntry(payload.folder.id)
  }
}

function handleEntryFolderAction(payload: EntryFolderActionPayload) {
  if (payload.action === 'create-child') {
    vaultStore.openCreate('login', payload.entry.id)
    return
  }
  if (payload.action === 'edit') {
    vaultStore.openEdit(payload.entry)
    return
  }
  if (payload.action === 'move') {
    vaultStore.openMoveSheet(payload.entry.id)
    return
  }
  if (payload.action === 'delete') {
    void vaultStore.deleteEntry(payload.entry.id)
  }
}

function handleSidebarSync() {
  if (!sync.hasCompleteOssSettings()) {
    ui.drawerSection = 'sync'
    openDrawer()
    return
  }
  void sync.uploadCloudBackup()
}

function handleMobileSidebarSelectView(view: WorkspaceSidebarView) {
  ui.mobileNavOpen = false
  handleSidebarSelectView(view)
}

function handleMobileSidebarSelectFolder(folderId: string) {
  ui.mobileNavOpen = false
  handleSidebarSelectFolder(folderId)
}

function handleMobileCreateFolder(parentId: string) {
  ui.mobileNavOpen = false
  vaultStore.openCreate('folder', parentId)
}

function handleMobileSidebarFolderAction(payload: WorkspaceSidebarFolderAction) {
  ui.mobileNavOpen = false
  handleSidebarFolderAction(payload)
}

function handleMobileOpenHealth() {
  ui.mobileNavOpen = false
  vaultStore.openPasswordHealth()
}

function handleMobileOpenPasskeys() {
  ui.mobileNavOpen = false
  vaultStore.openPasskeyManager()
}

function handleMobileOpenGenerator() {
  ui.mobileNavOpen = false
  vaultStore.openCredentialGenerator(false)
}

function handleMobileOpenImport() {
  ui.mobileNavOpen = false
  ui.importOpen = true
}

function handleMobileOpenQuickAccess() {
  ui.mobileNavOpen = false
  vaultStore.openQuickAccess()
}

function handleMobileSidebarSync() {
  ui.mobileNavOpen = false
  handleSidebarSync()
}

function handleMobileOpenSettings() {
  ui.mobileNavOpen = false
  openDrawer()
}

function handleMobileLock() {
  ui.mobileNavOpen = false
  handleQuickLock()
}

function handlePaletteCommand(commandKey: string) {
  if (commandKey === 'create-login') {
    vaultStore.openCreate('login')
    return
  }
  if (commandKey === 'generator') {
    vaultStore.openCredentialGenerator(false)
    return
  }
  if (commandKey === 'sync') {
    handleSidebarSync()
    return
  }
  if (commandKey === 'health') {
    vaultStore.openPasswordHealth()
    return
  }
  if (commandKey === 'import') {
    ui.importOpen = true
    return
  }
  if (commandKey === 'lock') {
    handleQuickLock()
  }
}

function toggleQuickAccessPalette() {
  if (!session.unlocked) return
  if (ui.quickAccessOpen) {
    ui.quickAccessOpen = false
  } else {
    vaultStore.openQuickAccess()
  }
}

function handleNativeBack() {
  if (stores.closeTopLayer()) return true
  const now = Date.now()
  if (now - lastBackRequestAt < BACK_EXIT_INTERVAL) {
    void session.safeExit()
    return true
  }
  lastBackRequestAt = now
  showToast('再按一次退出')
  return true
}

function handleGlobalKeydown(event: KeyboardEvent) {
  session.handleSessionActivity(event)
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()

  if ((mod && !event.shiftKey && !event.altKey && key === 'k') || (event.ctrlKey && event.shiftKey && event.code === 'Space')) {
    if (session.unlocked) {
      event.preventDefault()
      event.stopPropagation()
      toggleQuickAccessPalette()
    }
    return
  }

  if (mod && !event.shiftKey && !event.altKey && key === 'f') {
    if (session.unlocked && !hasBlockingOverlay()) {
      event.preventDefault()
      event.stopPropagation()
      void headerRef.value?.focusSearch()
    }
    return
  }

  if (mod && !event.shiftKey && !event.altKey && key === 'n') {
    if (session.unlocked && !hasBlockingOverlay()) {
      event.preventDefault()
      event.stopPropagation()
      vaultStore.openCreate('login')
    }
    return
  }

  if (mod && !event.shiftKey && !event.altKey && key === 's') {
    if (session.unlocked && ui.editorOpen) {
      event.preventDefault()
      event.stopPropagation()
      void vaultStore.saveEntry()
    }
    return
  }

  if (mod && !event.shiftKey && !event.altKey && key === 'l') {
    if (session.unlocked) {
      event.preventDefault()
      event.stopPropagation()
      handleQuickLock()
    }
    return
  }

  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (activeConfirm.value) return
  if (!stores.closeTopLayer()) return
  event.preventDefault()
  event.stopPropagation()
}

function closeTopMenusOnOutside(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (ui.entryContextMenuOpen && !target?.closest('.ui-context-menu')) ui.closeContextMenu()
  if (ui.moreMenuOpen && !target?.closest('.ui-dropdown')) {
    ui.moreMenuOpen = false
  }
}

function handleEntryContextMenu(payload: { entry: VaultEntry; x: number; y: number }) {
  if (vaultStore.dragMode) return
  const entry = payload.entry
  const items: UiContextMenuItem[] = []

  if (entry.status === 'trashed') {
    items.push(
      { key: 'restore', label: '恢复条目', icon: 'restore' },
      { key: 'purge', label: '彻底删除', icon: 'trash', danger: true, divider: true }
    )
  } else if (entry.kind === 'folder') {
    items.push(
      { key: 'create-login', label: '新建登录', icon: 'plus' },
      { key: 'create-folder', label: '新建子分组', icon: 'folder' },
      { key: 'edit', label: '重命名分组', icon: 'edit', divider: true },
      { key: 'move', label: '移动到…', icon: 'move' },
      { key: 'duplicate', label: '创建副本', icon: 'duplicate' },
      { key: 'archive', label: '归档分组', icon: 'archive', danger: true, divider: true },
      { key: 'trash', label: '移入回收站', icon: 'trash', danger: true }
    )
  } else {
    const account = entry.username || entry.email || entry.phone || ''
    const isFav = vaultStore.favoriteEntryIds.has(entry.id)
    items.push(
      { key: 'view', label: '查看详情', icon: 'eye' },
      { key: 'edit', label: '编辑条目', icon: 'edit' }
    )
    if (entry.kind === 'login') {
      let hasCopyDivider = true
      if (account) {
        items.push({ key: 'copy-account', label: '复制账号', icon: 'copy', divider: hasCopyDivider })
        hasCopyDivider = false
      }
      if (entry.password) {
        items.push({ key: 'copy-password', label: '复制密码', icon: 'key', divider: hasCopyDivider })
        hasCopyDivider = false
      }
      if (entry.totpSecret) {
        items.push({ key: 'copy-totp', label: '复制验证码 (TOTP)', icon: 'shield', divider: hasCopyDivider })
        hasCopyDivider = false
      }
      if (entry.domains?.[0]) {
        items.push({ key: 'open-website', label: '打开网站', icon: 'external-link', divider: hasCopyDivider })
      }
    }
    items.push(
      { key: 'toggle-favorite', label: isFav ? '取消收藏' : '收藏', icon: isFav ? 'star-filled' : 'star', divider: true },
      { key: 'move', label: '移动到…', icon: 'move' },
      { key: 'duplicate', label: '创建副本', icon: 'duplicate' },
      { key: 'archive', label: '归档条目', icon: 'archive', danger: true, divider: true },
      { key: 'trash', label: '移入回收站', icon: 'trash', danger: true }
    )
  }

  ui.openContextMenu({
    x: payload.x,
    y: payload.y,
    header: entry.title || (entry.kind === 'folder' ? '分组操作' : '条目操作'),
    items,
    onSelect: (item) => {
      if (item.key === 'view') return vaultStore.openView(entry)
      if (item.key === 'edit') return vaultStore.openEdit(entry)
      if (item.key === 'create-login') return vaultStore.openCreate('login', entry.id)
      if (item.key === 'create-folder') return vaultStore.openCreate('folder', entry.id)
      if (item.key === 'copy-account') {
        const account = entry.username || entry.email || entry.phone || ''
        if (account) void vaultStore.copyText(account)
        return
      }
      if (item.key === 'copy-password') { void vaultStore.copyEntryPassword(entry.id); return }
      if (item.key === 'copy-totp') { void vaultStore.copyQuickAccessTotp(entry); return }
      if (item.key === 'open-website') {
        if (entry.domains?.[0]) void vaultStore.openQuickAccessWebsite(entry.domains[0])
        return
      }
      if (item.key === 'toggle-favorite') { vaultStore.toggleEntryFavorite(entry.id); return }
      if (item.key === 'move') return vaultStore.openMoveSheet(entry.id)
      if (item.key === 'duplicate') { void vaultStore.duplicateEntry(entry.id); return }
      if (item.key === 'archive') { void vaultStore.disableEntry(entry.id); return }
      if (item.key === 'trash') { void vaultStore.deleteEntry(entry.id); return }
      if (item.key === 'restore') { void vaultStore.restoreEntry(entry.id); return }
      if (item.key === 'purge') { void vaultStore.purgeEntry(entry.id); return }
    }
  })
}

function resolveEditableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const editable = target.closest('input, textarea, [contenteditable="true"]') as HTMLElement | null
  if (!editable) return null
  if (editable instanceof HTMLInputElement) {
    const type = (editable.type || 'text').toLowerCase()
    const nonTextTypes = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'hidden'])
    if (nonTextTypes.has(type) || editable.disabled) return null
    return editable
  }
  if (editable instanceof HTMLTextAreaElement) {
    return editable.disabled ? null : editable
  }
  return editable.isContentEditable ? editable : null
}

function getEditableSelectedText(el: HTMLInputElement | HTMLTextAreaElement | HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    return start !== end ? el.value.slice(start, end) : ''
  }
  return window.getSelection()?.toString() || ''
}

function replaceEditableRange(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  el.value = next
  const caret = start + text.length
  el.setSelectionRange?.(caret, caret)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function handleEditableContextAction(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  actionKey: string
): Promise<void> {
  el.focus()
  if (actionKey === 'select-all') {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select()
    } else {
      document.execCommand?.('selectAll')
    }
    return
  }

  if (actionKey === 'copy') {
    const selected = getEditableSelectedText(el)
    if (!selected) return
    try {
      await navigator.clipboard?.writeText(selected)
    } catch {
      document.execCommand?.('copy')
    }
    return
  }

  if (actionKey === 'cut') {
    const selected = getEditableSelectedText(el)
    if (!selected) return
    try {
      await navigator.clipboard?.writeText(selected)
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (!el.readOnly) replaceEditableRange(el, '')
      } else {
        document.execCommand?.('cut')
      }
    } catch {
      document.execCommand?.('cut')
    }
    return
  }

  if (actionKey === 'paste') {
    try {
      const clipText = await navigator.clipboard?.readText()
      if (typeof clipText === 'string') {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (!el.readOnly) replaceEditableRange(el, clipText)
        } else {
          document.execCommand?.('insertText', false, clipText)
        }
        return
      }
    } catch {
      // Fallback below
    }
    document.execCommand?.('paste')
  }
}

function buildWorkspaceContextItems(): UiContextMenuItem[] {
  return [
    { key: 'create-login', label: '新建登录条目', icon: 'plus', shortcut: 'Ctrl+N' },
    { key: 'create-folder', label: '新建分组', icon: 'folder' },
    { key: 'quick-access', label: '命令面板', icon: 'command', shortcut: 'Ctrl+K' },
    { key: 'generator', label: '密码生成器', icon: 'wand', divider: true },
    { key: 'health', label: '密码健康检查', icon: 'shield' },
    { key: 'sync', label: '立即云同步', icon: 'cloud' },
    { key: 'settings', label: '切换皮肤 / 设置', icon: 'settings' },
    { key: 'lock', label: '锁定保险库', icon: 'lock', shortcut: 'Ctrl+L', danger: true, divider: true }
  ]
}

function runWorkspaceContextAction(actionKey: string): void {
  if (actionKey === 'create-login') { vaultStore.openCreate('login'); return }
  if (actionKey === 'create-folder') { vaultStore.openCreate('folder', ''); return }
  if (actionKey === 'quick-access') { vaultStore.openQuickAccess(); return }
  if (actionKey === 'generator') { vaultStore.openCredentialGenerator(false); return }
  if (actionKey === 'health') { vaultStore.openPasswordHealth(); return }
  if (actionKey === 'sync') { handleSidebarSync(); return }
  if (actionKey === 'settings') {
    ui.drawerSection = 'appearance'
    openDrawer()
    return
  }
  if (actionKey === 'lock') handleQuickLock()
}

function handleGlobalContextMenu(event: MouseEvent): void {
  if (!isDesktopRuntime && !ui.isWide) return
  event.preventDefault()

  const editable = resolveEditableTarget(event.target)
  if (editable) {
    const isReadOnly = (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) && editable.readOnly
    const hasSelection = getEditableSelectedText(editable).length > 0
    const hasContent = editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
      ? editable.value.length > 0
      : Boolean(editable.textContent?.length)
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { key: 'cut', label: '剪切', icon: 'edit', shortcut: 'Ctrl+X', disabled: isReadOnly || !hasSelection },
        { key: 'copy', label: '复制', icon: 'copy', shortcut: 'Ctrl+C', disabled: !hasSelection },
        { key: 'paste', label: '粘贴', icon: 'duplicate', shortcut: 'Ctrl+V', disabled: isReadOnly },
        { key: 'select-all', label: '全选', icon: 'check-square', shortcut: 'Ctrl+A', disabled: !hasContent, divider: true }
      ],
      onSelect: (item) => {
        void handleEditableContextAction(editable, item.key)
      }
    })
    return
  }

  const selectedText = window.getSelection()?.toString().trim() || ''
  if (selectedText) {
    const items: UiContextMenuItem[] = [
      { key: 'copy-selection', label: '复制选中文本', icon: 'copy', shortcut: 'Ctrl+C' }
    ]
    if (session.unlocked) {
      items.push(
        { key: 'create-login', label: '新建登录条目', icon: 'plus', shortcut: 'Ctrl+N', divider: true },
        { key: 'quick-access', label: '命令面板', icon: 'command', shortcut: 'Ctrl+K' },
        { key: 'settings', label: '切换皮肤 / 设置', icon: 'settings' }
      )
    }
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items,
      onSelect: (item) => {
        if (item.key === 'copy-selection') {
          void vaultStore.copyText(selectedText)
          return
        }
        runWorkspaceContextAction(item.key)
      }
    })
    return
  }

  if (session.unlocked) {
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildWorkspaceContextItems(),
      onSelect: (item) => runWorkspaceContextAction(item.key)
    })
    return
  }

  ui.openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { key: 'refresh-state', label: '刷新状态', icon: 'refresh' },
      {
        key: 'toggle-theme',
        label: ui.theme === 'dark' ? '切换浅色主题' : '切换深色主题',
        icon: ui.theme === 'dark' ? 'sun' : 'moon',
        divider: true
      }
    ],
    onSelect: (item) => {
      if (item.key === 'refresh-state') { void session.loadState(); return }
      if (item.key === 'toggle-theme') ui.toggleTheme()
    }
  })
}

function scrollFocusedEditorFieldIntoView(event: FocusEvent) {
  if (!ui.editorOpen) return
  const target = event.target as HTMLElement | null
  const element = (target?.closest?.('.editor-row, .autofill-rule-field, .account-source-field') as HTMLElement | null) || target
  const scroller = element?.closest('.editor-inline-body, .ui-modal__body, .editor-form') as HTMLElement | null
  if (!element || !scroller) return
  window.setTimeout(() => {
    if (document.activeElement !== target && !element.contains(document.activeElement)) return
    const scrollerRect = scroller.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top < scrollerRect.top + 24 || elementRect.bottom > scrollerRect.bottom - 48) {
      const usableHeight = Math.max(120, scroller.clientHeight)
      const centeredTop = scroller.scrollTop + elementRect.top - scrollerRect.top - Math.max(0, (usableHeight - elementRect.height) / 2)
      scroller.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' })
    }
  }, 160)
}

function openDrawer() {
  ui.moreMenuOpen = false
  drawerOpen.value = true
  void session.loadAppInfo()
  void desktopTraySettingsComposable.load()
  if (showPluginSettings.value) void loadPluginListenerState()
  void androidAutofillSettings.load()
  void androidPasskeyProviderSettings.load()
  void vaultStore.loadAttachmentStorageState()
}

onMounted(() => {
  sync.purgeLegacyCloudSyncState()
  ui.mountUi()
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('pointerdown', session.handleSessionActivity, true)
  window.addEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.addEventListener('scroll', ui.closeContextMenu, true)
  window.addEventListener('resize', ui.closeContextMenu)
  document.addEventListener('contextmenu', handleGlobalContextMenu)
  window.addEventListener('focus', androidAutofillSettings.load)
  window.addEventListener('focus', androidPasskeyProviderSettings.load)
  window.addEventListener('focus', session.resetAndroidInstallBusy)
  window.addEventListener('focus', session.scheduleExternalVaultRefresh)
  window.addEventListener('focus', sync.scheduleAutoCloudDownloadCheck)
  window.addEventListener('mypwdmg:quick-access', vaultStore.openQuickAccess)
  window.addEventListener('mypwdmg:lock-request', session.handleDesktopLockRequest)
  document.addEventListener('visibilitychange', session.handleVisibilityChange)
  window.__mypwdmgHandleNativeBack = handleNativeBack
  window.__mypwdmgHandleNativeLock = () => {
    clearAllFeedback()
    session.applyLockedUiState()
    return true
  }
  window.__mypwdmgHandleNativeAutofillIntent = () => {
    void vaultStore.loadAndroidAutofillLaunchContext()
    return true
  }
  session.mountNativeLockSubscription()
  void session.loadAppInfo()
  void desktopTraySettingsComposable.load()
  void vaultStore.loadAndroidAutofillLaunchContext()
  void session.loadState()
  void androidAutofillSettings.load()
  void androidPasskeyProviderSettings.load()
  window.setTimeout(() => {
    void api.showDesktopWindow()
  }, 250)
})

onUnmounted(() => {
  ui.unmountUi()
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('pointerdown', session.handleSessionActivity, true)
  window.removeEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.removeEventListener('scroll', ui.closeContextMenu, true)
  window.removeEventListener('resize', ui.closeContextMenu)
  document.removeEventListener('contextmenu', handleGlobalContextMenu)
  window.removeEventListener('focus', androidAutofillSettings.load)
  window.removeEventListener('focus', androidPasskeyProviderSettings.load)
  window.removeEventListener('focus', session.resetAndroidInstallBusy)
  window.removeEventListener('focus', session.scheduleExternalVaultRefresh)
  window.removeEventListener('focus', sync.scheduleAutoCloudDownloadCheck)
  window.removeEventListener('mypwdmg:quick-access', vaultStore.openQuickAccess)
  window.removeEventListener('mypwdmg:lock-request', session.handleDesktopLockRequest)
  document.removeEventListener('visibilitychange', session.handleVisibilityChange)
  sync.clearAutoSyncTimers()
  session.unmountNativeLockSubscription()
  vaultStore.stopTotpTimer()
  delete window.__mypwdmgHandleNativeBack
  delete window.__mypwdmgHandleNativeLock
  delete window.__mypwdmgHandleNativeAutofillIntent
})
</script>

<style scoped>
.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--app-bg);
  color: var(--text-main);
  overflow: hidden;
}

.app-shell > :not(.app-wallpaper-layer) {
  position: relative;
  z-index: 1;
}

.app-wallpaper-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.app-wallpaper-layer__img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(var(--wallpaper-blur, 0px));
  transform: scale(1.06);
  will-change: transform, filter;
}

.app-wallpaper-layer__scrim {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, var(--wallpaper-dim, 0.24));
}

:global(:root[data-theme='dark']) .app-wallpaper-layer__scrim {
  background: rgba(0, 0, 0, var(--wallpaper-dim, 0.24));
}

.workspace {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mobile-nav-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(2px);
}

.mobile-nav-drawer {
  width: min(280px, 84vw);
  height: 100%;
  background-color: var(--sidebar-bg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.mobile-nav-fade-enter-active,
.mobile-nav-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
}

.mobile-nav-fade-enter-active .mobile-nav-drawer,
.mobile-nav-fade-leave-active .mobile-nav-drawer {
  transition: transform var(--duration-normal) var(--ease-standard);
}

.mobile-nav-fade-enter-from,
.mobile-nav-fade-leave-to {
  opacity: 0;
}

.mobile-nav-fade-enter-from .mobile-nav-drawer,
.mobile-nav-fade-leave-to .mobile-nav-drawer {
  transform: translateX(-100%);
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-note {
  margin: 0;
  font-size: var(--app-font-xs);
  line-height: 1.5;
  color: var(--text-secondary);
}

.modal-note--mono {
  font-family: var(--font-mono);
  word-break: break-all;
}

.device-unlock-interval-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
}

.device-unlock-interval-field select {
  height: var(--control-height-md);
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  color: var(--text-main);
}

.plugin-detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plugin-setting-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.plugin-setting-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--app-font-sm);
  color: var(--text-secondary);
}

.plugin-status-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  font-size: var(--app-font-sm);
}

.plugin-status-grid span {
  color: var(--text-secondary);
}

.plugin-status-grid strong {
  color: var(--text-main);
  font-weight: 600;
}

.plugin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trash-undo-snackbar {
  position: fixed;
  left: 50%;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-elevated);
  color: var(--text-main);
  font-size: var(--app-font-sm);
  box-shadow: var(--shadow-lg);
}

.trash-undo-btn {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background-color: var(--brand-soft);
  color: var(--brand);
  font-size: var(--app-font-sm);
  font-weight: 600;
  cursor: pointer;
}

.trash-undo-btn:hover {
  background-color: var(--brand);
  color: var(--text-on-brand);
}

.snackbar-fade-enter-active,
.snackbar-fade-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.snackbar-fade-enter-from,
.snackbar-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
