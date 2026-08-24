<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import { useConfirm } from 'primevue/useconfirm'
import { ArrowLeft, Download, CheckCircle } from '@lucide/vue'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import CustomFieldsPanel from '../../../shared/ui/CustomFieldsPanel.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface CreditNoteLine {
  id: string
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
  gstAmount: string
  lineTotal: string
}

interface CreditNote {
  id: string
  creditNoteNumber: string | null
  invoiceId: string | null
  customerId: string
  status: string
  issueDate: string | null
  subtotal: string
  gstAmount: string
  total: string
  reason: string | null
  createdAt: string
  lines: CreditNoteLine[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const cnId = computed(() => route.params.id as string)
const cn = ref<CreditNote | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    cn.value = await apiFetch<CreditNote>(`/credit-notes/${cnId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/credit-notes')
      return
    }
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

const issuing = ref(false)

function issue() {
  confirm.require({
    message: 'Issue this credit note? It will be locked and a number will be allocated.',
    header: 'Issue Credit Note',
    acceptLabel: 'Issue',
    rejectLabel: 'Cancel',
    accept: async () => {
      issuing.value = true
      try {
        await apiFetch(`/credit-notes/${cnId.value}/issue`, { method: 'POST', body: '{}' })
        toast.add({
          severity: 'success',
          summary: 'Issued',
          detail: 'Credit note has been issued.',
          life: 3000,
        })
        await load()
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 422
            ? 'This credit note cannot be issued (check GST period lock).'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
      } finally {
        issuing.value = false
      }
    },
  })
}

const downloading = ref(false)

async function downloadPdf() {
  downloading.value = true
  try {
    const result = await apiFetch<{ url?: string } | null>(`/credit-notes/${cnId.value}/pdf`)
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
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/credit-notes')">
        <ArrowLeft class="w-4 h-4" />
        Credit Notes
      </Button>

      <div class="flex-1 min-w-0">
        <div v-if="cn" class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50 truncate">
            {{ cn.creditNoteNumber ?? 'Draft Credit Note' }}
          </h2>
          <StatusTag :status="cn.status" />
        </div>
        <div
          v-else-if="loading"
          class="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse"
        />
      </div>

      <div v-if="cn" class="flex items-center gap-2 flex-wrap">
        <Button v-if="cn.status === 'draft'" :loading="issuing" @click="issue">
          <CheckCircle class="w-4 h-4" />
          Issue
        </Button>
        <Button severity="secondary" :loading="downloading" @click="downloadPdf">
          <Download class="w-4 h-4" />
          PDF
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="cn">
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Issue Date</p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="cn.issueDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Against Invoice</p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <RouterLink
                v-if="cn.invoiceId"
                :to="`/invoices/${cn.invoiceId}`"
                class="text-primary-500 hover:underline"
                >View invoice</RouterLink
              >
              <span v-else>—</span>
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Total Credited</p>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-50">
              <MoneyCell :amount="cn.total" />
            </p>
          </div>
        </div>
        <div v-if="cn.reason" class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Reason</p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ cn.reason }}
          </p>
        </div>
      </div>

      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
        </div>
        <DataTable :value="cn.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right tabular-nums" />
          <Column field="unitPrice" header="Unit Price" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as CreditNoteLine).unitPrice"
            /></template>
          </Column>
          <Column field="gstCategory" header="GST" />
          <Column field="gstAmount" header="GST Amt" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as CreditNoteLine).gstAmount"
            /></template>
          </Column>
          <Column field="lineTotal" header="Total" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as CreditNoteLine).lineTotal"
            /></template>
          </Column>
        </DataTable>

        <div class="flex justify-end px-6 py-4 border-t border-surface-100 dark:border-surface-800">
          <div class="w-64 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Subtotal</span>
              <MoneyCell :amount="cn.subtotal" />
            </div>
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">GST</span>
              <MoneyCell :amount="cn.gstAmount" />
            </div>
            <div
              class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
            >
              <span class="text-surface-900 dark:text-surface-50">Total credited</span>
              <MoneyCell :amount="cn.total" />
            </div>
          </div>
        </div>
      </div>

      <CustomFieldsPanel doc-type="credit_note" :doc-id="cnId" />
    </template>
  </div>
</template>
