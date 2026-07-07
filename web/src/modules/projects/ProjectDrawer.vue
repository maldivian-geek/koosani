<script setup lang="ts">
import { ref, watch } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import AutoComplete from 'primevue/autocomplete'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { ProjectCreate } from '@koosani/shared'
import type { Project } from './views/ProjectsView.vue'

interface CustomerOption {
  id: string
  name: string
}

const props = defineProps<{
  project: Project | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const toast = useToast()

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Archived', value: 'archived' },
]

const GST_CATEGORY_OPTIONS = [
  { label: 'General (8%)', value: 'general_8' },
  { label: 'Tourism (16%)', value: 'tourism_16' },
  { label: 'Tourism (17%)', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

interface FormState {
  name: string
  description: string
  status: string
  defaultBillableRate: string
  defaultGstCategory: string
}

const blank = (): FormState => ({
  name: '',
  description: '',
  status: 'active',
  defaultBillableRate: '',
  defaultGstCategory: 'general_8',
})

const form = ref<FormState>(blank())
const errors = ref<Partial<Record<keyof FormState, string>>>({})
const saving = ref(false)
const customer = ref<CustomerOption | null>(null)
const customerSuggestions = ref<CustomerOption[]>([])

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    errors.value = {}
    customer.value = null
    if (props.project) {
      const p = props.project
      form.value = {
        name: p.name,
        description: p.description ?? '',
        status: p.status,
        defaultBillableRate: p.defaultBillableRate ?? '',
        defaultGstCategory: p.defaultGstCategory,
      }
    } else {
      form.value = blank()
    }
  },
)

async function searchCustomers(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true', pageSize: '20' })
    const data = await apiFetch<{ items: CustomerOption[] } | CustomerOption[]>(
      `/customers?${params}`,
    )
    customerSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    customerSuggestions.value = []
  }
}

async function onSave() {
  errors.value = {}
  const payload = {
    customerId: customer.value?.id || undefined,
    name: form.value.name,
    description: form.value.description || undefined,
    status: form.value.status as ProjectCreate['status'],
    defaultBillableRate: form.value.defaultBillableRate || undefined,
    defaultGstCategory: form.value.defaultGstCategory as ProjectCreate['defaultGstCategory'],
  }

  const result = ProjectCreate.safeParse(payload)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormState
      if (!errors.value[field]) errors.value[field] = issue.message
    }
    return
  }

  saving.value = true
  try {
    if (props.project) {
      await apiFetch(`/projects/${props.project.id}`, {
        method: 'PATCH',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Project updated.', life: 3000 })
    } else {
      await apiFetch('/projects', { method: 'POST', body: JSON.stringify(result.data) })
      toast.add({ severity: 'success', summary: 'Created', detail: 'Project created.', life: 3000 })
    }
    emit('saved')
  } catch (err) {
    const detail =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail, life: 5000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Drawer
    :visible="open"
    position="right"
    :style="{ width: '420px' }"
    :header="project ? 'Edit Project' : 'New Project'"
    @update:visible="
      (v) => {
        if (!v) $emit('close')
      }
    "
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Name *</label>
        <InputText v-model="form.name" :invalid="!!errors.name" fluid />
        <small v-if="errors.name" class="text-red-500">{{ errors.name }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Customer (optional — for billable projects)</label>
        <AutoComplete
          v-model="customer"
          :suggestions="customerSuggestions"
          option-label="name"
          placeholder="Search customers…"
          fluid
          @complete="searchCustomers"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Description</label>
        <Textarea v-model="form.description" rows="2" fluid />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Status</label>
          <Select
            v-model="form.status"
            :options="STATUS_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default rate (per hour)</label>
          <InputText
            v-model="form.defaultBillableRate"
            inputmode="decimal"
            placeholder="0.00"
            fluid
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Default GST category</label>
        <Select
          v-model="form.defaultGstCategory"
          :options="GST_CATEGORY_OPTIONS"
          option-label="label"
          option-value="value"
          fluid
        />
      </div>
    </form>

    <template #footer>
      <div class="flex items-center gap-2">
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button label="Save" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
