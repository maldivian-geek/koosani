<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import DatePicker from 'primevue/datepicker'
import { ArrowLeft } from 'lucide-vue-next'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { todayMv, startOfMvMonth } from '@koosani/shared'

interface SoaEntry {
  type: 'invoice' | 'credit_note' | 'payment'
  date: string
  refNumber: string | null
  description: string
  debit: string | null
  credit: string | null
  balance: string
}

interface SoaResponse {
  customerId: string
  customerName: string
  from: string
  to: string
  openingBalance: string
  entries: SoaEntry[]
  closingBalance: string
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const customerId = route.params.id as string

const soa = ref<SoaResponse | null>(null)
const customerName = ref('')
const loading = ref(false)

// Default: current month
const today = todayMv()
const monthStart = startOfMvMonth(today)
const fromDate = ref<Date>(new Date(monthStart))
const toDate = ref<Date>(new Date(today))

async function load() {
  loading.value = true
  soa.value = null
  try {
    const from = formatDate(fromDate.value)
    const to = formatDate(toDate.value)
    const data = await apiFetch<SoaResponse>(
      `/customers/${customerId}/soa?from=${from}&to=${to}&format=json`,
    )
    soa.value = data
    customerName.value = data.customerName
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/customers')
      return
    }
    const msg =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    loading.value = false
  }
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(() => void load())

function entryTypeLabel(type: string): string {
  if (type === 'invoice') return 'Invoice'
  if (type === 'credit_note') return 'Credit Note'
  if (type === 'payment') return 'Payment'
  return type
}

function isNegativeBalance(balance: string): boolean {
  return parseFloat(balance) < 0
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/customers')">
        <ArrowLeft class="w-4 h-4" />
        Customers
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          Statement of Account
          <span
            v-if="customerName"
            class="text-surface-500 dark:text-surface-400 font-normal text-lg"
          >
            — {{ customerName }}</span
          >
        </h2>
      </div>
    </div>

    <!-- Date range filter -->
    <div class="card p-5">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">From</label>
          <DatePicker v-model="fromDate" date-format="dd M yy" show-icon show-button-bar />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">To</label>
          <DatePicker v-model="toDate" date-format="dd M yy" show-icon show-button-bar />
        </div>
        <Button :loading="loading" @click="() => void load()">Apply</Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="soa">
      <!-- Summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Opening Balance
          </p>
          <p
            class="text-lg font-semibold tabular-nums"
            :class="
              isNegativeBalance(soa.openingBalance)
                ? 'text-green-600 dark:text-green-400'
                : 'text-surface-900 dark:text-surface-50'
            "
          >
            <MoneyCell :amount="soa.openingBalance" />
          </p>
        </div>
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Total Invoiced
          </p>
          <p class="text-lg font-semibold text-surface-900 dark:text-surface-50 tabular-nums">
            <MoneyCell
              :amount="
                soa.entries
                  .filter((e) => e.type === 'invoice')
                  .reduce((s, e) => s + parseFloat(e.debit ?? '0'), 0)
                  .toFixed(2)
              "
            />
          </p>
        </div>
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Total Received
          </p>
          <p class="text-lg font-semibold text-green-600 dark:text-green-400 tabular-nums">
            <MoneyCell
              :amount="
                soa.entries
                  .filter((e) => e.type === 'payment')
                  .reduce((s, e) => s + parseFloat(e.credit ?? '0'), 0)
                  .toFixed(2)
              "
            />
          </p>
        </div>
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Closing Balance
          </p>
          <p
            class="text-lg font-semibold tabular-nums"
            :class="
              parseFloat(soa.closingBalance) > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-surface-900 dark:text-surface-50'
            "
          >
            <MoneyCell :amount="soa.closingBalance" />
          </p>
        </div>
      </div>

      <!-- Entries table -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Transactions
            <span class="text-surface-400 font-normal ml-2">
              <DateCell :date="soa.from" /> – <DateCell :date="soa.to" />
            </span>
          </h3>
        </div>

        <div v-if="soa.entries.length === 0" class="text-center py-12 text-sm text-surface-400">
          No transactions in this period.
        </div>

        <DataTable v-else :value="soa.entries" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="date" header="Date" style="width: 120px">
            <template #body="{ data }">
              <DateCell :date="(data as SoaEntry).date" />
            </template>
          </Column>
          <Column field="type" header="Type" style="width: 120px">
            <template #body="{ data }">
              <span class="text-xs text-surface-500">{{
                entryTypeLabel((data as SoaEntry).type)
              }}</span>
            </template>
          </Column>
          <Column field="refNumber" header="Reference" style="width: 140px">
            <template #body="{ data }">
              <span class="font-mono text-xs">{{ (data as SoaEntry).refNumber ?? '—' }}</span>
            </template>
          </Column>
          <Column field="description" header="Description" />
          <Column field="debit" header="Debit" class="text-right" style="width: 120px">
            <template #body="{ data }">
              <MoneyCell v-if="(data as SoaEntry).debit" :amount="(data as SoaEntry).debit!" />
              <span v-else class="text-surface-300 dark:text-surface-600">—</span>
            </template>
          </Column>
          <Column field="credit" header="Credit" class="text-right" style="width: 120px">
            <template #body="{ data }">
              <MoneyCell v-if="(data as SoaEntry).credit" :amount="(data as SoaEntry).credit!" />
              <span v-else class="text-surface-300 dark:text-surface-600">—</span>
            </template>
          </Column>
          <Column field="balance" header="Balance" class="text-right" style="width: 130px">
            <template #body="{ data }">
              <span
                class="tabular-nums font-medium"
                :class="
                  parseFloat((data as SoaEntry).balance) > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-surface-700 dark:text-surface-300'
                "
              >
                <MoneyCell :amount="(data as SoaEntry).balance" />
              </span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>
