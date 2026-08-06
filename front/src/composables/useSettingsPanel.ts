import { ref, type Ref } from 'vue'

export type DrawerSection = 'settings' | 'updates' | 'backup' | 'system'
export type SystemGroupKey = 'archived' | 'trashed'

export type SettingsPanelState = {
  drawerOpen: Ref<boolean>
  drawerDetailOpen: Ref<boolean>
  drawerSection: Ref<DrawerSection>
  systemGroupKey: Ref<SystemGroupKey>
  passwordSheetOpen: Ref<boolean>
  pluginDetailOpen: Ref<boolean>
  passwordHealthOpen: Ref<boolean>
}

export function useSettingsPanel(): SettingsPanelState {
  return {
    drawerOpen: ref(false),
    drawerDetailOpen: ref(false),
    drawerSection: ref<DrawerSection>('settings'),
    systemGroupKey: ref<SystemGroupKey>('archived'),
    passwordSheetOpen: ref(false),
    pluginDetailOpen: ref(false),
    passwordHealthOpen: ref(false)
  }
}
