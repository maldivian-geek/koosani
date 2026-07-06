<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { usePortalAuthStore } from '../stores/auth.js'

const authStore = usePortalAuthStore()
const router = useRouter()

async function onLogout() {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-surface-50 dark:bg-surface-950">
    <header
      class="border-b border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900"
    >
      <div class="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <nav class="flex gap-6 text-sm font-medium">
          <RouterLink to="/invoices" class="hover:underline">Invoices</RouterLink>
          <RouterLink to="/estimates" class="hover:underline">Estimates</RouterLink>
          <RouterLink to="/statement" class="hover:underline">Statement</RouterLink>
        </nav>
        <div class="flex items-center gap-4">
          <span v-if="authStore.customer" class="text-sm text-surface-500">{{
            authStore.customer.name
          }}</span>
          <Button label="Sign out" size="small" text @click="onLogout" />
        </div>
      </div>
    </header>
    <main class="max-w-4xl mx-auto px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
