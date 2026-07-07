<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import { useConfirm } from 'primevue/useconfirm'
import {
  ArrowLeft,
  Download,
  Mail,
  Pencil,
  Send,
  CheckCircle,
  XCircle,
  ArrowRightCircle,
} from 'lucide-vue-next'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import CustomFieldsPanel from '../../../shared/ui/CustomFieldsPanel.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface EstimateLine {
  id: string
  itemId: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
  gstAmount: string
  lineTotal: string
  sortOrder: number
}

interface Estimate {
  id: string
  estimateNumber: string | null
  customerId: string
  customerName: string
  status: string
  issueDate: string | null
  expiryDate: string | null
  notes: string | null
  subtotal: string
  gstAmount: string
  total: string
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  currency: 'MVR' | 'USD' | 'EUR' | 'GBP'
  exchangeRate: string
  subtotalMvr: string
  gstAmountMvr: string
  totalMvr: string
  convertedAt: string | null
  lines: EstimateLine[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const estimateId = computed(() => route.params.id as string)
const estimate = ref<Estimate | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    estimate.value = await apiFetch<Estimate>(`/estimates/${estimateId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/estimates')
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

const sending = ref(false)
async function send() {
  sending.value = true
  try {
    await apiFetch(`/estimates/${estimateId.value}/send`, { method: 'POST', body: '{}' })
    toast.add({
      severity: 'success',
      summary: 'Sent',
      detail: 'Estimate has been sent.',
      life: 3000,
    })
    await load()
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to send estimate.',
      life: 4000,
    })
  } finally {
    sending.value = false
  }
}

const accepting = ref(false)
async function accept() {
  accepting.value = true
  try {
    await apiFetch(`/estimates/${estimateId.value}/accept`, { method: 'POST', body: '{}' })
    toast.add({
      severity: 'success',
      summary: 'Accepted',
      detail: 'Marked as accepted.',
      life: 3000,
    })
    await load()
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to update.', life: 4000 })
  } finally {
    accepting.value = false
  }
}

const declining = ref(false)
function decline() {
  confirm.require({
    message: 'Mark this estimate as declined by the customer?',
    header: 'Decline Estimate',
    acceptLabel: 'Decline',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      declining.value = true
      try {
        await apiFetch(`/estimates/${estimateId.value}/decline`, { method: 'POST', body: '{}' })
        toast.add({
          severity: 'info',
          summary: 'Declined',
          detail: 'Marked as declined.',
          life: 3000,
        })
        await load()
      } catch {
        toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to update.', life: 4000 })
      } finally {
        declining.value = false
      }
    },
  })
}

const converting = ref(false)
function convert() {
  confirm.require({
    message:
      'Convert this estimate into a draft invoice? The invoice will need to be issued separately.',
    header: 'Convert to Invoice',
    acceptLabel: 'Convert',
    rejectLabel: 'Cancel',
    accept: async () => {
      converting.value = true
      try {
        const result = await apiFetch<{ invoiceId: string }>(
          `/estimates/${estimateId.value}/convert`,
          {
            method: 'POST',
            body: '{}',
          },
        )
        toast.add({
          severity: 'success',
          summary: 'Converted',
          detail: 'Draft invoice created.',
          life: 3000,
        })
        void router.push(`/invoices/${result.invoiceId}`)
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 422
            ? 'This estimate cannot be converted.'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 4000 })
      } finally {
        converting.value = false
      }
    },
  })
}

const downloading = ref(false)
async function downloadPdf() {
  downloading.value = true
  try {
    const result = await apiFetch<{ url?: string } | null>(`/estimates/${estimateId.value}/pdf`)
    if (result?.url) {
      window.open(result.url, '_blank')
    } else {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to generate PDF.',
        life: 4000,
      })
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to generate PDF.',
      life: 4000,
    })
  } finally {
    downloading.value = false
  }
}

const emailing = ref(false)
async function sendEmail() {
  emailing.value = true
  try {
    await apiFetch(`/estimates/${estimateId.value}/send`, { method: 'POST', body: '{}' })
    toast.add({
      severity: 'success',
      summary: 'Queued',
      detail: 'The estimate email has been queued for sending.',
      life: 3000,
    })
    await load()
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to send email.', life: 4000 })
  } finally {
    emailing.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/estimates')">
        <ArrowLeft class="w-4 h-4" />
        Estimates
      </Button>
      <div class="flex-1">
        <h2
          class="text-2xl font-semibold text-surface-900 dark:text-surface-50 flex items-center gap-3"
        >
          {{ estimate?.estimateNumber ?? 'Draft Estimate' }}
          <StatusTag v-if="estimate" :status="estimate.status" />
        </h2>
      </div>

      <div class="flex gap-2 flex-wrap">
        <Button
          v-if="estimate?.status === 'draft'"
          severity="secondary"
          @click="() => void router.push(`/estimates/${estimateId}/edit`)"
        >
          <Pencil class="w-4 h-4" />
          Edit
        </Button>

        <Button v-if="estimate?.status === 'draft'" :loading="sending" @click="send">
          <Send class="w-4 h-4" />
          Send
        </Button>

        <Button
          v-if="estimate?.status === 'sent'"
          severity="success"
          :loading="accepting"
          @click="accept"
        >
          <CheckCircle class="w-4 h-4" />
          Mark Accepted
        </Button>

        <Button
          v-if="estimate?.status === 'sent'"
          severity="danger"
          outlined
          :loading="declining"
          @click="decline"
        >
          <XCircle class="w-4 h-4" />
          Mark Declined
        </Button>

        <Button
          v-if="
            (estimate?.status === 'sent' || estimate?.status === 'accepted') &&
            !estimate?.convertedAt
          "
          severity="secondary"
          :loading="converting"
          @click="convert"
        >
          <ArrowRightCircle class="w-4 h-4" />
          Convert to Invoice
        </Button>

        <Button
          v-if="estimate && estimate.status !== 'draft'"
          severity="secondary"
          :loading="downloading"
          @click="downloadPdf"
        >
          <Download class="w-4 h-4" />
          PDF
        </Button>

        <Button
          v-if="estimate && estimate.status !== 'draft'"
          severity="secondary"
          outlined
          :loading="emailing"
          @click="sendEmail"
        >
          <Mail class="w-4 h-4" />
          Email
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="estimate">
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Customer
            </p>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ estimate.customerName }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Issued
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="estimate.issueDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Valid Until
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="estimate.expiryDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Total
            </p>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-50 tabular-nums">
              <MoneyCell :amount="estimate.total" :currency="estimate.currency" />
            </p>
            <p v-if="estimate.currency !== 'MVR'" class="text-xs text-surface-400 tabular-nums">
              <MoneyCell :amount="estimate.totalMvr" currency="MVR" />
            </p>
          </div>
        </div>
        <div
          v-if="estimate.notes"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800"
        >
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Notes
          </p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ estimate.notes }}
          </p>
        </div>
        <div
          v-if="estimate.convertedAt"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800"
        >
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Converted to an invoice on <DateCell :date="estimate.convertedAt" />.
          </p>
        </div>
      </div>

      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
        </div>
        <DataTable :value="estimate.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right" style="width: 100px" />
          <Column field="unitPrice" header="Unit Price" class="text-right" style="width: 120px">
            <template #body="{ data }">
              <MoneyCell :amount="(data as EstimateLine).unitPrice" />
            </template>
          </Column>
          <Column field="gstAmount" header="GST" class="text-right" style="width: 110px">
            <template #body="{ data }">
              <MoneyCell :amount="(data as EstimateLine).gstAmount" />
            </template>
          </Column>
          <Column field="lineTotal" header="Total" class="text-right" style="width: 120px">
            <template #body="{ data }">
              <MoneyCell :amount="(data as EstimateLine).lineTotal" />
            </template>
          </Column>
        </DataTable>
        <div class="px-6 py-4 border-t border-surface-100 dark:border-surface-800 flex justify-end">
          <div class="w-56 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Subtotal</span>
              <MoneyCell :amount="estimate.subtotal" :currency="estimate.currency" />
            </div>
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Estimated GST</span>
              <MoneyCell :amount="estimate.gstAmount" :currency="estimate.currency" />
            </div>
            <div
              class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
            >
              <span class="text-surface-900 dark:text-surface-50">Total</span>
              <MoneyCell :amount="estimate.total" :currency="estimate.currency" />
            </div>
            <div
              v-if="estimate.currency !== 'MVR'"
              class="flex justify-between text-xs text-surface-400"
            >
              <span>Total (MVR @ {{ estimate.exchangeRate }})</span>
              <MoneyCell :amount="estimate.totalMvr" currency="MVR" />
            </div>
          </div>
        </div>
      </div>

      <CustomFieldsPanel doc-type="estimate" :doc-id="estimateId" />
    </template>
  </div>
</template>
