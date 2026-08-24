<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import { ArrowLeft, PlusCircle, MinusCircle } from '@lucide/vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface CreditEntry {
  id: string
  amount: string
  kind: string
  referenceType: string | null
  referenceId: string | null
  notes: string | null
  createdAt: string
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const customerId = route.params.id as string
const balance = ref('0.00')
const ledger = ref<CreditEntry[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await apiFetch<{ balance: string; ledger: CreditEntry[] }>(
      `/customers/${customerId}/credits`,
    )
    balance.value = data.balance
    ledger.value = data.ledger
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/customers')
      return
    }
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

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    overpayment: 'Overpayment',
    advance: 'Advance',
    voided_invoice: 'Voided invoice',
    applied_to_invoice: 'Applied to invoice',
    refunded: 'Refunded',
  }
  return labels[kind] ?? kind
}

// ─── Advance dialog ───────────────────────────────────────────────────────────
const advanceOpen = ref(false)
const advanceAmount = ref('0.00')
const advanceNotes = ref('')
const advanceSaving = ref(false)

function openAdvance() {
  advanceAmount.value = '0.00'
  advanceNotes.value = ''
  advanceOpen.value = true
}

async function submitAdvance() {
  advanceSaving.value = true
  try {
    await apiFetch(`/customers/${customerId}/credits/advance`, {
      method: 'POST',
      body: JSON.stringify({ amount: advanceAmount.value, notes: advanceNotes.value || undefined }),
    })
    advanceOpen.value = false
    toast.add({ severity: 'success', summary: 'Recorded', detail: 'Advance recorded.', life: 3000 })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Please check the amount and try again.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    advanceSaving.value = false
  }
}

// ─── Refund dialog ────────────────────────────────────────────────────────────
const refundOpen = ref(false)
const refundAmount = ref('0.00')
const refundNotes = ref('')
const refundSaving = ref(false)

function openRefund() {
  refundAmount.value = '0.00'
  refundNotes.value = ''
  refundOpen.value = true
}

async function submitRefund() {
  refundSaving.value = true
  try {
    await apiFetch(`/customers/${customerId}/credits/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount: refundAmount.value, notes: refundNotes.value || undefined }),
    })
    refundOpen.value = false
    toast.add({ severity: 'success', summary: 'Refunded', detail: 'Refund recorded.', life: 3000 })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Refund amount exceeds the available credit balance.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    refundSaving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/customers')">
        <ArrowLeft class="w-4 h-4" />
        Customers
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          Customer Credit
        </h2>
      </div>
      <div class="flex gap-2">
        <Button severity="secondary" @click="openAdvance">
          <PlusCircle class="w-4 h-4" />
          Record Advance
        </Button>
        <Button severity="secondary" outlined @click="openRefund">
          <MinusCircle class="w-4 h-4" />
          Refund
        </Button>
      </div>
    </div>

    <div class="card p-6">
      <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
        Available Credit Balance
      </p>
      <p class="text-3xl font-semibold tabular-nums text-surface-900 dark:text-surface-50">
        <MoneyCell :amount="balance" />
      </p>
      <p class="text-xs text-surface-500 mt-2">
        Apply this balance to an invoice from the invoice's detail page, or refund it here.
      </p>
    </div>

    <div class="card overflow-hidden p-0!">
      <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
        <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Ledger</h3>
      </div>

      <div v-if="loading" class="text-center py-12 text-sm text-surface-400">Loading…</div>
      <div v-else-if="ledger.length === 0" class="text-center py-12 text-sm text-surface-400">
        No credit activity yet.
      </div>

      <DataTable v-else :value="ledger" :pt="{ root: { class: 'text-sm!' } }">
        <Column field="createdAt" header="Date" style="width: 140px">
          <template #body="{ data }">
            <DateCell :date="(data as CreditEntry).createdAt" />
          </template>
        </Column>
        <Column field="kind" header="Type">
          <template #body="{ data }">
            <span class="text-xs text-surface-600 dark:text-surface-300">{{
              kindLabel((data as CreditEntry).kind)
            }}</span>
          </template>
        </Column>
        <Column field="notes" header="Notes">
          <template #body="{ data }">
            <span class="text-xs text-surface-500">{{ (data as CreditEntry).notes ?? '—' }}</span>
          </template>
        </Column>
        <Column field="amount" header="Amount" class="text-right" style="width: 130px">
          <template #body="{ data }">
            <span
              class="tabular-nums font-medium"
              :class="
                parseFloat((data as CreditEntry).amount) >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-surface-700 dark:text-surface-300'
              "
            >
              <MoneyCell :amount="(data as CreditEntry).amount" />
            </span>
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="advanceOpen" header="Record Advance" modal :style="{ width: '26rem' }">
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Amount</label>
          <MoneyInput v-model="advanceAmount" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Notes</label>
          <Textarea
            v-model="advanceNotes"
            rows="2"
            placeholder="e.g. retainer for Q3"
            auto-resize
          />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="advanceOpen = false" />
        <Button label="Record" :loading="advanceSaving" @click="submitAdvance" />
      </template>
    </Dialog>

    <Dialog v-model:visible="refundOpen" header="Refund Credit" modal :style="{ width: '26rem' }">
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Amount</label>
          <MoneyInput v-model="refundAmount" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Notes</label>
          <Textarea
            v-model="refundNotes"
            rows="2"
            placeholder="e.g. refunded via bank transfer"
            auto-resize
          />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="refundOpen = false" />
        <Button label="Refund" severity="danger" :loading="refundSaving" @click="submitRefund" />
      </template>
    </Dialog>
  </div>
</template>
