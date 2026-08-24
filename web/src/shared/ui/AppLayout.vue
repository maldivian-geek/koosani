<script setup lang="ts">
import { ref } from 'vue'
import { LayoutDashboard, FileText, Users, Menu as MenuIcon } from '@lucide/vue'
import SidebarNav from './SidebarNav.vue'
import TopBar from './TopBar.vue'
import BreadcrumbBar from './BreadcrumbBar.vue'

const sidebarOpen = ref(false)

const bottomNavLinks = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Invoices', to: '/invoices', icon: FileText },
  { label: 'Customers', to: '/customers', icon: Users },
]
</script>

<template>
  <div class="flex min-h-dvh bg-surface-50 dark:bg-surface-950 overflow-hidden">
    <SidebarNav v-model:mobile-open="sidebarOpen" />
    <!-- spacer to offset fixed sidebar -->
    <div class="hidden md:block w-16 lg:w-64 shrink-0" />

    <div class="flex flex-col flex-1 min-w-0">
      <TopBar @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <BreadcrumbBar />
      <main class="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
        <RouterView />
      </main>
    </div>

    <!-- mobile bottom nav -->
    <nav
      class="fixed bottom-0 inset-x-0 bg-surface-0 dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700 flex md:hidden z-30"
    >
      <RouterLink
        v-for="item in bottomNavLinks"
        :key="item.to"
        :to="item.to"
        class="flex-1 flex flex-col items-center py-2 text-xs gap-1 text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50 transition-colors"
        active-class="text-surface-900! dark:text-surface-50! font-medium"
      >
        <component :is="item.icon" class="w-5 h-5" />
        {{ item.label }}
      </RouterLink>
      <button
        class="flex-1 flex flex-col items-center py-2 text-xs gap-1 text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50 transition-colors cursor-pointer"
        @click="sidebarOpen = true"
      >
        <MenuIcon class="w-5 h-5" />
        More
      </button>
    </nav>
  </div>
</template>
