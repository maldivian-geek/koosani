<script setup lang="ts">
import SidebarNav from './SidebarNav.vue'
import TopBar from './TopBar.vue'
import BreadcrumbBar from './BreadcrumbBar.vue'
</script>

<template>
  <div class="flex min-h-dvh bg-surface-50 dark:bg-surface-950 overflow-hidden">
    <SidebarNav />
    <!-- spacer to offset fixed sidebar -->
    <div class="hidden md:block w-64 shrink-0" />

    <div class="flex flex-col flex-1 min-w-0">
      <TopBar />
      <BreadcrumbBar />
      <main class="flex-1 overflow-y-auto p-4 md:p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
