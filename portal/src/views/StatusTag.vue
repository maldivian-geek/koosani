<script setup lang="ts">
import Tag from 'primevue/tag'
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

type Severity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined

const severityMap: Record<string, Severity> = {
  draft: 'secondary',
  issued: 'info',
  sent: 'info',
  paid: 'success',
  accepted: 'success',
  partially_paid: 'warn',
  voided: 'danger',
  declined: 'danger',
  expired: 'secondary',
}

const severity = computed<Severity>(() => severityMap[props.status] ?? 'secondary')

const label = computed(() =>
  props.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
)
</script>

<template>
  <Tag :value="label" :severity="severity" />
</template>
