<template>
  <UiModal
    :open="open"
    :title="modalTitle"
    :subtitle="modalSubtitle"
    size="xl"
    :fullscreen-on-mobile="true"
    :fixed-height="true"
    @close="emit('update:open', false)"
  >
    <template v-if="isMobileSubpage" #header-leading>
      <button
        type="button"
        class="settings-back-btn"
        aria-label="返回设置列表"
        title="返回设置列表"
        @click="ui.drawerDetailOpen = false"
      >
        <UiIcon name="arrow-left" :size="17" />
      </button>
    </template>

    <div
      class="settings-layout"
      :class="{
        'is-mobile-menu': isMobileMenu,
        'is-mobile-subpage': isMobileSubpage
      }"
    >
      <aside v-if="ui.isWide || isMobileMenu" class="settings-nav" aria-label="设置分类">
        <nav class="settings-nav-list no-scrollbar">
          <button
            v-for="item in navItems"
            :key="item.key"
            type="button"
            class="settings-nav-btn"
            :class="{ 'is-active': ui.isWide && activeSection === item.key }"
            :aria-current="ui.isWide && activeSection === item.key ? 'page' : undefined"
            @click="selectSection(item.key)"
          >
            <span class="settings-nav-icon">
              <UiIcon :name="item.icon" :size="16" />
            </span>
            <span class="settings-nav-copy">
              <span class="settings-nav-label">{{ item.label }}</span>
              <small v-if="item.hint" class="settings-nav-hint">{{ item.hint }}</small>
            </span>
            <UiBadge
              v-if="item.badge"
              :tone="item.badgeTone || 'neutral'"
              size="sm"
            >
              {{ item.badge }}
            </UiBadge>
            <UiIcon name="chevron-right" :size="15" class="settings-nav-chevron" />
          </button>
        </nav>

        <div class="settings-nav-footer">
          <UiButton
            variant="ghost"
            size="sm"
            block
            class="settings-exit-btn"
            @click="session.safeExit()"
          >
            <UiIcon name="lock" :size="14" />
            <span>安全退出</span>
          </UiButton>
        </div>
      </aside>

      <div v-if="ui.isWide || isMobileSubpage" ref="contentPane" class="settings-content">
        <!-- 1. 外观与交互 -->
        <section v-if="activeSection === 'appearance'" class="settings-section" aria-label="外观与交互">
          <div class="settings-card">
            <h3 class="settings-card__title">主题外观</h3>
            <div class="theme-segment" role="radiogroup" aria-label="主题模式">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                type="button"
                role="radio"
                class="theme-segment__btn"
                :class="{ 'is-active': ui.themePreference === option.value }"
                :aria-checked="ui.themePreference === option.value"
                @click="ui.setTheme(option.value)"
              >
                <UiIcon :name="option.icon" :size="15" />
                <span>{{ option.label }}</span>
              </button>
            </div>
          </div>

          <div class="settings-card">
            <div class="skin-gallery-head">
              <div class="skin-gallery-head__copy">
                <h3 class="settings-card__title">皮肤配色</h3>
                <small class="skin-gallery-sub">内置与自定义配色，切换时保留当前布局组合</small>
              </div>
              <span class="skin-gallery-count">{{ ui.availableSkins.length }} 套可用</span>
            </div>

            <div class="skin-grid" role="radiogroup" aria-label="选择皮肤配色">
              <div
                v-for="skin in ui.availableSkins"
                :key="skin.id"
                class="skin-card"
                :class="{ 'is-active': ui.activeSkinId === skin.id }"
              >
                <button
                  type="button"
                  role="radio"
                  class="skin-card__select"
                  :aria-checked="ui.activeSkinId === skin.id"
                  :title="skin.description ? `${skin.name} — ${skin.description}` : skin.name"
                  @click="selectSkin(skin.id)"
                >
                  <span
                    class="skin-swatch"
                    :style="{
                      backgroundColor: skinPreview(skin).bg,
                      borderColor: skinPreview(skin).border
                    }"
                    aria-hidden="true"
                  >
                    <span
                      class="skin-swatch__sidebar"
                      :style="{
                        backgroundColor: skinPreview(skin).sidebar,
                        borderColor: skinPreview(skin).border
                      }"
                    >
                      <span class="skin-swatch__dot" :style="{ backgroundColor: skinPreview(skin).accent }" />
                      <span class="skin-swatch__bar" :style="{ backgroundColor: skinPreview(skin).text }" />
                    </span>
                    <span
                      class="skin-swatch__surface"
                      :style="{
                        backgroundColor: skinPreview(skin).surface,
                        borderColor: skinPreview(skin).border
                      }"
                    >
                      <span class="skin-swatch__line" :style="{ backgroundColor: skinPreview(skin).text }" />
                      <span class="skin-swatch__pill" :style="{ backgroundColor: skinPreview(skin).accent }" />
                    </span>
                  </span>

                  <span class="skin-card__meta">
                    <span class="skin-card__title-row">
                      <strong class="skin-card__name">{{ skin.name }}</strong>
                      <span v-if="ui.activeSkinId === skin.id" class="skin-card__check" aria-label="当前使用">
                        <UiIcon name="check" :size="10" :stroke-width="2.5" />
                      </span>
                    </span>
                    <span class="skin-card__foot">
                      <span class="skin-card__layout-badge">{{ skinLayoutBadge(skin) }}</span>
                    </span>
                  </span>
                </button>

                <button
                  v-if="!skin.builtin"
                  type="button"
                  class="skin-card__delete"
                  :aria-label="`删除自定义皮肤 ${skin.name}`"
                  title="删除自定义皮肤"
                  @click.stop="handleRemoveCustomSkin(skin)"
                >
                  <UiIcon name="trash" :size="12" />
                </button>
              </div>
            </div>

            <div class="skin-subsection">
              <div class="skin-subsection__head">
                <div class="skin-gallery-head__copy">
                  <h4 class="skin-subsection__title">独立布局设置</h4>
                  <small class="skin-gallery-sub">与任意皮肤配色自由混搭</small>
                </div>
                <UiButton
                  v-if="ui.hasLayoutOverride"
                  variant="ghost"
                  size="xs"
                  @click="ui.resetLayoutOverride()"
                >
                  重置为皮肤默认
                </UiButton>
              </div>

              <div class="layout-override-list">
                <div class="layout-override-row">
                  <span class="layout-override-label">框架布局</span>
                  <div class="layout-segment" role="radiogroup" aria-label="框架布局">
                    <button
                      v-for="opt in layoutModeOptions"
                      :key="opt.key"
                      type="button"
                      role="radio"
                      class="segment-btn layout-segment__btn"
                      :class="{ 'is-active': (ui.layoutOverride.mode ?? null) === opt.value }"
                      :aria-checked="(ui.layoutOverride.mode ?? null) === opt.value"
                      @click="ui.setLayoutMode(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <div class="layout-override-row">
                  <span class="layout-override-label">列表形态</span>
                  <div class="layout-segment" role="radiogroup" aria-label="列表形态">
                    <button
                      v-for="opt in listStyleOptions"
                      :key="opt.key"
                      type="button"
                      role="radio"
                      class="segment-btn layout-segment__btn"
                      :class="{ 'is-active': (ui.layoutOverride.listStyle ?? null) === opt.value }"
                      :aria-checked="(ui.layoutOverride.listStyle ?? null) === opt.value"
                      @click="ui.setListStyle(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <div class="layout-override-row">
                  <span class="layout-override-label">界面密度</span>
                  <div class="layout-segment" role="radiogroup" aria-label="界面密度">
                    <button
                      v-for="opt in densityOptions"
                      :key="opt.key"
                      type="button"
                      role="radio"
                      class="segment-btn layout-segment__btn"
                      :class="{ 'is-active': (ui.layoutOverride.density ?? null) === opt.value }"
                      :aria-checked="(ui.layoutOverride.density ?? null) === opt.value"
                      @click="ui.setDensity(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="skin-subsection">
              <div class="skin-subsection__head">
                <h4 class="skin-subsection__title">皮肤插件管理</h4>
              </div>
              <div class="skin-actions">
                <UiButton variant="secondary" size="sm" @click="triggerSkinImport">
                  <UiIcon name="upload" :size="14" />
                  <span>导入皮肤插件 (.json)</span>
                </UiButton>
                <UiButton variant="ghost" size="sm" @click="handleExportSkinTemplate">
                  <UiIcon name="download" :size="14" />
                  <span>导出当前组合为皮肤插件 (.json)</span>
                </UiButton>
                <input
                  ref="skinFileInput"
                  class="sr-only"
                  type="file"
                  accept=".json,application/json"
                  tabindex="-1"
                  @change="handleSkinFileChange"
                />
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="skin-gallery-head">
              <div class="skin-gallery-head__copy">
                <h3 class="settings-card__title">背景图片与透明度</h3>
                <small class="skin-gallery-sub">自定义背景图并调节面板透光度、背景模糊与遮罩</small>
              </div>
            </div>

            <div class="wallpaper-picker">
              <div class="wallpaper-preview" :class="{ 'is-empty': !ui.wallpaperImageUrl }">
                <img
                  v-if="ui.wallpaperImageUrl"
                  :src="ui.wallpaperImageUrl"
                  alt="当前背景图片预览"
                  class="wallpaper-preview__img"
                />
                <span v-else class="wallpaper-preview__placeholder">
                  <UiIcon name="sun" :size="18" />
                  <span>未设置背景</span>
                </span>
              </div>

              <div class="wallpaper-picker__actions">
                <UiButton variant="secondary" size="sm" @click="triggerWallpaperSelect">
                  <UiIcon name="upload" :size="14" />
                  <span>选择背景图片</span>
                </UiButton>
                <UiButton
                  v-if="ui.wallpaperImageUrl"
                  variant="ghost"
                  size="sm"
                  @click="handleClearWallpaper"
                >
                  <UiIcon name="trash" :size="14" />
                  <span>清除背景</span>
                </UiButton>
                <input
                  ref="wallpaperFileInput"
                  class="sr-only"
                  type="file"
                  accept="image/*"
                  tabindex="-1"
                  @change="handleWallpaperFileChange"
                />
              </div>
            </div>

            <div class="slider-row">
              <div class="slider-row__head">
                <label for="settings-wallpaper-opacity">界面不透明度</label>
                <strong class="slider-row__val">{{ ui.wallpaperSettings.surfaceOpacity }}%</strong>
              </div>
              <input
                id="settings-wallpaper-opacity"
                class="settings-range"
                type="range"
                :min="ui.WALLPAPER_OPACITY_MIN"
                :max="ui.WALLPAPER_OPACITY_MAX"
                step="1"
                :value="ui.wallpaperSettings.surfaceOpacity"
                @input="ui.updateWallpaperSettings({ surfaceOpacity: Number(($event.target as HTMLInputElement).value) }, false)"
                @change="ui.updateWallpaperSettings({ surfaceOpacity: Number(($event.target as HTMLInputElement).value) }, true)"
              />
            </div>

            <div class="slider-row">
              <div class="slider-row__head">
                <label for="settings-wallpaper-blur">背景模糊</label>
                <strong class="slider-row__val">{{ ui.wallpaperSettings.wallpaperBlur }}px</strong>
              </div>
              <input
                id="settings-wallpaper-blur"
                class="settings-range"
                type="range"
                :min="ui.WALLPAPER_BLUR_MIN"
                :max="ui.WALLPAPER_BLUR_MAX"
                step="1"
                :value="ui.wallpaperSettings.wallpaperBlur"
                @input="ui.updateWallpaperSettings({ wallpaperBlur: Number(($event.target as HTMLInputElement).value) }, false)"
                @change="ui.updateWallpaperSettings({ wallpaperBlur: Number(($event.target as HTMLInputElement).value) }, true)"
              />
            </div>

            <div class="slider-row">
              <div class="slider-row__head">
                <label for="settings-wallpaper-dim">背景遮罩</label>
                <strong class="slider-row__val">{{ ui.wallpaperSettings.wallpaperDim }}%</strong>
              </div>
              <input
                id="settings-wallpaper-dim"
                class="settings-range"
                type="range"
                :min="ui.WALLPAPER_DIM_MIN"
                :max="ui.WALLPAPER_DIM_MAX"
                step="1"
                :value="ui.wallpaperSettings.wallpaperDim"
                @input="ui.updateWallpaperSettings({ wallpaperDim: Number(($event.target as HTMLInputElement).value) }, false)"
                @change="ui.updateWallpaperSettings({ wallpaperDim: Number(($event.target as HTMLInputElement).value) }, true)"
              />
            </div>
          </div>

          <div class="settings-card">
            <h3 class="settings-card__title">界面缩放与字体</h3>
            <div class="slider-row">
              <div class="slider-row__head">
                <label for="settings-ui-scale">界面缩放</label>
                <strong class="slider-row__val">{{ ui.uiScalePercent }}%</strong>
              </div>
              <input
                id="settings-ui-scale"
                class="settings-range"
                type="range"
                :min="ui.UI_SCALE_MIN_PERCENT"
                :max="ui.UI_SCALE_MAX_PERCENT"
                step="1"
                :value="ui.uiScalePercent"
                @input="ui.setUiScaleDraft(Number(($event.target as HTMLInputElement).value))"
                @change="ui.commitUiScale(Number(($event.target as HTMLInputElement).value))"
              />
            </div>

            <div class="slider-row">
              <div class="slider-row__head">
                <label for="settings-font-size">字体大小</label>
                <strong class="slider-row__val">{{ ui.fontSizePercent }}%</strong>
              </div>
              <input
                id="settings-font-size"
                class="settings-range"
                type="range"
                :min="ui.FONT_SIZE_MIN"
                :max="ui.FONT_SIZE_MAX"
                step="1"
                :value="ui.fontSizePercent"
                @input="ui.setFontSizeDraft(Number(($event.target as HTMLInputElement).value))"
                @change="ui.commitFontSize(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>

          <div v-if="showDesktopTraySettings" class="settings-card">
            <h3 class="settings-card__title">桌面托盘与窗口行为</h3>
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>系统托盘</strong>
                <small>{{ desktopTrayLabel }}</small>
              </div>
              <UiSwitch
                :model-value="desktopTraySettings?.trayEnabled ?? true"
                :loading="desktopTrayBusy || !desktopTraySettings"
                aria-label="系统托盘"
                @update:model-value="toggleDesktopTray($event)"
              />
            </div>

            <div v-if="desktopTraySettings?.trayEnabled === true" class="setting-row setting-row--stack">
              <div class="setting-row__copy">
                <strong>关闭主窗口</strong>
                <small>点击标题栏关闭按钮后的默认行为</small>
              </div>
              <div class="segment-group" role="radiogroup" aria-label="关闭主窗口行为">
                <button
                  type="button"
                  role="radio"
                  class="segment-btn"
                  :class="{ 'is-active': desktopCloseBehavior === 'minimize-to-tray' }"
                  :aria-checked="desktopCloseBehavior === 'minimize-to-tray'"
                  :disabled="desktopTrayBusy"
                  @click="setDesktopCloseBehavior('minimize-to-tray')"
                >
                  最小化到托盘
                </button>
                <button
                  type="button"
                  role="radio"
                  class="segment-btn"
                  :class="{ 'is-active': desktopCloseBehavior === 'exit' }"
                  :aria-checked="desktopCloseBehavior === 'exit'"
                  :disabled="desktopTrayBusy"
                  @click="setDesktopCloseBehavior('exit')"
                >
                  关闭程序
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. 安全与解锁 -->
        <section v-else-if="activeSection === 'security'" class="settings-section" aria-label="安全与解锁">
          <div class="settings-card">
            <h3 class="settings-card__title">主密码与凭据安全</h3>

            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>主密码</strong>
                <small>修改或清空当前保险库的主密码</small>
              </div>
              <UiButton variant="secondary" size="sm" @click="session.openPasswordSheet()">
                修改
              </UiButton>
            </div>

            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>密码健康</strong>
                <small>{{ vault.passwordHealthSettingsLabel }}</small>
              </div>
              <div class="setting-row__actions">
                <UiBadge :tone="vault.sidebarCounts.healthIssues > 0 ? 'warning' : 'success'" size="sm">
                  {{ vault.passwordHealthScoreLabel }}
                </UiBadge>
                <UiButton variant="secondary" size="sm" @click="openHealthCenter">
                  查看
                </UiButton>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>通行密钥</strong>
                <small>{{ passkeyCount ? `${passkeyCount} 个已保存凭据` : '暂无已保存凭据' }}</small>
              </div>
              <div class="setting-row__actions">
                <UiBadge tone="neutral" size="sm">{{ passkeyCount }}</UiBadge>
                <UiButton variant="secondary" size="sm" @click="openPasskeys">
                  管理
                </UiButton>
              </div>
            </div>

            <div v-if="session.deviceUnlockState.supported" class="setting-row">
              <div class="setting-row__copy">
                <strong>设备快速解锁</strong>
                <small>{{ session.deviceUnlockSettingsLabel }}</small>
              </div>
              <UiSwitch
                :model-value="session.deviceUnlockState.enabled"
                aria-label="设备快速解锁"
                @update:model-value="session.toggleDeviceUnlock($event)"
              />
            </div>

            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>自动锁定</strong>
                <small>{{ session.sessionTimeoutMinutes === 0 ? '已关闭，仅手动锁定' : `无操作 ${session.sessionTimeoutMinutes} 分钟后自动锁定` }}</small>
              </div>
              <UiSwitch
                :model-value="session.sessionTimeoutMinutes > 0"
                aria-label="自动锁定"
                @update:model-value="toggleSessionAutoLock($event)"
              />
            </div>

            <div v-if="session.sessionTimeoutMinutes > 0" class="setting-row">
              <div class="setting-row__copy">
                <strong>等待时间（分钟）</strong>
                <small>支持 {{ Math.max(1, session.SESSION_TIMEOUT_MIN_MINUTES) }} ~ {{ session.SESSION_TIMEOUT_MAX_MINUTES }} 分钟</small>
              </div>
              <div class="stepper">
                <UiButton
                  variant="secondary"
                  size="xs"
                  icon-only
                  aria-label="减少自动锁定分钟数"
                  :disabled="session.sessionTimeoutMinutes <= Math.max(1, session.SESSION_TIMEOUT_MIN_MINUTES)"
                  @click="session.updateSessionTimeout(session.sessionTimeoutMinutes - 1)"
                >
                  -
                </UiButton>
                <input
                  class="stepper__input"
                  type="number"
                  :min="Math.max(1, session.SESSION_TIMEOUT_MIN_MINUTES)"
                  :max="session.SESSION_TIMEOUT_MAX_MINUTES"
                  :value="session.sessionTimeoutMinutes"
                  aria-label="自动锁定等待分钟数"
                  @change="session.updateSessionTimeout(($event.target as HTMLInputElement).value)"
                />
                <UiButton
                  variant="secondary"
                  size="xs"
                  icon-only
                  aria-label="增加自动锁定分钟数"
                  :disabled="session.sessionTimeoutMinutes >= session.SESSION_TIMEOUT_MAX_MINUTES"
                  @click="session.updateSessionTimeout(session.sessionTimeoutMinutes + 1)"
                >
                  +
                </UiButton>
              </div>
            </div>
          </div>

          <div v-if="showAndroidAutofillSettings" class="settings-card">
            <h3 class="settings-card__title">Android 自动填充</h3>
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>自动填充服务</strong>
                <small>系统会打开授权确认页</small>
              </div>
              <div class="setting-row__actions">
                <UiBadge :tone="androidAutofillEnabled ? 'success' : 'neutral'" size="sm">
                  {{ androidAutofillStatus }}
                </UiBadge>
                <UiButton variant="secondary" size="sm" @click="openAndroidAutofillSettings">
                  去设置
                </UiButton>
              </div>
            </div>
          </div>

          <div v-if="showAndroidPasskeyProviderSettings" class="settings-card">
            <h3 class="settings-card__title">Android 通行密钥</h3>
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>通行密钥提供方</strong>
                <small>
                  {{
                    androidPasskeyProviderEnabled
                      ? (androidPasskeyProviderSystemEnabled ? '已被系统选中，可响应网站请求' : '组件已开启，请完成系统选择')
                      : '组件未开启，不会响应系统请求'
                  }}
                </small>
              </div>
              <div class="setting-row__actions">
                <UiBadge :tone="androidPasskeyProviderEnabled ? 'success' : 'neutral'" size="sm">
                  {{ androidPasskeyProviderStatus }}
                </UiBadge>
                <UiSwitch
                  :model-value="androidPasskeyProviderEnabled"
                  :loading="androidPasskeyProviderBusy"
                  aria-label="通行密钥提供方"
                  @update:model-value="toggleAndroidPasskeyProvider($event)"
                />
              </div>
            </div>

            <div v-if="androidPasskeyProviderEnabled" class="setting-row">
              <div class="setting-row__copy">
                <strong>系统凭据提供方</strong>
                <small>在系统页面选择或取消 My Password</small>
              </div>
              <div class="setting-row__actions">
                <UiBadge :tone="androidPasskeyProviderSystemEnabled ? 'success' : 'warning'" size="sm">
                  {{ androidPasskeyProviderSystemEnabled ? '已选择' : '待选择' }}
                </UiBadge>
                <UiButton variant="secondary" size="sm" @click="openAndroidPasskeyProviderSettings">
                  打开系统页
                </UiButton>
              </div>
            </div>
          </div>

          <div v-if="showPluginSettings" class="settings-card">
            <h3 class="settings-card__title">浏览器插件</h3>
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>插件监听</strong>
                <small>Chrome / Edge 自动填充 Native Host</small>
              </div>
              <div class="setting-row__actions">
                <UiBadge :tone="pluginEnabled ? 'success' : 'neutral'" size="sm">
                  {{ pluginStatus }}
                </UiBadge>
                <UiButton variant="secondary" size="sm" @click="openPluginDetail">
                  配置
                </UiButton>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. 云同步与备份 -->
        <section v-else-if="activeSection === 'sync'" class="settings-section" aria-label="云同步与备份">
          <div v-if="portableBackupSupported" class="settings-card portable-backup-panel">
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>本地完整备份</strong>
                <small>包含加密保险库与全部附件</small>
              </div>
              <div class="setting-row__actions">
                <UiButton variant="secondary" size="sm" :loading="sync.portableBackupBusy" @click="sync.exportPortableBackupPackage()">
                  <UiIcon name="download" :size="14" />
                  <span>导出包</span>
                </UiButton>
                <UiButton variant="secondary" size="sm" :disabled="sync.portableBackupBusy" @click="sync.beginPortableBackupImport()">
                  <UiIcon name="upload" :size="14" />
                  <span>恢复包</span>
                </UiButton>
              </div>
            </div>
            <p v-if="sync.portableBackupStatus" class="settings-note">{{ sync.portableBackupStatus }}</p>
          </div>

          <div v-if="androidVaultBackupSupported" class="settings-card portable-backup-panel">
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>本地保险库副本</strong>
                <small>仅包含加密保险库，不含附件</small>
              </div>
              <div class="setting-row__actions">
                <UiButton variant="secondary" size="sm" :loading="sync.portableBackupBusy" @click="sync.exportAndroidVaultBackup()">
                  <UiIcon name="download" :size="14" />
                  <span>导出文件</span>
                </UiButton>
              </div>
            </div>
            <p v-if="sync.portableBackupStatus" class="settings-note">{{ sync.portableBackupStatus }}</p>
          </div>

          <div class="settings-card cloud-encryption-binding-panel">
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>云端加密参数</strong>
                <small>{{ sync.cloudEncryptionBindingLabel }}</small>
              </div>
              <UiButton variant="secondary" size="sm" :loading="sync.cloudBusy" @click="sync.rebindCloudEncryption()">
                重新绑定
              </UiButton>
            </div>
          </div>

          <div class="settings-card">
            <h3 class="settings-card__title">阿里云 OSS 配置</h3>
            <p class="settings-note">上传/下载会先校验新增、修改、删除项；备份会直接上传一个带日期的云端文件，不在本地留存。</p>

            <form class="oss-form" autocomplete="off" @submit.prevent="sync.saveSettings()">
              <div class="oss-grid">
                <UiInput
                  :model-value="sync.settings.oss.bucketName"
                  label="Bucket"
                  placeholder="OSS Bucket 名称"
                  autocomplete="off"
                  @update:model-value="sync.updateOssSetting('bucketName', $event)"
                />
                <UiInput
                  :model-value="sync.settings.oss.region"
                  label="Region"
                  placeholder="oss-cn-hangzhou"
                  autocomplete="off"
                  @update:model-value="sync.updateOssSetting('region', $event)"
                />
                <UiInput
                  :model-value="sync.settings.oss.accessKeyId"
                  label="AccessKey ID"
                  placeholder="AccessKey ID"
                  autocomplete="off"
                  @update:model-value="sync.updateOssSetting('accessKeyId', $event)"
                />
                <UiInput
                  :model-value="sync.settings.oss.accessKeySecret"
                  label="AccessKey Secret"
                  type="password"
                  placeholder="AccessKey Secret"
                  autocomplete="new-password"
                  @update:model-value="sync.updateOssSetting('accessKeySecret', $event)"
                />
              </div>

              <UiInput
                :model-value="sync.settings.oss.objectName"
                label="对象路径"
                placeholder="pwd/mypwdmg-vault.json"
                autocomplete="off"
                @update:model-value="sync.updateOssSetting('objectName', $event)"
              />

              <div class="setting-row">
                <div class="setting-row__copy">
                  <strong>自动同步数据</strong>
                  <small>保存后自动上传校验，回到前台自动下载校验</small>
                </div>
                <UiSwitch
                  :model-value="sync.settings.oss.autoSync"
                  aria-label="自动同步数据"
                  @update:model-value="sync.settings.oss.autoSync = $event"
                />
              </div>

              <div class="setting-row">
                <div class="setting-row__copy">
                  <strong>同步间隔（分钟）</strong>
                  <small>自动下载校验最小间隔</small>
                </div>
                <div class="stepper">
                  <UiButton
                    variant="secondary"
                    size="xs"
                    icon-only
                    aria-label="减少同步间隔"
                    :disabled="sync.settings.oss.autoSyncIntervalMinutes <= sync.AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES"
                    @click="sync.setAutoSyncIntervalMinutes(sync.settings.oss.autoSyncIntervalMinutes - 1)"
                  >
                    -
                  </UiButton>
                  <input
                    class="stepper__input"
                    type="number"
                    :min="sync.AUTO_CLOUD_SYNC_INTERVAL_MIN_MINUTES"
                    :max="sync.AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES"
                    :value="sync.settings.oss.autoSyncIntervalMinutes"
                    aria-label="同步间隔分钟数"
                    @change="sync.setAutoSyncIntervalMinutes(($event.target as HTMLInputElement).value)"
                  />
                  <UiButton
                    variant="secondary"
                    size="xs"
                    icon-only
                    aria-label="增加同步间隔"
                    :disabled="sync.settings.oss.autoSyncIntervalMinutes >= sync.AUTO_CLOUD_SYNC_INTERVAL_MAX_MINUTES"
                    @click="sync.setAutoSyncIntervalMinutes(sync.settings.oss.autoSyncIntervalMinutes + 1)"
                  >
                    +
                  </UiButton>
                </div>
              </div>

              <div class="oss-submit-row">
                <UiButton variant="primary" type="submit" :loading="sync.cloudBusy">
                  <UiIcon name="check" :size="14" />
                  <span>保存云配置</span>
                </UiButton>
              </div>
            </form>

            <div class="backup-actions">
              <UiButton variant="secondary" size="sm" :loading="sync.cloudBusy" @click="sync.checkCloudBackupInfo()">
                <UiIcon name="search" :size="14" />
                <span>检测</span>
              </UiButton>
              <UiButton variant="primary" size="sm" :loading="sync.cloudBusy" @click="sync.uploadCloudBackup()">
                <UiIcon name="upload" :size="14" />
                <span>上传</span>
              </UiButton>
              <UiButton variant="secondary" size="sm" :loading="sync.cloudBusy" @click="sync.backupCloudVault()">
                <UiIcon name="cloud" :size="14" />
                <span>备份</span>
              </UiButton>
              <UiButton variant="secondary" size="sm" :loading="sync.cloudBusy" @click="sync.downloadCloudBackup()">
                <UiIcon name="download" :size="14" />
                <span>下载</span>
              </UiButton>
              <UiButton variant="secondary" size="sm" :loading="sync.cloudBusy" @click="sync.refreshCloudBackupList()">
                <UiIcon name="refresh" :size="14" />
                <span>列表</span>
              </UiButton>
            </div>

            <div v-if="sync.cloudInfo" class="info-metrics-grid">
              <div class="info-metric">
                <span>固定文件</span>
                <strong>{{ sync.cloudInfo.exists ? '已存在' : '未找到' }}</strong>
              </div>
              <div class="info-metric">
                <span>大小</span>
                <strong>{{ sync.cloudInfo.size ? formatBytes(sync.cloudInfo.size) : '-' }}</strong>
              </div>
              <div class="info-metric">
                <span>更新时间</span>
                <strong>{{ sync.cloudInfo.lastModified ? formatDateTime(sync.cloudInfo.lastModified) : '-' }}</strong>
              </div>
            </div>

            <div v-if="sync.cloudBackups.length" class="cloud-backup-list">
              <button
                v-for="item in sync.cloudBackups"
                :key="item.name"
                type="button"
                class="cloud-backup-item"
                @click="sync.selectCloudBackup(item.name)"
              >
                <span class="cloud-backup-item__name">{{ item.name }}</span>
                <small>{{ formatBytes(item.size) }} · {{ formatDateTime(item.lastModified) }}</small>
              </button>
            </div>

            <p v-if="sync.backupStatus" class="settings-note">{{ sync.backupStatus }}</p>
          </div>

          <div class="settings-card cloud-sync-log-panel">
            <div class="cloud-sync-log-head">
              <div class="setting-row__copy">
                <strong>同步记录</strong>
                <small>最多保留 {{ sync.cloudSyncLogLimit }} 条</small>
              </div>
              <div class="cloud-sync-log-controls">
                <div class="stepper">
                  <UiButton
                    variant="secondary"
                    size="xs"
                    icon-only
                    aria-label="减少同步记录上限"
                    :disabled="sync.cloudSyncLogLimit <= sync.CLOUD_SYNC_LOG_LIMIT_MIN"
                    @click="sync.setCloudSyncLogLimit(sync.cloudSyncLogLimit - 5)"
                  >
                    -
                  </UiButton>
                  <input
                    class="stepper__input"
                    type="number"
                    :min="sync.CLOUD_SYNC_LOG_LIMIT_MIN"
                    :max="sync.CLOUD_SYNC_LOG_LIMIT_MAX"
                    :value="sync.cloudSyncLogLimit"
                    aria-label="同步记录保留条数"
                    @change="sync.setCloudSyncLogLimit(($event.target as HTMLInputElement).value)"
                  />
                  <UiButton
                    variant="secondary"
                    size="xs"
                    icon-only
                    aria-label="增加同步记录上限"
                    :disabled="sync.cloudSyncLogLimit >= sync.CLOUD_SYNC_LOG_LIMIT_MAX"
                    @click="sync.setCloudSyncLogLimit(sync.cloudSyncLogLimit + 5)"
                  >
                    +
                  </UiButton>
                </div>
                <UiButton
                  variant="ghost"
                  size="sm"
                  :disabled="sync.cloudSyncLogs.length === 0"
                  @click="sync.clearCloudSyncLogs()"
                >
                  清空
                </UiButton>
              </div>
            </div>

            <div v-if="sync.cloudSyncLogs.length" class="cloud-sync-log-list">
              <div
                v-for="item in sync.cloudSyncLogs"
                :key="item.id"
                class="cloud-sync-log-item"
                :class="[`is-${item.status}`, { 'is-actionable': item.status === 'review' }]"
                @click="item.status === 'review' && sync.handleResolveSyncLog(item)"
              >
                <div class="cloud-sync-log-main">
                  <div class="cloud-sync-log-title-line">
                    <UiBadge tone="brand" size="sm">{{ sync.cloudSyncDirectionLabel(item.direction) }}</UiBadge>
                    <strong>{{ sync.cloudSyncLogTitle(item) }}</strong>
                  </div>
                  <small>{{ formatDateTime(new Date(item.at).toISOString()) }} · {{ item.automatic ? '自动' : '手动' }}</small>
                </div>
                <div class="cloud-sync-log-meta">
                  <UiBadge :tone="syncLogTone(item.status)" size="sm">{{ sync.cloudSyncLogStatusLabel(item.status) }}</UiBadge>
                  <small>{{ sync.cloudSyncLogSummary(item) }}</small>
                  <small class="cloud-sync-log-object">{{ item.objectName }}</small>
                  <UiButton
                    v-if="item.status === 'review'"
                    class="cloud-sync-log-action"
                    variant="primary"
                    size="xs"
                    @click.stop="sync.handleResolveSyncLog(item)"
                  >
                    手动处理
                  </UiButton>
                </div>
              </div>
            </div>
            <UiEmpty v-else icon="search" title="暂无同步记录" description="触发上传、下载或自动同步后会在此显示记录。" />
          </div>
        </section>

        <!-- 4. 附件与存储 -->
        <section v-else-if="activeSection === 'storage'" class="settings-section" aria-label="附件与存储">
          <div class="settings-card">
            <h3 class="settings-card__title">附件存储空间</h3>
            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>当前附件</strong>
                <small>
                  {{
                    vault.attachmentStorageState
                      ? `${formatBytes(vault.attachmentStorageState.activeBytes)} · 配额 ${formatBytes(vault.attachmentStorageState.quotaBytes)}`
                      : '正在读取存储状态'
                  }}
                </small>
              </div>
              <UiBadge tone="neutral" size="sm">{{ vault.attachmentStorageState?.activeCount ?? '-' }} 个</UiBadge>
            </div>

            <div v-if="vault.attachmentStorageState?.retainedCount" class="setting-row">
              <div class="setting-row__copy">
                <strong>可恢复附件</strong>
                <small>{{ formatBytes(vault.attachmentStorageState.retainedBytes) }}</small>
              </div>
              <UiBadge tone="warning" size="sm">{{ vault.attachmentStorageState.retainedCount }} 个</UiBadge>
            </div>

            <div class="setting-row">
              <div class="setting-row__copy">
                <strong>整理附件存储</strong>
                <small>核对当前保险库引用并回收过期对象</small>
              </div>
              <UiButton
                variant="secondary"
                size="sm"
                :loading="vault.attachmentStorageBusy"
                @click="vault.collectAttachmentStorage()"
              >
                <UiIcon name="trash" :size="14" />
                <span>整理</span>
              </UiButton>
            </div>
          </div>
        </section>

        <!-- 5. 系统分组 -->
        <section v-else-if="activeSection === 'system'" class="settings-section" aria-label="系统分组">
          <div class="settings-card">
            <div class="system-tabs-row">
              <div class="segment-group" role="tablist" aria-label="系统分组切换">
                <button
                  v-for="group in vault.systemGroups"
                  :key="group.key"
                  type="button"
                  role="tab"
                  class="segment-btn"
                  :class="{ 'is-active': ui.systemGroupKey === group.key }"
                  :aria-selected="ui.systemGroupKey === group.key"
                  @click="ui.systemGroupKey = group.key"
                >
                  <UiIcon :name="group.key === 'archived' ? 'archive' : 'trash'" :size="14" />
                  <span>{{ group.title }}</span>
                  <UiBadge tone="neutral" size="sm">{{ group.count }}</UiBadge>
                </button>
              </div>

              <div class="system-header-actions">
                <UiButton
                  variant="subtle"
                  size="xs"
                  @click="jumpToSystemView(ui.systemGroupKey === 'archived' ? 'archived' : 'trash')"
                >
                  在主界面预览
                </UiButton>
                <UiButton
                  v-if="vault.systemGroupEntries.length"
                  variant="secondary"
                  size="xs"
                  @click="toggleSystemSelectionMode"
                >
                  {{ systemSelectionMode ? '取消选择' : '批量选择' }}
                </UiButton>
                <UiButton
                  v-if="!systemSelectionMode && ui.systemGroupKey === 'trashed' && vault.systemGroupEntries.length"
                  variant="danger"
                  size="xs"
                  @click="vault.purgeAllTrashedEntries()"
                >
                  全部删除
                </UiButton>
              </div>
            </div>

            <p class="settings-note">{{ vault.currentSystemGroup.description }}</p>

            <div v-if="systemSelectionMode" class="system-batch-toolbar" role="toolbar" aria-label="系统分组批量操作">
              <strong>已选 {{ systemSelectedIds.size }}</strong>
              <div class="system-batch-actions">
                <UiButton variant="subtle" size="xs" @click="toggleAllSystemEntries">
                  {{ allSystemEntriesSelected ? '全不选' : '全选' }}
                </UiButton>
                <UiButton
                  variant="secondary"
                  size="xs"
                  :disabled="systemSelectedIds.size === 0"
                  @click="vault.restoreEntries([...systemSelectedIds])"
                >
                  恢复
                </UiButton>
                <UiButton
                  v-if="ui.systemGroupKey === 'archived'"
                  variant="danger"
                  size="xs"
                  :disabled="systemSelectedIds.size === 0"
                  @click="vault.trashEntries([...systemSelectedIds])"
                >
                  移入回收站
                </UiButton>
                <UiButton
                  v-else
                  variant="danger"
                  size="xs"
                  :disabled="systemSelectedIds.size === 0"
                  @click="vault.purgeEntries([...systemSelectedIds])"
                >
                  彻底删除
                </UiButton>
              </div>
            </div>

            <UiEmpty
              v-if="vault.systemGroupEntries.length === 0"
              :icon="ui.systemGroupKey === 'trashed' ? 'trash' : 'folder'"
              :title="vault.currentSystemGroup.emptyText"
            />

            <div v-else class="archive-entry-list">
              <div
                v-for="entry in vault.systemGroupEntries"
                :key="entry.id"
                class="archive-entry"
                :class="{ 'is-batch-selected': systemSelectedIds.has(entry.id) }"
                @click="handleSystemEntryClick(entry)"
              >
                <button
                  v-if="systemSelectionMode"
                  type="button"
                  class="system-check-btn"
                  :class="{ 'is-checked': systemSelectedIds.has(entry.id) }"
                  :aria-label="systemSelectedIds.has(entry.id) ? '取消选择' : '选择'"
                  :aria-pressed="systemSelectedIds.has(entry.id)"
                  @click.stop="toggleSystemEntry(entry.id)"
                >
                  <UiIcon v-if="systemSelectedIds.has(entry.id)" name="check" :size="12" :stroke-width="2.5" />
                </button>

                <div class="archive-entry__copy">
                  <strong>{{ entry.title || '未命名条目' }}</strong>
                  <span>{{ vault.archiveEntryMeta(entry) }}</span>
                  <small v-if="entry.statusReason">{{ entry.statusReason }}</small>
                </div>

                <div v-if="!systemSelectionMode" class="archive-entry__actions" @click.stop>
                  <UiButton v-if="entry.kind !== 'folder'" variant="ghost" size="xs" @click="inspectSystemEntry(entry)">
                    预览
                  </UiButton>
                  <UiButton variant="subtle" size="xs" @click="vault.restoreEntry(entry.id)">
                    恢复
                  </UiButton>
                  <UiButton
                    v-if="ui.systemGroupKey === 'archived'"
                    variant="danger"
                    size="xs"
                    @click="vault.trashEntry(entry.id)"
                  >
                    回收站
                  </UiButton>
                  <UiButton
                    v-else
                    variant="danger"
                    size="xs"
                    @click="vault.purgeEntry(entry.id)"
                  >
                    彻底删除
                  </UiButton>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 6. 关于与更新 -->
        <section v-else class="settings-section" aria-label="关于与更新">
          <div class="settings-card about-hero">
            <div class="about-hero__badge">
              <UiIcon name="shield" :size="22" />
            </div>
            <div class="about-hero__copy">
              <strong>My Password</strong>
              <span>版本 v{{ session.displayAppVersion }} · 构建 {{ frontendBuildId }}</span>
              <small>{{ vault.stats.logins }} 登录 · {{ vault.stats.folders }} 分组 · {{ vault.stats.totp }} TOTP</small>
            </div>
          </div>

          <div v-if="session.showUpdateSettings" class="settings-card">
            <h3 class="settings-card__title">应用更新</h3>
            <p class="settings-note">使用 GitHub Release 的 manifest 检查版本。下载包必须通过 SHA256 校验后才能安装。</p>

            <UiInput
              :model-value="session.updateManifestUrl"
              label="Manifest 地址"
              type="textarea"
              :rows="2"
              :placeholder="session.DEFAULT_UPDATE_MANIFEST_URL"
              @update:model-value="session.updateManifestUrl = $event"
            />

            <div class="update-actions">
              <UiButton variant="primary" size="sm" :loading="session.updateBusy === 'check'" @click="session.checkAppUpdate()">
                <UiIcon name="refresh" :size="14" />
                <span>检查更新</span>
              </UiButton>
              <UiButton
                variant="secondary"
                size="sm"
                :disabled="session.updateInfo?.updateAvailable !== true"
                :loading="session.updateBusy === 'download'"
                @click="session.downloadAppUpdate()"
              >
                <UiIcon name="download" :size="14" />
                <span>下载</span>
              </UiButton>
              <UiButton
                variant="danger"
                size="sm"
                :disabled="!session.downloadedUpdatePath || session.updateInfo?.canApply !== true"
                :loading="session.updateBusy === 'apply'"
                @click="session.applyAppUpdate()"
              >
                <UiIcon name="upload" :size="14" />
                <span>{{ session.updateInstallButtonText }}</span>
              </UiButton>
            </div>

            <div v-if="session.updateInfo" class="info-metrics-grid">
              <div class="info-metric">
                <span>当前版本</span>
                <strong>{{ session.updateInfo.currentVersion }}</strong>
              </div>
              <div class="info-metric">
                <span>最新版本</span>
                <strong>{{ session.updateInfo.latestVersion }}</strong>
              </div>
              <div class="info-metric">
                <span>安装方式</span>
                <strong>{{ session.updateInstallModeText }}</strong>
              </div>
            </div>

            <div v-if="session.updateBusy && session.updateProgress" class="update-progress">
              <div class="update-progress__head">
                <span>{{ session.updateProgressLabel }}</span>
                <strong v-if="session.updateProgressPercent > 0">{{ session.updateProgressPercent }}%</strong>
              </div>
              <div class="update-progress__track">
                <span :style="{ width: `${session.updateProgressPercent || 12}%` }" />
              </div>
            </div>

            <p v-if="session.downloadedUpdatePath" class="settings-note">已下载：{{ session.downloadedUpdatePath }}</p>
            <p v-if="session.updateStatus" class="settings-note">{{ session.updateStatus }}</p>
          </div>
        </section>

        <div class="settings-mobile-footer">
          <UiButton
            variant="ghost"
            size="sm"
            block
            class="settings-exit-btn"
            @click="session.safeExit()"
          >
            <UiIcon name="lock" :size="14" />
            <span>安全退出</span>
          </UiButton>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { UiBadge, UiButton, UiEmpty, UiIcon, UiInput, UiModal, UiSwitch } from '../ui'
import type { UiIconName } from '../ui'
import type { DrawerSection } from '../../composables/useSettingsPanel'
import {
  formatBytes,
  formatDateTime,
  frontendBuildId,
  isAndroidRuntime,
  isDesktopRuntime
} from '../../services/runtime'
import type {
  SkinDensity,
  SkinLayoutMode,
  SkinListStyle,
  SkinPlugin,
  SkinPreviewColors
} from '../../services/skins/index.ts'
import { showFailToast, showSuccessToast } from '../../services/uiFeedback'
import { useAppStores, type SidebarView, type ThemePreference } from '../../stores'
import type { DesktopCloseBehavior, VaultEntry } from '../../types'

type SettingsSectionKey = 'appearance' | 'security' | 'sync' | 'storage' | 'system' | 'about'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const stores = useAppStores()
const ui = reactive(stores.ui)
const session = reactive(stores.session)
const vault = reactive(stores.vault)
const sync = reactive(stores.sync)
const platform = stores.platform

const contentPane = ref<HTMLElement | null>(null)
const skinFileInput = ref<HTMLInputElement | null>(null)
const wallpaperFileInput = ref<HTMLInputElement | null>(null)
const systemSelectionMode = ref(false)
const systemSelectedIds = ref<Set<string>>(new Set())

const portableBackupSupported = isDesktopRuntime
const androidVaultBackupSupported = isAndroidRuntime

function normalizeSection(section: DrawerSection): SettingsSectionKey {
  if (section === 'settings') return 'appearance'
  if (section === 'backup') return 'sync'
  if (section === 'updates') return 'about'
  if (section === 'appearance' || section === 'security' || section === 'sync' || section === 'storage' || section === 'system' || section === 'about') {
    return section
  }
  return 'appearance'
}

const activeSection = computed<SettingsSectionKey>(() => normalizeSection(ui.drawerSection))

const passkeyCount = computed(() => vault.passkeyPresentationItems.length)

const showDesktopTraySettings = computed(() => Boolean(platform?.desktopTray.showSettings.value))
const desktopTraySettings = computed(() => platform?.desktopTray.state.value ?? null)
const desktopTrayBusy = computed(() => Boolean(platform?.desktopTray.busy.value))
const desktopCloseBehavior = computed<DesktopCloseBehavior>(() => desktopTraySettings.value?.closeBehavior || 'exit')
const desktopTrayLabel = computed(() => {
  const settings = desktopTraySettings.value
  if (!settings) return '正在读取托盘状态'
  if (!settings.trayEnabled) return '不显示托盘图标'
  return settings.trayAvailable ? '托盘图标已显示' : '已开启，托盘暂不可用'
})

const showAndroidAutofillSettings = computed(() => Boolean(platform?.androidAutofill.showSettings.value))
const androidAutofillEnabled = computed(() => platform?.androidAutofill.state.value?.enabled === true)
const androidAutofillStatus = computed(() => platform?.androidAutofill.status.value || '')

const showAndroidPasskeyProviderSettings = computed(() => Boolean(platform?.androidPasskeyProvider.showSettings.value))
const androidPasskeyProviderEnabled = computed(() => platform?.androidPasskeyProvider.state.value?.componentEnabled === true)
const androidPasskeyProviderSystemEnabled = computed(() => platform?.androidPasskeyProvider.state.value?.systemEnabled === true)
const androidPasskeyProviderStatus = computed(() => platform?.androidPasskeyProvider.status.value || '')
const androidPasskeyProviderBusy = computed(() => Boolean(platform?.androidPasskeyProvider.busy.value))

const showPluginSettings = computed(() => Boolean(platform?.pluginListener.showSettings.value))
const pluginEnabled = computed(() => platform?.pluginListener.state.value?.enabled === true)
const pluginStatus = computed(() => platform?.pluginListener.status.value || '')

const themeOptions: Array<{ value: ThemePreference; label: string; icon: UiIconName }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' }
]

const layoutModeOptions: Array<{ key: string; value: SkinLayoutMode | null; label: string }> = [
  { key: 'follow', value: null, label: '跟随皮肤' },
  { key: 'three-pane', value: 'three-pane', label: '经典三栏' },
  { key: 'top-nav-split', value: 'top-nav-split', label: '顶栏双栏' },
  { key: 'compact-cards', value: 'compact-cards', label: '极简轨' }
]

const listStyleOptions: Array<{ key: string; value: SkinListStyle | null; label: string }> = [
  { key: 'follow', value: null, label: '跟随皮肤' },
  { key: 'rows', value: 'rows', label: '列表行' },
  { key: 'table', value: 'table', label: '数据表' },
  { key: 'cards', value: 'cards', label: '卡片网格' }
]

const densityOptions: Array<{ key: string; value: SkinDensity | null; label: string }> = [
  { key: 'follow', value: null, label: '跟随皮肤' },
  { key: 'compact', value: 'compact', label: '紧凑' },
  { key: 'comfortable', value: 'comfortable', label: '标准' },
  { key: 'airy', value: 'airy', label: '舒展' }
]

const navItems = computed<Array<{
  key: SettingsSectionKey
  label: string
  hint?: string
  icon: UiIconName
  badge?: string | number
  badgeTone?: 'neutral' | 'brand' | 'warning' | 'danger'
}>>(() => [
  {
    key: 'appearance',
    label: '外观与交互',
    hint: `${ui.activeSkin.name} · ${ui.theme === 'dark' ? '深色' : '浅色'}`,
    icon: 'sun'
  },
  {
    key: 'security',
    label: '安全与解锁',
    hint: session.deviceUnlockState.enabled ? '主密码 · 已启用设备快解' : '主密码 · 自动锁定 · 自动填充',
    icon: 'shield'
  },
  {
    key: 'sync',
    label: '云同步与备份',
    hint: sync.hasCompleteOssSettings() ? '阿里云 OSS 已配置' : '配置云同步与本地完整备份',
    icon: 'cloud'
  },
  {
    key: 'storage',
    label: '附件与存储',
    hint: '本地加密附件空间与清理',
    icon: 'paperclip'
  },
  {
    key: 'system',
    label: '系统分组',
    hint: `已归档 ${vault.stats.archived} · 回收站 ${vault.stats.trashed}`,
    icon: 'archive',
    badge: (vault.stats.archived + vault.stats.trashed) || undefined,
    badgeTone: 'neutral'
  },
  {
    key: 'about',
    label: '关于与更新',
    hint: `v${session.displayAppVersion}`,
    icon: 'info',
    badge: session.updateInfo?.updateAvailable ? '新' : undefined,
    badgeTone: 'brand'
  }
])

const isMobileMenu = computed(() => !ui.isWide && !ui.drawerDetailOpen)
const isMobileSubpage = computed(() => !ui.isWide && ui.drawerDetailOpen)
const activeNavItem = computed(() => navItems.value.find((item) => item.key === activeSection.value))
const modalTitle = computed(() => {
  if (isMobileSubpage.value) return activeNavItem.value?.label || '设置'
  return ui.isWide ? '设置与管理' : '设置'
})
const modalSubtitle = computed(() => undefined)

const allSystemEntriesSelected = computed(() => (
  vault.systemGroupEntries.length > 0
  && vault.systemGroupEntries.every((entry) => systemSelectedIds.value.has(entry.id))
))

function selectSection(section: SettingsSectionKey): void {
  ui.drawerSection = section
  if (!ui.isWide) {
    ui.drawerDetailOpen = true
  }
  if (section === 'appearance') {
    void platform?.desktopTray.load()
  } else if (section === 'security') {
    if (showPluginSettings.value) void platform?.pluginListener.load()
    void platform?.androidAutofill.load()
    void platform?.androidPasskeyProvider.load()
  } else if (section === 'storage') {
    void vault.loadAttachmentStorageState()
  }
  void nextTick(() => {
    if (contentPane.value) contentPane.value.scrollTop = 0
  })
}

function toggleDesktopTray(enabled: boolean): void {
  void platform?.desktopTray.toggle(enabled)
}

function skinPreview(skin: SkinPlugin): SkinPreviewColors {
  return ui.theme === 'dark' ? skin.preview.dark : skin.preview.light
}

function skinLayoutBadge(skin: SkinPlugin): string {
  const mode = skin.layout?.mode ?? 'three-pane'
  const listStyle = skin.layout?.listStyle ?? 'rows'
  if (mode === 'top-nav-split') return '推荐 · 顶栏双栏'
  if (mode === 'compact-cards' || listStyle === 'cards') return '推荐 · 卡片网格'
  if (listStyle === 'table') return '推荐 · 紧凑表格'
  return '推荐 · 经典三栏'
}

function selectSkin(id: string): void {
  ui.setSkin(id)
}

function triggerSkinImport(): void {
  skinFileInput.value?.click()
}

function triggerWallpaperSelect(): void {
  wallpaperFileInput.value?.click()
}

async function handleWallpaperFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    await ui.setWallpaperImageFromFile(file)
    showSuccessToast('已应用自定义背景图片')
  } catch (error) {
    showFailToast(error instanceof Error ? error.message : '设置背景图片失败')
  }
}

async function handleClearWallpaper(): Promise<void> {
  await ui.clearWallpaper()
  showSuccessToast('已清除背景图片')
}

async function handleSkinFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const result = ui.installSkinFromJson(text)
    if (!result.ok) {
      showFailToast(result.message)
      return
    }
    showSuccessToast(`已安装并应用皮肤：${result.skin.name}`)
  } catch {
    showFailToast('读取皮肤文件失败')
  }
}

function handleRemoveCustomSkin(skin: SkinPlugin): void {
  if (ui.removeCustomSkin(skin.id)) {
    showSuccessToast(`已删除皮肤：${skin.name}`)
  }
}

function handleExportSkinTemplate(): void {
  const json = ui.exportCurrentSkinJson()
  const fileName = `mypwdmg-skin-${ui.activeSkinId}.json`
  try {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showSuccessToast(`已导出皮肤模板：${fileName}`)
  } catch {
    showFailToast('导出皮肤模板失败')
  }
}

function setDesktopCloseBehavior(behavior: DesktopCloseBehavior): void {
  void platform?.desktopTray.setCloseBehavior(behavior)
}

function openAndroidAutofillSettings(): void {
  void platform?.androidAutofill.openSettings()
}

function toggleAndroidPasskeyProvider(enabled: boolean): void {
  void platform?.androidPasskeyProvider.toggle(enabled)
}

function openAndroidPasskeyProviderSettings(): void {
  void platform?.androidPasskeyProvider.openSettings()
}

function openPluginDetail(): void {
  platform?.pluginListener.open()
}

function openHealthCenter(): void {
  emit('update:open', false)
  vault.openPasswordHealth()
}

function openPasskeys(): void {
  emit('update:open', false)
  vault.openPasskeyManager()
}

function toggleSessionAutoLock(enabled: boolean): void {
  session.updateSessionTimeout(enabled ? session.SESSION_TIMEOUT_DEFAULT_MINUTES : 0)
}

function syncLogTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'success') return 'success'
  if (status === 'review') return 'warning'
  if (status === 'error') return 'danger'
  return 'neutral'
}

function jumpToSystemView(view: Extract<SidebarView, 'archived' | 'trash'>): void {
  vault.selectSidebarView(view)
  emit('update:open', false)
}

function inspectSystemEntry(entry: VaultEntry): void {
  vault.selectSidebarView(entry.status === 'trashed' ? 'trash' : 'archived')
  vault.openEntry(entry)
  emit('update:open', false)
}

function handleSystemEntryClick(entry: VaultEntry): void {
  if (systemSelectionMode.value) {
    toggleSystemEntry(entry.id)
    return
  }
  if (entry.kind !== 'folder') {
    inspectSystemEntry(entry)
  }
}

function toggleSystemSelectionMode(): void {
  if (systemSelectionMode.value) resetSystemSelection()
  else systemSelectionMode.value = true
}

function resetSystemSelection(): void {
  systemSelectionMode.value = false
  systemSelectedIds.value = new Set()
}

function toggleSystemEntry(entryId: string): void {
  const next = new Set(systemSelectedIds.value)
  if (next.has(entryId)) next.delete(entryId)
  else next.add(entryId)
  systemSelectedIds.value = next
}

function toggleAllSystemEntries(): void {
  systemSelectedIds.value = allSystemEntriesSelected.value
    ? new Set()
    : new Set(vault.systemGroupEntries.map((entry) => entry.id))
}

watch(
  () => [props.open, activeSection.value, ui.systemGroupKey] as const,
  () => resetSystemSelection()
)

watch(
  () => vault.systemGroupEntries.map((entry) => entry.id).join('\u0000'),
  () => {
    const validIds = new Set(vault.systemGroupEntries.map((entry) => entry.id))
    systemSelectedIds.value = new Set([...systemSelectedIds.value].filter((id) => validIds.has(id)))
    if (vault.systemGroupEntries.length === 0) systemSelectionMode.value = false
  }
)
</script>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 18px;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding-right: 12px;
  border-right: 1px solid var(--border-soft);
  min-height: 0;
  overflow-y: auto;
}

.settings-nav-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.settings-nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.settings-nav-btn :deep(.ui-badge) {
  flex: 0 0 auto;
}

.settings-nav-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.settings-nav-btn.is-active {
  background-color: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}

.settings-nav-footer {
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.settings-exit-btn {
  color: var(--danger);
}

.settings-content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
}

.settings-card__title {
  margin: 0;
  font-size: var(--app-font-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border-soft);
  padding-top: 12px;
}

.setting-row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.setting-row__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-row__copy strong {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.setting-row__copy small {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.4;
}

.setting-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Theme & segmented controls */
.theme-segment,
.segment-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container);
  border: 1px solid var(--border-soft);
}

.theme-segment {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.theme-segment__btn,
.segment-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.theme-segment__btn:hover,
.segment-btn:hover {
  color: var(--text-main);
}

.theme-segment__btn.is-active,
.segment-btn.is-active {
  background-color: var(--panel-bg);
  color: var(--brand);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

/* Skin plugin gallery */
.skin-gallery-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.skin-gallery-head__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skin-gallery-sub {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  line-height: 1.35;
}

.skin-gallery-count {
  font-size: var(--app-font-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.skin-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.skin-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.skin-card:hover {
  border-color: var(--border-strong);
}

.skin-card.is-active {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.skin-card__select {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 7px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.skin-swatch {
  display: grid;
  grid-template-columns: 30% 1fr;
  height: 40px;
  border-radius: var(--radius-xs);
  border: 1px solid transparent;
  overflow: hidden;
}

.skin-swatch__sidebar {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 5px;
  border-right: 1px solid transparent;
}

.skin-swatch__dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

.skin-swatch__bar {
  display: block;
  height: 3px;
  width: 80%;
  border-radius: 2px;
  opacity: 0.34;
}

.skin-swatch__surface {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px;
  margin: 4px;
  border-radius: 3px;
  border: 1px solid transparent;
}

.skin-swatch__line {
  display: block;
  height: 4px;
  width: 72%;
  border-radius: 2px;
  opacity: 0.72;
}

.skin-swatch__pill {
  display: block;
  height: 5px;
  width: 44%;
  border-radius: 2px;
}

.skin-card__meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.skin-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.skin-card__name {
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skin-card__foot {
  display: flex;
  align-items: center;
  min-width: 0;
}

.skin-card__layout-badge {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skin-card__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: var(--radius-full);
  background-color: var(--brand);
  color: var(--on-brand);
  flex-shrink: 0;
}

.skin-card__delete {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xs);
  background-color: var(--panel-bg);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.skin-card:hover .skin-card__delete,
.skin-card:focus-within .skin-card__delete {
  opacity: 1;
}

.skin-card__delete:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.skin-subsection {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.skin-subsection__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skin-subsection__title {
  margin: 0;
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.layout-override-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layout-override-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.layout-override-label {
  font-size: var(--app-font-xs);
  font-weight: 500;
  color: var(--text-secondary);
}

.layout-segment {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container);
  border: 1px solid var(--border-soft);
}

.layout-segment__btn {
  padding: 5px 6px;
  font-size: var(--app-font-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skin-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* Custom wallpaper picker */
.wallpaper-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.wallpaper-preview {
  width: 112px;
  height: 64px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--surface-container);
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wallpaper-preview__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wallpaper-preview__placeholder {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--text-muted);
  font-size: 10px;
}

.wallpaper-picker__actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* Native sliders */
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--app-font-sm);
}

.slider-row__val {
  font-variant-numeric: tabular-nums;
  color: var(--brand);
}

.settings-range {
  width: 100%;
  accent-color: var(--brand);
  cursor: pointer;
}

/* Numeric stepper */
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stepper__input {
  width: 56px;
  height: var(--control-height-xs);
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  text-align: center;
  font-size: var(--app-font-sm);
  font-variant-numeric: tabular-nums;
}

.settings-note {
  margin: 0;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

/* OSS & Cloud sync */
.oss-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.oss-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.oss-submit-row {
  display: flex;
  justify-content: flex-end;
}

.backup-actions,
.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.info-metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.info-metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
}

.info-metric span {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.info-metric strong {
  font-size: var(--app-font-sm);
  color: var(--text-main);
  word-break: break-word;
}

.cloud-backup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.cloud-backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  font-size: var(--app-font-xs);
  text-align: left;
  cursor: pointer;
}

.cloud-backup-item:hover {
  border-color: var(--brand);
}

.cloud-backup-item__name {
  font-family: var(--font-mono);
  word-break: break-all;
}

.cloud-backup-item small {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Sync logs with deferred rendering */
.cloud-sync-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.cloud-sync-log-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.cloud-sync-log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cloud-sync-log-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  content-visibility: auto;
  contain-intrinsic-size: auto 76px;
}

.cloud-sync-log-item.is-actionable {
  border-color: color-mix(in srgb, var(--warning) 44%, var(--border-soft));
  cursor: pointer;
}

.cloud-sync-log-item.is-actionable:hover {
  border-color: var(--warning);
}

.cloud-sync-log-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cloud-sync-log-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cloud-sync-log-main strong {
  font-size: var(--app-font-sm);
  color: var(--text-main);
}

.cloud-sync-log-main small {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.cloud-sync-log-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  text-align: right;
  flex-shrink: 0;
}

.cloud-sync-log-meta small {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.cloud-sync-log-object {
  font-family: var(--font-mono);
  color: var(--text-muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* System groups */
.system-tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.system-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.system-batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background-color: var(--brand-soft);
  font-size: var(--app-font-xs);
}

.system-batch-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.archive-entry-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.archive-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background-color: var(--panel-bg);
  cursor: pointer;
}

.archive-entry:hover {
  border-color: var(--border-strong);
}

.archive-entry.is-batch-selected {
  border-color: var(--brand);
  background-color: var(--brand-soft);
}

.system-check-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-xs);
  background: var(--panel-bg);
  color: var(--on-brand);
  cursor: pointer;
  flex-shrink: 0;
}

.system-check-btn.is-checked {
  background-color: var(--brand);
  border-color: var(--brand);
}

.archive-entry__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.archive-entry__copy strong {
  font-size: var(--app-font-sm);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-entry__copy span,
.archive-entry__copy small {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-entry__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* About & Update */
.about-hero {
  flex-direction: row;
  align-items: center;
  gap: 14px;
}

.about-hero__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background-color: var(--brand-soft);
  color: var(--brand);
  flex-shrink: 0;
}

.about-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-hero__copy strong {
  font-size: var(--app-font-md);
  color: var(--text-main);
}

.about-hero__copy span,
.about-hero__copy small {
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.update-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.update-progress__track {
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--surface-container-high);
  overflow: hidden;
}

.update-progress__track span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background-color: var(--brand);
  transition: width var(--duration-normal) var(--ease-standard);
}

.settings-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.settings-back-btn:hover {
  background-color: var(--surface-container-high);
}

.settings-nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.settings-nav-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-nav-chevron {
  flex: 0 0 auto;
}

.settings-nav-hint,
.settings-nav-chevron,
.settings-mobile-footer {
  display: none;
}

@media (max-width: 767px) {
  .settings-layout {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    gap: 10px;
  }

  .settings-nav {
    flex: 1 1 auto;
    border-right: 0;
    border-bottom: 0;
    padding: 0;
    gap: 16px;
  }

  .settings-nav-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-md);
    background-color: var(--surface-container-low);
    overflow: hidden;
  }

  .settings-nav-btn {
    width: 100%;
    justify-content: flex-start;
    padding: 13px 14px;
    gap: 12px;
    border-radius: 0;
    border: 0;
    border-bottom: 1px solid var(--border-soft);
    background-color: transparent;
    color: var(--text-main);
    font-size: var(--app-font-base);
  }

  .settings-nav-btn:last-child {
    border-bottom: 0;
  }

  .settings-nav-icon {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background-color: var(--surface-container-high);
    color: var(--text-secondary);
  }

  .settings-nav-hint {
    display: block;
    font-size: var(--app-font-xs);
    font-weight: 400;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-nav-chevron {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--text-muted);
  }

  .settings-nav-footer {
    display: block;
    padding-top: 0;
    border-top: 0;
  }

  .settings-nav-footer .settings-exit-btn {
    border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border-soft));
    background-color: var(--danger-soft);
  }

  .settings-content {
    gap: 10px;
  }

  .settings-section {
    gap: 10px;
  }

  .settings-card {
    padding: 12px;
    gap: 10px;
  }

  .oss-grid,
  .info-metrics-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .skin-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .layout-override-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .layout-segment {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cloud-sync-log-item {
    flex-direction: column;
  }

  .cloud-sync-log-meta {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
