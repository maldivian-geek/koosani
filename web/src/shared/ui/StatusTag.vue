<script setup lang="ts">
import Tag from 'primevue/tag'
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

type Severity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined

const severityMap: Record<string, Severity> = {
  // Invoice / CN
  draft: 'secondary',
  issued: 'info',
  paid: 'success',
  partially_paid: 'warn',
  void: 'danger',
  // Bill
  confirmed: 'info',
  // GST period
  open: 'info',
  built: 'warn',
  locked: 'contrast',
  // PO / GRN
  pending: 'secondary',
  approved: 'info',
  received: 'success',
  partially_received: 'warn',
  cancelled: 'danger',
  // Projects / tasks (Phase 32)
  active: 'success',
  completed: 'contrast',
  archived: 'secondary',
  done: 'success',
}

const severity = computed<Severity>(() => severityMap[props.status] ?? 'secondary')

const label = computed(() =>
  props.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
)
</script>

<template>
  <Tag :value="label" :severity="severity" />
</template>
