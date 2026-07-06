<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  amount: string | null | undefined
}>()

const formatted = computed(() => {
  if (props.amount === null || props.amount === undefined) return '—'
  const num = parseFloat(props.amount)
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('en-MV', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
})
</script>

<template>
  <span class="tabular-nums">MVR {{ formatted }}</span>
</template>
