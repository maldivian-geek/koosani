<script setup lang="ts">
import { markRaw, computed, type Component } from 'vue'
import { useRoute } from 'vue-router'
import {
  LayoutDashboard,
  Users,
  Building2,
  Package,
  Boxes,
  FileText,
  FileMinus,
  Truck,
  FileSpreadsheet,
  Repeat,
  Receipt,
  Banknote,
  FolderKanban,
  ShoppingCart,
  Percent,
  BarChart2,
  ShieldCheck,
  ScrollText,
  Settings,
  LogOut,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth.js'

interface NavItem {
  label: string
  to: string
  icon: Component
}

interface NavGroup {
  items: NavItem[]
}

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const BASE_GROUPS: NavGroup[] = [
  {
    items: [{ label: 'Dashboard', to: '/dashboard', icon: markRaw(LayoutDashboard) }],
  },
  {
    items: [
      { label: 'Customers', to: '/customers', icon: markRaw(Users) },
      { label: 'Suppliers', to: '/suppliers', icon: markRaw(Building2) },
      { label: 'Items', to: '/items', icon: markRaw(Package) },
      { label: 'Inventory', to: '/inventory', icon: markRaw(Boxes) },
    ],
  },
  {
    items: [
      { label: 'Estimates', to: '/estimates', icon: markRaw(FileSpreadsheet) },
      { label: 'Invoices', to: '/invoices', icon: markRaw(FileText) },
      { label: 'Credit Notes', to: '/credit-notes', icon: markRaw(FileMinus) },
      { label: 'Delivery Notes', to: '/delivery-notes', icon: markRaw(Truck) },
      { label: 'Recurring Invoices', to: '/recurring', icon: markRaw(Repeat) },
    ],
  },
  {
    items: [
      { label: 'Bills', to: '/bills', icon: markRaw(Receipt) },
      { label: 'Expenses', to: '/expenses', icon: markRaw(Banknote) },
      { label: 'Projects', to: '/projects', icon: markRaw(FolderKanban) },
      { label: 'Purchase Orders', to: '/pos', icon: markRaw(ShoppingCart) },
    ],
  },
  {
    items: [{ label: 'GST', to: '/gst', icon: markRaw(Percent) }],
  },
  {
    items: [{ label: 'Reports', to: '/reports', icon: markRaw(BarChart2) }],
  },
]

const ADMIN_GROUP: NavGroup = {
  items: [
    { label: 'Users', to: '/users', icon: markRaw(ShieldCheck) },
    { label: 'Audit Log', to: '/audit', icon: markRaw(ScrollText) },
    { label: 'Settings', to: '/settings', icon: markRaw(Settings) },
  ],
}

const route = useRoute()
const authStore = useAuthStore()

const groups = computed<NavGroup[]>(() =>
  authStore.user?.role === 'admin' ? [...BASE_GROUPS, ADMIN_GROUP] : BASE_GROUPS,
)

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + '/')
}

const userInitial = () => authStore.user?.name?.charAt(0).toUpperCase() ?? '?'

// At `compact`, labels hide at tablet width (icon-only rail) and reappear at
// desktop (`lg`) — used for the fixed aside. The mobile drawer never passes
// `compact`, so its labels always show regardless of viewport width.
const labelClass = computed(() => (props.compact ? 'md:hidden lg:block' : ''))
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- brand -->
    <div
      class="flex items-center gap-3 px-4 h-16 border-b border-surface-100 dark:border-surface-800 shrink-0"
    >
      <div class="w-5 h-5 grid grid-cols-2 gap-0.5 flex-none">
        <span class="rounded-xs bg-surface-900 dark:bg-surface-100" />
        <span class="rounded-xs bg-surface-900 dark:bg-surface-100" />
        <span class="rounded-xs bg-surface-900 dark:bg-surface-100" />
        <span class="rounded-xs bg-surface-900 dark:bg-surface-100" />
      </div>
      <span
        class="font-semibold text-surface-900 dark:text-surface-50 text-sm truncate"
        :class="labelClass"
        >Koosani</span
      >
    </div>

    <!-- nav -->
    <nav class="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
      <template v-for="(group, gi) in groups" :key="gi">
        <div v-if="gi > 0" class="my-1" />
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="
            isActive(item.to)
              ? 'bg-surface-900! text-surface-0! hover:bg-surface-800! dark:bg-surface-700! dark:text-surface-50! dark:hover:bg-surface-600!'
              : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-50'
          "
        >
          <component :is="item.icon" class="w-4 h-4 flex-none" />
          <span :class="labelClass">{{ item.label }}</span>
        </RouterLink>
      </template>
    </nav>

    <!-- user -->
    <div class="border-t border-surface-100 dark:border-surface-800 p-3 shrink-0 space-y-1">
      <div class="flex items-center gap-3 px-2 py-2">
        <div
          class="w-8 h-8 rounded-full bg-surface-900 dark:bg-surface-100 text-surface-0 dark:text-surface-900 flex items-center justify-center text-xs font-semibold shrink-0"
        >
          {{ userInitial() }}
        </div>
        <div class="flex-1 min-w-0" :class="labelClass">
          <p class="text-sm font-medium text-surface-900 dark:text-surface-50 truncate">
            {{ authStore.user?.name ?? '' }}
          </p>
          <p class="text-xs text-surface-500 dark:text-surface-400 truncate capitalize">
            {{ authStore.user?.role ?? '' }}
          </p>
        </div>
      </div>
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-50 transition-colors"
        @click="() => void authStore.logout()"
      >
        <LogOut class="w-4 h-4 flex-none" />
        <span :class="labelClass">Sign out</span>
      </button>
    </div>
  </div>
</template>
