<script setup lang="ts">
import { useAuthStore } from '../../../stores/auth.js'

const authStore = useAuthStore()
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900">Dashboard</h2>
      <p class="text-surface-500 mt-0.5">
        Welcome back{{ authStore.user ? `, ${authStore.user.name}` : '' }}.
      </p>
    </div>
  </div>
</template>
