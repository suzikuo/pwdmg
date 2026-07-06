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
        <van-search v-model="keyword" shape="round" placeholder="搜索标题、账号、域名" />
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
              @copy="copyText"
              @toggle-password="showPassword = !showPassword"
              @refresh-totp="refreshTotp()"
            />
          </template>
          <van-empty v-else image="search" description="选择一个登录条目查看详情" />
        </aside>
      </div>
    </section>

    <van-popup v-model:show="detailOpen" position="bottom" round class="detail-sheet" :class="{ 'is-expanded': detailSheetExpanded }" :duration="0.12" lazy-render>
      <div class="sheet-inner" v-if="selectedEntry">
        <div class="sheet-handle" @pointerdown="startSheetHandleDrag($event, 'detail')"></div>
        <DetailContent
          :entry="selectedEntry"
          :show-password="showPassword"
          :password-mask="passwordMask"
          :totp-code="totpCode"
          :totp-remaining="totpRemaining"
          :totp-progress="totpProgress"
          @edit="openEdit"
          @delete="deleteEntry"
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

    <van-popup v-model:show="editorOpen" position="bottom" round class="editor-popup" :class="{ 'is-expanded': editorSheetExpanded }" :duration="0.12" lazy-render>
      <div class="sheet-inner" @focusin="scrollFocusedEditorFieldIntoView">
        <div class="sheet-handle" @pointerdown="startSheetHandleDrag($event, 'editor')"></div>
        <van-nav-bar safe-area-inset-top :title="editingId ? '编辑条目' : '新建条目'" left-arrow @click-left="editorOpen = false" />
        <van-form class="editor-form" @submit="saveEntry">
          <van-field v-model="form.title" label="名称" placeholder="例如 Github" :rules="[{ required: true }]" />
          <van-field v-if="form.kind === 'login'" v-model="domainText" label="域名" type="textarea" autosize placeholder="github.com，多行或逗号分隔" />
          <template v-if="form.kind === 'login'">
            <van-field v-model="form.username" label="账号" autocomplete="username" placeholder="用户名/账号名" />
            <van-field v-model="form.email" label="邮箱" type="email" autocomplete="email" placeholder="邮箱地址" />
            <van-field v-model="form.password" label="密码" type="password" autocomplete="current-password" placeholder="密码" />
            <van-field v-model="form.phone" label="手机" autocomplete="tel" placeholder="手机号" />
            <div class="account-source-field">
              <span>自动填充账号</span>
              <van-radio-group v-model="form.loginAccountSource" class="account-source-options" direction="horizontal">
                <van-radio v-for="option in loginAccountSourceOptions" :key="option.value" :name="option.value">
                  {{ option.label }}
                </van-radio>
              </van-radio-group>
            </div>
            <van-field v-model="form.totpSecret" label="TOTP" placeholder="Base32 密钥" />
            <van-field v-model="form.note" label="备注" type="textarea" autosize placeholder="安全问题、登录提示等" />
            <div v-if="editingId && form.totpSecret" class="totp-box">
              <span>{{ totpCode || '------' }}</span>
              <button class="inline-icon-button" type="button" aria-label="刷新验证码" @click.prevent="refreshTotp()">
                <van-icon name="replay" />
              </button>
            </div>
          </template>
          <van-button block type="primary" native-type="submit" :loading="busy">保存</van-button>
        </van-form>
      </div>
    </van-popup>

    <van-popup v-model:show="drawerOpen" position="left" class="nav-drawer" :duration="0.16" lazy-render>
      <aside class="drawer-shell" :class="{ 'is-detail': drawerDetailOpen }">
        <div class="drawer-head drawer-menu-part">
          <div class="brand-mark drawer-mark">PM</div>
          <div>
            <strong>My Password</strong>
            <span>{{ stats.logins }} 登录 · {{ stats.folders }} 分组</span>
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
        <section v-else-if="drawerSection === 'backup'" class="drawer-panel">
          <p class="settings-note">上传会覆盖固定云端文件；备份会直接上传一个带日期的云端文件，不在本地留存。下载会覆盖本机保险库。</p>
          <van-form @submit="saveSettings">
            <van-field v-model="settings.oss.bucketName" label="Bucket" placeholder="OSS Bucket 名称" />
            <van-field v-model="settings.oss.accessKeyId" label="Key ID" placeholder="AccessKey ID" />
            <van-field v-model="settings.oss.accessKeySecret" label="Key Secret" type="password" placeholder="AccessKey Secret" />
            <van-field v-model="settings.oss.region" label="Region" placeholder="oss-cn-hangzhou" />
            <van-field v-model="settings.oss.objectName" label="文件名" placeholder="mypwdmg-vault.json" />
            <van-button block type="primary" native-type="submit">保存云配置</van-button>
          </van-form>
          <div class="backup-actions">
            <van-button class="backup-action-button" size="small" type="primary" icon="upgrade" :loading="cloudBusy" @click="uploadCloudBackup">上传</van-button>
            <van-button class="backup-action-button" size="small" plain type="primary" icon="notes-o" :loading="cloudBusy" @click="backupCloudVault">备份</van-button>
            <van-button class="backup-action-button" size="small" plain type="primary" icon="down" :loading="cloudBusy" @click="downloadCloudBackup">下载</van-button>
          </div>
          <p v-if="backupStatus" class="settings-note">{{ backupStatus }}</p>
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
              <strong>{{ pluginListener.mode === 'packaged' ? (pluginListener.hostExecutableExists ? '已找到' : '缺少 Host exe') : '开发模式' }}</strong>
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
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import DetailContent from './components/DetailContent.vue'
import EntryList from './components/EntryList.vue'
import { AliyunOSSAPI, APIResponseStatus, DEFAULT_OSS_OBJECT_NAME, normalizeObjectName } from './services/aliyunOss'
import { api } from './services/api'
import { generateTotp } from './services/totp'
import type { AndroidAutofillState, AppState, EntryKind, LoginAccountSource, PluginListenerState, VaultEntry, VaultPayload } from './types'

type ThemeMode = 'light' | 'dark'
type CssVars = Record<string, string>
type MoveEntryPayload = {
  entryId: string
  targetParentId: string
  targetIndex: number
}

const LOGIN_ACCOUNT_SOURCES = new Set<LoginAccountSource>(['auto', 'username', 'email', 'phone'])

const DESKTOP_QUERY = '(min-width: 820px)'
const PANE_WIDTH_KEY = 'mypwdmg.desktopPaneWidth'
const UI_SCALE_KEY = 'mypwdmg.uiScaleLevel.v2'
const FONT_SIZE_KEY = 'mypwdmg.fontSizePercent'
const UI_SCALE_BASE = 0.92
const UI_SCALE_MIN = 0.5
const UI_SCALE_MAX = 1.3
const FONT_SIZE_MIN = 80
const FONT_SIZE_MAX = 130
const TOTP_PERIOD_SECONDS = 30
const BACK_EXIT_INTERVAL = 1600

const state = reactive<AppState>({
  hasVault: false,
  locked: true,
  expiresAt: 0,
  legacyAvailable: false,
  vaultPath: ''
})
const stateLoading = ref(true)
const stateError = ref('')
const busy = ref(false)
const cloudBusy = ref(false)
const pluginBusy = ref(false)
const androidAutofillBusy = ref(false)
const backupStatus = ref('')
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changePasswordValue = ref('')
const changePasswordConfirm = ref('')
const pluginExtensionId = ref('')
const importLegacy = ref(true)
const keyword = ref('')
const vault = ref<VaultPayload | null>(null)
const editorOpen = ref(false)
const detailOpen = ref(false)
const editorSheetExpanded = ref(false)
const detailSheetExpanded = ref(false)
const drawerOpen = ref(false)
const createSheetOpen = ref(false)
const createMenuOpen = ref(false)
const moreMenuOpen = ref(false)
const passwordSheetOpen = ref(false)
const pluginDetailOpen = ref(false)
const createParentId = ref('')
const dragMode = ref(false)
const drawerDetailOpen = ref(false)
const drawerSection = ref<'settings' | 'updates' | 'backup'>('settings')
const searchOpen = ref(false)
const uiScalePercent = ref(loadUiScale())
const fontSizePercent = ref(loadFontSize())
const editingId = ref('')
const editingParentId = ref('')
const domainText = ref('')
const totpCode = ref('')
const selectedEntry = ref<VaultEntry | null>(null)
const pluginListener = ref<PluginListenerState | null>(null)
const androidAutofill = ref<AndroidAutofillState | null>(null)
const showPassword = ref(false)
const totpRemaining = ref(TOTP_PERIOD_SECONDS)
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
    objectName: DEFAULT_OSS_OBJECT_NAME
  }
})
const createActions = [
  { name: '登录', subname: '账号、密码、TOTP', kind: 'login' as EntryKind },
  { name: '分组', subname: '整理一组条目', kind: 'folder' as EntryKind }
]
const createMenuActions = [
  { text: '登录', icon: 'records-o', kind: 'login' as EntryKind },
  { text: '分组', icon: 'cluster-o', kind: 'folder' as EntryKind }
]
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
const filteredEntries = computed(() => filterEntries(vault.value?.entries || [], keyword.value.trim().toLowerCase()))
const passwordMask = computed(() => selectedEntry.value?.password ? '••••••••••••' : '未设置')
const totpProgress = computed(() => Math.round((totpRemaining.value / TOTP_PERIOD_SECONDS) * 100))
const drawerSectionTitle = computed(() => {
  if (drawerSection.value === 'settings') return '设置'
  if (drawerSection.value === 'updates') return '更新'
  return '备份'
})
const pluginListenerStatus = computed(() => {
  const listener = pluginListener.value
  if (!listener) return '未检测'
  if (!listener.supported) return '仅 Windows 支持'
  if (!listener.enabled) return '未开启'
  const browsers = [
    listener.chromeRegistered ? 'Chrome' : '',
    listener.edgeRegistered ? 'Edge' : ''
  ].filter(Boolean)
  return browsers.length ? `${browsers.join('/')} 已开启` : '未开启'
})
const showPluginSettings = computed(() => pluginListener.value?.supported === true)
const showAndroidAutofillSettings = computed(() => androidAutofill.value?.supported === true)
const androidAutofillStatus = computed(() => {
  const state = androidAutofill.value
  if (!state) return '未检测'
  if (!state.supported) return '不支持'
  return state.enabled ? '已开启' : '去设置'
})
const desktopGridStyle = computed<CssVars>(() => {
  if (!isWide.value) return {} as CssVars
  return { '--vault-pane-width': `${paneWidth.value}px` }
})
const stats = computed(() => {
  const flat = flattenEntries(vault.value?.entries || [])
  return {
    logins: flat.filter((entry) => entry.kind === 'login').length,
    folders: flat.filter((entry) => entry.kind === 'folder').length,
    totp: flat.filter((entry) => entry.kind === 'login' && entry.totpSecret).length
  }
})

let desktopMediaQuery: MediaQueryList | null = null
let drawerMediaQuery: MediaQueryList | null = null
let resizingPane = false
let totpTimer = 0
let totpCurrentStep = -1
let lastBackRequestAt = 0
let sheetDrag: { kind: 'detail' | 'editor'; startY: number; pointerId: number; expanded: boolean } | null = null

onMounted(() => {
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
  window.addEventListener('focus', loadAndroidAutofillState)
  window.visualViewport?.addEventListener('resize', updateEditorViewportHeight)
  window.visualViewport?.addEventListener('scroll', updateEditorViewportHeight)
  window.__mypwdmgHandleNativeBack = handleNativeBack
  updateEditorViewportHeight()
  loadState()
  loadPluginListenerState()
  loadAndroidAutofillState()
})

watch(drawerOpen, (open) => {
  if (!open) drawerDetailOpen.value = false
})
watch(detailOpen, (open) => {
  if (!open) detailSheetExpanded.value = false
})
watch(editorOpen, (open) => {
  if (!open) editorSheetExpanded.value = false
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
  window.removeEventListener('focus', loadAndroidAutofillState)
  window.visualViewport?.removeEventListener('resize', updateEditorViewportHeight)
  window.visualViewport?.removeEventListener('scroll', updateEditorViewportHeight)
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
  updateEditorViewportHeight()
  const target = event.target as HTMLElement | null
  const field = target?.closest?.('.van-field') as HTMLElement | null
  const element = field || target
  if (!element) return
  window.setTimeout(() => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }), 80)
  window.setTimeout(() => element.scrollIntoView({ block: 'center', inline: 'nearest' }), 260)
}

function updateEditorViewportHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight
  const maxHeight = Math.max(280, Math.floor(viewportHeight - 10))
  document.documentElement.style.setProperty('--sheet-viewport-height', `${Math.floor(viewportHeight)}px`)
  document.documentElement.style.setProperty('--editor-popup-max-height', `${maxHeight}px`)
}

function startSheetHandleDrag(event: PointerEvent, kind: 'detail' | 'editor') {
  if (event.button > 0) return
  event.preventDefault()
  sheetDrag = {
    kind,
    startY: event.clientY,
    pointerId: event.pointerId,
    expanded: kind === 'detail' ? detailSheetExpanded.value : editorSheetExpanded.value
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleSheetHandleDrag, { passive: false })
  window.addEventListener('pointerup', stopSheetHandleDrag)
  window.addEventListener('pointercancel', stopSheetHandleDrag)
}

function handleSheetHandleDrag(event: PointerEvent) {
  if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return
  const deltaY = event.clientY - sheetDrag.startY
  if (deltaY < -26) {
    setSheetExpanded(sheetDrag.kind, true)
    sheetDrag.expanded = true
    event.preventDefault()
    return
  }
  if (deltaY > 34 && sheetDrag.expanded) {
    setSheetExpanded(sheetDrag.kind, false)
    sheetDrag.expanded = false
    event.preventDefault()
  }
}

function stopSheetHandleDrag() {
  if (!sheetDrag) return
  sheetDrag = null
  window.removeEventListener('pointermove', handleSheetHandleDrag)
  window.removeEventListener('pointerup', stopSheetHandleDrag)
  window.removeEventListener('pointercancel', stopSheetHandleDrag)
}

function setSheetExpanded(kind: 'detail' | 'editor', expanded: boolean) {
  if (kind === 'detail') detailSheetExpanded.value = expanded
  else editorSheetExpanded.value = expanded
}

async function loadState() {
  stateLoading.value = true
  stateError.value = ''
  const result = await api.getState()
  if (result.ok && result.data) {
    Object.assign(state, result.data)
    if (state.hasVault) {
      if (state.locked) await unlockWithPassword('', true)
      else await loadUnlockedVault()
    }
  } else {
    stateError.value = result.message || '无法连接本地保险库'
  }
  stateLoading.value = false
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
  showSuccessToast(result.data.migrated ? `已迁移 ${result.data.migrated} 条` : '保险库已创建')
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
  return true
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
    domains: [],
    username: '',
    email: '',
    password: '',
    phone: '',
    loginAccountSource: 'auto',
    note: '',
    totpSecret: '',
    children: []
  }
}

function makeId() {
  return crypto.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resetForm(entry: VaultEntry) {
  Object.assign(form, emptyEntry(entry.kind), JSON.parse(JSON.stringify(entry)))
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

async function saveEntry() {
  if (!vault.value) return
  busy.value = true
  const payload = cloneVault()
  const entry = normalizeForm()
  if (editingId.value) {
    replaceEntry(payload.entries, editingId.value, entry)
  } else {
    insertEntry(payload.entries, editingParentId.value, entry)
  }
  const result = await api.saveVault(payload)
  busy.value = false
  if (!result.ok || !result.data) return showFailToast(result.message || '保存失败')
  vault.value = result.data
  syncSettings(vault.value.settings)
  selectedEntry.value = findEntry(vault.value.entries, entry.id)
  editorOpen.value = false
  showSuccessToast('已保存')
}

async function deleteEntry(entryId: string) {
  if (!vault.value) return
  const target = findEntry(vault.value.entries, entryId)
  if (!target) return showToast('条目不存在')
  const title = target.title || '未命名'
  const childCount = target.kind === 'folder' ? flattenEntries(target.children || []).length : 0
  const firstMessage =
    target.kind === 'folder'
      ? childCount > 0
        ? `分组「${title}」下的 ${childCount} 项内容也会一起删除，确定继续吗？`
        : `确定删除空分组「${title}」吗？`
      : `确定删除登录「${title}」吗？`

  try {
    await showConfirmDialog({
      title: target.kind === 'folder' ? '删除分组' : '删除登录',
      message: firstMessage,
      confirmButtonText: '继续删除',
      confirmButtonColor: '#ee0a24'
    })
    await showConfirmDialog({
      title: '再次确认',
      message: '删除后无法从保险库恢复，确定永久删除吗？',
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
  if (!result.ok || !result.data) return showFailToast(result.message || '删除失败')
  vault.value = result.data
  if (shouldClearSelection) {
    selectedEntry.value = null
    detailOpen.value = false
    stopTotpTimer()
  }
  showSuccessToast('已删除')
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
  if (!result.ok || !result.data) return showFailToast(result.message || '移动失败')
  vault.value = result.data
  if (selectedEntry.value) selectedEntry.value = findEntry(vault.value.entries, selectedEntry.value.id)
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
  const result = await api.changePassword(changePasswordValue.value)
  busy.value = false
  if (!result.ok || !result.data) return showFailToast(result.message || '修改失败')
  Object.assign(state, result.data)
  changePasswordValue.value = ''
  changePasswordConfirm.value = ''
  passwordSheetOpen.value = false
  showSuccessToast('主密码已修改')
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

async function persistSettings(options: { closeDrawer?: boolean; toast?: boolean } = {}) {
  if (!vault.value) return
  const payload = cloneVault()
  payload.settings = normalizeSettings(settings)
  const result = await api.saveVault(payload)
  if (!result.ok || !result.data) {
    showFailToast(result.message || '保存失败')
    return false
  }
  vault.value = result.data
  syncSettings(vault.value.settings)
  if (options.closeDrawer) drawerOpen.value = false
  if (options.toast) showSuccessToast('设置已保存')
  return true
}

async function uploadCloudBackup() {
  await uploadCloudVault(false)
}

async function backupCloudVault() {
  await uploadCloudVault(true)
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
    const saved = await persistSettings({ closeDrawer: false, toast: false })
    if (!saved) return
    const exported = await api.exportVaultBackup()
    if (!exported.ok || !exported.data) {
      showFailToast(exported.message || '导出保险库失败')
      return
    }

    const client = createOssClient()
    const response = await client.uploadFile(objectName, exported.data.content, 'application/json')
    if (response.status !== APIResponseStatus.Success) {
      showFailToast(String(response.content || (asDatedBackup ? '备份失败' : '上传失败')))
      return
    }
    backupStatus.value = `已上传到 ${settings.oss.bucketName}/${objectName}`
    showSuccessToast(asDatedBackup ? '云端备份已创建' : '云端文件已上传')
  } finally {
    cloudBusy.value = false
  }
}

async function downloadCloudBackup() {
  if (!vault.value || cloudBusy.value) return
  if (!validateOssSettings()) return

  try {
    await confirmTwice({
      title: '下载云端备份',
      message: `将从 OSS 下载 ${settings.oss.objectName}。继续吗？`,
      secondTitle: '再次确认覆盖',
      secondMessage: '下载后会覆盖本机保险库并锁定当前会话。覆盖前会先保留一份本地备份。',
      confirmButtonText: '下载并覆盖'
    })
  } catch {
    return
  }

  cloudBusy.value = true
  backupStatus.value = ''
  try {
    const saved = await persistSettings({ closeDrawer: false, toast: false })
    if (!saved) return
    const client = createOssClient()
    const response = await client.downloadFile(settings.oss.objectName, 'text/plain')
    if (response.status !== APIResponseStatus.Success || typeof response.content !== 'string') {
      showFailToast(String(response.content || '下载失败'))
      return
    }

    const imported = await api.importVaultBackup(response.content)
    if (!imported.ok || !imported.data) {
      showFailToast(imported.message || '导入备份失败')
      return
    }

    Object.assign(state, imported.data.state)
    vault.value = null
    selectedEntry.value = null
    detailOpen.value = false
    drawerOpen.value = false
    stopTotpTimer()
    backupStatus.value = imported.data.backupPath ? `本地覆盖前备份：${imported.data.backupPath}` : ''
    showSuccessToast('已下载，请重新解锁')
  } finally {
    cloudBusy.value = false
  }
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
  if (reset) totpRemaining.value = TOTP_PERIOD_SECONDS
}

function updateTotpClock(entryId: string) {
  if (selectedEntry.value?.id !== entryId || !selectedEntry.value?.totpSecret) {
    stopTotpTimer()
    return
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const elapsed = nowSeconds % TOTP_PERIOD_SECONDS
  const step = Math.floor(nowSeconds / TOTP_PERIOD_SECONDS)
  totpRemaining.value = elapsed === 0 ? TOTP_PERIOD_SECONDS : TOTP_PERIOD_SECONDS - elapsed
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
      objectName: normalizeObjectName(String(oss.objectName || DEFAULT_OSS_OBJECT_NAME))
    }
  }
}

function validateOssSettings() {
  syncSettings(settings)
  if (!settings.oss.bucketName || !settings.oss.accessKeyId || !settings.oss.accessKeySecret || !settings.oss.region) {
    showFailToast('请先填写完整 OSS 配置')
    return false
  }
  if (!crypto.subtle) {
    showFailToast('当前环境不支持 Web Crypto')
    return false
  }
  return true
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
  return `${objectName}.${datePart}-${timePart}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
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
    ? value as LoginAccountSource
    : 'auto'
}

function cloneVault(): VaultPayload {
  return JSON.parse(JSON.stringify(vault.value))
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
}

function openDrawer() {
  createMenuOpen.value = false
  moreMenuOpen.value = false
  drawerOpen.value = true
  loadAndroidAutofillState()
  if (!isDrawerWide.value) drawerDetailOpen.value = false
}

function closeTopMenusOnOutside(event: PointerEvent) {
  if (!createMenuOpen.value && !moreMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.top-menu-popover, .top-menu-trigger')) return
  createMenuOpen.value = false
  moreMenuOpen.value = false
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
