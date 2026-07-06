<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { apiFetch } from '../lib/apiFetch.js'
import MoneyCell from './MoneyCell.vue'
import StatusTag from './StatusTag.vue'

type EstimateRow = {
  id: string
  estimateNumber: string | null
  issueDate: string | null
  expiryDate: string | null
  total: string
  status: string
}

const rows = ref<EstimateRow[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await apiFetch<{ items: EstimateRow[] }>('/portal/estimates?pageSize=100')
    rows.value = res.items
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <h1 class="text-xl font-semibold mb-4">Estimates</h1>
  <div class="card">
    <DataTable :value="rows" :loading="loading" data-key="id">
      <template #empty>No estimates yet.</template>
      <Column field="estimateNumber" header="Estimate #">
        <template #body="{ data }">
          <RouterLink :to="`/estimates/${data.id}`" class="text-primary-500 hover:underline">
            {{ data.estimateNumber ?? '—' }}
          </RouterLink>
        </template>
      </Column>
      <Column field="issueDate" header="Issue date" />
      <Column field="expiryDate" header="Valid until" />
      <Column header="Total">
        <template #body="{ data }"><MoneyCell :amount="data.total" /></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }"><StatusTag :status="data.status" /></template>
      </Column>
    </DataTable>
  </div>
</template>
