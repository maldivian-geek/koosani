<script setup lang="ts">
import Button from 'primevue/button'
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="text-center p-8">
      <p class="text-6xl font-bold text-surface-300 mb-4">404</p>
      <h1 class="text-2xl font-semibold mb-2">Page not found</h1>
      <p class="text-surface-500 mb-8">The page you're looking for doesn't exist.</p>
      <RouterLink to="/dashboard">
        <Button label="Go to Dashboard" />
      </RouterLink>
    </div>
  </div>
</template>
