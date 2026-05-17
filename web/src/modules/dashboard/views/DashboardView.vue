<script setup lang="ts">
import { useAuthStore } from '../../../stores/auth.js'

const authStore = useAuthStore()
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-1">Dashboard</h1>
    <p class="text-surface-500">
      Welcome back{{ authStore.user ? `, ${authStore.user.name}` : '' }}.
    </p>
  </div>
</template>
