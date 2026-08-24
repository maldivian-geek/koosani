<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { ItemCreate, ItemPatch } from '@koosani/shared'
import type { Item, Category } from './views/ItemsView.vue'

const props = defineProps<{
  item: Item | null
  open: boolean
  categories: Category[]
}>()

const emit = defineEmits<{
  close: []
  saved: []
  deleted: []
}>()

const toast = useToast()
const confirm = useConfirm()

const GST_OPTIONS = [
  { label: 'General 8%', value: 'general_8' },
  { label: 'Tourism 16%', value: 'tourism_16' },
  { label: 'Tourism 17%', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

interface FormState {
  sku: string
  name: string
  customerItemName: string
  unit: string
  categoryId: string
  gstCategory: string
  defaultPrice: string
  defaultCost: string
  reorderPoint: string
  notes: string
  gstCategoryChangeReason: string
}

const blank = (): FormState => ({
  sku: '',
  name: '',
  customerItemName: '',
  unit: '',
  categoryId: '',
  gstCategory: 'general_8',
  defaultPrice: '',
  defaultCost: '',
  reorderPoint: '',
  notes: '',
  gstCategoryChangeReason: '',
})

const form = ref<FormState>(blank())
const errors = ref<Partial<Record<keyof FormState, string>>>({})
const saving = ref(false)
const deleting = ref(false)
const originalGstCategory = ref('')

const gstCategoryChanged = computed(
  () => props.item !== null && form.value.gstCategory !== originalGstCategory.value,
)

const categoryOptions = computed(() => [
  { label: '— None —', value: '' },
  ...props.categories.map((c) => ({ label: c.name, value: c.id })),
])

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    errors.value = {}
    if (props.item) {
      const it = props.item
      form.value = {
        sku: it.sku,
        name: it.name,
        customerItemName: it.customerItemName ?? '',
        unit: it.unit,
        categoryId: it.categoryId ?? '',
        gstCategory: it.gstCategory,
        defaultPrice: it.defaultPrice ?? '',
        defaultCost: it.defaultCost ?? '',
        reorderPoint: it.reorderPoint ?? '',
        notes: it.notes ?? '',
        gstCategoryChangeReason: '',
      }
      originalGstCategory.value = it.gstCategory
    } else {
      form.value = blank()
      originalGstCategory.value = ''
    }
  },
)

async function onSave() {
  errors.value = {}

  if (gstCategoryChanged.value && !form.value.gstCategoryChangeReason.trim()) {
    errors.value.gstCategoryChangeReason = 'Reason is required when changing GST category.'
    return
  }

  const payload = {
    sku: form.value.sku,
    name: form.value.name,
    customerItemName: form.value.customerItemName || undefined,
    unit: form.value.unit,
    categoryId: form.value.categoryId || undefined,
    gstCategory: form.value.gstCategory,
    defaultPrice: form.value.defaultPrice || undefined,
    defaultCost: form.value.defaultCost || undefined,
    reorderPoint: form.value.reorderPoint || undefined,
    notes: form.value.notes || undefined,
  }

  const Schema = props.item ? ItemPatch : ItemCreate
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
    if (props.item) {
      const body: Record<string, unknown> = { ...result.data }
      if (gstCategoryChanged.value)
        body.gstCategoryChangeReason = form.value.gstCategoryChangeReason
      await apiFetch(`/items/${props.item.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Item updated.', life: 3000 })
    } else {
      await apiFetch('/items', { method: 'POST', body: JSON.stringify(result.data) })
      toast.add({ severity: 'success', summary: 'Created', detail: 'Item created.', life: 3000 })
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
  if (!props.item) return
  const name = props.item.name
  confirm.require({
    message: `Delete "${name}"? This cannot be undone.`,
    header: 'Delete Item',
    icon: 'pi pi-trash',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        await apiFetch(`/items/${props.item!.id}`, { method: 'DELETE' })
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
            ? 'Cannot delete: item is referenced by existing transactions.'
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
    :style="{ width: '460px' }"
    :header="item ? 'Edit Item' : 'New Item'"
    @update:visible="
      (v) => {
        if (!v) $emit('close')
      }
    "
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">SKU *</label>
          <InputText v-model="form.sku" :invalid="!!errors.sku" fluid />
          <small v-if="errors.sku" class="text-red-500">{{ errors.sku }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Unit *</label>
          <InputText
            v-model="form.unit"
            placeholder="pcs, kg, litre…"
            :invalid="!!errors.unit"
            fluid
          />
          <small v-if="errors.unit" class="text-red-500">{{ errors.unit }}</small>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Name *</label>
        <InputText v-model="form.name" :invalid="!!errors.name" fluid />
        <small v-if="errors.name" class="text-red-500">{{ errors.name }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Customer Item Name</label>
        <InputText
          v-model="form.customerItemName"
          placeholder="How this customer refers to it"
          :invalid="!!errors.customerItemName"
          fluid
        />
        <small v-if="errors.customerItemName" class="text-red-500">{{
          errors.customerItemName
        }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Category</label>
        <Select
          v-model="form.categoryId"
          :options="categoryOptions"
          option-label="label"
          option-value="value"
          :invalid="!!errors.categoryId"
          fluid
        />
        <small v-if="errors.categoryId" class="text-red-500">{{ errors.categoryId }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">GST Category *</label>
        <Select
          v-model="form.gstCategory"
          :options="GST_OPTIONS"
          option-label="label"
          option-value="value"
          :invalid="!!errors.gstCategory"
          fluid
        />
        <small v-if="errors.gstCategory" class="text-red-500">{{ errors.gstCategory }}</small>
      </div>

      <div v-if="gstCategoryChanged" class="flex flex-col gap-1">
        <label class="font-medium text-sm">Reason for GST category change *</label>
        <InputText
          v-model="form.gstCategoryChangeReason"
          :invalid="!!errors.gstCategoryChangeReason"
          fluid
        />
        <small v-if="errors.gstCategoryChangeReason" class="text-red-500">{{
          errors.gstCategoryChangeReason
        }}</small>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default price (MVR)</label>
          <InputText
            v-model="form.defaultPrice"
            inputmode="decimal"
            :invalid="!!errors.defaultPrice"
            fluid
          />
          <small v-if="errors.defaultPrice" class="text-red-500">{{ errors.defaultPrice }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Default cost (MVR)</label>
          <InputText
            v-model="form.defaultCost"
            inputmode="decimal"
            :invalid="!!errors.defaultCost"
            fluid
          />
          <small v-if="errors.defaultCost" class="text-red-500">{{ errors.defaultCost }}</small>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Reorder point</label>
        <InputText
          v-model="form.reorderPoint"
          inputmode="decimal"
          :invalid="!!errors.reorderPoint"
          fluid
        />
        <small v-if="errors.reorderPoint" class="text-red-500">{{ errors.reorderPoint }}</small>
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
          v-if="item"
          icon="pi pi-trash"
          severity="danger"
          text
          :loading="deleting"
          aria-label="Delete item"
          @click="onDelete"
        />
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button label="Save" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
