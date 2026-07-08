<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Column from 'primevue/column'
import Select from 'primevue/select'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import ExpenseDrawer from '../ExpenseDrawer.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface Expense {
  id: string
  category: string
  description: string | null
  supplierId: string | null
  expenseDate: string
  amount: string
  gstCategory: string
  gstAmount: string
  total: string
  paymentMethod: string | null
  receiptFileId: string | null
  billable: boolean
  customerId: string | null
  invoiceId: string | null
  invoicedAt: string | null
}

const BILLABLE_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Billable only', value: true },
  { label: 'Non-billable only', value: false },
]

const toast = useToast()

const rows = ref<Expense[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const billableFilter = ref<boolean | undefined>(undefined)

const selected = ref<Expense | null>(null)
const drawerOpen = ref(false)

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (billableFilter.value !== undefined) params.set('billable', String(billableFilter.value))
    const data = await apiFetch<{ items: Expense[]; total: number }>(`/expenses?${params}`)
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

function onBillableFilterChange() {
  page.value = 1
  void load()
}

function openCreate() {
  selected.value = null
  drawerOpen.value = true
}

function onRowClick(row: unknown) {
  selected.value = row as Expense
  drawerOpen.value = true
}

function onSaved() {
  drawerOpen.value = false
  void load()
}

function onDeleted() {
  drawerOpen.value = false
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900">Expenses</h2>
      <p class="text-surface-500 mt-0.5">
        Lightweight expense capture — distinct from supplier bills. Mark an expense billable to add
        it as a line item on a customer's invoice.
      </p>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Expense"
      @page="onPage"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <template #filters>
        <Select
          v-model="billableFilter"
          :options="BILLABLE_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-44"
          @change="onBillableFilterChange"
        />
      </template>
      <Column field="expenseDate" header="Date" style="width: 130px" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as Expense).expenseDate" />
        </template>
      </Column>
      <Column field="category" header="Category" :pt="stackPt" />
      <Column field="description" header="Description" :pt="stackPt" />
      <Column header="Amount" class="text-right" style="width: 120px" :pt="stackPt">
        <template #body="{ data }">
          <MoneyCell :amount="(data as Expense).amount" />
        </template>
      </Column>
      <Column header="Total (incl. GST)" class="text-right" style="width: 140px" :pt="stackPt">
        <template #body="{ data }">
          <MoneyCell :amount="(data as Expense).total" />
        </template>
      </Column>
      <Column header="Billable" style="width: 110px" :pt="stackPt">
        <template #body="{ data }">
          <span v-if="(data as Expense).billable" class="text-xs text-primary-500 font-medium">
            {{ (data as Expense).invoicedAt ? 'Invoiced' : 'Billable' }}
          </span>
          <span v-else class="text-xs text-surface-400">—</span>
        </template>
      </Column>
    </EntityList>

    <ExpenseDrawer
      :expense="selected"
      :open="drawerOpen"
      @close="drawerOpen = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>
