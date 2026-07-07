<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import { ArrowLeft, Download } from 'lucide-vue-next'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface DeliveryNoteLine {
  id: string
  itemId: string | null
  description: string
  qty: string
}

interface DeliveryNote {
  id: string
  deliveryNoteNumber: string
  invoiceId: string
  customerId: string
  issueDate: string
  notes: string | null
  lines: DeliveryNoteLine[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const dnId = computed(() => route.params.id as string)
const dn = ref<DeliveryNote | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    dn.value = await apiFetch<DeliveryNote>(`/delivery-notes/${dnId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/delivery-notes')
      return
    }
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

const downloading = ref(false)

async function downloadPdf() {
  downloading.value = true
  try {
    const result = await apiFetch<{ url?: string } | null>(`/delivery-notes/${dnId.value}/pdf`)
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
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/delivery-notes')">
        <ArrowLeft class="w-4 h-4" />
        Delivery Notes
      </Button>

      <div class="flex-1 min-w-0">
        <h2 v-if="dn" class="text-2xl font-semibold text-surface-900 dark:text-surface-50 truncate">
          {{ dn.deliveryNoteNumber }}
        </h2>
        <div
          v-else-if="loading"
          class="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse"
        />
      </div>

      <Button v-if="dn" severity="secondary" :loading="downloading" @click="downloadPdf">
        <Download class="w-4 h-4" />
        PDF
      </Button>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="dn">
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Issue Date</p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="dn.issueDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Against Invoice</p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <RouterLink :to="`/invoices/${dn.invoiceId}`" class="text-primary-500 hover:underline"
                >View invoice</RouterLink
              >
            </p>
          </div>
        </div>
        <div v-if="dn.notes" class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Notes</p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ dn.notes }}
          </p>
        </div>
      </div>

      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Items</h3>
        </div>
        <DataTable :value="dn.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right tabular-nums" />
        </DataTable>
      </div>
    </template>
  </div>
</template>
