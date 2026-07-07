<script setup lang="ts">
import { ref, onMounted } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { BusinessSettingsPatch } from '@koosani/shared'

interface BusinessSettings {
  name: string
  tin: string | null
  address: string | null
  phone: string | null
  email: string | null
  allowBackorders: boolean
  gstPeriodType: 'monthly' | 'quarterly'
  defaultCreditTermsDays: number
  defaultInvoiceNotes: string | null
  invoiceNumberPrefix: string
  creditNoteNumberPrefix: string
  billNumberPrefix: string
  poNumberPrefix: string
  estimateNumberPrefix: string
  defaultEstimateValidityDays: number
  deliveryNoteNumberPrefix: string
  logoUrl: string | null
}

const GST_PERIOD_OPTIONS = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
]

const toast = useToast()
const loading = ref(true)
const saving = ref(false)
const uploadingLogo = ref(false)
const logoUrl = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

interface FormState {
  name: string
  tin: string
  address: string
  phone: string
  email: string
  allowBackorders: boolean
  gstPeriodType: 'monthly' | 'quarterly'
  defaultCreditTermsDays: number
  defaultInvoiceNotes: string
  invoiceNumberPrefix: string
  creditNoteNumberPrefix: string
  billNumberPrefix: string
  poNumberPrefix: string
  estimateNumberPrefix: string
  defaultEstimateValidityDays: number
  deliveryNoteNumberPrefix: string
}

const form = ref<FormState>({
  name: '',
  tin: '',
  address: '',
  phone: '',
  email: '',
  allowBackorders: false,
  gstPeriodType: 'monthly',
  defaultCreditTermsDays: 30,
  defaultInvoiceNotes: '',
  invoiceNumberPrefix: '',
  creditNoteNumberPrefix: '',
  billNumberPrefix: '',
  poNumberPrefix: '',
  estimateNumberPrefix: '',
  defaultEstimateValidityDays: 30,
  deliveryNoteNumberPrefix: '',
})
const errors = ref<Partial<Record<keyof FormState, string>>>({})

async function load() {
  loading.value = true
  try {
    const s = await apiFetch<BusinessSettings>('/settings')
    form.value = {
      name: s.name,
      tin: s.tin ?? '',
      address: s.address ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      allowBackorders: s.allowBackorders,
      gstPeriodType: s.gstPeriodType,
      defaultCreditTermsDays: s.defaultCreditTermsDays,
      defaultInvoiceNotes: s.defaultInvoiceNotes ?? '',
      invoiceNumberPrefix: s.invoiceNumberPrefix,
      creditNoteNumberPrefix: s.creditNoteNumberPrefix,
      billNumberPrefix: s.billNumberPrefix,
      poNumberPrefix: s.poNumberPrefix,
      estimateNumberPrefix: s.estimateNumberPrefix,
      defaultEstimateValidityDays: s.defaultEstimateValidityDays,
      deliveryNoteNumberPrefix: s.deliveryNoteNumberPrefix,
    }
    logoUrl.value = s.logoUrl
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load settings.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

async function onSave() {
  errors.value = {}
  const payload = {
    name: form.value.name,
    tin: form.value.tin || null,
    address: form.value.address || null,
    phone: form.value.phone || null,
    email: form.value.email || null,
    allowBackorders: form.value.allowBackorders,
    gstPeriodType: form.value.gstPeriodType,
    defaultCreditTermsDays: form.value.defaultCreditTermsDays,
    defaultInvoiceNotes: form.value.defaultInvoiceNotes || null,
    invoiceNumberPrefix: form.value.invoiceNumberPrefix,
    creditNoteNumberPrefix: form.value.creditNoteNumberPrefix,
    billNumberPrefix: form.value.billNumberPrefix,
    poNumberPrefix: form.value.poNumberPrefix,
    estimateNumberPrefix: form.value.estimateNumberPrefix,
    defaultEstimateValidityDays: form.value.defaultEstimateValidityDays,
    deliveryNoteNumberPrefix: form.value.deliveryNoteNumberPrefix,
  }

  const result = BusinessSettingsPatch.safeParse(payload)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormState
      if (!errors.value[field]) errors.value[field] = issue.message
    }
    return
  }

  saving.value = true
  try {
    await apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(result.data) })
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Settings updated.', life: 3000 })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail:
        err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.',
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}

function pickLogo() {
  fileInput.value?.click()
}

async function onLogoSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  uploadingLogo.value = true
  const formData = new FormData()
  formData.append('file', file)
  try {
    const s = await apiFetch<BusinessSettings>('/settings/logo', {
      method: 'POST',
      body: formData,
    })
    logoUrl.value = s.logoUrl
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Logo updated.', life: 3000 })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: err instanceof ApiError ? err.message : 'Failed to upload logo.',
      life: 5000,
    })
  } finally {
    uploadingLogo.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900">Business Settings</h2>
        <p class="text-surface-500 mt-0.5">Profile, branding, and document defaults.</p>
      </div>
      <div class="flex flex-col items-end gap-1 mt-1">
        <RouterLink to="/settings/exchange-rates" class="text-sm text-primary-500 hover:underline">
          Exchange rates →
        </RouterLink>
        <RouterLink to="/settings/custom-fields" class="text-sm text-primary-500 hover:underline">
          Custom fields →
        </RouterLink>
      </div>
    </div>

    <div v-if="!loading" class="card space-y-6">
      <!-- Logo -->
      <div class="flex items-center gap-4">
        <div
          class="w-16 h-16 rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center overflow-hidden shrink-0"
        >
          <img
            v-if="logoUrl"
            :src="logoUrl"
            alt="Business logo"
            class="w-full h-full object-contain"
          />
          <span v-else class="text-xs text-surface-400">No logo</span>
        </div>
        <div>
          <Button
            label="Upload logo"
            severity="secondary"
            size="small"
            :loading="uploadingLogo"
            @click="pickLogo"
          />
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="onLogoSelected"
          />
          <p class="text-xs text-surface-500 mt-1">PNG, JPEG, or WebP. Shown on invoice PDFs.</p>
        </div>
      </div>

      <!-- Profile -->
      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Business name *</label>
        <InputText v-model="form.name" :invalid="!!errors.name" fluid />
        <small v-if="errors.name" class="text-red-500">{{ errors.name }}</small>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">TIN</label>
          <InputText v-model="form.tin" :invalid="!!errors.tin" fluid />
          <small v-if="errors.tin" class="text-red-500">{{ errors.tin }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Phone</label>
          <InputText v-model="form.phone" :invalid="!!errors.phone" fluid />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Email</label>
          <InputText v-model="form.email" type="email" :invalid="!!errors.email" fluid />
          <small v-if="errors.email" class="text-red-500">{{ errors.email }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">GST period type</label>
          <Select
            v-model="form.gstPeriodType"
            :options="GST_PERIOD_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Address</label>
        <Textarea v-model="form.address" rows="2" :invalid="!!errors.address" fluid />
      </div>

      <!-- Defaults -->
      <div class="border-t border-surface-100 dark:border-surface-800 pt-4 space-y-4">
        <h3 class="font-semibold text-sm text-surface-700">Defaults</h3>

        <div class="flex items-center gap-2">
          <Checkbox v-model="form.allowBackorders" binary input-id="allow-backorders" />
          <label for="allow-backorders" class="text-sm text-surface-700"
            >Allow selling below zero stock (backorders)</label
          >
        </div>

        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default customer credit terms (days)</label>
          <InputNumber
            v-model="form.defaultCreditTermsDays"
            :min="0"
            :max="365"
            show-buttons
            class="w-40"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default invoice notes / terms</label>
          <Textarea
            v-model="form.defaultInvoiceNotes"
            rows="3"
            placeholder="e.g. payment terms, bank details — prefilled on new invoices"
            fluid
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default estimate validity (days)</label>
          <InputNumber
            v-model="form.defaultEstimateValidityDays"
            :min="0"
            :max="365"
            show-buttons
            class="w-40"
          />
        </div>
      </div>

      <!-- Numbering -->
      <div class="border-t border-surface-100 dark:border-surface-800 pt-4 space-y-4">
        <h3 class="font-semibold text-sm text-surface-700">Document numbering</h3>
        <p class="text-xs text-surface-500">
          Changing a prefix restarts that document type's sequence at 1 for the new prefix —
          existing numbers are unaffected.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Invoice prefix</label>
            <InputText
              v-model="form.invoiceNumberPrefix"
              :invalid="!!errors.invoiceNumberPrefix"
              fluid
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Credit note prefix</label>
            <InputText
              v-model="form.creditNoteNumberPrefix"
              :invalid="!!errors.creditNoteNumberPrefix"
              fluid
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Bill prefix</label>
            <InputText v-model="form.billNumberPrefix" :invalid="!!errors.billNumberPrefix" fluid />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Purchase order prefix</label>
            <InputText v-model="form.poNumberPrefix" :invalid="!!errors.poNumberPrefix" fluid />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Estimate prefix</label>
            <InputText
              v-model="form.estimateNumberPrefix"
              :invalid="!!errors.estimateNumberPrefix"
              fluid
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">Delivery note prefix</label>
            <InputText
              v-model="form.deliveryNoteNumberPrefix"
              :invalid="!!errors.deliveryNoteNumberPrefix"
              fluid
            />
          </div>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <Button label="Save changes" :loading="saving" @click="onSave" />
      </div>
    </div>
  </div>
</template>
