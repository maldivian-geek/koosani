<script setup lang="ts">
defineProps<{
  variant?: 'first-time' | 'filtered' | 'restricted'
  entity?: string
}>()

defineEmits<{
  create: []
  clearFilters: []
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-20 gap-3 text-center">
    <i class="pi pi-inbox text-4xl text-surface-300" />

    <template v-if="variant === 'first-time' || !variant">
      <p class="text-surface-500">No {{ entity ?? 'records' }} yet.</p>
      <slot name="action" />
    </template>

    <template v-else-if="variant === 'filtered'">
      <p class="text-surface-500">No {{ entity ?? 'records' }} match your filters.</p>
      <slot name="action">
        <button class="text-sm text-primary-600 hover:underline" @click="$emit('clearFilters')">
          Clear filters
        </button>
      </slot>
    </template>

    <template v-else-if="variant === 'restricted'">
      <p class="text-surface-500">You don't have access to view {{ entity ?? 'this' }}.</p>
      <p class="text-sm text-surface-400">Contact your administrator.</p>
    </template>
  </div>
</template>
