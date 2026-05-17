<script setup lang="ts">
import { useRoute } from 'vue-router'

interface NavItem {
  label: string
  to: string
  icon: string
}

interface NavGroup {
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    items: [{ label: 'Dashboard', to: '/dashboard', icon: 'pi-home' }],
  },
  {
    items: [
      { label: 'Customers', to: '/customers', icon: 'pi-users' },
      { label: 'Suppliers', to: '/suppliers', icon: 'pi-building' },
      { label: 'Items', to: '/items', icon: 'pi-box' },
    ],
  },
  {
    items: [
      { label: 'Invoices', to: '/invoices', icon: 'pi-file-edit' },
      { label: 'Credit Notes', to: '/credit-notes', icon: 'pi-file-minus' },
    ],
  },
  {
    items: [
      { label: 'Bills', to: '/bills', icon: 'pi-receipt' },
      { label: 'Purchase Orders', to: '/pos', icon: 'pi-shopping-cart' },
    ],
  },
  {
    items: [{ label: 'GST', to: '/gst', icon: 'pi-percentage' }],
  },
  {
    items: [{ label: 'Reports', to: '/reports', icon: 'pi-chart-bar' }],
  },
]

const route = useRoute()

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <nav
    class="w-56 flex-none flex flex-col border-r border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 overflow-y-auto"
  >
    <div class="px-4 py-5 border-b border-surface-200 dark:border-surface-700">
      <span class="font-bold text-lg tracking-tight">Koosani</span>
    </div>

    <div class="flex-1 py-3">
      <template v-for="(group, gi) in groups" :key="gi">
        <div v-if="gi > 0" class="my-1 mx-3 border-t border-surface-200 dark:border-surface-700" />
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-4 py-2 mx-2 rounded-md text-sm font-medium transition-colors"
          :class="
            isActive(item.to)
              ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-50'
              : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-50'
          "
        >
          <i :class="['pi', item.icon, 'text-base']" />
          {{ item.label }}
        </RouterLink>
      </template>
    </div>
  </nav>
</template>
