<script setup lang="ts">
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import Drawer from 'primevue/drawer'
import SidebarContent from './SidebarContent.vue'

const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })

const route = useRoute()

watch(
  () => route.path,
  () => (mobileOpen.value = false),
)
</script>

<template>
  <Drawer v-model:visible="mobileOpen" position="left" :style="{ width: '16rem' }">
    <SidebarContent />
  </Drawer>

  <aside
    class="hidden md:flex flex-col fixed inset-y-0 left-0 z-30 w-16 lg:w-64 bg-surface-0 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-800"
  >
    <SidebarContent compact />
  </aside>
</template>
