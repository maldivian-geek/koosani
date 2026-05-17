<script setup lang="ts">
import { ref, watch } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { CustomerCreate } from '@koosani/shared'
import type { Customer } from './views/CustomersView.vue'

const props = defineProps<{
  customer: Customer | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: []
  deleted: []
}>()

const toast = useToast()
const confirm = useConfirm()

interface FormState {
  name: string
  tin: string
  email: string
  phone: string
  address: string
  creditTermsDays: string
  creditLimit: string
  notes: string
}

const blank = (): FormState => ({
  name: '',
  tin: '',
  email: '',
  phone: '',
  address: '',
  creditTermsDays: '',
  creditLimit: '',
  notes: '',
})

const form = ref<FormState>(blank())
const errors = ref<Partial<Record<keyof FormState, string>>>({})
const saving = ref(false)
const deleting = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    errors.value = {}
    if (props.customer) {
      const c = props.customer
      form.value = {
        name: c.name,
        tin: c.tin ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        address: c.address ?? '',
        creditTermsDays: c.creditTermsDays != null ? String(c.creditTermsDays) : '',
        creditLimit: c.creditLimit ?? '',
        notes: c.notes ?? '',
      }
    } else {
      form.value = blank()
    }
  },
)

async function onSave() {
  errors.value = {}
  const payload = {
    name: form.value.name,
    tin: form.value.tin || undefined,
    email: form.value.email || undefined,
    phone: form.value.phone || undefined,
    address: form.value.address || undefined,
    creditTermsDays: form.value.creditTermsDays ? Number(form.value.creditTermsDays) : undefined,
    creditLimit: form.value.creditLimit || undefined,
    notes: form.value.notes || undefined,
  }

  const Schema = props.customer ? CustomerCreate.partial() : CustomerCreate
  const result = Schema.safeParse(payload)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormState
      if (!errors.value[field]) errors.value[field] = issue.message
    }
    return
  }

  saving.value = true
  try {
    if (props.customer) {
      await apiFetch(`/customers/${props.customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Customer updated.', life: 3000 })
    } else {
      await apiFetch('/customers', { method: 'POST', body: JSON.stringify(result.data) })
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Customer created.',
        life: 3000,
      })
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

function onDelete() {
  if (!props.customer) return
  const name = props.customer.name
  confirm.require({
    message: `Delete "${name}"? This cannot be undone.`,
    header: 'Delete Customer',
    icon: 'pi pi-trash',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        await apiFetch(`/customers/${props.customer!.id}`, { method: 'DELETE' })
        toast.add({
          severity: 'success',
          summary: 'Deleted',
          detail: `${name} deleted.`,
          life: 3000,
        })
        emit('deleted')
      } catch (err) {
        const detail =
          err instanceof ApiError && err.status === 409
            ? 'Cannot delete: customer has an outstanding balance or draft invoices.'
            : err instanceof ApiError && err.status === 403
              ? "You don't have permission to do that."
              : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail, life: 5000 })
      } finally {
        deleting.value = false
      }
    },
  })
}
</script>

<template>
  <Drawer
    :visible="open"
    position="right"
    :style="{ width: '420px' }"
    :header="customer ? 'Edit Customer' : 'New Customer'"
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
        <label class="font-medium text-sm">TIN</label>
        <InputText v-model="form.tin" :invalid="!!errors.tin" fluid />
        <small v-if="errors.tin" class="text-red-500">{{ errors.tin }}</small>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Email</label>
          <InputText v-model="form.email" type="email" :invalid="!!errors.email" fluid />
          <small v-if="errors.email" class="text-red-500">{{ errors.email }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Phone</label>
          <InputText v-model="form.phone" :invalid="!!errors.phone" fluid />
          <small v-if="errors.phone" class="text-red-500">{{ errors.phone }}</small>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Address</label>
        <Textarea v-model="form.address" rows="2" :invalid="!!errors.address" fluid />
        <small v-if="errors.address" class="text-red-500">{{ errors.address }}</small>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Credit terms (days)</label>
          <InputText
            v-model="form.creditTermsDays"
            inputmode="numeric"
            :invalid="!!errors.creditTermsDays"
            fluid
          />
          <small v-if="errors.creditTermsDays" class="text-red-500">{{
            errors.creditTermsDays
          }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Credit limit (MVR)</label>
          <InputText
            v-model="form.creditLimit"
            inputmode="decimal"
            :invalid="!!errors.creditLimit"
            fluid
          />
          <small v-if="errors.creditLimit" class="text-red-500">{{ errors.creditLimit }}</small>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Notes</label>
        <Textarea v-model="form.notes" rows="3" :invalid="!!errors.notes" fluid />
        <small v-if="errors.notes" class="text-red-500">{{ errors.notes }}</small>
      </div>
    </form>

    <template #footer>
      <div class="flex items-center gap-2">
        <Button
          v-if="customer"
          icon="pi pi-trash"
          severity="danger"
          text
          :loading="deleting"
          aria-label="Delete customer"
          @click="onDelete"
        />
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button label="Save" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
