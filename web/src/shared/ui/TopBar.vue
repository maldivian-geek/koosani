<script setup lang="ts">
import { ref } from 'vue'
import Menu from 'primevue/menu'
import Button from 'primevue/button'
import type { MenuItem } from 'primevue/menuitem'
import { useAuthStore } from '../../stores/auth.js'
import { useUiStore } from '../../stores/ui.js'

const authStore = useAuthStore()
const uiStore = useUiStore()

const menu = ref<InstanceType<typeof Menu> | null>(null)

function toggleMenu(event: Event) {
  menu.value?.toggle(event)
}

const menuItems = ref<MenuItem[]>([
  {
    label: 'Theme',
    items: [
      {
        label: 'Light',
        icon: 'pi pi-sun',
        command: () => uiStore.setTheme('light'),
      },
      {
        label: 'Dark',
        icon: 'pi pi-moon',
        command: () => uiStore.setTheme('dark'),
      },
      {
        label: 'System',
        icon: 'pi pi-desktop',
        command: () => uiStore.setTheme('system'),
      },
    ],
  },
  { separator: true },
  {
    label: 'Sign out',
    icon: 'pi pi-sign-out',
    command: () => void authStore.logout(),
  },
])
</script>

<template>
  <header
    class="flex items-center justify-end gap-3 px-6 h-14 border-b border-surface-200 dark:border-surface-700 flex-none"
  >
    <Button
      :label="authStore.user?.name ?? ''"
      icon="pi pi-user"
      icon-pos="left"
      severity="secondary"
      text
      aria-haspopup="true"
      aria-controls="user-menu"
      @click="toggleMenu"
    />
    <Menu id="user-menu" ref="menu" :model="menuItems" popup />
  </header>
</template>
