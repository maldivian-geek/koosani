<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import AutoComplete from 'primevue/autocomplete'
import { ArrowLeft, Upload, RefreshCw, ExternalLink } from '@lucide/vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface SupplierOption {
  id: string
  name: string
  tin: string | null
}

interface SoaMatch {
  line: {
    date: string
    ref: string
    description?: string
    amount: string
  }
  billId?: string
  billNumber?: string
}

interface JobResult {
  status: 'processing' | 'done' | 'failed'
  matches?: SoaMatch[]
  error?: string
}

const router = useRouter()
const toast = useToast()

const supplier = ref<SupplierOption | null>(null)
const supplierSuggestions = ref<SupplierOption[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)

const uploading = ref(false)
const jobId = ref<string | null>(null)
const jobResult = ref<JobResult | null>(null)
const polling = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null

async function searchSuppliers(event: { query: string }) {
  try {
    const data = await apiFetch<SupplierOption[] | { items: SupplierOption[] }>(
      `/suppliers?q=${encodeURIComponent(event.query)}&active=true&pageSize=20`,
    )
    supplierSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    supplierSuggestions.value = []
  }
}

function onFileChange(e: Event) {
  selectedFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function upload() {
  if (!supplier.value) {
    toast.add({
      severity: 'warn',
      summary: 'Supplier required',
      detail: 'Please select a supplier first.',
      life: 3000,
    })
    return
  }
  if (!selectedFile.value) {
    toast.add({
      severity: 'warn',
      summary: 'File required',
      detail: 'Please select a CSV or PDF file.',
      life: 3000,
    })
    return
  }

  uploading.value = true
  jobId.value = null
  jobResult.value = null

  try {
    const form = new FormData()
    form.append('file', selectedFile.value)
    form.append('supplierId', supplier.value.id)
    const result = await apiFetch<{ jobId: string }>('/soa-extract', { method: 'POST', body: form })
    jobId.value = result.jobId
    toast.add({
      severity: 'info',
      summary: 'Processing',
      detail: 'File uploaded. Extracting transactions…',
      life: 3000,
    })
    schedulePoll()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Invalid file format. Please upload a CSV or PDF.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Upload failed. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    uploading.value = false
  }
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(() => void pollJob(), 2000)
}

async function pollJob() {
  if (!jobId.value) return
  polling.value = true
  try {
    const result = await apiFetch<JobResult>(`/soa-extract/${jobId.value}`)
    jobResult.value = result
    if (result.status === 'processing') {
      schedulePoll()
    } else {
      polling.value = false
      if (result.status === 'done') {
        toast.add({
          severity: 'success',
          summary: 'Done',
          detail: `Extracted ${result.matches?.length ?? 0} transactions.`,
          life: 4000,
        })
      } else {
        toast.add({
          severity: 'error',
          summary: 'Extraction failed',
          detail: result.error ?? 'Could not parse the file.',
          life: 6000,
        })
      }
    }
  } catch {
    polling.value = false
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not check extraction status.',
      life: 5000,
    })
  }
}

function reset() {
  if (pollTimer) clearTimeout(pollTimer)
  jobId.value = null
  jobResult.value = null
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <Button severity="secondary" text @click="() => void router.push('/bills')">
        <ArrowLeft class="w-4 h-4" />Bills
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">SOA Extraction</h2>
        <p class="text-surface-500 dark:text-surface-400 mt-0.5">
          Upload a supplier statement (CSV or PDF) to match against existing bills.
        </p>
      </div>
    </div>

    <!-- Upload form -->
    <div class="card p-6 space-y-5">
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Supplier <span class="text-red-500">*</span></label
        >
        <AutoComplete
          v-model="supplier"
          :suggestions="supplierSuggestions"
          option-label="name"
          placeholder="Search suppliers…"
          @complete="searchSuppliers"
        >
          <template #option="{ option }">
            <div class="flex flex-col">
              <span class="text-sm">{{ option.name }}</span>
              <span v-if="option.tin" class="text-xs text-surface-400">TIN: {{ option.tin }}</span>
            </div>
          </template>
        </AutoComplete>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Statement File <span class="text-red-500">*</span></label
        >
        <div class="flex items-center gap-3">
          <input
            ref="fileInput"
            type="file"
            accept=".csv,.pdf"
            class="hidden"
            @change="onFileChange"
          />
          <Button severity="secondary" outlined @click="() => fileInput?.click()">
            <Upload class="w-4 h-4" />Choose file
          </Button>
          <span class="text-sm text-surface-500">
            {{ selectedFile ? selectedFile.name : 'No file selected — CSV or PDF' }}
          </span>
        </div>
      </div>

      <div class="flex gap-3">
        <Button :loading="uploading || polling" @click="upload">
          <Upload class="w-4 h-4" />Upload & Extract
        </Button>
        <Button v-if="jobId" severity="secondary" @click="reset">Reset</Button>
      </div>
    </div>

    <!-- Status indicator while processing -->
    <div
      v-if="jobId && jobResult?.status === 'processing'"
      class="card p-6 flex items-center gap-4"
    >
      <RefreshCw class="w-5 h-5 text-surface-400 animate-spin" />
      <div>
        <p class="text-sm font-medium text-surface-700 dark:text-surface-300">Processing…</p>
        <p class="text-xs text-surface-400 mt-0.5">
          Extracting and matching transactions against your bills.
        </p>
      </div>
    </div>

    <!-- Failed state -->
    <div
      v-else-if="jobResult?.status === 'failed'"
      class="card p-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
    >
      <p class="text-sm font-medium text-red-700 dark:text-red-300">Extraction failed</p>
      <p class="text-xs text-red-500 dark:text-red-400 mt-1">
        {{ jobResult.error ?? 'Could not parse the file. Please check the format and try again.' }}
      </p>
    </div>

    <!-- Results table -->
    <div
      v-else-if="jobResult?.status === 'done' && jobResult.matches"
      class="card overflow-hidden p-0!"
    >
      <div
        class="px-6 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
      >
        <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
          Extraction Results
          <span class="text-surface-400 font-normal ml-2"
            >{{ jobResult.matches.length }} transactions</span
          >
        </h3>
        <span class="text-xs text-surface-400">
          {{ jobResult.matches.filter((m) => m.billId).length }} matched ·
          {{ jobResult.matches.filter((m) => !m.billId).length }} unmatched
        </span>
      </div>

      <div v-if="jobResult.matches.length === 0" class="text-center py-12 text-sm text-surface-400">
        No transactions were extracted from the file.
      </div>

      <DataTable v-else :value="jobResult.matches" :pt="{ root: { class: 'text-sm!' } }">
        <Column field="line.date" header="Date" style="width: 120px">
          <template #body="{ data }">
            <DateCell :date="(data as SoaMatch).line.date" />
          </template>
        </Column>
        <Column field="line.ref" header="Reference" style="width: 160px">
          <template #body="{ data }">
            <span class="font-mono text-xs">{{ (data as SoaMatch).line.ref }}</span>
          </template>
        </Column>
        <Column field="line.description" header="Description">
          <template #body="{ data }">
            {{ (data as SoaMatch).line.description ?? '—' }}
          </template>
        </Column>
        <Column field="line.amount" header="Amount" class="text-right" style="width: 120px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as SoaMatch).line.amount" />
          </template>
        </Column>
        <Column header="Matched Bill" style="width: 180px">
          <template #body="{ data }">
            <div v-if="(data as SoaMatch).billId" class="flex items-center gap-1">
              <span class="font-mono text-xs text-surface-700 dark:text-surface-300">{{
                (data as SoaMatch).billNumber
              }}</span>
              <button
                class="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
                @click="() => void router.push(`/bills/${(data as SoaMatch).billId}`)"
              >
                <ExternalLink class="w-3.5 h-3.5" />
              </button>
            </div>
            <span
              v-else
              class="text-xs text-surface-400 bg-surface-100 dark:bg-surface-800 rounded px-2 py-0.5"
              >No match</span
            >
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
