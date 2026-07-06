<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { apiFetch, ApiError } from '../lib/apiFetch.js'
import MoneyCell from './MoneyCell.vue'
import StatusTag from './StatusTag.vue'

type EstimateLine = {
  id: string
  description: string
  qty: string
  unitPrice: string
  lineTotal: string
}

type EstimateDetail = {
  id: string
  estimateNumber: string | null
  issueDate: string | null
  expiryDate: string | null
  subtotal: string
  gstAmount: string
  total: string
  status: string
  notes: string | null
  lines: EstimateLine[]
}

const route = useRoute()
const toast = useToast()
const estimate = ref<EstimateDetail | null>(null)
const notFound = ref(false)
const downloading = ref(false)
const acting = ref(false)
const declineDialogOpen = ref(false)

const canRespond = computed(() => estimate.value?.status === 'sent')

async function load() {
  try {
    estimate.value = await apiFetch<EstimateDetail>(
      `/portal/estimates/${route.params['id'] as string}`,
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true
    else throw err
  }
}

onMounted(load)

async function downloadPdf() {
  downloading.value = true
  try {
    const { url } = await apiFetch<{ url: string }>(
      `/portal/estimates/${route.params['id'] as string}/pdf`,
    )
    window.open(url, '_blank')
  } finally {
    downloading.value = false
  }
}

async function accept() {
  acting.value = true
  try {
    estimate.value = await apiFetch<EstimateDetail>(
      `/portal/estimates/${route.params['id'] as string}/accept`,
      {
        method: 'POST',
      },
    )
    toast.add({ severity: 'success', summary: 'Estimate accepted', life: 4000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Could not accept this estimate', life: 4000 })
  } finally {
    acting.value = false
  }
}

async function decline() {
  acting.value = true
  try {
    estimate.value = await apiFetch<EstimateDetail>(
      `/portal/estimates/${route.params['id'] as string}/decline`,
      {
        method: 'POST',
      },
    )
    declineDialogOpen.value = false
    toast.add({ severity: 'info', summary: 'Estimate declined', life: 4000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Could not decline this estimate', life: 4000 })
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div v-if="notFound" class="card">Estimate not found.</div>
  <div v-else-if="estimate" class="flex flex-col gap-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold">Estimate {{ estimate.estimateNumber ?? '' }}</h1>
        <p class="text-surface-500 text-sm">
          Issued {{ estimate.issueDate ?? '—' }} · Valid until {{ estimate.expiryDate ?? '—' }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <StatusTag :status="estimate.status" />
        <Button
          label="Download PDF"
          icon="pi pi-download"
          :loading="downloading"
          @click="downloadPdf"
        />
      </div>
    </div>

    <div class="card">
      <DataTable :value="estimate.lines" data-key="id">
        <Column field="description" header="Description" />
        <Column field="qty" header="Qty" />
        <Column header="Unit price">
          <template #body="{ data }"><MoneyCell :amount="data.unitPrice" /></template>
        </Column>
        <Column header="Line total">
          <template #body="{ data }"><MoneyCell :amount="data.lineTotal" /></template>
        </Column>
      </DataTable>

      <div class="flex flex-col items-end gap-1 mt-4 text-sm">
        <div class="flex gap-8">
          <span class="text-surface-500">Subtotal</span><MoneyCell :amount="estimate.subtotal" />
        </div>
        <div class="flex gap-8">
          <span class="text-surface-500">GST</span><MoneyCell :amount="estimate.gstAmount" />
        </div>
        <div class="flex gap-8 font-semibold">
          <span>Total</span><MoneyCell :amount="estimate.total" />
        </div>
      </div>
    </div>

    <p v-if="estimate.notes" class="text-sm text-surface-500">{{ estimate.notes }}</p>

    <div v-if="canRespond" class="flex gap-3">
      <Button label="Accept estimate" icon="pi pi-check" :loading="acting" @click="accept" />
      <Button
        label="Decline"
        icon="pi pi-times"
        severity="danger"
        outlined
        :disabled="acting"
        @click="declineDialogOpen = true"
      />
    </div>

    <Dialog
      v-model:visible="declineDialogOpen"
      header="Decline this estimate?"
      modal
      :style="{ width: '28rem' }"
    >
      <p class="text-surface-600 dark:text-surface-300">
        This tells us you don't want to proceed with this estimate. You can still contact us
        afterwards if you change your mind.
      </p>
      <template #footer>
        <Button label="Cancel" text @click="declineDialogOpen = false" />
        <Button label="Decline estimate" severity="danger" :loading="acting" @click="decline" />
      </template>
    </Dialog>
  </div>
</template>
