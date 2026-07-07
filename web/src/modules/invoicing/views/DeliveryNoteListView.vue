<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface DeliveryNote {
  id: string
  deliveryNoteNumber: string
  customerId: string
  customerName: string
  invoiceId: string
  issueDate: string
}

const router = useRouter()
const toast = useToast()

const allRows = ref<DeliveryNote[]>([])
const rows = ref<DeliveryNote[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    allRows.value = await apiFetch<DeliveryNote[]>('/delivery-notes')
    rows.value = allRows.value
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    loading.value = false
  }
}

function onSearch(q: string) {
  const needle = q.trim().toLowerCase()
  rows.value = !needle
    ? allRows.value
    : allRows.value.filter(
        (r) =>
          r.deliveryNoteNumber.toLowerCase().includes(needle) ||
          r.customerName.toLowerCase().includes(needle),
      )
}

function onRowClick(row: unknown) {
  void router.push(`/delivery-notes/${(row as DeliveryNote).id}`)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Delivery Notes</h2>
      <p class="text-surface-500 dark:text-surface-400 mt-0.5">
        Packing slips generated from issued invoices. Generate one from an invoice's detail page.
      </p>
    </div>

    <EntityList
      :rows="rows"
      :total="rows.length"
      :loading="loading"
      :page="1"
      :page-size="200"
      entity="Delivery Note"
      :can-create="false"
      @search="onSearch"
      @row-click="onRowClick"
    >
      <Column field="deliveryNoteNumber" header="Number">
        <template #body="{ data }">
          <span class="font-mono text-sm">{{ (data as DeliveryNote).deliveryNoteNumber }}</span>
        </template>
      </Column>
      <Column field="customerName" header="Customer" />
      <Column field="issueDate" header="Date">
        <template #body="{ data }">
          <DateCell :date="(data as DeliveryNote).issueDate" />
        </template>
      </Column>
    </EntityList>
  </div>
</template>
