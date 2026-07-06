<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { apiFetch } from '../lib/apiFetch.js'
import MoneyCell from './MoneyCell.vue'
import StatusTag from './StatusTag.vue'

type InvoiceRow = {
  id: string
  invoiceNumber: string | null
  issueDate: string | null
  dueDate: string | null
  total: string
  paidAmount: string
  status: string
}

const rows = ref<InvoiceRow[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await apiFetch<{ items: InvoiceRow[] }>('/portal/invoices?pageSize=100')
    rows.value = res.items
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <h1 class="text-xl font-semibold mb-4">Invoices</h1>
  <div class="card">
    <DataTable :value="rows" :loading="loading" data-key="id">
      <template #empty>No invoices yet.</template>
      <Column field="invoiceNumber" header="Invoice #">
        <template #body="{ data }">
          <RouterLink :to="`/invoices/${data.id}`" class="text-primary-500 hover:underline">
            {{ data.invoiceNumber ?? '—' }}
          </RouterLink>
        </template>
      </Column>
      <Column field="issueDate" header="Issue date" />
      <Column field="dueDate" header="Due date" />
      <Column header="Total">
        <template #body="{ data }"><MoneyCell :amount="data.total" /></template>
      </Column>
      <Column header="Paid">
        <template #body="{ data }"><MoneyCell :amount="data.paidAmount" /></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }"><StatusTag :status="data.status" /></template>
      </Column>
    </DataTable>
  </div>
</template>
