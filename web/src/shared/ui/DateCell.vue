<script setup lang="ts">
import { computed } from 'vue'
import { format, parseISO } from 'date-fns'

const props = defineProps<{ date: string | null | undefined }>()

const formatted = computed(() => {
  if (!props.date) return '—'
  try {
    return format(parseISO(props.date), 'dd MMM yyyy')
  } catch {
    return props.date
  }
})
</script>

<template>
  <span>{{ formatted }}</span>
</template>
