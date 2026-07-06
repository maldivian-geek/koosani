<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import { apiFetch } from '../lib/apiFetch.js'
import { usePortalAuthStore } from '../stores/auth.js'

const route = useRoute()
const router = useRouter()
const authStore = usePortalAuthStore()
const failed = ref(false)

onMounted(async () => {
  const token = typeof route.query['token'] === 'string' ? route.query['token'] : null
  if (!token) {
    failed.value = true
    return
  }

  try {
    const profile = await apiFetch<{ id: string; name: string; email: string | null }>(
      '/portal/auth/magic-link/verify',
      { method: 'POST', body: JSON.stringify({ token }), noRedirect: true },
    )
    authStore.setCustomer(profile)
    const redirect =
      typeof route.query['redirect'] === 'string' ? route.query['redirect'] : '/invoices'
    router.replace(redirect)
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8 text-center">
      <template v-if="!failed">
        <ProgressSpinner style="width: 48px; height: 48px" />
        <p class="text-surface-500 mt-4">Signing you in…</p>
      </template>
      <template v-else>
        <h1 class="text-xl font-semibold mb-2">This link isn't valid</h1>
        <p class="text-surface-500 mb-6">
          It may have expired or already been used. Sign-in links are valid for 15 minutes and can
          only be used once.
        </p>
        <RouterLink to="/login" class="text-primary-500 hover:underline"
          >Request a new link</RouterLink
        >
      </template>
    </div>
  </div>
</template>
