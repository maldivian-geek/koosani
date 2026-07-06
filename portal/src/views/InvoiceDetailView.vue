<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import { apiFetch, ApiError } from '../lib/apiFetch.js'
import MoneyCell from './MoneyCell.vue'
import StatusTag from './StatusTag.vue'

type InvoiceLine = {
  id: string
  description: string
  qty: string
  unitPrice: string
  lineTotal: string
}

type InvoiceDetail = {
  id: string
  invoiceNumber: string | null
  issueDate: string | null
  dueDate: string | null
  subtotal: string
  gstAmount: string
  total: string
  paidAmount: string
  status: string
  notes: string | null
  lines: InvoiceLine[]
}

const route = useRoute()
const invoice = ref<InvoiceDetail | null>(null)
const notFound = ref(false)
const downloading = ref(false)

async function load() {
  try {
    invoice.value = await apiFetch<InvoiceDetail>(
      `/portal/invoices/${route.params['id'] as string}`,
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true
    else throw err
  }
}

onMounted(load)

async function downloadPdf() {
  downloading.value = true
  try {
    const { url } = await apiFetch<{ url: string }>(
      `/portal/invoices/${route.params['id'] as string}/pdf`,
    )
    window.open(url, '_blank')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div v-if="notFound" class="card">Invoice not found.</div>
  <div v-else-if="invoice" class="flex flex-col gap-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold">Invoice {{ invoice.invoiceNumber ?? '' }}</h1>
        <p class="text-surface-500 text-sm">
          Issued {{ invoice.issueDate ?? '—' }} · Due {{ invoice.dueDate ?? '—' }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <StatusTag :status="invoice.status" />
        <Button
          label="Download PDF"
          icon="pi pi-download"
          :loading="downloading"
          @click="downloadPdf"
        />
      </div>
    </div>

    <div class="card">
      <DataTable :value="invoice.lines" data-key="id">
        <Column field="description" header="Description" />
        <Column field="qty" header="Qty" />
        <Column header="Unit price">
          <template #body="{ data }"><MoneyCell :amount="data.unitPrice" /></template>
        </Column>
        <Column header="Line total">
          <template #body="{ data }"><MoneyCell :amount="data.lineTotal" /></template>
        </Column>
      </DataTable>

      <div class="flex flex-col items-end gap-1 mt-4 text-sm">
        <div class="flex gap-8">
          <span class="text-surface-500">Subtotal</span><MoneyCell :amount="invoice.subtotal" />
        </div>
        <div class="flex gap-8">
          <span class="text-surface-500">GST</span><MoneyCell :amount="invoice.gstAmount" />
        </div>
        <div class="flex gap-8 font-semibold">
          <span>Total</span><MoneyCell :amount="invoice.total" />
        </div>
        <div class="flex gap-8">
          <span class="text-surface-500">Paid</span><MoneyCell :amount="invoice.paidAmount" />
        </div>
      </div>
    </div>

    <p v-if="invoice.notes" class="text-sm text-surface-500">{{ invoice.notes }}</p>
  </div>
</template>
