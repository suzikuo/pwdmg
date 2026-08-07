<template>
  <van-popup
    :show="open"
    position="left"
    class="nav-drawer"
    :duration="0.16"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <aside class="drawer-shell" :class="{ 'is-detail': detailOpen }">
      <div class="drawer-head drawer-menu-part">
        <div class="brand-mark drawer-mark">PM</div>
        <div>
          <strong>My Password</strong>
          <span>v{{ displayAppVersion }} · {{ stats.logins }} 登录 · {{ stats.folders }} 分组</span>
        </div>
      </div>

      <nav class="drawer-nav drawer-menu-part" aria-label="设置导航">
        <button type="button" :class="{ active: section === 'settings' }" @click="selectSection('settings')">
          <van-icon name="setting-o" />
          <span>设置</span>
        </button>
        <button v-if="showUpdateSettings" type="button" :class="{ active: section === 'updates' }" @click="selectSection('updates')">
          <van-icon name="replay" />
          <span>更新</span>
        </button>
        <button type="button" :class="{ active: section === 'backup' }" @click="selectSection('backup')">
          <van-icon name="description-o" />
          <span>备份</span>
        </button>
        <button type="button" :class="{ active: section === 'system' }" @click="selectSection('system')">
          <van-icon name="cluster-o" />
          <span>系统分组</span>
        </button>
      </nav>

      <div class="drawer-detail-head">
        <button class="inline-icon-button" type="button" aria-label="返回" @click="emit('update:detail-open', false)">
          <van-icon name="arrow-left" />
        </button>
        <strong>{{ sectionTitle }}</strong>
      </div>

      <section v-if="section === 'settings'" class="drawer-panel settings-panel">
        <div class="settings-group">
          <div class="settings-group-title">外观</div>
          <van-cell center title="深色模式" label="适合夜间或 OLED 屏">
            <template #right-icon>
              <van-switch :model-value="theme === 'dark'" size="22" @update:model-value="emit('update-theme', $event ? 'dark' : 'light')" />
            </template>
          </van-cell>
          <div class="scale-setting">
            <div class="scale-setting-head"><span>界面缩放</span><strong>{{ uiScalePercent }}%</strong></div>
            <van-slider
              class="compact-slider"
              :model-value="uiScalePercent"
              :min="uiScaleMin"
              :max="uiScaleMax"
              :step="1"
              button-size="14px"
              @update:model-value="emit('update-ui-scale', $event)"
              @change="emit('commit-ui-scale', $event)"
            />
          </div>
          <div class="scale-setting">
            <div class="scale-setting-head"><span>字体大小</span><strong>{{ fontSizePercent }}%</strong></div>
            <van-slider
              class="compact-slider"
              :model-value="fontSizePercent"
              :min="80"
              :max="130"
              :step="1"
              button-size="14px"
              @update:model-value="emit('update-font-size', $event)"
              @change="emit('commit-font-size', $event)"
            />
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">安全</div>
          <van-cell center is-link title="主密码" label="修改或清空主密码" @click="emit('open-password-sheet')">
            <template #value><span class="settings-entry-value">修改</span></template>
          </van-cell>
          <van-cell center is-link title="密码健康" :label="passwordHealthLabel" @click="emit('open-password-health')">
            <template #value><span class="settings-entry-value">{{ passwordHealthScore }}</span></template>
          </van-cell>
          <van-cell center title="自动锁定" :label="sessionTimeoutMinutes === 0 ? '已关闭，仅手动锁定' : '已开启'">
            <template #right-icon>
              <van-switch
                :model-value="sessionTimeoutMinutes > 0"
                size="18px"
                @update:model-value="toggleSessionAutoLock(Boolean($event))"
              />
            </template>
          </van-cell>
          <van-cell v-if="sessionTimeoutMinutes > 0" center title="等待时间" :label="`无操作 ${sessionTimeoutMinutes} 分钟后锁定`">
            <template #right-icon>
              <van-stepper
                :model-value="sessionTimeoutMinutes"
                :min="Math.max(1, sessionTimeoutMin)"
                :max="sessionTimeoutMax"
                integer
                button-size="24px"
                @update:model-value="emit('update-session-timeout', $event)"
              />
            </template>
          </van-cell>
        </div>

        <div v-if="showAndroidAutofillSettings" class="settings-group">
          <div class="settings-group-title">Android 自动填充</div>
          <van-cell center is-link title="自动填充服务" label="系统会打开授权确认页" @click="emit('open-android-settings')">
            <template #value><strong :class="['plugin-status-pill', androidAutofillEnabled ? 'is-on' : 'is-off']">{{ androidAutofillStatus }}</strong></template>
          </van-cell>
        </div>

        <div v-if="showPluginSettings" class="settings-group">
          <div class="settings-group-title">浏览器插件</div>
          <van-cell center is-link title="插件监听" label="Chrome / Edge 自动填充" @click="emit('open-plugin')">
            <template #value><strong :class="['plugin-status-pill', pluginEnabled ? 'is-on' : 'is-off']">{{ pluginStatus }}</strong></template>
          </van-cell>
        </div>
      </section>

      <section v-else-if="section === 'updates' && showUpdateSettings" class="drawer-panel update-panel">
        <div class="settings-group">
          <div class="settings-group-title">应用更新</div>
          <p class="settings-note compact-note">使用 GitHub Release 的 manifest 检查版本。下载包必须通过 SHA256 校验后才能安装。</p>
          <van-field :model-value="updateManifestUrl" label="Manifest" type="textarea" autosize :placeholder="defaultUpdateManifestUrl" @update:model-value="emit('update-manifest-url', String($event))" />
          <div class="update-actions">
            <van-button size="small" type="primary" icon="replay" :loading="updateBusy === 'check'" @click="emit('check-update')">检查</van-button>
            <van-button size="small" plain type="primary" icon="down" :disabled="!updateAvailable" :loading="updateBusy === 'download'" @click="emit('download-update')">下载</van-button>
            <van-button size="small" plain type="danger" icon="upgrade" :disabled="!downloadedUpdatePath || !canApplyUpdate" :loading="updateBusy === 'apply'" @click="emit('apply-update')">{{ updateInstallButtonText }}</van-button>
          </div>
          <div v-if="updateInfo" class="update-summary">
            <div><span>当前版本</span><strong>{{ updateInfo.currentVersion }}</strong></div>
            <div><span>最新版本</span><strong>{{ updateInfo.latestVersion }}</strong></div>
            <div><span>安装方式</span><strong>{{ updateInstallModeText }}</strong></div>
          </div>
          <div v-if="updateBusy && updateProgress" class="update-progress">
            <div class="update-progress-head"><span>{{ updateProgressLabel }}</span><strong v-if="updateProgressPercent > 0">{{ updateProgressPercent }}%</strong></div>
            <div class="update-progress-track"><span :style="{ width: `${updateProgressPercent || 12}%` }"></span></div>
          </div>
          <p v-if="downloadedUpdatePath" class="settings-note compact-note">已下载：{{ downloadedUpdatePath }}</p>
          <p v-if="updateStatus" class="settings-note compact-note">{{ updateStatus }}</p>
        </div>
      </section>

      <section v-else-if="section === 'backup'" ref="backupPanel" class="drawer-panel backup-panel">
        <p class="settings-note">上传/下载会先校验新增、修改、删除项；备份会直接上传一个带日期的云端文件，不在本地留存。</p>
        <van-form @submit="emit('save-settings')">
          <van-field :model-value="oss.bucketName" label="Bucket" placeholder="OSS Bucket 名称" @update:model-value="updateOss('bucketName', $event)" />
          <van-field :model-value="oss.accessKeyId" label="Key ID" placeholder="AccessKey ID" @update:model-value="updateOss('accessKeyId', $event)" />
          <van-field :model-value="oss.accessKeySecret" label="Key Secret" type="password" placeholder="AccessKey Secret" @update:model-value="updateOss('accessKeySecret', $event)" />
          <van-field :model-value="oss.region" label="Region" placeholder="oss-cn-hangzhou" @update:model-value="updateOss('region', $event)" />
          <van-field :model-value="oss.objectName" label="文件名" placeholder="mypwdmg-vault.json" @update:model-value="updateOss('objectName', $event)" />
          <van-cell center title="自动同步数据" label="保存后上传校验，回到前台下载校验">
            <template #right-icon><van-switch :model-value="oss.autoSync" size="18" @update:model-value="emit('update-auto-sync', Boolean($event))" /></template>
          </van-cell>
          <van-cell center title="同步间隔" label="自动下载校验最小间隔（分钟）">
            <template #right-icon><van-stepper :model-value="oss.autoSyncIntervalMinutes" :min="autoSyncIntervalMin" :max="autoSyncIntervalMax" integer button-size="24px" @update:model-value="emit('update-auto-sync-interval', $event)" /></template>
          </van-cell>
          <van-button block type="primary" native-type="submit">保存云配置</van-button>
        </van-form>
        <div class="backup-actions">
          <van-button class="backup-action-button" size="small" plain type="default" icon="search" :loading="cloudBusy" @click="emit('check-cloud')">检测</van-button>
          <van-button class="backup-action-button" size="small" type="primary" icon="upgrade" :loading="cloudBusy" @click="emit('upload-cloud')">上传</van-button>
          <van-button class="backup-action-button" size="small" plain type="primary" icon="notes-o" :loading="cloudBusy" @click="emit('backup-cloud')">备份</van-button>
          <van-button class="backup-action-button" size="small" plain type="primary" icon="down" :loading="cloudBusy" @click="emit('download-cloud')">下载</van-button>
          <van-button class="backup-action-button" size="small" plain type="default" icon="records-o" :loading="cloudBusy" @click="emit('refresh-cloud-list')">列表</van-button>
        </div>
        <div v-if="cloudInfo" class="backup-info-grid">
          <div><span>固定文件</span><strong>{{ cloudInfo.exists ? '已存在' : '未找到' }}</strong></div>
          <div><span>大小</span><strong>{{ cloudInfo.size ? formatBytes(cloudInfo.size) : '-' }}</strong></div>
          <div><span>更新时间</span><strong>{{ cloudInfo.lastModified ? formatDateTime(cloudInfo.lastModified) : '-' }}</strong></div>
        </div>
        <div v-if="cloudBackups.length" class="cloud-backup-list">
          <button v-for="item in cloudBackups" :key="item.name" class="cloud-backup-item" type="button" @click="emit('select-cloud-backup', item.name)">
            <span>{{ item.name }}</span><small>{{ formatBytes(item.size) }} · {{ formatDateTime(item.lastModified) }}</small>
          </button>
        </div>
        <p v-if="backupStatus" class="settings-note">{{ backupStatus }}</p>
        <div class="cloud-sync-log-panel">
          <div class="cloud-sync-log-head">
            <div><strong>同步记录</strong><span>最多保留 {{ cloudSyncLogLimit }} 条</span></div>
            <div class="cloud-sync-log-controls">
              <van-stepper :model-value="cloudSyncLogLimit" :min="cloudSyncLogLimitMin" :max="cloudSyncLogLimitMax" integer button-size="24px" @update:model-value="emit('update-log-limit', $event)" />
              <van-button size="small" plain type="default" :disabled="cloudSyncLogs.length === 0" @click="emit('clear-logs')">清空</van-button>
            </div>
          </div>
          <div v-if="cloudSyncLogs.length" class="cloud-sync-log-list">
            <div v-for="item in cloudSyncLogs" :key="item.id" class="cloud-sync-log-item" :class="`is-${item.status}`">
              <div class="cloud-sync-log-main">
                <span class="cloud-sync-log-badge">{{ directionLabel(item.direction) }}</span>
                <strong>{{ logTitle(item) }}</strong>
                <small>{{ formatDateTime(new Date(item.at).toISOString()) }} · {{ item.automatic ? '自动' : '手动' }}</small>
              </div>
              <div class="cloud-sync-log-meta"><span>{{ statusLabel(item.status) }}</span><small>{{ logSummary(item) }}</small><small>{{ item.objectName }}</small></div>
            </div>
          </div>
          <van-empty v-else image="search" description="暂无同步记录" />
        </div>
      </section>

      <section v-else-if="section === 'system'" class="drawer-panel system-panel">
        <div class="system-group-list">
          <button v-for="group in systemGroups" :key="group.key" type="button" :class="{ active: systemGroupKey === group.key }" @click="emit('update-system-group', group.key)">
            <span class="system-group-icon"><van-icon :name="group.icon" /></span>
            <span class="system-group-copy"><strong>{{ group.title }}</strong><small>{{ group.description }}</small></span>
            <em>{{ group.count }}</em>
          </button>
        </div>
        <div class="system-group-head"><span>系统分组</span><strong>{{ currentSystemGroup.title }}</strong><small>{{ currentSystemGroup.description }}</small></div>
        <van-empty v-if="systemGroupEntries.length === 0" image="search" :description="currentSystemGroup.emptyText" />
        <div v-else class="archive-entry-list">
          <div v-for="entry in systemGroupEntries" :key="entry.id" class="archive-entry">
            <div><strong>{{ entry.title }}</strong><span>{{ archiveEntryMeta(entry) }}</span><small v-if="entry.statusReason">{{ entry.statusReason }}</small></div>
            <div class="archive-entry-actions">
              <van-button size="mini" plain type="primary" @click="emit('restore-entry', entry.id)">恢复</van-button>
              <van-button v-if="systemGroupKey === 'archived'" size="mini" plain type="danger" @click="emit('trash-entry', entry.id)">放入回收站</van-button>
              <van-button v-else size="mini" plain type="danger" @click="emit('purge-entry', entry.id)">彻底删除</van-button>
            </div>
          </div>
        </div>
      </section>
    </aside>
  </van-popup>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AppUpdateCheck, AppUpdateProgress, AndroidAutofillState, PluginListenerState, VaultEntry, VaultPayload } from '../../types'

type DrawerSection = 'settings' | 'updates' | 'backup' | 'system'
type ThemeMode = 'light' | 'dark'
type OssSettings = VaultPayload['settings']['oss']
type CloudInfo = { name: string; exists: boolean; size: number; lastModified: string }
type SystemGroup = { key: 'archived' | 'trashed'; title: string; description: string; emptyText: string; icon: string; count: number }
type CloudDirection = 'upload' | 'download' | 'backup'
type CloudStatus = 'started' | 'success' | 'review' | 'error' | 'skipped'
type CloudLog = { id: string; at: number; direction: CloudDirection; automatic: boolean; status: CloudStatus; objectName: string; message: string; added: number; modified: number; deleted: number; selected: number; total: number }

const props = defineProps<{
  open: boolean
  detailOpen: boolean
  section: DrawerSection
  sectionTitle: string
  displayAppVersion: string
  stats: { logins: number; folders: number }
  theme: ThemeMode
  uiScalePercent: number
  fontSizePercent: number
  uiScaleMin: number
  uiScaleMax: number
  sessionTimeoutMinutes: number
  sessionTimeoutMin: number
  sessionTimeoutMax: number
  sessionTimeoutDefault: number
  passwordHealthLabel: string
  passwordHealthScore: string
  showAndroidAutofillSettings: boolean
  androidAutofillEnabled: boolean
  androidAutofillStatus: string
  showPluginSettings: boolean
  pluginEnabled: boolean
  pluginStatus: string
  showUpdateSettings: boolean
  updateManifestUrl: string
  defaultUpdateManifestUrl: string
  updateBusy: '' | 'check' | 'download' | 'apply'
  updateAvailable: boolean
  downloadedUpdatePath: string
  canApplyUpdate: boolean
  updateInstallButtonText: string
  updateInfo: AppUpdateCheck | null
  updateInstallModeText: string
  updateProgress: AppUpdateProgress | null
  updateProgressLabel: string
  updateProgressPercent: number
  updateStatus: string
  oss: OssSettings
  autoSyncIntervalMin: number
  autoSyncIntervalMax: number
  cloudBusy: boolean
  cloudInfo: CloudInfo | null
  cloudBackups: CloudInfo[]
  backupStatus: string
  cloudSyncLogLimit: number
  cloudSyncLogLimitMin: number
  cloudSyncLogLimitMax: number
  cloudSyncLogs: CloudLog[]
  systemGroups: SystemGroup[]
  systemGroupKey: 'archived' | 'trashed'
  currentSystemGroup: SystemGroup
  systemGroupEntries: VaultEntry[]
  formatBytes: (value: number) => string
  formatDateTime: (value: string) => string
  directionLabel: (direction: CloudDirection) => string
  statusLabel: (status: CloudStatus) => string
  logTitle: (item: CloudLog) => string
  logSummary: (item: CloudLog) => string
  archiveEntryMeta: (entry: VaultEntry) => string
}>()

const backupPanel = ref<HTMLElement | null>(null)

watch(
  () => [props.open, props.section, props.detailOpen] as const,
  async ([open, section]) => {
    if (!open || section !== 'backup') return
    await nextTick()
    if (backupPanel.value) backupPanel.value.scrollTop = 0
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:detail-open': [value: boolean]
  'select-section': [section: DrawerSection]
  'update-theme': [theme: ThemeMode]
  'update-ui-scale': [value: number | number[]]
  'commit-ui-scale': [value: number | number[]]
  'update-font-size': [value: number | number[]]
  'commit-font-size': [value: number | number[]]
  'update-session-timeout': [value: number | string]
  'open-password-sheet': []
  'open-password-health': []
  'open-android-settings': []
  'open-plugin': []
  'update-manifest-url': [value: string]
  'check-update': []
  'download-update': []
  'apply-update': []
  'update-oss': [field: keyof OssSettings, value: string]
  'update-auto-sync': [value: boolean]
  'update-auto-sync-interval': [value: number | string]
  'save-settings': []
  'check-cloud': []
  'upload-cloud': []
  'backup-cloud': []
  'download-cloud': []
  'refresh-cloud-list': []
  'select-cloud-backup': [name: string]
  'update-log-limit': [value: number | string]
  'clear-logs': []
  'update-system-group': [key: 'archived' | 'trashed']
  'restore-entry': [entryId: string]
  'trash-entry': [entryId: string]
  'purge-entry': [entryId: string]
}>()

function selectSection(section: DrawerSection) {
  emit('select-section', section)
}

function updateOss(field: keyof OssSettings, value: unknown) {
  if (field === 'autoSync' || field === 'autoSyncIntervalMinutes') return
  emit('update-oss', field, String(value ?? ''))
}

function toggleSessionAutoLock(enabled: boolean) {
  emit('update-session-timeout', enabled ? props.sessionTimeoutDefault : 0)
}

</script>
