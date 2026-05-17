<script setup lang="ts">
import { ref, watch } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { SupplierCreate } from '@koosani/shared'
import type { Supplier } from './views/SuppliersView.vue'

const props = defineProps<{
  supplier: Supplier | null
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
  paymentTermsDays: string
  notes: string
}

const blank = (): FormState => ({
  name: '',
  tin: '',
  email: '',
  phone: '',
  address: '',
  paymentTermsDays: '',
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
    if (props.supplier) {
      const s = props.supplier
      form.value = {
        name: s.name,
        tin: s.tin ?? '',
        email: s.email ?? '',
        phone: s.phone ?? '',
        address: s.address ?? '',
        paymentTermsDays: s.paymentTermsDays != null ? String(s.paymentTermsDays) : '',
        notes: s.notes ?? '',
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
    paymentTermsDays: form.value.paymentTermsDays ? Number(form.value.paymentTermsDays) : undefined,
    notes: form.value.notes || undefined,
  }

  const Schema = props.supplier ? SupplierCreate.partial() : SupplierCreate
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
    if (props.supplier) {
      await apiFetch(`/suppliers/${props.supplier.id}`, {
        method: 'PATCH',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Supplier updated.', life: 3000 })
    } else {
      await apiFetch('/suppliers', { method: 'POST', body: JSON.stringify(result.data) })
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Supplier created.',
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
  if (!props.supplier) return
  const name = props.supplier.name
  confirm.require({
    message: `Delete "${name}"? This cannot be undone.`,
    header: 'Delete Supplier',
    icon: 'pi pi-trash',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        await apiFetch(`/suppliers/${props.supplier!.id}`, { method: 'DELETE' })
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
            ? 'Cannot delete: supplier has an outstanding balance or draft bills.'
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
    :header="supplier ? 'Edit Supplier' : 'New Supplier'"
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

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Payment terms (days)</label>
        <InputText
          v-model="form.paymentTermsDays"
          inputmode="numeric"
          :invalid="!!errors.paymentTermsDays"
          fluid
        />
        <small v-if="errors.paymentTermsDays" class="text-red-500">{{
          errors.paymentTermsDays
        }}</small>
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
          v-if="supplier"
          icon="pi pi-trash"
          severity="danger"
          text
          :loading="deleting"
          aria-label="Delete supplier"
          @click="onDelete"
        />
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button label="Save" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
