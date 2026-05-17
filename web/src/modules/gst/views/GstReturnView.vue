<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { ArrowLeft, Download, Lock, Unlock, RefreshCw } from 'lucide-vue-next'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
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

interface ReturnFile {
  kind: 'mira205' | 'mira206' | 'its'
  url: string
}

interface ReturnData {
  status: 'not_built' | 'built'
  builtAt?: string
  summary?: {
    mira205?: {
      taxableSupplies: string
      outputTax: string
      inputTax: string
      netPayable: string
    }
    mira206?: {
      taxableSupplies: string
      outputTax: string
      netPayable: string
    }
  }
  files: ReturnFile[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const periodId = route.params.id as string

const period = ref<Period | null>(null)
const periodLoading = ref(false)
const returnData = ref<ReturnData | null>(null)
const returnLoading = ref(false)
const building = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null

const lockDialogVisible = ref(false)
const miraReturnRef = ref('')
const lockLoading = ref(false)
const lockError = ref('')

const unlockDialogVisible = ref(false)
const unlockReason = ref('')
const unlockLoading = ref(false)
const unlockError = ref('')

const periodLabel = computed(() => {
  if (!period.value) return ''
  const start = new Date(period.value.periodStart)
  const end = new Date(period.value.periodEnd)
  const startLabel = start.toLocaleString('en', { month: 'short', year: 'numeric' })
  const endLabel = end.toLocaleString('en', { month: 'short', year: 'numeric' })
  return startLabel === endLabel
    ? startLabel
    : `${start.toLocaleString('en', { month: 'short' })} – ${endLabel}`
})

async function loadPeriod() {
  periodLoading.value = true
  try {
    const periods = await apiFetch<Period[]>('/gst/periods')
    period.value = periods.find((p) => p.id === periodId) ?? null
    if (!period.value) {
      void router.replace('/gst')
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load GST period.',
      life: 5000,
    })
  } finally {
    periodLoading.value = false
  }
}

async function loadReturn() {
  returnLoading.value = true
  try {
    returnData.value = await apiFetch<ReturnData>(`/gst/periods/${periodId}/return`)
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load return data.',
      life: 5000,
    })
  } finally {
    returnLoading.value = false
  }
}

function schedulePoll() {
  pollTimer = setTimeout(async () => {
    try {
      const data = await apiFetch<ReturnData>(`/gst/periods/${periodId}/return`)
      returnData.value = data
      if (data.status === 'built') {
        building.value = false
        await loadPeriod()
        toast.add({
          severity: 'success',
          summary: 'Return built',
          detail: 'GST return has been built successfully.',
          life: 4000,
        })
      } else {
        schedulePoll()
      }
    } catch {
      building.value = false
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Lost contact while building return.',
        life: 5000,
      })
    }
  }, 3000)
}

async function buildReturn() {
  building.value = true
  try {
    await apiFetch(`/gst/periods/${periodId}/build`, { method: 'POST' })
    schedulePoll()
  } catch (err) {
    building.value = false
    if (err instanceof ApiError && err.status === 429) {
      toast.add({
        severity: 'warn',
        summary: 'Rate limited',
        detail: 'You can only build a return 3 times per 5 minutes. Please wait.',
        life: 6000,
      })
    } else {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Could not start return build.',
        life: 5000,
      })
    }
  }
}

async function lockPeriod() {
  lockError.value = ''
  if (!miraReturnRef.value.trim()) {
    lockError.value = 'MIRAconnect reference is required.'
    return
  }
  lockLoading.value = true
  try {
    const updated = await apiFetch<Period>(`/gst/periods/${periodId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ miraReturnRef: miraReturnRef.value.trim() }),
    })
    period.value = updated
    lockDialogVisible.value = false
    miraReturnRef.value = ''
    toast.add({
      severity: 'success',
      summary: 'Period locked',
      detail: 'GST period has been locked.',
      life: 3000,
    })
  } catch (err) {
    lockError.value =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to lock periods."
        : 'Something went wrong. Please try again.'
  } finally {
    lockLoading.value = false
  }
}

async function unlockPeriod() {
  unlockError.value = ''
  if (!unlockReason.value.trim()) {
    unlockError.value = 'Reason is required.'
    return
  }
  unlockLoading.value = true
  try {
    const updated = await apiFetch<Period>(`/gst/periods/${periodId}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ reason: unlockReason.value.trim() }),
    })
    period.value = updated
    unlockDialogVisible.value = false
    unlockReason.value = ''
    toast.add({
      severity: 'success',
      summary: 'Period unlocked',
      detail: 'GST period has been unlocked.',
      life: 3000,
    })
  } catch (err) {
    unlockError.value =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to unlock periods."
        : 'Something went wrong. Please try again.'
  } finally {
    unlockLoading.value = false
  }
}

function fileLabel(kind: ReturnFile['kind']): string {
  if (kind === 'mira205') return 'MIRA 205'
  if (kind === 'mira206') return 'MIRA 206'
  if (kind === 'its') return 'ITS File'
  return kind
}

onMounted(async () => {
  await Promise.all([loadPeriod(), loadReturn()])
})

onBeforeUnmount(() => {
  if (pollTimer !== null) clearTimeout(pollTimer)
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-start gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/gst')">
        <ArrowLeft class="w-4 h-4" />GST
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          GST Period
          <span v-if="period" class="text-surface-500 dark:text-surface-400 font-normal text-lg">
            — {{ periodLabel }}
          </span>
        </h2>
        <div v-if="period" class="flex items-center gap-3 mt-1 flex-wrap">
          <StatusTag :status="period.status" />
          <span class="text-sm text-surface-400">
            <DateCell :date="period.periodStart" /> – <DateCell :date="period.periodEnd" />
          </span>
          <span
            v-if="period.miraReturnRef"
            class="text-xs font-mono text-surface-500 bg-surface-100 dark:bg-surface-800 rounded px-2 py-0.5"
          >
            Ref: {{ period.miraReturnRef }}
          </span>
        </div>
      </div>

      <!-- Actions -->
      <div v-if="period" class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="period.status === 'built'"
          severity="secondary"
          @click="lockDialogVisible = true"
        >
          <Lock class="w-4 h-4" />Lock Period
        </Button>
        <Button
          v-if="period.status === 'locked'"
          severity="secondary"
          @click="unlockDialogVisible = true"
        >
          <Unlock class="w-4 h-4" />Unlock
        </Button>
        <Button v-if="period.status !== 'locked'" :loading="building" @click="buildReturn">
          <RefreshCw class="w-4 h-4" />Build Return
        </Button>
      </div>
    </div>

    <!-- Building progress -->
    <div v-if="building" class="card p-6 flex items-center gap-3 text-surface-500 text-sm">
      <RefreshCw class="w-4 h-4 animate-spin" />
      Building GST return… this may take a moment.
    </div>

    <!-- Loading -->
    <div
      v-else-if="returnLoading || periodLoading"
      class="card p-6 text-center text-surface-400 text-sm"
    >
      Loading…
    </div>

    <!-- Return data -->
    <template v-else-if="returnData">
      <!-- Not yet built -->
      <div
        v-if="returnData.status === 'not_built'"
        class="card p-8 text-center text-surface-400 text-sm"
      >
        No return has been built for this period yet. Click
        <strong class="text-surface-600 dark:text-surface-300">Build Return</strong> to generate the
        MIRA files.
      </div>

      <!-- Built -->
      <template v-else>
        <p v-if="returnData.builtAt" class="text-xs text-surface-400">
          Built on <DateCell :date="returnData.builtAt" />
        </p>

        <!-- MIRA 205 card -->
        <div v-if="returnData.summary?.mira205" class="card p-6">
          <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            MIRA 205 — GST Return
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">
                Taxable Supplies
              </p>
              <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
                <MoneyCell :amount="returnData.summary.mira205.taxableSupplies" />
              </p>
            </div>
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Output Tax</p>
              <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
                <MoneyCell :amount="returnData.summary.mira205.outputTax" />
              </p>
            </div>
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Input Tax</p>
              <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
                <MoneyCell :amount="returnData.summary.mira205.inputTax" />
              </p>
            </div>
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Net Payable</p>
              <p
                class="text-base font-semibold tabular-nums"
                :class="
                  parseFloat(returnData.summary.mira205.netPayable) > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-600 dark:text-green-400'
                "
              >
                <MoneyCell :amount="returnData.summary.mira205.netPayable" />
              </p>
            </div>
          </div>
        </div>

        <!-- MIRA 206 card -->
        <div v-if="returnData.summary?.mira206" class="card p-6">
          <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            MIRA 206 — Tourism Tax Return
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">
                Taxable Supplies
              </p>
              <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
                <MoneyCell :amount="returnData.summary.mira206.taxableSupplies" />
              </p>
            </div>
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Output Tax</p>
              <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
                <MoneyCell :amount="returnData.summary.mira206.outputTax" />
              </p>
            </div>
            <div>
              <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Net Payable</p>
              <p
                class="text-base font-semibold tabular-nums"
                :class="
                  parseFloat(returnData.summary.mira206.netPayable) > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-600 dark:text-green-400'
                "
              >
                <MoneyCell :amount="returnData.summary.mira206.netPayable" />
              </p>
            </div>
          </div>
        </div>

        <!-- Download buttons -->
        <div v-if="returnData.files.length > 0" class="card p-6">
          <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
            Download Files
          </h3>
          <div class="flex flex-wrap gap-3">
            <Button
              v-for="file in returnData.files"
              :key="file.kind"
              severity="secondary"
              as="a"
              :href="file.url"
              target="_blank"
              rel="noopener"
            >
              <Download class="w-4 h-4" />{{ fileLabel(file.kind) }}
            </Button>
          </div>
        </div>
      </template>
    </template>

    <!-- Lock Dialog -->
    <Dialog
      v-model:visible="lockDialogVisible"
      header="Lock GST Period"
      modal
      :style="{ width: '420px' }"
    >
      <div class="space-y-4">
        <p class="text-sm text-surface-600 dark:text-surface-400">
          Enter the MIRAconnect reference number from the submitted return. This action cannot be
          reversed without admin access.
        </p>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
            >MIRAconnect Reference</label
          >
          <InputText
            v-model="miraReturnRef"
            placeholder="e.g. GST-2025-01-XXXX"
            :class="{ 'p-invalid': lockError }"
          />
          <span v-if="lockError" class="text-xs text-red-500">{{ lockError }}</span>
        </div>
      </div>
      <template #footer>
        <Button severity="secondary" text @click="lockDialogVisible = false">Cancel</Button>
        <Button :loading="lockLoading" severity="danger" @click="lockPeriod">Lock Period</Button>
      </template>
    </Dialog>

    <!-- Unlock Dialog -->
    <Dialog
      v-model:visible="unlockDialogVisible"
      header="Unlock GST Period"
      modal
      :style="{ width: '420px' }"
    >
      <div class="space-y-4">
        <p class="text-sm text-surface-600 dark:text-surface-400">
          Admin action. Provide a reason — it will be written to the audit log.
        </p>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Reason</label>
          <Textarea v-model="unlockReason" rows="3" :class="{ 'p-invalid': unlockError }" />
          <span v-if="unlockError" class="text-xs text-red-500">{{ unlockError }}</span>
        </div>
      </div>
      <template #footer>
        <Button severity="secondary" text @click="unlockDialogVisible = false">Cancel</Button>
        <Button :loading="unlockLoading" severity="danger" @click="unlockPeriod">
          Unlock Period
        </Button>
      </template>
    </Dialog>
  </div>
</template>
