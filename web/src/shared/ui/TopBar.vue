<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown, Sun, Moon } from 'lucide-vue-next'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useAuthStore } from '../../stores/auth.js'
import { useUiStore } from '../../stores/ui.js'

const authStore = useAuthStore()
const uiStore = useUiStore()
const route = useRoute()

const pageTitle = computed(() => {
  const matched = [...route.matched].reverse().find((r) => r.meta.title)
  return (matched?.meta.title as string | undefined) ?? ''
})

const menu = ref<InstanceType<typeof Menu> | null>(null)

function toggleMenu(event: Event) {
  menu.value?.toggle(event)
}

function toggleDark() {
  uiStore.setTheme(uiStore.isDark ? 'light' : 'dark')
}

const userInitial = () => authStore.user?.name?.charAt(0).toUpperCase() ?? '?'

const menuItems = ref<MenuItem[]>([
  { label: 'Sign out', icon: 'pi pi-sign-out', command: () => void authStore.logout() },
])
</script>

<template>
  <header
    class="h-16 bg-surface-0 dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center px-4 gap-3 shrink-0 z-20"
  >
    <h1 class="flex-1 text-base font-semibold text-surface-900 dark:text-surface-50">
      {{ pageTitle }}
    </h1>

    <!-- dark mode toggle -->
    <button
      class="p-2 rounded-lg bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 transition-colors cursor-pointer"
      :title="uiStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggleDark"
    >
      <Sun v-if="uiStore.isDark" class="w-4 h-4" />
      <Moon v-else class="w-4 h-4" />
    </button>

    <!-- user menu -->
    <button
      class="flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors cursor-pointer"
      aria-haspopup="true"
      aria-controls="user-menu"
      @click="toggleMenu"
    >
      <div
        class="w-8 h-8 rounded-full bg-surface-900 dark:bg-surface-100 text-surface-0 dark:text-surface-900 flex items-center justify-center text-xs font-semibold"
      >
        {{ userInitial() }}
      </div>
      <span
        class="hidden sm:block text-sm font-medium text-surface-700 dark:text-surface-200 max-w-32 truncate"
      >
        {{ authStore.user?.name ?? '' }}
      </span>
      <ChevronDown class="w-3 h-3 text-surface-400 hidden sm:block" />
    </button>

    <Menu
      id="user-menu"
      ref="menu"
      :model="menuItems"
      popup
      :pt="{
        root: { class: 'min-w-48!' },
        list: { class: 'p-1.5!' },
        itemContent: { class: 'px-3! py-2! rounded-lg!' },
      }"
    />
  </header>
</template>
