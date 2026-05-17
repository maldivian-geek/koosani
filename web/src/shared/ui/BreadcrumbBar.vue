<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Breadcrumb from 'primevue/breadcrumb'
import type { MenuItem } from 'primevue/menuitem'

const route = useRoute()

const home: MenuItem = { icon: 'pi pi-home', route: '/dashboard' }

const items = computed<MenuItem[]>(() =>
  route.matched
    .filter((r) => r.meta.title)
    .map((r) => ({
      label: r.meta.title as string,
      route: r.path,
    })),
)
</script>

<template>
  <div
    v-if="items.length > 0"
    class="px-6 py-2 border-b border-surface-100 dark:border-surface-800"
  >
    <Breadcrumb :home="home" :model="items">
      <template #item="{ item }">
        <RouterLink v-if="item.route" :to="item.route" class="text-sm">
          {{ item.label }}
        </RouterLink>
        <span v-else class="text-sm">{{ item.label }}</span>
      </template>
    </Breadcrumb>
  </div>
</template>
