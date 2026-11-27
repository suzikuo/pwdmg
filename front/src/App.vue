<template>
  <main class="app-shell" :class="{ 'app-shell--desktop-titlebar': desktopTitleBarWindow }">
    <DesktopTitleBar v-if="desktopTitleBarWindow" :app-window="desktopTitleBarWindow" />
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
      class="app-auth"
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
        :mobile-layout-mode="ui.mobileLayoutMode"
        :mobile-list-style="ui.mobileListStyle"
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
            :mobile-chrome-mode="ui.mobileLayoutMode"
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

        <template #mobile-chrome>
          <nav
            v-if="!ui.isWide && ui.mobileLayoutMode === 'bottom-tabs'"
            class="mobile-bottom-tabs"
            aria-label="移动端底部导航"
          >
            <button
              type="button"
              class="mobile-bottom-tab"
              :class="{ 'is-active': vaultStore.sidebarView === 'all' && !ui.searchOpen && !ui.mobileNavOpen }"
              @click="handleSidebarSelectView('all')"
            >
              <UiIcon name="shield" :size="18" />
              <span>全部</span>
            </button>
            <button
              type="button"
              class="mobile-bottom-tab"
              :class="{ 'is-active': vaultStore.sidebarView === 'favorites' && !ui.searchOpen && !ui.mobileNavOpen }"
              @click="handleSidebarSelectView('favorites')"
            >
              <UiIcon name="star" :size="18" />
              <span>收藏</span>
            </button>
            <button
              type="button"
              class="mobile-bottom-tab is-create"
              aria-label="新建条目"
              @click="vaultStore.openCreate('login')"
            >
              <span class="mobile-bottom-tab__fab">
                <UiIcon name="plus" :size="18" />
              </span>
            </button>
            <button
              type="button"
              class="mobile-bottom-tab"
              :class="{ 'is-active': ui.quickAccessOpen }"
              @click="openMobileQuickSearch"
            >
              <UiIcon name="search" :size="18" />
              <span>搜索</span>
            </button>
            <button
              type="button"
              class="mobile-bottom-tab"
              :class="{ 'is-active': ui.drawerOpen }"
              @click="openDrawer"
            >
              <UiIcon name="settings" :size="18" />
              <span>设置</span>
            </button>
          </nav>

          <template v-else-if="!ui.isWide && ui.mobileLayoutMode === 'floating-dock'">
            <div
              v-if="mobileFloatingBallOpen"
              class="mobile-fab-backdrop"
              aria-hidden="true"
              @click="mobileFloatingBallOpen = false"
            />
            <div
              class="mobile-floating-dock"
              :class="{ 'is-open': mobileFloatingBallOpen, 'is-dragging': mobileFabDragging }"
              :style="mobileFabContainerStyle"
              role="group"
              aria-label="移动端悬浮球菜单"
            >
              <button
                type="button"
                class="mobile-fab-item"
                :style="mobileFabItemStyle('vertical')"
                :tabindex="mobileFloatingBallOpen ? 0 : -1"
                aria-label="新建条目"
                @click="handleMobileFabAction('create')"
              >
                <UiIcon name="plus" :size="16" />
                <span>新建</span>
              </button>
              <button
                type="button"
                class="mobile-fab-item"
                :class="{ 'is-active': ui.quickAccessOpen }"
                :style="mobileFabItemStyle('diagonal')"
                :tabindex="mobileFloatingBallOpen ? 0 : -1"
                aria-label="快速搜索"
                @click="handleMobileFabAction('search')"
              >
                <UiIcon name="search" :size="16" />
                <span>搜索</span>
              </button>
              <button
                type="button"
                class="mobile-fab-item"
                :class="{ 'is-active': ui.drawerOpen }"
                :style="mobileFabItemStyle('horizontal')"
                :tabindex="mobileFloatingBallOpen ? 0 : -1"
                aria-label="打开设置"
                @click="handleMobileFabAction('settings')"
              >
                <UiIcon name="settings" :size="16" />
                <span>设置</span>
              </button>
              <button
                type="button"
                class="mobile-fab-trigger"
                :class="{ 'is-open': mobileFloatingBallOpen }"
                :aria-expanded="mobileFloatingBallOpen"
                :aria-label="mobileFloatingBallOpen ? '收起快捷菜单' : '展开快捷菜单'"
                @pointerdown="startMobileFabDrag"
                @click="handleMobileFabTriggerClick"
              >
                <UiIcon :name="mobileFloatingBallOpen ? 'close' : 'plus'" :size="20" />
              </button>
            </div>
          </template>
        </template>
      </VaultWorkspace>
    </section>

    <Teleport to="body">
      <div
        v-if="!ui.isWide && !ui.mobileNavOpen && mobileSwipeHint.active"
        class="mobile-swipe-indicator"
        :class="{ 'is-ready': mobileSwipeHint.ready }"
        :style="mobileSwipeIndicatorStyle"
        aria-hidden="true"
      >
        <UiIcon name="chevron-right" :size="15" />
        <span>{{ mobileSwipeHint.ready ? '松手打开菜单' : '右滑打开菜单' }}</span>
      </div>

      <Transition name="mobile-nav-fade">
        <div
          v-if="!ui.isWide && ui.mobileNavOpen"
          class="mobile-nav-backdrop"
          @click.self="ui.mobileNavOpen = false"
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
      :show-commands="quickAccessShowCommands"
      @update:open="handleQuickAccessOpenChange"
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
      @postpone="sync.postponeAutoSync($event, { fromReview: true })"
      @item-checked="sync.setCloudSyncItemChecked"
      @detail-checked="sync.setCloudSyncDetailChecked"
      @apply="sync.applyCloudSyncPreview"
    />

    <UiModal
      v-if="showPluginSettings"
      :open="pluginDetailOpen"
      title="浏览器插件监听"
      size="md"
      :stacked="ui.topOverlay === 'pluginDetail'"
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
            autofocus
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
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import AuthScreen from './components/auth/AuthScreen.vue'
import DesktopTitleBar from './components/desktop/DesktopTitleBar.vue'
import DetailContent from './components/DetailContent.vue'
import type { EntryFolderActionPayload } from './components/EntryList.vue'
import QuickAccess from './components/workspace/QuickAccess.vue'
import VaultWorkspace from './components/workspace/VaultWorkspace.vue'
import WorkspaceHeader from './components/workspace/WorkspaceHeader.vue'
import WorkspaceSidebar, { type WorkspaceSidebarFolderAction, type WorkspaceSidebarView } from './components/workspace/WorkspaceSidebar.vue'
import WorkspaceTopNav from './components/workspace/WorkspaceTopNav.vue'
import { UiBadge, UiButton, UiContextMenu, UiFeedbackHost, UiIcon, UiInput, UiModal, type UiContextMenuItem } from './components/ui'
import type { VaultEntry } from './types'
import { useAndroidAutofillSettings } from './composables/useAndroidAutofillSettings'
import { useAndroidPasskeyProviderSettings } from './composables/useAndroidPasskeyProviderSettings'
import { useDesktopTraySettings } from './composables/useDesktopTraySettings'
import { usePluginListenerSettings } from './composables/usePluginListenerSettings'
import { api } from './services/api'
import {
  canStartMobileDrawerSwipe,
  evaluateMobileDrawerSwipeMove
} from './services/mobileDrawerSwipe'
import {
  MOBILE_FAB_DRAG_THRESHOLD_PX,
  MOBILE_FAB_POSITION_KEY,
  clampMobileFabPosition,
  defaultMobileFabPosition,
  parseStoredMobileFabPosition,
  resolveMobileFabFanOffsets,
  type MobileFabPosition
} from './services/mobileFloatingBall'
import { isAndroidRuntime, isDesktopRuntime, readLocalStorage, writeLocalStorage } from './services/runtime'
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
const desktopTitleBarWindow = isDesktopRuntime && window.__mypwdmgDesktopTitleBar
  ? window.__TAURI__?.window?.getCurrentWindow()
  : undefined

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
  if (sync.settings.oss.autoSync && sync.isAutoSyncPostponed) {
    return `自动同步已推迟至 ${sync.autoSyncPostponedUntilLabel}`
  }
  return sync.backupStatus || '云同步就绪'
})

let lastBackRequestAt = 0
const mobileFloatingBallOpen = ref(false)
const mobileFabDragging = ref(false)
const mobileFabViewport = reactive({
  width: typeof window !== 'undefined' ? window.innerWidth : 390,
  height: typeof window !== 'undefined' ? window.innerHeight : 844
})

function desktopTitleBarInset(): number {
  return desktopTitleBarWindow ? 36 : 0
}

function loadInitialMobileFabPosition(): MobileFabPosition {
  const stored = parseStoredMobileFabPosition(readLocalStorage(MOBILE_FAB_POSITION_KEY))
  if (stored) {
    return clampMobileFabPosition(stored, mobileFabViewport.width, mobileFabViewport.height, desktopTitleBarInset())
  }
  return defaultMobileFabPosition(mobileFabViewport.width, mobileFabViewport.height, desktopTitleBarInset())
}

const mobileFabPos = reactive<MobileFabPosition>(loadInitialMobileFabPosition())
let mobileFabDragSession: {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
} | null = null
let suppressNextMobileFabClick = false

const mobileFabContainerStyle = computed(() => ({
  left: `${mobileFabPos.x}px`,
  top: `${mobileFabPos.y}px`
}))

const mobileFabFanOffsets = computed(() =>
  resolveMobileFabFanOffsets(mobileFabPos, mobileFabViewport.width, mobileFabViewport.height, desktopTitleBarInset())
)

function mobileFabItemStyle(slot: 'vertical' | 'diagonal' | 'horizontal'): Record<string, string> {
  if (!mobileFloatingBallOpen.value) {
    return { transform: 'translate3d(0, 0, 0) scale(0.5)' }
  }
  const offset = mobileFabFanOffsets.value[slot]
  return { transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(1)` }
}

function syncMobileFabViewport(): void {
  if (typeof window === 'undefined') return
  mobileFabViewport.width = window.innerWidth
  mobileFabViewport.height = window.innerHeight
  const clamped = clampMobileFabPosition(mobileFabPos, mobileFabViewport.width, mobileFabViewport.height, desktopTitleBarInset())
  mobileFabPos.x = clamped.x
  mobileFabPos.y = clamped.y
}

function startMobileFabDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  mobileFabDragSession = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: mobileFabPos.x,
    originY: mobileFabPos.y,
    moved: false
  }
  window.addEventListener('pointermove', handleMobileFabDragMove)
  window.addEventListener('pointerup', finishMobileFabDrag)
  window.addEventListener('pointercancel', finishMobileFabDrag)
}

function handleMobileFabDragMove(event: PointerEvent): void {
  if (!mobileFabDragSession || event.pointerId !== mobileFabDragSession.pointerId) return
  const dx = event.clientX - mobileFabDragSession.startX
  const dy = event.clientY - mobileFabDragSession.startY
  if (!mobileFabDragSession.moved && Math.hypot(dx, dy) < MOBILE_FAB_DRAG_THRESHOLD_PX) return
  if (!mobileFabDragSession.moved) {
    mobileFabDragSession.moved = true
    mobileFabDragging.value = true
    mobileFloatingBallOpen.value = false
  }
  const next = clampMobileFabPosition(
    { x: mobileFabDragSession.originX + dx, y: mobileFabDragSession.originY + dy },
    mobileFabViewport.width,
    mobileFabViewport.height,
    desktopTitleBarInset()
  )
  mobileFabPos.x = next.x
  mobileFabPos.y = next.y
}

function finishMobileFabDrag(event: PointerEvent): void {
  if (!mobileFabDragSession || event.pointerId !== mobileFabDragSession.pointerId) return
  const moved = mobileFabDragSession.moved
  mobileFabDragSession = null
  mobileFabDragging.value = false
  window.removeEventListener('pointermove', handleMobileFabDragMove)
  window.removeEventListener('pointerup', finishMobileFabDrag)
  window.removeEventListener('pointercancel', finishMobileFabDrag)
  if (moved) {
    suppressNextMobileFabClick = true
    writeLocalStorage(MOBILE_FAB_POSITION_KEY, JSON.stringify({ x: mobileFabPos.x, y: mobileFabPos.y }))
  }
}

function handleMobileFabTriggerClick(): void {
  if (suppressNextMobileFabClick) {
    suppressNextMobileFabClick = false
    return
  }
  mobileFloatingBallOpen.value = !mobileFloatingBallOpen.value
}

const quickAccessShowCommands = ref(true)

watch(() => ui.quickAccessOpen, (open) => {
  if (!open) {
    quickAccessShowCommands.value = true
  }
})

function handleQuickAccessOpenChange(open: boolean): void {
  ui.quickAccessOpen = open
  if (!open) {
    quickAccessShowCommands.value = true
  }
}

function openMobileQuickSearch(): void {
  quickAccessShowCommands.value = false
  vaultStore.openQuickAccess()
  if (!ui.quickAccessOpen) {
    quickAccessShowCommands.value = true
  }
}

function handleMobileFabAction(action: 'create' | 'search' | 'settings'): void {
  mobileFloatingBallOpen.value = false
  if (action === 'create') {
    vaultStore.openCreate('login')
    return
  }
  if (action === 'search') {
    openMobileQuickSearch()
    return
  }
  openDrawer()
}

const mobileSwipeHint = reactive({
  active: false,
  progress: 0,
  ready: false
})

const mobileSwipeIndicatorStyle = computed(() => {
  const offset = Math.round(mobileSwipeHint.progress * 24 - 16)
  const opacity = Math.min(1, Math.max(0.28, mobileSwipeHint.progress))
  return {
    transform: `translate3d(${offset}px, -50%, 0)${mobileSwipeHint.ready ? ' scale(1.03)' : ''}`,
    opacity: String(opacity)
  }
})

let mobileSwipeSession: {
  startX: number
  startY: number
  drawerOpen: boolean
  locked: boolean
} | null = null

function resetMobileSwipeState(): void {
  mobileSwipeSession = null
  mobileSwipeHint.active = false
  mobileSwipeHint.progress = 0
  mobileSwipeHint.ready = false
}

function isHorizontalScrollableAncestor(target: EventTarget | null): boolean {
  let node = target instanceof HTMLElement ? target : null
  while (node && node !== document.body) {
    if (node.matches('input, textarea, select, [contenteditable="true"], [role="slider"], .mobile-floating-dock, .mobile-floating-dock *')) {
      return true
    }
    if (node.scrollWidth > node.clientWidth + 4) {
      const overflowX = window.getComputedStyle(node).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

function handleMobileTouchStart(event: TouchEvent): void {
  if (ui.isWide || !session.unlocked || vaultStore.dragMode) {
    resetMobileSwipeState()
    return
  }
  if (event.touches.length !== 1) {
    resetMobileSwipeState()
    return
  }
  const drawerOpen = ui.mobileNavOpen
  if (!drawerOpen && hasBlockingOverlay()) {
    resetMobileSwipeState()
    return
  }
  const touch = event.touches[0]
  if (!touch || !canStartMobileDrawerSwipe(touch.clientX, drawerOpen)) {
    resetMobileSwipeState()
    return
  }
  if (!drawerOpen && isHorizontalScrollableAncestor(event.target)) {
    resetMobileSwipeState()
    return
  }
  mobileSwipeSession = {
    startX: touch.clientX,
    startY: touch.clientY,
    drawerOpen,
    locked: false
  }
}

function handleMobileTouchMove(event: TouchEvent): void {
  if (!mobileSwipeSession || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return
  const dx = touch.clientX - mobileSwipeSession.startX
  const dy = touch.clientY - mobileSwipeSession.startY
  const evaluation = evaluateMobileDrawerSwipeMove(dx, dy, mobileSwipeSession.drawerOpen)
  if (evaluation.status === 'cancelled') {
    resetMobileSwipeState()
    return
  }
  if (evaluation.status === 'active') {
    mobileSwipeSession.locked = true
    if (!mobileSwipeSession.drawerOpen) {
      mobileSwipeHint.active = true
      mobileSwipeHint.progress = evaluation.progress
      mobileSwipeHint.ready = evaluation.ready
    } else {
      mobileSwipeHint.ready = evaluation.ready
    }
  }
}

function handleMobileTouchEnd(): void {
  if (!mobileSwipeSession) return
  const shouldTrigger = mobileSwipeSession.locked && mobileSwipeHint.ready
  const wasOpen = mobileSwipeSession.drawerOpen
  resetMobileSwipeState()
  if (!shouldTrigger || ui.isWide || !session.unlocked) return
  if (wasOpen) {
    ui.mobileNavOpen = false
  } else if (!hasBlockingOverlay()) {
    ui.mobileNavOpen = true
  }
}

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
  ui.mountUi()
  void api.showDesktopWindow()
  sync.purgeLegacyCloudSyncState()
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('pointerdown', session.handleSessionActivity, true)
  window.addEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.addEventListener('touchstart', handleMobileTouchStart, { passive: true })
  window.addEventListener('touchmove', handleMobileTouchMove, { passive: true })
  window.addEventListener('touchend', handleMobileTouchEnd, { passive: true })
  window.addEventListener('touchcancel', resetMobileSwipeState, { passive: true })
  window.addEventListener('resize', syncMobileFabViewport)
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
})

onUnmounted(() => {
  ui.unmountUi()
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('pointerdown', session.handleSessionActivity, true)
  window.removeEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.removeEventListener('touchstart', handleMobileTouchStart)
  window.removeEventListener('touchmove', handleMobileTouchMove)
  window.removeEventListener('touchend', handleMobileTouchEnd)
  window.removeEventListener('touchcancel', resetMobileSwipeState)
  window.removeEventListener('resize', syncMobileFabViewport)
  window.removeEventListener('pointermove', handleMobileFabDragMove)
  window.removeEventListener('pointerup', finishMobileFabDrag)
  window.removeEventListener('pointercancel', finishMobileFabDrag)
  resetMobileSwipeState()
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

:global(body:has(.app-shell--desktop-titlebar)) {
  --desktop-titlebar-height: 36px;
}

.app-shell--desktop-titlebar > .desktop-title-bar {
  z-index: calc(var(--z-toast) + 1);
}

.app-shell--desktop-titlebar > .app-auth,
.app-shell--desktop-titlebar > .workspace {
  height: calc(100% - var(--desktop-titlebar-height));
}

.app-shell--desktop-titlebar > .app-auth {
  min-height: 0;
  align-items: safe center;
  overflow: auto;
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

.mobile-swipe-indicator {
  position: fixed;
  top: 50%;
  left: 0;
  z-index: calc(var(--z-modal) - 1);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px 8px 10px;
  border-radius: 0 999px 999px 0;
  border: 1px solid var(--border-soft);
  border-left: 0;
  background-color: var(--panel-bg);
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 500;
  box-shadow: var(--shadow-md);
  pointer-events: none;
  transition: background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.mobile-swipe-indicator.is-ready {
  background-color: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
}

.mobile-bottom-tabs {
  position: fixed;
  left: 14px;
  right: 14px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  z-index: calc(var(--z-dropdown) + 10);
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  max-width: 420px;
  margin: 0 auto;
  min-height: 56px;
  padding: 5px 8px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 45%, transparent);
  background-color: color-mix(in srgb, var(--panel-bg) 68%, transparent);
  backdrop-filter: blur(18px) saturate(160%);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}

.mobile-bottom-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  padding: 4px 2px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.mobile-bottom-tab.is-active {
  color: var(--brand);
  background-color: color-mix(in srgb, var(--brand) 14%, transparent);
}

.mobile-bottom-tab__fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 36px;
  border-radius: var(--radius-full);
  background-color: color-mix(in srgb, var(--brand) 82%, transparent);
  color: var(--on-brand);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 30%, transparent);
}

.mobile-fab-backdrop {
  position: fixed;
  inset: var(--desktop-titlebar-height, 0px) 0 0;
  z-index: calc(var(--z-dropdown) + 9);
  background: transparent;
}

.mobile-floating-dock {
  position: fixed;
  z-index: calc(var(--z-dropdown) + 10);
  width: 50px;
  height: 50px;
  touch-action: none;
}

.mobile-fab-trigger {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border: 1px solid color-mix(in srgb, var(--on-brand) 28%, transparent);
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--brand) 78%, transparent);
  backdrop-filter: blur(14px) saturate(150%);
  color: var(--on-brand);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
  cursor: grab;
  touch-action: none;
  transition: transform var(--duration-normal) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.mobile-floating-dock.is-dragging .mobile-fab-trigger {
  cursor: grabbing;
  transform: scale(1.06);
}

.mobile-fab-trigger.is-open {
  transform: rotate(90deg);
}

.mobile-fab-item {
  position: absolute;
  left: 2px;
  top: 2px;
  z-index: 1;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--border-strong) 50%, transparent);
  background-color: color-mix(in srgb, var(--panel-bg) 74%, transparent);
  backdrop-filter: blur(16px) saturate(160%);
  color: var(--text-main);
  font-size: 10px;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: transform var(--duration-normal) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.mobile-fab-item.is-active {
  background-color: color-mix(in srgb, var(--brand) 22%, var(--panel-bg));
  border-color: var(--brand);
  color: var(--brand);
}

.mobile-floating-dock.is-open .mobile-fab-item {
  opacity: 1;
  pointer-events: auto;
}

.mobile-nav-backdrop {
  position: fixed;
  inset: var(--desktop-titlebar-height, 0px) 0 0;
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
