<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  amount: string | null | undefined
  currency?: string
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

const currency = computed(() => props.currency ?? 'MVR')
</script>

<template>
  <span class="tabular-nums text-right">{{ currency }} {{ formatted }}</span>
</template>
