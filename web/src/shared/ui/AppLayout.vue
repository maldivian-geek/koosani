<script setup lang="ts">
import SidebarNav from './SidebarNav.vue'
import TopBar from './TopBar.vue'
import BreadcrumbBar from './BreadcrumbBar.vue'
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-surface-0 dark:bg-surface-900">
    <SidebarNav />
    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar />
      <BreadcrumbBar />
      <main class="flex-1 overflow-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
