<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import DatePicker from 'primevue/datepicker'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

// Multi-currency (Phase 30, UPGRADE.md G-10) — manual rate entry only; see
// STACK.md's open decisions for the (not yet built) automated daily-rate job.

interface ExchangeRate {
  id: string
  currency: string
  rate: string
  rateDate: string
  source: string
  createdAt: string
}

const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'GBP', value: 'GBP' },
]

const router = useRouter()
const toast = useToast()

const rates = ref<ExchangeRate[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await apiFetch<{ items: ExchangeRate[] }>('/exchange-rates')
    rates.value = data.items
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Something went wrong. Please try again.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

// ─── Record rate dialog ───────────────────────────────────────────────────────

const dialogOpen = ref(false)
const currency = ref('USD')
const rate = ref('')
const rateDate = ref<Date>(new Date())
const saving = ref(false)

function openDialog() {
  currency.value = 'USD'
  rate.value = ''
  rateDate.value = new Date()
  dialogOpen.value = true
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function submit() {
  saving.value = true
  try {
    await apiFetch('/exchange-rates', {
      method: 'POST',
      body: JSON.stringify({
        currency: currency.value,
        rate: rate.value,
        rateDate: isoDate(rateDate.value),
      }),
    })
    dialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Recorded',
      detail: 'Exchange rate recorded.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Please check the rate and try again.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/settings')">
        <ArrowLeft class="w-4 h-4" />
        Settings
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Exchange Rates</h2>
        <p class="text-surface-500 mt-0.5 text-sm">
          MVR per unit of foreign currency. New invoices/estimates use the most recent rate on or
          before their date.
        </p>
      </div>
      <Button @click="openDialog">
        <Plus class="w-4 h-4" />
        Record Rate
      </Button>
    </div>

    <div class="card overflow-hidden p-0!">
      <div v-if="loading" class="text-center py-12 text-sm text-surface-400">Loading…</div>
      <div v-else-if="rates.length === 0" class="text-center py-12 text-sm text-surface-400">
        No exchange rates recorded yet. MVR-only invoices don't need one.
      </div>
      <DataTable v-else :value="rates" :pt="{ root: { class: 'text-sm!' } }">
        <Column field="currency" header="Currency" style="width: 100px" />
        <Column field="rateDate" header="Effective from" style="width: 160px">
          <template #body="{ data }">
            <DateCell :date="(data as ExchangeRate).rateDate" />
          </template>
        </Column>
        <Column field="rate" header="Rate (MVR per unit)" class="text-right tabular-nums" />
        <Column field="source" header="Source" style="width: 100px" />
      </DataTable>
    </div>

    <Dialog
      v-model:visible="dialogOpen"
      header="Record Exchange Rate"
      modal
      :style="{ width: '26rem' }"
    >
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Currency</label>
          <Select
            v-model="currency"
            :options="CURRENCY_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Rate (MVR per unit)</label>
          <InputText v-model="rate" inputmode="decimal" placeholder="e.g. 15.42" fluid />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Effective from</label>
          <DatePicker v-model="rateDate" date-format="dd M yy" show-icon fluid />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="dialogOpen = false" />
        <Button label="Record" :loading="saving" @click="submit" />
      </template>
    </Dialog>
  </div>
</template>
