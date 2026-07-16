<template>
  <main class="app-shell">
    <section v-if="!unlocked" class="auth-screen">
      <div v-if="!stateLoading && !state.hasVault" class="brand-panel">
        <div class="brand-mark">PM</div>
        <h1>My Password</h1>
      </div>

      <div v-if="stateLoading" class="auth-card auth-status">
        <van-loading size="24" vertical>正在连接本地保险库</van-loading>
      </div>

      <div v-else-if="stateError" class="auth-card auth-status">
        <p>{{ stateError }}</p>
        <van-button block type="primary" plain @click="loadState">重试</van-button>
      </div>

      <van-form v-else-if="state.hasVault" class="auth-card auth-card-compact" @submit="unlockVault">
        <van-field v-model="password" type="password" name="password" autocomplete="current-password" placeholder="输入主密码，未设置可留空" />
        <van-button block type="primary" native-type="submit" :loading="busy">解锁</van-button>
      </van-form>

      <van-form v-else class="auth-card" @submit="createVault">
        <van-field v-model="newPassword" type="password" label="主密码" autocomplete="new-password" placeholder="可留空" />
        <van-field v-model="confirmPassword" type="password" label="确认" autocomplete="new-password" placeholder="再次输入，可留空" />
        <van-cell center title="迁移旧数据" label="从旧 localStorage_data.json 导入">
          <template #right-icon>
            <van-switch v-model="importLegacy" size="22" />
          </template>
        </van-cell>
        <van-button block type="primary" native-type="submit" :loading="busy">创建保险库</van-button>
      </van-form>
    </section>

    <section v-else class="workspace">
      <header class="app-topbar">
        <button class="top-icon" type="button" aria-label="打开菜单" @click="openDrawer">
          <van-icon name="wap-nav" />
        </button>
        <div class="top-spacer"></div>
        <div class="top-actions">
          <button class="top-icon" type="button" :aria-label="searchOpen || keyword ? '关闭搜索' : '搜索'" @click="toggleSearch">
            <van-icon :name="searchOpen || keyword ? 'cross' : 'search'" />
          </button>
          <van-popover
            v-model:show="createMenuOpen"
            class="top-menu-popover top-create-popover"
            placement="bottom-end"
            :actions="createMenuActions"
            close-on-click-action
            close-on-click-outside
            @select="handleTopCreateAction"
          >
            <template #reference>
              <button class="top-icon top-menu-trigger" type="button" aria-label="新建" @click="moreMenuOpen = false">
                <span class="plus-glyph">+</span>
              </button>
            </template>
          </van-popover>
          <van-popover
            v-model:show="moreMenuOpen"
            class="top-menu-popover top-more-popover"
            placement="bottom-end"
            :actions="moreActions"
            close-on-click-action
            close-on-click-outside
            @select="handleMoreAction"
          >
            <template #reference>
              <button class="top-icon top-menu-trigger" type="button" aria-label="更多" @click="createMenuOpen = false">
                <van-icon name="ellipsis" />
              </button>
            </template>
          </van-popover>
        </div>
      </header>

      <div v-if="searchOpen || keyword" class="search-strip">
        <van-search ref="searchInput" v-model="keyword" shape="round" placeholder="搜索标题、账号、域名" />
      </div>
      <div v-if="dragMode" class="drag-mode-strip">
        <van-icon name="sort" />
        <span>拖拽模式：长按条目后移动</span>
        <button type="button" @click="toggleDragMode">退出</button>
      </div>

      <div ref="workspaceGrid" class="workspace-grid" :style="desktopGridStyle">
        <section class="vault-pane">
          <div class="summary-strip">
            <div>
              <span>登录</span>
              <strong>{{ stats.logins }}</strong>
            </div>
            <div>
              <span>分组</span>
              <strong>{{ stats.folders }}</strong>
            </div>
            <div>
              <span>TOTP</span>
              <strong>{{ stats.totp }}</strong>
            </div>
            <div>
              <span>归档</span>
              <strong>{{ stats.archived }}</strong>
            </div>
          </div>

          <EntryList
            :entries="filteredEntries"
            :selected-id="selectedEntry?.id || ''"
            :auto-expand="Boolean(keyword.trim())"
            :draggable-enabled="dragMode && !keyword.trim()"
            :depth="0"
            @view="openView"
            @edit="openEdit"
            @delete="deleteEntry"
            @create="openCreateSheet"
            @move-entry="moveEntry"
            @context-menu="openEntryContextMenu"
          />
        </section>

        <div class="pane-resizer" role="separator" aria-label="调整列表宽度" @pointerdown="startPaneResize"></div>

        <aside class="desktop-preview">
          <template v-if="selectedEntry">
            <DetailContent
              :entry="selectedEntry"
              :show-password="showPassword"
              :password-mask="passwordMask"
              :totp-code="totpCode"
              :totp-remaining="totpRemaining"
              :totp-progress="totpProgress"
              @edit="openEdit"
              @delete="deleteEntry"
              @disable="disableEntry"
              @restore="restoreEntry"
              @purge="purgeEntry"
              @copy="copyText"
              @toggle-password="showPassword = !showPassword"
              @refresh-totp="refreshTotp()"
            />
          </template>
          <van-empty v-else image="search" description="选择一个登录条目查看详情" />
        </aside>
      </div>
    </section>

    <van-popup v-model:show="detailOpen" position="bottom" round class="detail-sheet" :duration="0.12" lazy-render>
      <div class="sheet-inner" v-if="selectedEntry">
        <DetailContent
          :entry="selectedEntry"
          :show-password="showPassword"
          :password-mask="passwordMask"
          :totp-code="totpCode"
          :totp-remaining="totpRemaining"
          :totp-progress="totpProgress"
          @edit="openEdit"
          @delete="deleteEntry"
          @disable="disableEntry"
          @restore="restoreEntry"
          @purge="purgeEntry"
          @copy="copyText"
          @toggle-password="showPassword = !showPassword"
          @refresh-totp="refreshTotp()"
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

    <van-popup v-model:show="editorOpen" position="bottom" class="editor-popup" :duration="0.12" lazy-render>
      <div class="sheet-inner" @focusin="scrollFocusedEditorFieldIntoView">
        <van-nav-bar safe-area-inset-top :title="editingId ? '编辑条目' : '新建条目'" left-arrow @click-left="editorOpen = false" />
        <van-form id="entry-editor-form" class="editor-form" @submit="saveEntry">
          <van-field class="editor-field editor-field-single" v-model="form.title" label="名称" placeholder="例如 Github" :rules="[{ required: true }]" />
          <van-field class="editor-field editor-field-area" v-if="form.kind === 'login'" v-model="domainText" label="域名" type="textarea" placeholder="github.com，多行或逗号分隔" />
          <template v-if="form.kind === 'login'">
            <van-field class="editor-field editor-field-single" v-model="form.username" label="账号" autocomplete="username" placeholder="用户名/账号名" />
            <van-field class="editor-field editor-field-single" v-model="form.email" label="邮箱" type="email" autocomplete="email" placeholder="邮箱地址" />
            <van-field class="editor-field editor-field-single" v-model="form.password" label="密码" type="password" autocomplete="current-password" placeholder="密码" />
            <van-field class="editor-field editor-field-single" v-model="form.phone" label="手机" autocomplete="tel" placeholder="手机号" />
            <div class="account-source-field">
              <span>自动填充账号</span>
              <van-radio-group v-model="form.loginAccountSource" class="account-source-options" direction="horizontal">
                <van-radio v-for="option in loginAccountSourceOptions" :key="option.value" :name="option.value">
                  {{ option.label }}
                </van-radio>
              </van-radio-group>
            </div>
            <van-field class="editor-field editor-field-single" v-model="form.totpSecret" label="TOTP" placeholder="Base32 密钥" />
            <van-field class="editor-field editor-field-area" v-model="form.note" label="备注" type="textarea" placeholder="安全问题、登录提示等" />
            <div v-if="editingId && form.totpSecret" class="totp-box">
              <span>{{ totpCode || '------' }}</span>
              <button class="inline-icon-button" type="button" aria-label="刷新验证码" @click.prevent="refreshTotp()">
                <van-icon name="replay" />
              </button>
            </div>
          </template>
        </van-form>
        <div class="editor-submit-bar">
          <van-button block type="primary" native-type="submit" form="entry-editor-form" :loading="busy">保存</van-button>
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="drawerOpen" position="left" class="nav-drawer" :duration="0.16" lazy-render>
      <aside class="drawer-shell" :class="{ 'is-detail': drawerDetailOpen }">
        <div class="drawer-head drawer-menu-part">
          <div class="brand-mark drawer-mark">PM</div>
          <div>
            <strong>My Password</strong>
            <span>v{{ displayAppVersion }} · {{ stats.logins }} 登录 · {{ stats.folders }} 分组</span>
          </div>
        </div>

        <nav class="drawer-nav drawer-menu-part">
          <button type="button" :class="{ active: drawerSection === 'settings' }" @click="selectDrawerSection('settings')">
            <van-icon name="setting-o" />
            <span>设置</span>
          </button>
          <button type="button" :class="{ active: drawerSection === 'updates' }" @click="selectDrawerSection('updates')">
            <van-icon name="replay" />
            <span>更新</span>
          </button>
          <button type="button" :class="{ active: drawerSection === 'backup' }" @click="selectDrawerSection('backup')">
            <van-icon name="description-o" />
            <span>备份</span>
          </button>
          <button type="button" :class="{ active: drawerSection === 'system' }" @click="selectDrawerSection('system')">
            <van-icon name="cluster-o" />
            <span>系统分组</span>
          </button>
        </nav>

        <div class="drawer-detail-head">
          <button class="inline-icon-button" type="button" aria-label="返回" @click="drawerDetailOpen = false">
            <van-icon name="arrow-left" />
          </button>
          <strong>{{ drawerSectionTitle }}</strong>
        </div>

        <section v-if="drawerSection === 'settings'" class="drawer-panel settings-panel">
          <div class="settings-group">
            <div class="settings-group-title">外观</div>
            <van-cell center title="深色模式" label="适合夜间或 OLED 屏">
            <template #right-icon>
              <van-switch :model-value="theme === 'dark'" size="22" @update:model-value="setTheme($event ? 'dark' : 'light')" />
            </template>
            </van-cell>
            <div class="scale-setting">
              <div class="scale-setting-head">
                <span>界面缩放</span>
                <strong>{{ uiScalePercent }}%</strong>
              </div>
              <van-slider
                class="compact-slider"
                :model-value="uiScalePercent"
                :min="1"
                :max="100"
                :step="1"
                button-size="14px"
                @update:model-value="setUiScaleDraft"
                @change="commitUiScale"
              />
            </div>
            <div class="scale-setting">
              <div class="scale-setting-head">
                <span>字体大小</span>
                <strong>{{ fontSizePercent }}%</strong>
              </div>
              <van-slider
                class="compact-slider"
                :model-value="fontSizePercent"
                :min="80"
                :max="130"
                :step="1"
                button-size="14px"
                @update:model-value="setFontSizeDraft"
                @change="commitFontSize"
              />
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-title">安全</div>
            <van-cell center is-link title="主密码" label="修改或清空主密码" @click="openPasswordSheet">
              <template #value>
                <span class="settings-entry-value">修改</span>
              </template>
            </van-cell>
          </div>

          <div v-if="showAndroidAutofillSettings" class="settings-group">
            <div class="settings-group-title">Android 自动填充</div>
            <van-cell center is-link title="自动填充服务" label="系统会打开授权确认页" @click="openAndroidAutofillSettings">
              <template #value>
                <strong :class="['plugin-status-pill', androidAutofill?.enabled ? 'is-on' : 'is-off']">{{ androidAutofillStatus }}</strong>
              </template>
            </van-cell>
          </div>

          <div v-if="showPluginSettings" class="settings-group">
            <div class="settings-group-title">浏览器插件</div>
            <van-cell center is-link title="插件监听" label="Chrome / Edge 自动填充" @click="openPluginDetail">
              <template #value>
                <strong :class="['plugin-status-pill', pluginListener?.enabled ? 'is-on' : 'is-off']">{{ pluginListenerStatus }}</strong>
              </template>
            </van-cell>
          </div>
        </section>
        <section v-else-if="drawerSection === 'updates'" class="drawer-panel update-panel">
          <div class="settings-group">
            <div class="settings-group-title">应用更新</div>
            <p class="settings-note compact-note">使用 GitHub Release 的 manifest 检查版本。下载包必须通过 SHA256 校验后才能安装。</p>
            <van-field
              v-model="updateManifestUrl"
              label="Manifest"
              type="textarea"
              autosize
              :placeholder="DEFAULT_UPDATE_MANIFEST_URL"
            />
            <div class="update-actions">
              <van-button size="small" type="primary" icon="replay" :loading="updateBusy === 'check'" @click="checkAppUpdate">检查</van-button>
              <van-button
                size="small"
                plain
                type="primary"
                icon="down"
                :disabled="!updateInfo?.updateAvailable"
                :loading="updateBusy === 'download'"
                @click="downloadAppUpdate"
              >
                下载
              </van-button>
              <van-button
                size="small"
                plain
                type="danger"
                icon="upgrade"
                :disabled="!downloadedUpdatePath || !updateInfo?.canApply"
                :loading="updateBusy === 'apply'"
                @click="applyAppUpdate"
              >
                {{ updateInstallButtonText }}
              </van-button>
            </div>
            <div v-if="updateInfo" class="update-summary">
              <div>
                <span>当前版本</span>
                <strong>{{ updateInfo.currentVersion }}</strong>
              </div>
              <div>
                <span>最新版本</span>
                <strong>{{ updateInfo.latestVersion }}</strong>
              </div>
              <div>
                <span>安装方式</span>
                <strong>{{ updateInstallModeText }}</strong>
              </div>
            </div>
            <div v-if="updateBusy && updateProgress" class="update-progress">
              <div class="update-progress-head">
                <span>{{ updateProgressLabel }}</span>
                <strong v-if="updateProgressPercent > 0">{{ updateProgressPercent }}%</strong>
              </div>
              <div class="update-progress-track">
                <span :style="{ width: `${updateProgressPercent || 12}%` }"></span>
              </div>
            </div>
            <p v-if="downloadedUpdatePath" class="settings-note compact-note">已下载：{{ downloadedUpdatePath }}</p>
            <p v-if="updateStatus" class="settings-note compact-note">{{ updateStatus }}</p>
          </div>
        </section>
        <section v-else-if="drawerSection === 'backup'" class="drawer-panel">
          <p class="settings-note">上传/下载会先校验新增、修改、删除项；备份会直接上传一个带日期的云端文件，不在本地留存。</p>
          <van-form @submit="saveSettings">
            <van-field v-model="settings.oss.bucketName" label="Bucket" placeholder="OSS Bucket 名称" />
            <van-field v-model="settings.oss.accessKeyId" label="Key ID" placeholder="AccessKey ID" />
            <van-field v-model="settings.oss.accessKeySecret" label="Key Secret" type="password" placeholder="AccessKey Secret" />
            <van-field v-model="settings.oss.region" label="Region" placeholder="oss-cn-hangzhou" />
            <van-field v-model="settings.oss.objectName" label="文件名" placeholder="mypwdmg-vault.json" />
            <van-cell center title="自动同步数据" label="保存后上传校验，回到前台下载校验">
              <template #right-icon>
                <van-switch v-model="settings.oss.autoSync" size="22" />
              </template>
            </van-cell>
            <van-cell center title="同步间隔" label="自动下载校验最小间隔（分钟）">
              <template #right-icon>
                <van-stepper
                  :model-value="settings.oss.autoSyncIntervalMinutes"
                  :min="AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES"
                  :max="AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES"
                  integer
                  button-size="24px"
                  @update:model-value="setAutoSyncIntervalMinutes"
                />
              </template>
            </van-cell>
            <van-button block type="primary" native-type="submit">保存云配置</van-button>
          </van-form>
          <div class="backup-actions">
            <van-button class="backup-action-button" size="small" plain type="default" icon="search" :loading="cloudBusy" @click="checkCloudBackupInfo">检测</van-button>
            <van-button class="backup-action-button" size="small" type="primary" icon="upgrade" :loading="cloudBusy" @click="uploadCloudBackup">上传</van-button>
            <van-button class="backup-action-button" size="small" plain type="primary" icon="notes-o" :loading="cloudBusy" @click="backupCloudVault">备份</van-button>
            <van-button class="backup-action-button" size="small" plain type="primary" icon="down" :loading="cloudBusy" @click="downloadCloudBackup">下载</van-button>
            <van-button class="backup-action-button" size="small" plain type="default" icon="records-o" :loading="cloudBusy" @click="refreshCloudBackupList">列表</van-button>
          </div>
          <div v-if="cloudInfo" class="backup-info-grid">
            <div>
              <span>固定文件</span>
              <strong>{{ cloudInfo.exists ? '已存在' : '未找到' }}</strong>
            </div>
            <div>
              <span>大小</span>
              <strong>{{ cloudInfo.size ? formatBytes(cloudInfo.size) : '-' }}</strong>
            </div>
            <div>
              <span>更新时间</span>
              <strong>{{ cloudInfo.lastModified ? formatDateTime(cloudInfo.lastModified) : '-' }}</strong>
            </div>
          </div>
          <div v-if="cloudBackups.length" class="cloud-backup-list">
            <button
              v-for="item in cloudBackups"
              :key="item.name"
              class="cloud-backup-item"
              type="button"
              @click="selectCloudBackup(item.name)"
            >
              <span>{{ item.name }}</span>
              <small>{{ formatBytes(item.size) }} · {{ formatDateTime(item.lastModified) }}</small>
            </button>
          </div>
          <p v-if="backupStatus" class="settings-note">{{ backupStatus }}</p>
          <div class="cloud-sync-log-panel">
            <div class="cloud-sync-log-head">
              <div>
                <strong>同步记录</strong>
                <span>最多保留 {{ cloudSyncLogLimit }} 条</span>
              </div>
              <div class="cloud-sync-log-controls">
                <van-stepper
                  :model-value="cloudSyncLogLimit"
                  :min="CLOUD_SYNC_LOG_LIMIT_MIN"
                  :max="CLOUD_SYNC_LOG_LIMIT_MAX"
                  integer
                  button-size="24px"
                  @update:model-value="setCloudSyncLogLimit"
                />
                <van-button size="small" plain type="default" :disabled="cloudSyncLogs.length === 0" @click="clearCloudSyncLogs">清空</van-button>
              </div>
            </div>
            <div v-if="cloudSyncLogs.length" class="cloud-sync-log-list">
              <div
                v-for="item in cloudSyncLogs"
                :key="item.id"
                class="cloud-sync-log-item"
                :class="`is-${item.status}`"
              >
                <div class="cloud-sync-log-main">
                  <span class="cloud-sync-log-badge">{{ cloudSyncDirectionLabel(item.direction) }}</span>
                  <strong>{{ cloudSyncLogTitle(item) }}</strong>
                  <small>{{ formatDateTime(new Date(item.at).toISOString()) }} · {{ item.automatic ? '自动' : '手动' }}</small>
                </div>
                <div class="cloud-sync-log-meta">
                  <span>{{ cloudSyncLogStatusLabel(item.status) }}</span>
                  <small>{{ cloudSyncLogSummary(item) }}</small>
                  <small>{{ item.objectName }}</small>
                </div>
              </div>
            </div>
            <van-empty v-else image="search" description="暂无同步记录" />
          </div>
        </section>
        <section v-else-if="drawerSection === 'system'" class="drawer-panel system-panel">
          <div class="system-group-list">
            <button
              v-for="group in systemGroups"
              :key="group.key"
              type="button"
              :class="{ active: systemGroupKey === group.key }"
              @click="systemGroupKey = group.key"
            >
              <span class="system-group-icon"><van-icon :name="group.icon" /></span>
              <span class="system-group-copy">
                <strong>{{ group.title }}</strong>
                <small>{{ group.description }}</small>
              </span>
              <em>{{ group.count }}</em>
            </button>
          </div>
          <div class="system-group-head">
            <span>系统分组</span>
            <strong>{{ currentSystemGroup.title }}</strong>
            <small>{{ currentSystemGroup.description }}</small>
          </div>
          <van-empty v-if="systemGroupEntries.length === 0" image="search" :description="currentSystemGroup.emptyText" />
          <div v-else class="archive-entry-list">
            <div v-for="entry in systemGroupEntries" :key="entry.id" class="archive-entry">
              <div>
                <strong>{{ entry.title }}</strong>
                <span>{{ archiveEntryMeta(entry) }}</span>
                <small v-if="entry.statusReason">{{ entry.statusReason }}</small>
              </div>
              <div class="archive-entry-actions">
                <van-button size="mini" plain type="primary" @click="restoreEntry(entry.id)">恢复</van-button>
                <van-button v-if="systemGroupKey === 'archived'" size="mini" plain type="danger" @click="trashEntry(entry.id)">放入回收站</van-button>
                <van-button v-else size="mini" plain type="danger" @click="purgeEntry(entry.id)">彻底删除</van-button>
              </div>
            </div>
          </div>
        </section>
        <section v-else class="drawer-panel drawer-empty"></section>
      </aside>
    </van-popup>

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

    <van-popup
      v-model:show="cloudPasswordPromptOpen"
      round
      class="password-popup"
      :duration="0.14"
      :close-on-click-overlay="false"
      @closed="handleCloudPasswordPromptClosed"
    >
      <div class="password-popup-inner">
        <van-nav-bar safe-area-inset-top title="校验云端保险库" left-arrow @click-left="cancelCloudPasswordPrompt" />
        <van-form class="password-popup-form" @submit="submitCloudPasswordPrompt">
          <p class="settings-note compact-note">云端文件使用了另一套加密参数。请输入云端保险库的主密码重新校验；云端未设置主密码可留空。</p>
          <van-field v-model="cloudPasswordPromptValue" type="password" label="云端密码" autocomplete="current-password" placeholder="云端未设置可留空" />
          <div class="prompt-actions">
            <van-button block plain type="default" native-type="button" @click="cancelCloudPasswordPrompt">取消</van-button>
            <van-button block type="primary" native-type="submit">继续</van-button>
          </div>
        </van-form>
      </div>
    </van-popup>

    <van-popup
      v-model:show="cloudSyncReviewOpen"
      position="bottom"
      class="cloud-sync-popup"
      :duration="0.14"
      :close-on-click-overlay="false"
      lazy-render
    >
      <section v-if="cloudSyncPreview" class="cloud-sync-shell">
        <van-nav-bar safe-area-inset-top :title="cloudSyncReviewTitle" left-arrow @click-left="hideCloudSyncReview" />
        <div class="cloud-sync-body">
          <div class="cloud-sync-target">
            <span>{{ cloudSyncPreview.direction === 'download' ? '云端到本机' : '本机到云端' }}</span>
            <strong>{{ cloudSyncPreview.objectName }}</strong>
          </div>
          <div class="cloud-sync-summary">
            <div>
              <span>新增</span>
              <strong>{{ cloudSyncDiffCounts.added }}</strong>
            </div>
            <div>
              <span>修改</span>
              <strong>{{ cloudSyncDiffCounts.modified }}</strong>
            </div>
            <div>
              <span>删除</span>
              <strong>{{ cloudSyncDiffCounts.deleted }}</strong>
            </div>
          </div>
          <div class="cloud-sync-actions">
            <van-button size="small" plain type="default" @click="setAllCloudSyncDiffs(true)">全选</van-button>
            <van-button size="small" plain type="default" @click="setAllCloudSyncDiffs(false)">全不选</van-button>
            <van-button size="small" plain type="danger" @click="discardCloudSyncReview">放弃本次</van-button>
          </div>
          <div v-if="cloudSyncPreview.items.length" class="cloud-sync-list">
            <article
              v-for="item in cloudSyncPreview.items"
              :key="`${item.changeType}:${item.id}`"
              class="cloud-sync-item"
              :class="`is-${item.changeType}`"
            >
              <label class="cloud-sync-item-head">
                <input :checked="isCloudSyncItemChecked(item)" type="checkbox" @change="setCloudSyncItemChecked(item, readCheckboxChecked($event))" />
                <span class="cloud-sync-tag">{{ cloudSyncChangeLabel(item.changeType) }}</span>
                <span class="cloud-sync-copy">
                  <strong>{{ item.path }}</strong>
                  <small>{{ cloudSyncItemSummary(item) }}</small>
                </span>
              </label>
              <div v-if="item.changeType === 'modified' && item.details.length" class="cloud-sync-field-list">
                <label
                  v-for="detail in item.details"
                  :key="detail.key"
                  class="cloud-sync-field"
                >
                  <input :checked="detail.checked" type="checkbox" @change="setCloudSyncDetailChecked(item, detail, readCheckboxChecked($event))" />
                  <span class="cloud-sync-field-copy">
                    <strong>{{ detail.label }}</strong>
                    <small>
                      <em>{{ cloudSyncPreview.direction === 'download' ? '云端' : '本机' }}</em>
                      <b>{{ detail.sourceText }}</b>
                    </small>
                    <small>
                      <em>{{ cloudSyncPreview.direction === 'download' ? '本机' : '云端' }}</em>
                      <b>{{ detail.baseText }}</b>
                    </small>
                  </span>
                </label>
              </div>
            </article>
          </div>
          <van-empty v-else image="search" description="两端条目一致" />
        </div>
        <div class="cloud-sync-footer">
          <span>已选 {{ cloudSyncSelectedCount }} 处</span>
          <van-button size="small" type="primary" :disabled="cloudSyncSelectedCount === 0" :loading="cloudBusy" @click="applyCloudSyncPreview">
            {{ cloudSyncReviewActionText }}
          </van-button>
        </div>
      </section>
    </van-popup>

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
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import DetailContent from './components/DetailContent.vue'
import EntryList from './components/EntryList.vue'
import { AliyunOSSAPI, APIResponseStatus, DEFAULT_OSS_OBJECT_NAME, normalizeObjectName, type OSSFileInfo } from './services/aliyunOss'
import { api } from './services/api'
import { hasCloudSyncPositionChanged } from './services/cloudSyncPosition'
import { generateTotp, readTotpPeriod } from './services/totp'
import type {
  AndroidAutofillState,
  ApiResult,
  AppState,
  AppUpdateCheck,
  AppUpdateProgress,
  EntryKind,
  EntryStatus,
  LoginAccountSource,
  PluginListenerState,
  VaultEntry,
  VaultPayload
} from './types'

type ThemeMode = 'light' | 'dark'
type CssVars = Record<string, string>
type MoveEntryPayload = {
  entryId: string
  targetParentId: string
  targetIndex: number
}
type AndroidAutofillLaunchContext = {
  active: boolean
  target?: string
  searchTerm?: string
  includeAll?: boolean
}
type DrawerSection = 'settings' | 'updates' | 'backup' | 'system'
type SystemGroupKey = 'archived' | 'trashed'
type SystemGroupInfo = {
  key: SystemGroupKey
  title: string
  description: string
  emptyText: string
  icon: string
  count: number
}
type CloudBackupInfo = {
  name: string
  exists: boolean
  size: number
  lastModified: string
}
type CloudSyncDirection = 'upload' | 'download'
type CloudSyncChangeType = 'added' | 'modified' | 'deleted'
type EntryIndexMeta = {
  entry: VaultEntry
  parentId: string
  index: number
  path: string
  ancestorIds: string[]
  siblingIds: string[]
}
type CloudSyncDiffItem = {
  id: string
  changeType: CloudSyncChangeType
  entryKind: EntryKind
  title: string
  path: string
  checked: boolean
  details: CloudSyncChangeDetail[]
  sourceParentId: string
  sourceIndex: number
}
type CloudSyncChangeField =
  | 'position'
  | 'kind'
  | 'title'
  | 'status'
  | 'statusReason'
  | 'deletedAt'
  | 'domains'
  | 'username'
  | 'email'
  | 'password'
  | 'phone'
  | 'loginAccountSource'
  | 'note'
  | 'totpSecret'
type CloudSyncEntryChangeField = Exclude<CloudSyncChangeField, 'position'>
type CloudSyncChangeDetail = {
  key: CloudSyncChangeField
  label: string
  sourceText: string
  baseText: string
  checked: boolean
}
type CloudSyncPreview = {
  direction: CloudSyncDirection
  objectName: string
  sourcePayload: VaultPayload
  basePayload: VaultPayload
  items: CloudSyncDiffItem[]
  automatic: boolean
  localFingerprint: string
  remoteFingerprint: string
  remoteObjectFingerprint: string
  remoteExists: boolean
}
type CloudSyncLogStatus = 'started' | 'success' | 'review' | 'error' | 'skipped'
type CloudSyncLogEntry = {
  id: string
  at: number
  direction: CloudSyncDirection | 'backup'
  automatic: boolean
  status: CloudSyncLogStatus
  objectName: string
  message: string
  added: number
  modified: number
  deleted: number
  selected: number
  total: number
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
const UI_SCALE_KEY = 'mypwdmg.uiScaleLevel.v2'
const FONT_SIZE_KEY = 'mypwdmg.fontSizePercent'
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
const CLOUD_SYNC_CHANGE_LABELS: Record<CloudSyncChangeField, string> = {
  position: '位置',
  kind: '类型',
  title: '名称',
  status: '状态',
  statusReason: '状态说明',
  deletedAt: '删除时间',
  domains: '域名',
  username: '账号',
  email: '邮箱',
  password: '密码',
  phone: '手机',
  loginAccountSource: '自动填充账号',
  note: '备注',
  totpSecret: 'TOTP'
}
const CLOUD_SYNC_ENTRY_CHANGE_FIELDS: CloudSyncEntryChangeField[] = [
  'kind',
  'title',
  'status',
  'statusReason',
  'deletedAt',
  'domains',
  'username',
  'email',
  'password',
  'phone',
  'loginAccountSource',
  'note',
  'totpSecret'
]
const CLOUD_SYNC_MANUAL_REVIEW_FIELDS = new Set<CloudSyncChangeField>([
  'kind',
  'status',
  'deletedAt',
  'username',
  'email',
  'password',
  'phone',
  'loginAccountSource',
  'totpSecret'
])
const GITHUB_UPDATE_MANIFEST_URL = 'https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json'
const DEFAULT_UPDATE_MANIFEST_URL = GITHUB_UPDATE_MANIFEST_URL
const BUILT_IN_MANIFEST_URL_PATTERN =
  /^(?:https:\/\/ghproxy\.net\/)?https:\/\/github\.com\/suzikuo\/pwdmg\/releases\/(?:latest\/download|download\/[^/]+)\/update-manifest\.json$/i
const packagedAppVersion = String(import.meta.env.PACKAGE_VERSION || '').trim()
const appVersion = ref('')
const displayAppVersion = computed(() => appVersion.value || packagedAppVersion || '0.0.0')
const UI_SCALE_BASE = 0.92
const UI_SCALE_MIN = 0.5
const UI_SCALE_MAX = 1.3
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
const cloudBusy = ref(false)
const pluginBusy = ref(false)
const androidAutofillBusy = ref(false)
const backupStatus = ref('')
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
const changePasswordValue = ref('')
const changePasswordConfirm = ref('')
const pluginExtensionId = ref('')
const importLegacy = ref(true)
const keyword = ref('')
const vault = ref<VaultPayload | null>(null)
const editorOpen = ref(false)
const detailOpen = ref(false)
const drawerOpen = ref(false)
const createSheetOpen = ref(false)
const entryContextMenuOpen = ref(false)
const createMenuOpen = ref(false)
const moreMenuOpen = ref(false)
const passwordSheetOpen = ref(false)
const pluginDetailOpen = ref(false)
const createParentId = ref('')
const dragMode = ref(false)
const drawerDetailOpen = ref(false)
const drawerSection = ref<DrawerSection>('settings')
const systemGroupKey = ref<SystemGroupKey>('archived')
const searchOpen = ref(false)
const uiScalePercent = ref(loadUiScale())
const fontSizePercent = ref(loadFontSize())
const editingId = ref('')
const editingParentId = ref('')
const contextEntryId = ref('')
const entryContextMenuX = ref(0)
const entryContextMenuY = ref(0)
const domainText = ref('')
const totpCode = ref('')
const selectedEntry = ref<VaultEntry | null>(null)
const pluginListener = ref<PluginListenerState | null>(null)
const androidAutofill = ref<AndroidAutofillState | null>(null)
const androidAutofillLaunch = ref<AndroidAutofillLaunchContext | null>(null)
const cloudInfo = ref<CloudBackupInfo | null>(null)
const cloudBackups = ref<CloudBackupInfo[]>([])
const selectedCloudObjectName = ref('')
const cloudSyncReviewOpen = ref(false)
const cloudSyncPreview = ref<CloudSyncPreview | null>(null)
const cloudSyncLogs = ref<CloudSyncLogEntry[]>(loadCloudSyncLogs())
const cloudSyncLogLimit = ref(loadCloudSyncLogLimit())
const showPassword = ref(false)
const totpRemaining = ref(TOTP_PERIOD_SECONDS)
const totpPeriodSeconds = ref(TOTP_PERIOD_SECONDS)
const totpRequestId = ref(0)
const isWide = ref(false)
const isDrawerWide = ref(false)
const paneWidth = ref(loadPaneWidth())
const workspaceGrid = ref<HTMLElement | null>(null)
const searchInput = ref<{ focus?: () => void } | null>(null)
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
let cloudPasswordPromptResolve: ((value: string | null) => void) | null = null
const createActions = [
  { name: '登录', subname: '账号、密码、TOTP', kind: 'login' as EntryKind },
  { name: '分组', subname: '整理一组条目', kind: 'folder' as EntryKind }
]
const createMenuActions = [
  { text: '登录', icon: 'records-o', kind: 'login' as EntryKind },
  { text: '分组', icon: 'cluster-o', kind: 'folder' as EntryKind }
]
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
      { name: '编辑分组', key: 'edit' },
      { name: '归档分组', key: 'archive', color: '#ee0a24' },
      { name: '移入回收站', key: 'trash', color: '#ee0a24' }
    )
  } else {
    actions.push(
      { name: '编辑登录', key: 'edit' },
      { name: '归档登录', key: 'archive', color: '#ee0a24' },
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
  {
    text: dragMode.value ? '退出拖拽模式' : '拖拽模式',
    icon: 'sort',
    key: 'drag'
  },
  { text: '锁定', icon: 'lock', key: 'lock' },
  { text: '安全退出', icon: 'cross', key: 'safe-exit', color: '#ee0a24' }
])
const loginAccountSourceOptions: Array<{ label: string; value: LoginAccountSource }> = [
  { label: '自动', value: 'auto' },
  { label: '账号', value: 'username' },
  { label: '邮箱', value: 'email' },
  { label: '手机', value: 'phone' }
]

const unlocked = computed(() => Boolean(vault.value) && !state.locked)
const filteredEntries = computed(() => filterEntries(activeTree(vault.value?.entries || []), keyword.value.trim().toLowerCase()))
const passwordMask = computed(() => selectedEntry.value?.password ? '••••••••••••' : '未设置')
const totpProgress = computed(() => Math.round((totpRemaining.value / totpPeriodSeconds.value) * 100))
const drawerSectionTitle = computed(() => {
  if (drawerSection.value === 'settings') return '设置'
  if (drawerSection.value === 'updates') return '更新'
  if (drawerSection.value === 'system') return '系统分组'
  return '备份'
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
const runtimeMode = String(import.meta.env.VITE_STORAGE_MODE || import.meta.env.VITE_API_MODE || import.meta.env.MODE || '').toLowerCase()
const isDesktopMode = computed(() => ['desktop', 'pywebview', 'native'].includes(runtimeMode))
const showPluginSettings = computed(() => isDesktopMode.value && pluginListener.value?.supported !== false)
const showAndroidAutofillSettings = computed(() => androidAutofill.value?.supported === true)
const androidAutofillStatus = computed(() => {
  const state = androidAutofill.value
  if (!state) return '未检测'
  if (!state.supported) return '不支持'
  return state.enabled ? '已开启' : '去设置'
})
const updatePlatform = computed(() => updateInfo.value?.platform || (showAndroidAutofillSettings.value ? 'android' : 'desktop'))
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
const stats = computed(() => {
  const flat = flattenEntries(vault.value?.entries || [])
  const active = flat.filter(isActiveEntry)
  return {
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
  window.addEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.addEventListener('scroll', closeEntryContextMenu, true)
  window.addEventListener('resize', closeEntryContextMenu)
  window.addEventListener('focus', loadAndroidAutofillState)
  window.addEventListener('focus', resetAndroidInstallBusy)
  window.addEventListener('focus', scheduleExternalVaultRefresh)
  window.addEventListener('focus', scheduleAutoCloudDownloadCheck)
  document.addEventListener('selectstart', suppressNonEditableSelection)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.__mypwdmgHandleNativeBack = handleNativeBack
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
watch(keyword, (value) => {
  if (value.trim()) dragMode.value = false
})
watch(() => [selectedEntry.value?.id, selectedEntry.value?.totpSecret], syncSelectedTotpTimer)

onUnmounted(() => {
  desktopMediaQuery?.removeEventListener('change', syncDesktopMode)
  drawerMediaQuery?.removeEventListener('change', syncDrawerMode)
  window.removeEventListener('resize', clampPaneToViewport)
  window.removeEventListener('pointerdown', closeTopMenusOnOutside, true)
  window.removeEventListener('scroll', closeEntryContextMenu, true)
  window.removeEventListener('resize', closeEntryContextMenu)
  window.removeEventListener('focus', loadAndroidAutofillState)
  window.removeEventListener('focus', resetAndroidInstallBusy)
  window.removeEventListener('focus', scheduleExternalVaultRefresh)
  window.removeEventListener('focus', scheduleAutoCloudDownloadCheck)
  document.removeEventListener('selectstart', suppressNonEditableSelection)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (externalVaultRefreshTimer) window.clearTimeout(externalVaultRefreshTimer)
  if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
  if (autoCloudDownloadTimer) window.clearTimeout(autoCloudDownloadTimer)
  delete window.__mypwdmgHandleNativeBack
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

function closeTopLayer() {
  if (cloudSyncReviewOpen.value) {
    hideCloudSyncReview()
    return true
  }
  if (pluginDetailOpen.value) {
    pluginDetailOpen.value = false
    return true
  }
  if (passwordSheetOpen.value) {
    passwordSheetOpen.value = false
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
  if (searchOpen.value || keyword.value) {
    searchOpen.value = false
    keyword.value = ''
    return true
  }
  if (dragMode.value) {
    dragMode.value = false
    return true
  }
  return false
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
  stateLoading.value = true
  stateError.value = ''
  let shouldAutoUnlock = false
  try {
    const result = await api.getStartupData()
    if (result.ok && result.data) {
      Object.assign(state, result.data.state)
      if (result.data.vault) {
        vault.value = result.data.vault
        syncSettings(vault.value.settings)
        state.locked = false
        applyAndroidAutofillSearch()
        scheduleAutoCloudDownloadCheck(true)
      } else if (state.hasVault) {
        if (state.locked && state.passwordless) shouldAutoUnlock = true
        else if (!state.locked) await loadUnlockedVault()
      }
    } else {
      stateError.value = result.message || '无法连接本地保险库'
    }
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
  if (newPassword.value !== confirmPassword.value) return showFailToast('两次密码不一致')
  busy.value = true
  const result = await api.createVault(newPassword.value, importLegacy.value)
  busy.value = false
  if (!result.ok || !result.data) return showFailToast(result.message || '创建失败')
  vault.value = result.data.vault
  syncSettings(vault.value.settings)
  state.hasVault = true
  state.locked = false
  applyAndroidAutofillSearch()
  if (result.data.legacyCleanupPending) {
    showFailToast(`已迁移 ${result.data.migrated} 条，但旧数据清理失败；请暂时保留并手动检查旧文件`)
  } else {
    showSuccessToast(result.data.migrated ? `已迁移 ${result.data.migrated} 条并清理旧数据` : '保险库已创建')
  }
}

async function unlockVault() {
  await unlockWithPassword(password.value)
}

async function unlockWithPassword(candidate: string, silent = false) {
  if (!silent) busy.value = true
  const result = await api.unlock(candidate)
  if (!silent) busy.value = false
  if (!result.ok || !result.data) {
    if (!silent) showFailToast(result.message || '解锁失败')
    return false
  }
  vault.value = result.data
  syncSettings(vault.value.settings)
  state.locked = false
  password.value = ''
  applyAndroidAutofillSearch()
  scheduleAutoCloudDownloadCheck(true)
  return true
}

async function loadUnlockedVault() {
  const result = await api.getVault()
  if (!result.ok || !result.data) {
    state.locked = true
    return false
  }
  vault.value = result.data
  syncSettings(vault.value.settings)
  state.locked = false
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
  if (!isDesktopMode.value || !vault.value || state.locked) return
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
  if (!isDesktopMode.value || externalVaultRefreshing || !vault.value || state.locked) return
  if (busy.value || cloudBusy.value || pluginBusy.value || updateBusy.value) return
  if (editorOpen.value || passwordSheetOpen.value || createSheetOpen.value) return

  externalVaultRefreshing = true
  lastExternalVaultRefreshAt = Date.now()
  const selectedEntryId = selectedEntry.value?.id || ''
  try {
    const result = await api.getVault()
    if (!result.ok || !result.data) {
      if (result.code === 'LOCKED') {
        vault.value = null
        selectedEntry.value = null
        stopTotpTimer()
        state.locked = true
      }
      return
    }

    vault.value = result.data
    syncSettings(vault.value.settings)
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
  await api.lock()
  vault.value = null
  selectedEntry.value = null
  stopTotpTimer()
  state.locked = true
  dragMode.value = false
  createMenuOpen.value = false
  moreMenuOpen.value = false
  drawerOpen.value = false
  searchOpen.value = false
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
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    history: [],
    children: []
  }
}

function makeId() {
  return crypto.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resetForm(entry: VaultEntry) {
  Object.assign(form, emptyEntry(entry.kind), JSON.parse(JSON.stringify(entry)))
  form.status = normalizeEntryStatus(form.status)
  form.loginAccountSource = normalizeLoginAccountSource(form.loginAccountSource)
  domainText.value = (entry.domains || []).join('\n')
  totpCode.value = ''
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
  const menuHeight = 188
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin))
  }
}

function handleMoreAction(action: { key?: string }) {
  moreMenuOpen.value = false
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
    searchOpen.value = false
    detailOpen.value = false
    showToast('拖拽模式：长按条目移动')
  }
}

async function safeExit() {
  moreMenuOpen.value = false
  const result = await api.safeExit()
  if (!result.ok) showFailToast(result.message || '安全退出失败')
}

function openView(entry: VaultEntry) {
  if (entry.kind !== 'login') return
  if (androidAutofillLaunch.value?.active) {
    completeAndroidAutofill(entry)
    return
  }
  showEntryDetail(entry)
}

function showEntryDetail(entry: VaultEntry) {
  selectedEntry.value = entry
  showPassword.value = false
  totpCode.value = ''
  detailOpen.value = !isWide.value
  syncSelectedTotpTimer()
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
    if (latest.ok && latest.data) {
      vault.value = latest.data
      syncSettings(vault.value.settings)
      selectedEntry.value = selectedId ? findEntry(vault.value.entries, selectedId) : null
    }
    showFailToast('保险库已被其他窗口或插件更新，已重新载入；当前操作未保存，请重试')
    return
  }
  showFailToast(result.message || fallback)
}

async function saveEntry() {
  if (!vault.value) return
  busy.value = true
  const payload = cloneVault()
  const entry = normalizeForm()
  if (editingId.value) {
    appendEntryHistory(entry, 'updated', '手动编辑')
    replaceEntry(payload.entries, editingId.value, entry)
  } else {
    appendEntryHistory(entry, 'created', '手动创建')
    insertEntry(payload.entries, editingParentId.value, entry)
  }
  const result = await api.saveVault(payload)
  busy.value = false
  if (!result.ok || !result.data) return handleVaultWriteError(result, '保存失败')
  vault.value = result.data
  syncSettings(vault.value.settings)
  selectedEntry.value = findEntry(vault.value.entries, entry.id)
  editorOpen.value = false
  scheduleAutoCloudUpload()
  showSuccessToast('已保存')
}

async function deleteEntry(entryId: string) {
  await trashEntry(entryId)
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
  const message = target.kind === 'folder'
    ? childCount > 0
      ? `分组「${title}」和其中 ${childCount} 项内容会从正常列表中隐藏，之后可以在归档里恢复。`
      : `分组「${title}」会从正常列表中隐藏，之后可以在归档里恢复。`
    : `「${title}」会从正常列表和自动填充中隐藏，之后可以在归档里恢复。`
  try {
    await showConfirmDialog({
      title: target.kind === 'folder' ? '归档分组' : '归档登录',
      message,
      confirmButtonText: target.kind === 'folder' ? '归档分组' : '归档登录',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }
  const payload = cloneVault()
  const reason = target.kind === 'folder' ? '分组已归档' : '登录已归档，暂不在正常列表使用'
  if (!updateEntryById(payload.entries, entryId, (entry) => markEntryStatus(entry, 'disabled', reason))) return
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '归档失败')
  vault.value = result.data
  scheduleAutoCloudUpload()
  if (selectedEntry.value && (selectedEntry.value.id === entryId || isDescendant(target, selectedEntry.value.id))) {
    clearSelectedEntry()
  }
  drawerSection.value = 'system'
  systemGroupKey.value = 'archived'
  showSuccessToast(target.kind === 'folder' ? '分组已归档' : '登录已归档')
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
    : `将登录「${title}」移入回收站？之后可以恢复。`
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
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '删除失败')
  vault.value = result.data
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
    : (entry: VaultEntry) => markEntrySelfStatus(entry, 'active', '恢复为正常账号')
  if (!updateEntryAndAncestorsById(payload.entries, entryId, updater, (entry) => markEntrySelfStatus(entry, 'active', '恢复上级分组'))) {
    return showToast('条目不存在')
  }
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '恢复失败')
  vault.value = result.data
  scheduleAutoCloudUpload()
  selectedEntry.value = findEntry(vault.value.entries, entryId)
  if (selectedEntry.value && selectedEntry.value.kind === 'login') showEntryDetail(selectedEntry.value)
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
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '彻底删除失败')
  vault.value = result.data
  scheduleAutoCloudUpload()
  if (shouldClearSelection) clearSelectedEntry()
  showSuccessToast('已彻底删除')
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

  const result = await api.saveVault(nextVault)
  if (!result.ok || !result.data) return handleVaultWriteError(result, '移动失败')
  vault.value = result.data
  scheduleAutoCloudUpload()
  if (selectedEntry.value) selectedEntry.value = findEntry(vault.value.entries, selectedEntry.value.id)
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
  const result = await api.applyAppUpdate(downloadedUpdatePath.value)
  if (!result.ok) {
    updateBusy.value = ''
    showFailToast(result.message || '安装更新失败')
    return
  }
  if (result.data?.permissionRequired) {
    updateBusy.value = ''
    updateStatus.value = '请在系统页面允许安装未知应用，返回后再次点击打开安装器'
    showToast('请先允许安装未知应用')
    return
  }
  updateStatus.value = isAndroidUpdate ? '已打开系统安装器' : '正在关闭并安装更新'
  showSuccessToast(isAndroidUpdate ? '请在系统安装器中确认' : '正在安装更新')
  if (isAndroidUpdate || result.data?.willRestart === false) {
    updateBusy.value = ''
  }
}

async function saveSettings() {
  await persistSettings({ closeDrawer: true, toast: true })
}

async function changeMasterPassword() {
  if (changePasswordValue.value !== changePasswordConfirm.value) {
    showFailToast('两次密码不一致')
    return
  }

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

  busy.value = true
  let cloudRewrite: { objectName: string; remoteObjectFingerprint: string } | null = null
  try {
    cloudRewrite = await prepareCloudRewriteForPasswordChange()
  } catch (error) {
    busy.value = false
    showFailToast(error instanceof Error ? error.message : String(error))
    return
  }

  const result = await api.changePassword(changePasswordValue.value)
  if (!result.ok || !result.data) {
    busy.value = false
    return showFailToast(result.message || '修改失败')
  }
  Object.assign(state, result.data)
  const refreshedVault = await api.getVault()
  if (refreshedVault.ok && refreshedVault.data) vault.value = refreshedVault.data

  let cloudRewriteError = ''
  if (cloudRewrite && vault.value) {
    const exported = await api.exportVaultBackup()
    if (!exported.ok || !exported.data) {
      cloudRewriteError = exported.message || '无法生成使用新主密码加密的云端文件'
    } else {
      const client = createOssClient()
      const validation = await validateCloudObjectRevision(
        client,
        cloudRewrite.objectName,
        cloudRewrite.remoteObjectFingerprint,
        true
      )
      if (!validation.ok) {
        cloudRewriteError = validation.message
      } else {
        const response = await client.uploadFile(cloudRewrite.objectName, exported.data.content, 'application/json')
        if (response.status !== APIResponseStatus.Success) {
          cloudRewriteError = String(response.content || '云端保险库重新加密失败')
        } else {
          await rememberCloudSyncState(cloudRewrite.objectName, vault.value, vault.value)
        }
      }
    }
  }

  busy.value = false
  changePasswordValue.value = ''
  changePasswordConfirm.value = ''
  passwordSheetOpen.value = false
  if (cloudRewriteError) {
    backupStatus.value = `本地主密码已修改，但${cloudRewriteError}`
    showFailToast(backupStatus.value)
  } else {
    showSuccessToast(cloudRewrite ? '主密码及云端保险库已重新加密' : '主密码已修改')
  }
}

async function prepareCloudRewriteForPasswordChange() {
  if (!vault.value || !hasCompleteOssSettings()) return null
  const objectName = normalizeObjectName(settings.oss.objectName)
  const response = await createOssClient().downloadFile(objectName, 'text/plain')
  if (response.status === APIResponseStatus.FileNotExist) return null
  if (response.status !== APIResponseStatus.Success || typeof response.content !== 'string') {
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
    remoteObjectFingerprint: response.revision || await sha256Text(response.content)
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
  const result = await api.openAndroidAutofillSettings()
  androidAutofillBusy.value = false
  if (!result.ok || !result.data) {
    showFailToast(result.message || '无法打开自动填充设置')
    return
  }
  androidAutofill.value = result.data
  showToast('请在系统页面选择 My Password')
  window.setTimeout(loadAndroidAutofillState, 1000)
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
  const result = await api.enablePluginListener(extensionId, ['chrome', 'edge'])
  pluginBusy.value = false
  if (!result.ok || !result.data) return showFailToast(result.message || '开启失败')
  pluginListener.value = result.data
  pluginExtensionId.value = result.data.extensionId || extensionId
  showSuccessToast('插件监听已开启，重载扩展或浏览器后生效')
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
  const result = await api.disablePluginListener()
  pluginBusy.value = false
  if (!result.ok || !result.data) return showFailToast(result.message || '关闭失败')
  pluginListener.value = result.data
  showSuccessToast('插件监听已关闭')
}

async function persistSettings(options: { closeDrawer?: boolean; toast?: boolean; skipAutoSync?: boolean } = {}) {
  if (!vault.value) return
  const payload = cloneVault()
  payload.settings = normalizeSettings(settings)
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) {
    await handleVaultWriteError(result, '保存失败')
    return false
  }
  vault.value = result.data
  syncSettings(vault.value.settings)
  if (options.closeDrawer) drawerOpen.value = false
  if (options.toast) showSuccessToast('设置已保存')
  if (!options.skipAutoSync) {
    scheduleAutoCloudDownloadCheck(true)
    scheduleAutoCloudUpload()
  }
  return true
}

async function uploadCloudBackup() {
  await startCloudSyncReview('upload')
}

async function backupCloudVault() {
  await uploadCloudVault(true)
}

async function checkCloudBackupInfo() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return
  cloudBusy.value = true
  backupStatus.value = ''
  try {
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) return
    const client = createOssClient()
    const response = await client.getFileInfo(settings.oss.objectName)
    if (response.status === APIResponseStatus.Success && typeof response.content !== 'string') {
      cloudInfo.value = toCloudBackupInfo(response.content)
      backupStatus.value = `云端文件已存在：${formatBytes(cloudInfo.value.size)}`
      showSuccessToast('云端文件可用')
      return
    }
    if (response.status === APIResponseStatus.FileNotExist && typeof response.content !== 'string') {
      cloudInfo.value = toCloudBackupInfo(response.content)
      backupStatus.value = '云端固定文件不存在'
      showToast('云端文件不存在')
      return
    }
    showFailToast(String(response.content || '检测失败'))
  } finally {
    cloudBusy.value = false
  }
}

async function refreshCloudBackupList() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return
  cloudBusy.value = true
  backupStatus.value = ''
  try {
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) return
    const client = createOssClient()
    const response = await client.listFiles(settings.oss.objectName, 50)
    if (response.status !== APIResponseStatus.Success || !Array.isArray(response.content)) {
      showFailToast(String(response.content || '读取备份列表失败'))
      return
    }
    const fixedName = normalizeObjectName(settings.oss.objectName)
    cloudBackups.value = response.content
      .map(toCloudBackupInfo)
      .filter((item) => item.name !== fixedName && item.name.startsWith(`${fixedName}.`))
      .sort((left, right) => String(right.lastModified).localeCompare(String(left.lastModified)))
    backupStatus.value = cloudBackups.value.length ? `找到 ${cloudBackups.value.length} 个云端日期备份` : '没有找到日期备份'
    showToast(backupStatus.value)
  } finally {
    cloudBusy.value = false
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

async function uploadCloudVault(asDatedBackup: boolean) {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return
  const objectName = asDatedBackup ? makeDatedBackupName(settings.oss.objectName) : settings.oss.objectName

  try {
    await confirmTwice({
      title: asDatedBackup ? '创建云端备份' : '上传云端文件',
      message: `将当前加密保险库上传到 OSS：${objectName}。继续吗？`,
      secondTitle: asDatedBackup ? '再次确认备份' : '再次确认上传',
      secondMessage: asDatedBackup ? '会直接上传一个新的云端日期备份文件，不会在本地额外留存。' : '云端同名文件会被覆盖，确认继续上传？',
      confirmButtonText: asDatedBackup ? '确认备份' : '确认上传'
    })
  } catch {
    return
  }

  cloudBusy.value = true
  backupStatus.value = ''
  try {
    const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
    if (!saved) return
    const exported = await api.exportVaultBackup()
    if (!exported.ok || !exported.data) {
      appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'error',
        objectName,
        message: exported.message || '导出保险库失败'
      })
      showFailToast(exported.message || '导出保险库失败')
      return
    }

    const client = createOssClient()
    const response = await client.uploadFile(objectName, exported.data.content, 'application/json')
    if (response.status !== APIResponseStatus.Success) {
      appendCloudSyncLog({
        direction: 'backup',
        automatic: false,
        status: 'error',
        objectName,
        message: String(response.content || (asDatedBackup ? '备份失败' : '上传失败'))
      })
      showFailToast(String(response.content || (asDatedBackup ? '备份失败' : '上传失败')))
      return
    }
    backupStatus.value = `已上传到 ${settings.oss.bucketName}/${objectName}`
    if (!asDatedBackup) cloudInfo.value = {
      name: objectName,
      exists: true,
      size: exported.data.content.length,
      lastModified: new Date().toISOString()
    }
    if (!asDatedBackup && vault.value) {
      const uploadedPayload = clonePayload(vault.value)
      uploadedPayload.updatedAt = Number(exported.data.updatedAt || uploadedPayload.updatedAt || 0)
      await rememberCloudSyncState(objectName, uploadedPayload, vault.value)
    }
    appendCloudSyncLog({
      direction: 'backup',
      automatic: false,
      status: 'success',
      objectName,
      message: asDatedBackup ? '云端备份已创建' : '云端文件已上传'
    })
    showSuccessToast(asDatedBackup ? '云端备份已创建' : '云端文件已上传')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '云端上传失败')
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
    cloudBusy.value = false
  }
}

async function downloadCloudBackup() {
  await startCloudSyncReview('download')
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
  if (!canScheduleAutoCloudSync()) return
  if (autoCloudUploadTimer) window.clearTimeout(autoCloudUploadTimer)
  autoCloudUploadTimer = window.setTimeout(() => {
    autoCloudUploadTimer = 0
    if (canScheduleAutoCloudSync()) startCloudSyncReview('upload', { automatic: true, skipPersist: true })
  }, AUTO_CLOUD_SYNC_UPLOAD_DELAY_MS)
}

function scheduleAutoCloudDownloadCheck(forceOrEvent: boolean | Event = false) {
  if (!canScheduleAutoCloudSync()) return
  const force = forceOrEvent === true
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
    if (canScheduleAutoCloudSync()) {
      startCloudSyncReview('download', { automatic: true, skipPersist: true, objectName: settings.oss.objectName })
    }
  }, delay)
}

async function startCloudSyncReview(
  direction: CloudSyncDirection,
  options: { automatic?: boolean; skipPersist?: boolean; objectName?: string } = {}
) {
  if (!vault.value || cloudBusy.value) return
  let scheduleUploadAfterSkip = false
  if (hasPendingCloudSyncReview()) {
    if (!options.automatic) {
      cloudSyncReviewOpen.value = true
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

  const objectName = normalizeObjectName(
    options.objectName ||
    (direction === 'download' && !options.automatic ? selectedCloudObjectName.value || settings.oss.objectName : settings.oss.objectName)
  )
  appendCloudSyncLog({
    direction,
    automatic: options.automatic === true,
    status: 'started',
    objectName,
    message: direction === 'download' ? '开始下载校验' : '开始上传校验'
  })

  cloudBusy.value = true
  backupStatus.value = direction === 'download' ? '正在生成下载差异' : '正在生成上传差异'
  try {
    const localPayloadBeforePersist = clonePayload(vault.value)
    if (!options.skipPersist) {
      const saved = await persistSettings({ closeDrawer: false, toast: false, skipAutoSync: true })
      if (!saved || !vault.value) {
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
    const client = createOssClient()
    const response = await client.downloadFile(objectName, 'text/plain')
    let remotePayload: VaultPayload | null = null

    if (response.status === APIResponseStatus.Success && typeof response.content === 'string') {
      let preview = await api.previewVaultBackup(response.content)
      if ((!preview.ok || !preview.data) && !options.automatic && isVaultPasswordChangedResult(preview)) {
        backupStatus.value = '云端文件需要输入云端主密码校验'
        const retryPassword = await requestCloudVaultPassword()
        if (retryPassword === null) {
          backupStatus.value = '已取消云端校验'
          appendCloudSyncLog({
            direction,
            automatic: false,
            status: 'skipped',
            objectName,
            message: '已取消云端校验'
          })
          return
        }
        preview = await api.previewVaultBackupWithPassword(response.content, retryPassword)
      }
      if (!preview.ok || !preview.data) {
        if (!options.automatic) showFailToast(preview.message || '云端文件无法用当前会话解密')
        backupStatus.value = '云端文件无法校验，请确认它来自当前保险库'
        appendCloudSyncLog({
          direction,
          automatic: options.automatic === true,
          status: 'error',
          objectName,
          message: preview.message || '云端文件无法用当前会话解密'
        })
        return
      }
      remotePayload = preview.data
    } else if (response.status === APIResponseStatus.FileNotExist) {
      if (direction === 'download') {
        if (!options.automatic) showFailToast('云端文件不存在')
        backupStatus.value = '云端文件不存在'
        appendCloudSyncLog({
          direction,
          automatic: options.automatic === true,
          status: 'skipped',
          objectName,
          message: '云端文件不存在'
        })
        return
      }
      remotePayload = emptyCloudPayload()
    } else {
      if (!options.automatic) showFailToast(String(response.content || '读取云端文件失败'))
      appendCloudSyncLog({
        direction,
        automatic: options.automatic === true,
        status: 'error',
        objectName,
        message: String(response.content || '读取云端文件失败')
      })
      return
    }
    if (!remotePayload) return

    let effectiveDirection = direction
    if (direction === 'upload' && await shouldPreferCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)) {
      effectiveDirection = 'download'
      const message = options.automatic
        ? '云端数据已更新，已跳过自动上传并改为下载校验'
        : '云端数据比本地同步基线更新，已改为下载校验'
      backupStatus.value = message
      appendCloudSyncLog({
        direction: 'upload',
        automatic: options.automatic === true,
        status: 'skipped',
        objectName,
        message
      })
    }

    const sourcePayload = effectiveDirection === 'download' ? remotePayload : localPayload
    const basePayload = effectiveDirection === 'download' ? localPayload : remotePayload
    const items = buildCloudSyncDiff(sourcePayload, basePayload)

    if (
      options.automatic &&
      effectiveDirection === 'download' &&
      await shouldSkipAutomaticCloudDownload(objectName, localPayload, remotePayload, localPayloadBeforePersist)
    ) {
      cloudSyncPreview.value = null
      scheduleUploadAfterSkip = true
      const message = '本地有未上传变更，已跳过自动下载并改为上传校验'
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

    if (!items.length) {
      cloudSyncPreview.value = null
      await rememberCloudSyncState(objectName, remotePayload, localPayload)
      backupStatus.value = '两端条目一致'
      if (!options.automatic) showToast('两端条目一致')
      appendCloudSyncLog({
        direction: effectiveDirection,
        automatic: options.automatic === true,
        status: 'success',
        objectName,
        message: '两端条目一致'
      })
      return
    }

    const preview: CloudSyncPreview = {
      direction: effectiveDirection,
      objectName,
      sourcePayload,
      basePayload,
      items,
      automatic: options.automatic === true,
      localFingerprint: await cloudSyncPayloadFingerprint(localPayload),
      remoteFingerprint: await cloudSyncPayloadFingerprint(remotePayload),
      remoteObjectFingerprint: response.status === APIResponseStatus.Success && typeof response.content === 'string'
        ? response.revision || await sha256Text(response.content)
        : 'missing',
      remoteExists: response.status === APIResponseStatus.Success
    }
    cloudSyncPreview.value = preview

    if (options.automatic) {
      const autoDecision = resolveAutoCloudSyncDecision(preview)
      if (autoDecision.apply) {
        await applyCloudSyncItems(preview, items, {
          clearPreview: true,
          showSuccess: false,
          showErrors: false,
          successMessage: autoDecision.message
        })
        return
      }

      cloudSyncReviewOpen.value = true
      backupStatus.value = autoDecision.message
      appendCloudSyncLog({
        direction: preview.direction,
        automatic: true,
        status: 'review',
        objectName,
        message: autoDecision.message,
        total: items.length,
        ...cloudSyncDiffCountsForItems(items)
      })
      return
    }

    cloudSyncReviewOpen.value = true
    backupStatus.value = `发现 ${items.length} 项差异`
    appendCloudSyncLog({
      direction: preview.direction,
      automatic: false,
      status: 'review',
      objectName,
      message: `发现 ${items.length} 项差异`,
      total: items.length,
      ...cloudSyncDiffCountsForItems(items)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '同步校验失败')
    if (!options.automatic) showFailToast(message)
    appendCloudSyncLog({
      direction,
      automatic: options.automatic === true,
      status: 'error',
      objectName,
      message
    })
  } finally {
    cloudBusy.value = false
    if (scheduleUploadAfterSkip) scheduleAutoCloudUpload()
  }
}

async function applyCloudSyncPreview() {
  const preview = cloudSyncPreview.value
  if (!preview || cloudBusy.value) return
  const selectedItems = getCloudSyncSelectedItems(preview.items)
  if (!selectedItems.length) return showToast('没有选中差异')

  cloudBusy.value = true
  try {
    await applyCloudSyncItems(preview, selectedItems, {
      closeReview: true,
      showSuccess: true,
      showErrors: true
    })
  } finally {
    cloudBusy.value = false
  }
}

type CloudSyncApplyOptions = {
  closeReview?: boolean
  clearPreview?: boolean
  showSuccess?: boolean
  showErrors?: boolean
  successMessage?: string
}

async function validateCloudSyncPreview(preview: CloudSyncPreview): Promise<{ ok: boolean; message: string }> {
  const currentLocal = await api.getVault()
  if (!currentLocal.ok || !currentLocal.data) {
    return { ok: false, message: currentLocal.message || '无法重新读取本地保险库' }
  }
  if (await cloudSyncPayloadFingerprint(currentLocal.data) !== preview.localFingerprint) {
    return { ok: false, message: '本地保险库在确认期间已变化，请重新检测同步差异' }
  }

  return validateCloudObjectRevision(
    createOssClient(),
    preview.objectName,
    preview.remoteObjectFingerprint,
    preview.remoteExists
  )
}

async function validateCloudObjectRevision(
  client: AliyunOSSAPI,
  objectName: string,
  expectedFingerprint: string,
  expectedExists: boolean
): Promise<{ ok: boolean; message: string }> {
  const currentRemote = await client.downloadFile(objectName, 'text/plain')
  if (!expectedExists) {
    if (currentRemote.status !== APIResponseStatus.FileNotExist) {
      return { ok: false, message: '云端文件在确认期间已创建，请重新检测同步差异' }
    }
    return { ok: true, message: '' }
  }
  if (currentRemote.status !== APIResponseStatus.Success || typeof currentRemote.content !== 'string') {
    return { ok: false, message: String(currentRemote.content || '无法重新读取云端保险库') }
  }
  const currentFingerprint = currentRemote.revision || await sha256Text(currentRemote.content)
  if (currentFingerprint !== expectedFingerprint) {
    return { ok: false, message: '云端保险库在确认期间已变化，请重新检测同步差异' }
  }
  return { ok: true, message: '' }
}

async function applyCloudSyncItems(preview: CloudSyncPreview, selectedItems: CloudSyncDiffItem[], options: CloudSyncApplyOptions = {}) {
  backupStatus.value = preview.direction === 'download' ? '正在应用下载差异' : '正在应用上传差异'
  try {
    const validation = await validateCloudSyncPreview(preview)
    if (!validation.ok) {
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

    const nextPayload = clonePayload(preview.basePayload)
    nextPayload.settings = normalizeSettings(settings)
    for (const item of selectedItems) {
      applyCloudSyncDiffItem(nextPayload.entries, preview.sourcePayload.entries, item)
    }
    const previewStats = cloudSyncSelectionStats(preview.items)
    const selectedStats = cloudSyncSelectionStats(selectedItems)

    if (preview.direction === 'download') {
      const result = await api.saveVault(nextPayload)
      if (!result.ok || !result.data) {
        const failureMessage = result.code === 'CONFLICT'
          ? '本地保险库在应用同步期间已变化，请重新检测差异'
          : result.message || '应用下载差异失败'
        backupStatus.value = failureMessage
        appendCloudSyncLog({
          direction: preview.direction,
          automatic: preview.automatic,
          status: 'error',
          objectName: preview.objectName,
          message: failureMessage,
          selected: selectedStats.selected,
          total: previewStats.total,
          ...cloudSyncDiffCountsForItems(selectedItems)
        })
        if (result.code === 'CONFLICT') await handleVaultWriteError(result, failureMessage)
        else if (options.showErrors !== false) showFailToast(failureMessage)
        if (options.clearPreview && cloudSyncPreview.value === preview) cloudSyncPreview.value = null
        return false
      }
      vault.value = result.data
      syncSettings(vault.value.settings)
      await rememberCloudSyncState(preview.objectName, preview.sourcePayload, vault.value)
      if (selectedEntry.value) {
        selectedEntry.value = findEntry(vault.value.entries, selectedEntry.value.id)
        if (!selectedEntry.value) clearSelectedEntry()
      }
      selectedCloudObjectName.value = ''
      const message = options.successMessage || `已下载 ${selectedItems.length} 项差异`
      backupStatus.value = message
      appendCloudSyncLog({
        direction: preview.direction,
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

    const exported = await api.exportVaultBackupForPayload(nextPayload)
    if (!exported.ok || !exported.data) {
      backupStatus.value = exported.message || '生成上传内容失败'
      appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'error',
        objectName: preview.objectName,
        message: exported.message || '生成上传内容失败',
        selected: selectedStats.selected,
        total: previewStats.total,
        ...cloudSyncDiffCountsForItems(selectedItems)
      })
      if (options.showErrors !== false) showFailToast(exported.message || '生成上传内容失败')
      if (options.clearPreview && cloudSyncPreview.value === preview) cloudSyncPreview.value = null
      return false
    }

    const client = createOssClient()
    const response = await client.uploadFile(preview.objectName, exported.data.content, 'application/json')
    if (response.status !== APIResponseStatus.Success) {
      backupStatus.value = String(response.content || '上传失败')
      appendCloudSyncLog({
        direction: preview.direction,
        automatic: preview.automatic,
        status: 'error',
        objectName: preview.objectName,
        message: String(response.content || '上传失败'),
        selected: selectedStats.selected,
        total: previewStats.total,
        ...cloudSyncDiffCountsForItems(selectedItems)
      })
      if (options.showErrors !== false) showFailToast(String(response.content || '上传失败'))
      if (options.clearPreview && cloudSyncPreview.value === preview) cloudSyncPreview.value = null
      return false
    }
    cloudInfo.value = {
      name: preview.objectName,
      exists: true,
      size: exported.data.content.length,
      lastModified: new Date().toISOString()
    }
    const uploadedPayload = clonePayload(nextPayload)
    uploadedPayload.updatedAt = Number(exported.data.updatedAt || uploadedPayload.updatedAt || 0)
    await rememberCloudSyncState(preview.objectName, uploadedPayload, vault.value || uploadedPayload)
    const message = options.successMessage || `已上传 ${selectedItems.length} 项差异`
    backupStatus.value = options.successMessage || `已上传 ${selectedItems.length} 项差异到 ${settings.oss.bucketName}/${preview.objectName}`
    appendCloudSyncLog({
      direction: preview.direction,
      automatic: preview.automatic,
      status: 'success',
      objectName: preview.objectName,
      message,
      selected: selectedStats.selected,
      total: previewStats.total,
      ...cloudSyncDiffCountsForItems(selectedItems)
    })
    finishCloudSyncApplyPreview(preview, options)
    if (options.showSuccess) showSuccessToast('上传差异已应用')
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '应用同步差异失败')
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

function cloudSyncSelectionStats(items: CloudSyncDiffItem[]) {
  let selected = 0
  let total = 0
  for (const item of items) {
    if (item.changeType === 'modified') {
      total += item.details.length
      selected += item.details.filter((detail) => detail.checked).length
      continue
    }
    total += 1
    if (item.checked) selected += 1
  }
  return { selected, total }
}

function countCloudSyncSelections(items: CloudSyncDiffItem[]) {
  return cloudSyncSelectionStats(items).selected
}

function cloudSyncItemSummary(item: CloudSyncDiffItem) {
  if (item.changeType === 'modified') {
    const stats = cloudSyncSelectionStats([item])
    const summary = stats.total ? `已选 ${stats.selected}/${stats.total} 处` : '无可选字段'
    const fields = item.details.map((detail) => detail.label).join(' · ')
    return [summary, fields].filter(Boolean).join(' · ')
  }
  return `${cloudSyncChangeLabel(item.changeType)} · ${cloudSyncEntryLabel(item)}`
}

function setAllCloudSyncDiffs(checked: boolean) {
  for (const item of cloudSyncPreview.value?.items || []) setCloudSyncItemChecked(item, checked)
}

function cloudSyncDiffCountsForItems(items: CloudSyncDiffItem[]) {
  return {
    added: items.filter((item) => item.changeType === 'added').length,
    modified: items.filter((item) => item.changeType === 'modified').length,
    deleted: items.filter((item) => item.changeType === 'deleted').length
  }
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

function autoCloudSyncManualReviewLabels(items: CloudSyncDiffItem[]) {
  const labels = new Set<string>()
  for (const item of items) {
    if (item.changeType !== 'modified') continue
    for (const detail of item.details) {
      if (CLOUD_SYNC_MANUAL_REVIEW_FIELDS.has(detail.key)) labels.add(CLOUD_SYNC_CHANGE_LABELS[detail.key])
    }
  }
  return [...labels]
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
  const localFingerprint = await cloudSyncPayloadFingerprint(localPayload)
  const state = readCloudSyncState(objectName)
  if (state?.localFingerprint) {
    if (localFingerprint !== state.localFingerprint) return true
    return isLocalPayloadNewerThanRemote(localFreshnessPayload, remotePayload)
  }

  return isLocalPayloadNewerThanRemote(localFreshnessPayload, remotePayload)
}

function isLocalPayloadNewerThanRemote(localPayload: VaultPayload, remotePayload: VaultPayload) {
  const localUpdatedAt = cloudSyncPayloadUpdatedAt(localPayload)
  const remoteUpdatedAt = cloudSyncPayloadUpdatedAt(remotePayload)
  return localUpdatedAt > 0 && (remoteUpdatedAt <= 0 || localUpdatedAt > remoteUpdatedAt)
}

async function rememberCloudSyncState(objectName: string, remotePayload: VaultPayload, localPayload: VaultPayload = remotePayload) {
  try {
    const state = loadCloudSyncStateMap()
    state[cloudSyncStateKey(objectName)] = {
      remoteUpdatedAt: cloudSyncPayloadUpdatedAt(remotePayload),
      remoteFingerprint: await cloudSyncPayloadFingerprint(remotePayload),
      localFingerprint: await cloudSyncPayloadFingerprint(localPayload),
      recordedAt: Date.now()
    }
    localStorage.setItem(CLOUD_SYNC_STATE_KEY, JSON.stringify(state))
  } catch {
    // Sync state is only a safety hint; failing to persist it must not block vault use.
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

function cloudSyncPayloadUpdatedAt(payload: VaultPayload | null | undefined) {
  const value = Number(payload?.updatedAt || 0)
  return Number.isFinite(value) ? value : 0
}

async function cloudSyncPayloadFingerprint(payload: VaultPayload) {
  return sha256Text(JSON.stringify((payload.entries || []).map(cloudSyncEntryFingerprint)))
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
    ...comparableEntry(entry),
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
  return [selectedText, diffText || (item.total ? `差异 ${item.total}` : '')].filter(Boolean).join(' · ') || '无差异'
}

function buildCloudSyncDiff(sourcePayload: VaultPayload, basePayload: VaultPayload): CloudSyncDiffItem[] {
  const sourceIndex = indexEntries(sourcePayload.entries || [])
  const baseIndex = indexEntries(basePayload.entries || [])
  const ids = new Set<string>([...sourceIndex.keys(), ...baseIndex.keys()])
  const items: CloudSyncDiffItem[] = []

  for (const id of ids) {
    const sourceMeta = sourceIndex.get(id)
    const baseMeta = baseIndex.get(id)
    if (sourceMeta && !baseMeta) {
      if (hasMissingAncestor(sourceMeta, baseIndex)) continue
      items.push(makeCloudSyncDiffItem('added', sourceMeta, null))
      continue
    }
    if (!sourceMeta && baseMeta) {
      if (hasMissingAncestor(baseMeta, sourceIndex)) continue
      items.push(makeCloudSyncDiffItem('deleted', null, baseMeta))
      continue
    }
    if (sourceMeta && baseMeta) {
      const changes = diffEntryChanges(sourceMeta, baseMeta, sourceIndex, baseIndex)
      if (changes.length) items.push(makeCloudSyncDiffItem('modified', sourceMeta, baseMeta, changes))
    }
  }

  return items
}

function makeCloudSyncDiffItem(
  changeType: CloudSyncChangeType,
  sourceMeta: EntryIndexMeta | null,
  baseMeta: EntryIndexMeta | null,
  changes: CloudSyncChangeDetail[] = []
): CloudSyncDiffItem {
  const meta = sourceMeta || baseMeta
  const entry = meta?.entry
  return {
    id: entry?.id || '',
    changeType,
    entryKind: entry?.kind === 'folder' ? 'folder' : 'login',
    title: entry?.title || '未命名',
    path: meta?.path || '未命名',
    checked: true,
    details: changes,
    sourceParentId: sourceMeta?.parentId || '',
    sourceIndex: sourceMeta?.index || 0
  }
}

function indexEntries(entries: VaultEntry[], parentId = '', parents: string[] = [], ancestorIds: string[] = [], result = new Map<string, EntryIndexMeta>()) {
  const siblingIds = entries.map((entry) => entry.id)
  entries.forEach((entry, index) => {
    const title = entry.title || '未命名'
    const path = [...parents, title].join(' / ') || title
    result.set(entry.id, {
      entry,
      parentId,
      index,
      path,
      ancestorIds,
      siblingIds
    })
    indexEntries(entry.children || [], entry.id, [...parents, title], [...ancestorIds, entry.id], result)
  })
  return result
}

function hasMissingAncestor(meta: EntryIndexMeta, otherIndex: Map<string, EntryIndexMeta>) {
  return meta.ancestorIds.some((ancestorId) => !otherIndex.has(ancestorId))
}

function diffEntryChanges(
  sourceMeta: EntryIndexMeta,
  baseMeta: EntryIndexMeta,
  sourceIndex: ReadonlyMap<string, EntryIndexMeta>,
  baseIndex: ReadonlyMap<string, EntryIndexMeta>
) {
  const changes: CloudSyncChangeDetail[] = []
  if (hasCloudSyncPositionChanged(sourceMeta.entry.id, sourceMeta, baseMeta, sourceIndex, baseIndex)) {
    changes.push(makeCloudSyncChangeDetail('position', sourceMeta.path, baseMeta.path))
  }
  const source = comparableEntry(sourceMeta.entry)
  const base = comparableEntry(baseMeta.entry)
  for (const key of CLOUD_SYNC_ENTRY_CHANGE_FIELDS) {
    if (JSON.stringify(source[key as keyof typeof source]) !== JSON.stringify(base[key as keyof typeof base])) {
      changes.push(makeCloudSyncChangeDetail(key, source[key as keyof typeof source], base[key as keyof typeof base]))
    }
  }
  return changes
}

function makeCloudSyncChangeDetail(key: CloudSyncChangeField, sourceValue: unknown, baseValue: unknown): CloudSyncChangeDetail {
  return {
    key,
    label: CLOUD_SYNC_CHANGE_LABELS[key],
    sourceText: formatCloudSyncValue(key, sourceValue),
    baseText: formatCloudSyncValue(key, baseValue),
    checked: true
  }
}

function formatCloudSyncValue(key: CloudSyncChangeField, value: unknown) {
  if (key === 'password' || key === 'totpSecret') {
    const text = String(value || '')
    return text ? `已设置（${text.length} 字符）` : '空'
  }
  if (key === 'domains') {
    const domains = Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
    return domains.length ? domains.join('、') : '空'
  }
  if (key === 'deletedAt') {
    return formatUnixTime(Number(value || 0)) || '空'
  }
  if (key === 'kind') {
    return value === 'folder' ? '分组' : '登录'
  }
  if (key === 'status') {
    return cloudSyncStatusLabel(normalizeEntryStatus(value))
  }
  if (key === 'loginAccountSource') {
    return cloudSyncLoginAccountSourceLabel(normalizeLoginAccountSource(value))
  }
  return compactCloudSyncText(String(value || ''))
}

function compactCloudSyncText(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return '空'
  return text.length > 96 ? `${text.slice(0, 96)}...` : text
}

function cloudSyncStatusLabel(status: EntryStatus) {
  if (status === 'disabled') return '已归档'
  if (status === 'trashed') return '回收站'
  return '正常'
}

function cloudSyncLoginAccountSourceLabel(source: LoginAccountSource) {
  return loginAccountSourceOptions.find((option) => option.value === source)?.label || '自动'
}

function comparableEntry(entry: VaultEntry) {
  return {
    kind: entry.kind === 'folder' ? 'folder' : 'login',
    title: entry.title || '',
    status: normalizeEntryStatus(entry.status),
    statusReason: entry.statusReason || '',
    deletedAt: Number(entry.deletedAt || 0),
    domains: Array.isArray(entry.domains) ? [...entry.domains] : [],
    username: entry.username || '',
    email: entry.email || '',
    password: entry.password || '',
    phone: entry.phone || '',
    loginAccountSource: normalizeLoginAccountSource(entry.loginAccountSource),
    note: entry.note || '',
    totpSecret: entry.totpSecret || ''
  }
}

function applyCloudSyncDiffItem(targetEntries: VaultEntry[], sourceEntries: VaultEntry[], item: CloudSyncDiffItem) {
  if (item.changeType === 'deleted') {
    removeEntryCopies(targetEntries, item.id)
    return
  }

  const sourceEntry = findEntry(sourceEntries, item.id)
  if (!sourceEntry) return
  if (item.changeType === 'added') {
    removeEntryCopies(targetEntries, item.id)
    insertEntryAt(targetEntries, item.sourceParentId, clonePayload(sourceEntry), item.sourceIndex)
    return
  }

  const currentEntry = findEntry(targetEntries, item.id)
  if (!currentEntry) return
  for (const detail of item.details) {
    if (detail.checked && detail.key !== 'position') {
      applyCloudSyncEntryField(currentEntry, sourceEntry, detail.key)
    }
  }
  if (item.details.some((detail) => detail.checked && detail.key === 'position')) {
    const moved = takeEntry(targetEntries, item.id)
    if (moved) insertEntryAt(targetEntries, item.sourceParentId, moved.entry, item.sourceIndex)
  }
}

function applyCloudSyncEntryField(target: VaultEntry, source: VaultEntry, key: CloudSyncChangeField) {
  switch (key) {
    case 'position':
      return
    case 'kind':
      target.kind = source.kind === 'folder' ? 'folder' : 'login'
      if (target.kind === 'folder') target.children = target.children || []
      return
    case 'title':
      target.title = source.title || ''
      return
    case 'status':
      target.status = normalizeEntryStatus(source.status)
      target.statusUpdatedAt = Number(source.statusUpdatedAt || target.statusUpdatedAt || 0)
      return
    case 'statusReason':
      target.statusReason = source.statusReason || ''
      return
    case 'deletedAt':
      target.deletedAt = Number(source.deletedAt || 0)
      return
    case 'domains':
      target.domains = Array.isArray(source.domains) ? [...source.domains] : []
      return
    case 'username':
      target.username = source.username || ''
      return
    case 'email':
      target.email = source.email || ''
      return
    case 'password':
      target.password = source.password || ''
      return
    case 'phone':
      target.phone = source.phone || ''
      return
    case 'loginAccountSource':
      target.loginAccountSource = normalizeLoginAccountSource(source.loginAccountSource)
      return
    case 'note':
      target.note = source.note || ''
      return
    case 'totpSecret':
      target.totpSecret = source.totpSecret || ''
      return
  }
}

function cloudSyncChangeLabel(changeType: CloudSyncChangeType) {
  if (changeType === 'added') return '新增'
  if (changeType === 'modified') return '修改'
  return '删除'
}

function cloudSyncEntryLabel(item: CloudSyncDiffItem) {
  return item.entryKind === 'folder' ? '分组' : '登录'
}

function emptyCloudPayload(): VaultPayload {
  return {
    version: 1,
    revision: 1,
    entries: [],
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
  await navigator.clipboard?.writeText(value)
  showSuccessToast('已复制')
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

function createOssClient() {
  const oss = normalizeSettings(settings).oss
  return new AliyunOSSAPI(oss.bucketName, oss.accessKeyId, oss.accessKeySecret, oss.region)
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

function toCloudBackupInfo(value: OSSFileInfo): CloudBackupInfo {
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
  entry.loginAccountSource = normalizeLoginAccountSource(entry.loginAccountSource)
  entry.domains = domainText.value
    .split(/[\n,，\s]+/)
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''))
    .filter(Boolean)
  if (entry.kind === 'folder') {
    entry.domains = []
    entry.children = entry.children || []
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
  const now = Math.floor(Date.now() / 1000)
  const nextStatus = normalizeEntryStatus(status)
  entry.status = nextStatus
  entry.statusReason = nextStatus === 'active' ? '' : reason
  entry.statusUpdatedAt = now
  entry.deletedAt = nextStatus === 'trashed' ? now : 0
  appendEntryHistory(entry, nextStatus === 'active' ? 'restored' : nextStatus, reason)
}

function appendEntryHistory(entry: VaultEntry, action: 'created' | 'updated' | 'disabled' | 'restored' | 'trashed', note = '') {
  const history = Array.isArray(entry.history) ? entry.history : []
  history.unshift({
    id: makeId(),
    action,
    at: Math.floor(Date.now() / 1000),
    title: entry.title || '',
    username: entry.username || '',
    email: entry.email || '',
    phone: entry.phone || '',
    domains: [...(entry.domains || [])],
    note
  })
  entry.history = history.slice(0, 20)
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
  selectedEntry.value = null
  detailOpen.value = false
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

function filterEntries(entries: VaultEntry[], term: string): VaultEntry[] {
  if (!term) return entries
  return entries
    .map((entry) => {
      if (!isVisibleInMainList(entry)) return null
      const text = [entry.title, entry.username, entry.email, entry.phone, ...(entry.domains || [])].join(' ').toLowerCase()
      if (entry.kind === 'folder') {
        const children = filterEntries(entry.children || [], term)
        if (text.includes(term) || children.length) return { ...entry, children }
        return null
      }
      return text.includes(term) ? entry : null
    })
    .filter(Boolean) as VaultEntry[]
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children || [])])
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
  const rawValue = localStorage.getItem(UI_SCALE_KEY)
  if (rawValue === null || rawValue === '') return 50
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.round(value), 1), 100)
}

function loadFontSize() {
  const rawValue = localStorage.getItem(FONT_SIZE_KEY)
  if (rawValue === null || rawValue === '') return 100
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return 100
  return clampSliderValue(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
}

function setUiScaleDraft(value: number | number[]) {
  uiScalePercent.value = clampSliderValue(value, 1, 100)
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

function applyLayoutScale(save = true) {
  if (save) localStorage.setItem(UI_SCALE_KEY, String(uiScalePercent.value))
  document.documentElement.style.setProperty('--ui-scale', String(uiScaleFromLevel(uiScalePercent.value)))
  applyTypographyScale()
}

function applyFontSize(save = true) {
  if (save) localStorage.setItem(FONT_SIZE_KEY, String(fontSizePercent.value))
  applyTypographyScale()
}

function applyTypographyScale() {
  const scale = uiScaleFromLevel(uiScalePercent.value) * (fontSizePercent.value / 100)
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--font-scale', String(fontSizePercent.value / 100))
  rootStyle.setProperty('--app-font-sm', px(12 * scale))
  rootStyle.setProperty('--app-font-md', px(14 * scale))
  rootStyle.setProperty('--app-font-lg', px(16 * scale))
  rootStyle.setProperty('--app-font-xl', px(22 * scale))
}

function uiScaleFromLevel(level: number) {
  if (level <= 50) {
    return UI_SCALE_MIN + ((level - 1) / 49) * (UI_SCALE_BASE - UI_SCALE_MIN)
  }
  return UI_SCALE_BASE + ((level - 50) / 50) * (UI_SCALE_MAX - UI_SCALE_BASE)
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
  if (searchOpen.value || keyword.value) {
    keyword.value = ''
    searchOpen.value = false
    return
  }
  dragMode.value = false
  searchOpen.value = true
  nextTick(() => searchInput.value?.focus?.())
}

function openDrawer() {
  createMenuOpen.value = false
  moreMenuOpen.value = false
  drawerOpen.value = true
  loadAppInfo()
  if (drawerSection.value === 'settings') loadPluginListenerState()
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

function resetPasswordDraft() {
  changePasswordValue.value = ''
  changePasswordConfirm.value = ''
}

function openPluginDetail() {
  pluginDetailOpen.value = true
  loadPluginListenerState()
}

function selectDrawerSection(section: typeof drawerSection.value) {
  drawerSection.value = section
  if (section === 'settings') loadPluginListenerState()
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
  const available = workspaceGrid.value?.clientWidth || window.innerWidth
  const max = Math.max(340, Math.min(640, available - 420))
  return Math.round(Math.min(Math.max(340, value), max))
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

function stopPaneResize() {
  if (!resizingPane) return
  resizingPane = false
  localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth.value))
  document.body.classList.remove('is-resizing-pane')
  window.removeEventListener('pointermove', resizePane)
}
</script>
