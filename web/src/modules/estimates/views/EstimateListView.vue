<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import Select from 'primevue/select'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface Estimate {
  id: string
  estimateNumber: string | null
  customerId: string
  customerName: string
  status: string
  issueDate: string | null
  expiryDate: string | null
  total: string
  createdAt: string
}

const router = useRouter()
const toast = useToast()

const rows = ref<Estimate[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')
const statusFilter = ref<string | null>(null)

const statusOptions = [
  { label: 'All', value: null },
  { label: 'Draft', value: 'draft' },
  { label: 'Sent', value: 'sent' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Declined', value: 'declined' },
  { label: 'Expired', value: 'expired' },
]

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    if (statusFilter.value) params.set('status', statusFilter.value)

    const data = await apiFetch<{ items: Estimate[]; total: number }>(`/estimates?${params}`)
    rows.value = data.items
    total.value = data.total
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

function onPage(e: { page: number; pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
  void load()
}

function onSearch(query: string) {
  q.value = query
  page.value = 1
  void load()
}

function onCreate() {
  void router.push('/estimates/new')
}

function onRowClick(row: unknown) {
  const est = row as Estimate
  void router.push(`/estimates/${est.id}`)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Estimates</h2>
        <p class="text-surface-500 dark:text-surface-400 mt-0.5">
          Quotes for customers, convertible to invoices.
        </p>
      </div>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Estimate"
      @page="onPage"
      @search="onSearch"
      @create="onCreate"
      @row-click="onRowClick"
    >
      <template #filters>
        <Select
          v-model="statusFilter"
          :options="statusOptions"
          option-label="label"
          option-value="value"
          placeholder="All statuses"
          class="w-44"
          @change="
            () => {
              page = 1
              void load()
            }
          "
        />
      </template>

      <Column field="estimateNumber" header="Number" :pt="stackPt">
        <template #body="{ data }">
          <span class="font-mono text-sm">{{ (data as Estimate).estimateNumber ?? '—' }}</span>
        </template>
      </Column>
      <Column field="customerName" header="Customer" :pt="stackPt" />
      <Column field="issueDate" header="Date" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as Estimate).issueDate ?? (data as Estimate).createdAt" />
        </template>
      </Column>
      <Column field="expiryDate" header="Valid Until" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as Estimate).expiryDate" />
        </template>
      </Column>
      <Column field="status" header="Status" :pt="stackPt">
        <template #body="{ data }">
          <StatusTag :status="(data as Estimate).status" />
        </template>
      </Column>
      <Column field="total" header="Total" class="text-right" :pt="stackPt">
        <template #body="{ data }">
          <MoneyCell :amount="(data as Estimate).total" />
        </template>
      </Column>
    </EntityList>
  </div>
</template>
