<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface CreditNote {
  id: string
  creditNoteNumber: string | null
  customerId: string
  customerName: string
  status: string
  issueDate: string | null
  total: string
  createdAt: string
}

const router = useRouter()
const toast = useToast()

const allRows = ref<CreditNote[]>([])
const rows = ref<CreditNote[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    allRows.value = await apiFetch<CreditNote[]>('/credit-notes')
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

// No server-side text search on this endpoint — filter client-side, fine
// for the small result sets an SME's credit-note history produces.
function onSearch(q: string) {
  const needle = q.trim().toLowerCase()
  rows.value = !needle
    ? allRows.value
    : allRows.value.filter(
        (r) =>
          (r.creditNoteNumber ?? '').toLowerCase().includes(needle) ||
          r.customerName.toLowerCase().includes(needle),
      )
}

function onCreate() {
  void router.push('/credit-notes/new')
}

function onRowClick(row: unknown) {
  void router.push(`/credit-notes/${(row as CreditNote).id}`)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Credit Notes</h2>
      <p class="text-surface-500 dark:text-surface-400 mt-0.5">
        Credit notes raised against issued invoices.
      </p>
    </div>

    <EntityList
      :rows="rows"
      :total="rows.length"
      :loading="loading"
      :page="1"
      :page-size="200"
      entity="Credit Note"
      @create="onCreate"
      @search="onSearch"
      @row-click="onRowClick"
    >
      <Column field="creditNoteNumber" header="Number" :pt="stackPt">
        <template #body="{ data }">
          <span class="font-mono text-sm">{{ (data as CreditNote).creditNoteNumber ?? '—' }}</span>
        </template>
      </Column>
      <Column field="customerName" header="Customer" :pt="stackPt" />
      <Column header="Date" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as CreditNote).issueDate ?? (data as CreditNote).createdAt" />
        </template>
      </Column>
      <Column field="status" header="Status" :pt="stackPt">
        <template #body="{ data }">
          <StatusTag :status="(data as CreditNote).status" />
        </template>
      </Column>
      <Column field="total" header="Total" class="text-right" :pt="stackPt">
        <template #body="{ data }">
          <MoneyCell :amount="(data as CreditNote).total" />
        </template>
      </Column>
    </EntityList>
  </div>
</template>
