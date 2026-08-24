<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import { ExternalLink } from '@lucide/vue'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface Period {
  id: string
  periodStart: string
  periodEnd: string
  status: 'open' | 'built' | 'locked'
  lockedAt: string | null
  miraReturnRef: string | null
}

interface RateRow {
  id: string
  category: string
  rate: string
  validFrom: string
  validTo: string | null
}

const router = useRouter()
const toast = useToast()

// ─── Periods ──────────────────────────────────────────────────────────────────

const periods = ref<Period[]>([])
const periodsLoading = ref(false)

async function loadPeriods() {
  periodsLoading.value = true
  try {
    const data = await apiFetch<Period[]>('/gst/periods')
    periods.value = [...data].sort(
      (a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime(),
    )
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load GST periods.',
      life: 5000,
    })
  } finally {
    periodsLoading.value = false
  }
}

function periodLabel(p: Period): string {
  const start = new Date(p.periodStart)
  // e.g. "Jan 2025" or "Jan – Mar 2025"
  const end = new Date(p.periodEnd)
  const startLabel = start.toLocaleString('en', { month: 'short', year: 'numeric' })
  const endLabel = end.toLocaleString('en', { month: 'short', year: 'numeric' })
  return startLabel === endLabel
    ? startLabel
    : `${start.toLocaleString('en', { month: 'short' })} – ${endLabel}`
}

// ─── Rates ────────────────────────────────────────────────────────────────────

const rates = ref<RateRow[]>([])
const ratesLoading = ref(false)

const rateCategory = ref('general_8')
const rateValue = ref('')
const rateValidFrom = ref<Date | null>(null)
const rateAddLoading = ref(false)
const rateErrors = ref<Record<string, string>>({})

const categoryOptions = [
  { label: 'General (8%)', value: 'general_8' },
  { label: 'Tourism (16%)', value: 'tourism_16' },
  { label: 'Tourism (17%)', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

async function loadRates() {
  ratesLoading.value = true
  try {
    rates.value = await apiFetch<RateRow[]>('/gst/rates')
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load GST rates.',
      life: 5000,
    })
  } finally {
    ratesLoading.value = false
  }
}

function ratePercent(rate: string): string {
  return `${(parseFloat(rate) * 100).toFixed(2)}%`
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function addRate() {
  rateErrors.value = {}
  if (!rateValue.value.trim()) {
    rateErrors.value.rate = 'Rate is required.'
    return
  }
  if (isNaN(parseFloat(rateValue.value))) {
    rateErrors.value.rate = 'Enter a decimal fraction (e.g. 0.0800).'
    return
  }
  if (!rateValidFrom.value) {
    rateErrors.value.validFrom = 'Valid from date is required.'
    return
  }

  rateAddLoading.value = true
  try {
    await apiFetch('/gst/rates', {
      method: 'POST',
      body: JSON.stringify({
        category: rateCategory.value,
        rate: rateValue.value,
        validFrom: toIso(rateValidFrom.value),
      }),
    })
    toast.add({
      severity: 'success',
      summary: 'Rate added',
      detail: 'New GST rate recorded.',
      life: 3000,
    })
    rateValue.value = ''
    rateValidFrom.value = null
    await loadRates()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to add rates."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    rateAddLoading.value = false
  }
}

onMounted(() => {
  void loadPeriods()
  void loadRates()
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">GST</h2>
      <p class="text-surface-500 dark:text-surface-400 mt-0.5">Manage GST periods and tax rates.</p>
    </div>

    <Tabs value="periods">
      <TabList>
        <Tab value="periods">Periods</Tab>
        <Tab value="rates">Rates</Tab>
      </TabList>

      <TabPanels>
        <!-- Periods tab -->
        <TabPanel value="periods">
          <div class="pt-4 space-y-4">
            <div class="card overflow-hidden p-0!">
              <DataTable
                :value="periods"
                :loading="periodsLoading"
                :pt="{ root: { class: 'text-sm!' } }"
              >
                <template #empty>
                  <div class="text-center py-10 text-sm text-surface-400">
                    No GST periods yet. They are created automatically when transactions are posted.
                  </div>
                </template>
                <Column header="Period">
                  <template #body="{ data }">
                    <span class="font-medium text-surface-900 dark:text-surface-50">{{
                      periodLabel(data as Period)
                    }}</span>
                    <span class="text-xs text-surface-400 ml-2">
                      <DateCell :date="(data as Period).periodStart" /> –
                      <DateCell :date="(data as Period).periodEnd" />
                    </span>
                  </template>
                </Column>
                <Column field="status" header="Status" style="width: 130px">
                  <template #body="{ data }">
                    <StatusTag :status="(data as Period).status" />
                  </template>
                </Column>
                <Column header="Locked" style="width: 160px">
                  <template #body="{ data }">
                    <span v-if="(data as Period).lockedAt" class="text-sm text-surface-500">
                      <DateCell :date="(data as Period).lockedAt" />
                    </span>
                    <span v-else class="text-surface-300 dark:text-surface-600 text-sm">—</span>
                  </template>
                </Column>
                <Column header="MIRAconnect Ref" style="width: 180px">
                  <template #body="{ data }">
                    <span class="font-mono text-xs text-surface-600 dark:text-surface-400">
                      {{ (data as Period).miraReturnRef ?? '—' }}
                    </span>
                  </template>
                </Column>
                <Column header="" style="width: 100px">
                  <template #body="{ data }">
                    <Button
                      size="small"
                      severity="secondary"
                      @click="() => void router.push(`/gst/periods/${(data as Period).id}`)"
                    >
                      <ExternalLink class="w-3.5 h-3.5" />
                      View
                    </Button>
                  </template>
                </Column>
              </DataTable>
            </div>
          </div>
        </TabPanel>

        <!-- Rates tab -->
        <TabPanel value="rates">
          <div class="pt-4 space-y-6">
            <!-- Rates table -->
            <div class="card overflow-hidden p-0!">
              <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
                <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
                  Historical Rates
                </h3>
              </div>
              <DataTable
                :value="rates"
                :loading="ratesLoading"
                :pt="{ root: { class: 'text-sm!' } }"
              >
                <template #empty>
                  <div class="text-center py-8 text-sm text-surface-400">No rates configured.</div>
                </template>
                <Column field="category" header="Category">
                  <template #body="{ data }">
                    {{
                      categoryOptions.find((o) => o.value === (data as RateRow).category)?.label ??
                      (data as RateRow).category
                    }}
                  </template>
                </Column>
                <Column field="rate" header="Rate">
                  <template #body="{ data }">
                    <span class="font-mono font-medium">{{
                      ratePercent((data as RateRow).rate)
                    }}</span>
                  </template>
                </Column>
                <Column field="validFrom" header="Valid From">
                  <template #body="{ data }">
                    <DateCell :date="(data as RateRow).validFrom" />
                  </template>
                </Column>
                <Column field="validTo" header="Valid To">
                  <template #body="{ data }">
                    <span v-if="(data as RateRow).validTo">
                      <DateCell :date="(data as RateRow).validTo!" />
                    </span>
                    <span
                      v-else
                      class="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded px-2 py-0.5"
                      >Current</span
                    >
                  </template>
                </Column>
              </DataTable>
            </div>

            <!-- Add rate form (admin) -->
            <div class="card p-6 space-y-4">
              <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
                Add Rate Override
              </h3>
              <p class="text-xs text-surface-400">
                Use only when MIRA publishes a new rate. The rate value is a decimal fraction — e.g.
                enter
                <code class="font-mono bg-surface-100 dark:bg-surface-800 rounded px-1"
                  >0.0800</code
                >
                for 8%.
              </p>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
                    >Category</label
                  >
                  <Select
                    v-model="rateCategory"
                    :options="categoryOptions"
                    option-label="label"
                    option-value="value"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
                    >Rate (fraction)</label
                  >
                  <InputText
                    v-model="rateValue"
                    placeholder="0.0800"
                    :class="{ 'p-invalid': rateErrors.rate }"
                  />
                  <span v-if="rateErrors.rate" class="text-xs text-red-500">{{
                    rateErrors.rate
                  }}</span>
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
                    >Valid From</label
                  >
                  <DatePicker
                    v-model="rateValidFrom"
                    date-format="dd M yy"
                    show-icon
                    :class="{ 'p-invalid': rateErrors.validFrom }"
                  />
                  <span v-if="rateErrors.validFrom" class="text-xs text-red-500">{{
                    rateErrors.validFrom
                  }}</span>
                </div>
              </div>
              <div class="flex justify-end">
                <Button :loading="rateAddLoading" @click="addRate">Add Rate</Button>
              </div>
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
