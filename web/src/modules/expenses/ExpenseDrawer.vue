<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import AutoComplete from 'primevue/autocomplete'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { ExpenseCreate, money, gstFor, GST_RATES } from '@koosani/shared'
import type { Expense } from './views/ExpensesView.vue'

interface PartyOption {
  id: string
  name: string
}

const props = defineProps<{
  expense: Expense | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: []
  deleted: []
}>()

const toast = useToast()
const confirm = useConfirm()

const GST_CATEGORY_OPTIONS = [
  { label: 'General (8%)', value: 'general_8' },
  { label: 'Tourism (16%)', value: 'tourism_16' },
  { label: 'Tourism (17%)', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

interface FormState {
  category: string
  description: string
  expenseDate: Date
  amount: string
  gstCategory: string
  paymentMethod: string
  billable: boolean
}

const blank = (): FormState => ({
  category: '',
  description: '',
  expenseDate: new Date(),
  amount: '0.00',
  gstCategory: 'general_8',
  paymentMethod: '',
  billable: false,
})

const form = ref<FormState>(blank())
const errors = ref<Partial<Record<keyof FormState, string>>>({})
const saving = ref(false)
const deleting = ref(false)

const supplier = ref<PartyOption | null>(null)
const supplierSuggestions = ref<PartyOption[]>([])
const customer = ref<PartyOption | null>(null)
const customerSuggestions = ref<PartyOption[]>([])

const isInvoiced = computed(() => !!props.expense?.invoicedAt)

const gstPreview = computed(() => {
  try {
    const rate = GST_RATES[form.value.gstCategory] ?? '0'
    return gstFor(form.value.amount || '0', rate)
  } catch {
    return { gst: '0.00', gross: '0.00' }
  }
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    errors.value = {}
    supplier.value = null
    customer.value = null
    if (props.expense) {
      const e = props.expense
      form.value = {
        category: e.category,
        description: e.description ?? '',
        expenseDate: new Date(e.expenseDate),
        amount: e.amount,
        gstCategory: e.gstCategory,
        paymentMethod: e.paymentMethod ?? '',
        billable: e.billable,
      }
    } else {
      form.value = blank()
    }
  },
)

async function searchSuppliers(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true', pageSize: '20' })
    const data = await apiFetch<{ items: PartyOption[] } | PartyOption[]>(`/suppliers?${params}`)
    supplierSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    supplierSuggestions.value = []
  }
}

async function searchCustomers(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true', pageSize: '20' })
    const data = await apiFetch<{ items: PartyOption[] } | PartyOption[]>(`/customers?${params}`)
    customerSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    customerSuggestions.value = []
  }
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function onSave() {
  errors.value = {}

  if (form.value.billable && !customer.value) {
    toast.add({
      severity: 'error',
      summary: 'Customer required',
      detail: 'A billable expense must have a customer.',
      life: 4000,
    })
    return
  }

  const payload = {
    category: form.value.category,
    description: form.value.description || undefined,
    supplierId: supplier.value?.id || undefined,
    expenseDate: isoDate(form.value.expenseDate),
    amount: money.round2(form.value.amount || '0'),
    gstCategory: form.value.gstCategory as ExpenseCreate['gstCategory'],
    paymentMethod: form.value.paymentMethod || undefined,
    billable: form.value.billable,
    customerId: customer.value?.id || undefined,
  }

  const result = ExpenseCreate.safeParse(payload)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormState
      if (!errors.value[field]) errors.value[field] = issue.message
    }
    return
  }

  saving.value = true
  try {
    if (props.expense) {
      await apiFetch(`/expenses/${props.expense.id}`, {
        method: 'PATCH',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Expense updated.', life: 3000 })
    } else {
      await apiFetch('/expenses', { method: 'POST', body: JSON.stringify(result.data) })
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Expense recorded.',
        life: 3000,
      })
    }
    emit('saved')
  } catch (err) {
    const detail =
      err instanceof ApiError && err.status === 422
        ? 'This expense has already been added to an invoice and can no longer be edited.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail, life: 5000 })
  } finally {
    saving.value = false
  }
}

function onDelete() {
  if (!props.expense) return
  confirm.require({
    message: 'Delete this expense? This cannot be undone.',
    header: 'Delete Expense',
    icon: 'pi pi-trash',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        await apiFetch(`/expenses/${props.expense!.id}`, { method: 'DELETE' })
        toast.add({
          severity: 'success',
          summary: 'Deleted',
          detail: 'Expense deleted.',
          life: 3000,
        })
        emit('deleted')
      } catch (err) {
        const detail =
          err instanceof ApiError && err.status === 422
            ? 'This expense has already been added to an invoice and cannot be deleted.'
            : "Couldn't delete this expense. Please try again."
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
    :header="expense ? 'Edit Expense' : 'New Expense'"
    @update:visible="
      (v) => {
        if (!v) $emit('close')
      }
    "
  >
    <div
      v-if="isInvoiced"
      class="mb-4 text-xs bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 rounded-lg p-3"
    >
      This expense has been added to an invoice and can no longer be edited.
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Category *</label>
        <InputText
          v-model="form.category"
          :disabled="isInvoiced"
          :invalid="!!errors.category"
          fluid
        />
        <small v-if="errors.category" class="text-red-500">{{ errors.category }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Description</label>
        <Textarea v-model="form.description" rows="2" :disabled="isInvoiced" fluid />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Date *</label>
          <DatePicker
            v-model="form.expenseDate"
            date-format="dd M yy"
            show-icon
            :disabled="isInvoiced"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Supplier (optional)</label>
          <AutoComplete
            v-model="supplier"
            :suggestions="supplierSuggestions"
            option-label="name"
            placeholder="Search…"
            :disabled="isInvoiced"
            @complete="searchSuppliers"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">Amount (excl. GST) *</label>
          <InputText
            v-model="form.amount"
            inputmode="decimal"
            :disabled="isInvoiced"
            :invalid="!!errors.amount"
            fluid
          />
          <small v-if="errors.amount" class="text-red-500">{{ errors.amount }}</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-medium text-sm">GST Category</label>
          <Select
            v-model="form.gstCategory"
            :options="GST_CATEGORY_OPTIONS"
            option-label="label"
            option-value="value"
            :disabled="isInvoiced"
            fluid
          />
        </div>
      </div>

      <p class="text-xs text-surface-500">
        GST {{ gstPreview.gst }} · Total paid {{ gstPreview.gross }} (for record-keeping — does not
        feed MIRA input tax; record a supplier bill for that)
      </p>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Payment method</label>
        <InputText
          v-model="form.paymentMethod"
          placeholder="e.g. cash, bank transfer"
          :disabled="isInvoiced"
          fluid
        />
      </div>

      <div class="flex items-center gap-2">
        <Checkbox
          v-model="form.billable"
          binary
          input-id="expense-billable"
          :disabled="isInvoiced"
        />
        <label for="expense-billable" class="text-sm">Billable to a customer</label>
      </div>

      <div v-if="form.billable" class="flex flex-col gap-1">
        <label class="font-medium text-sm">Customer *</label>
        <AutoComplete
          v-model="customer"
          :suggestions="customerSuggestions"
          option-label="name"
          placeholder="Search customers…"
          :disabled="isInvoiced"
          @complete="searchCustomers"
        />
      </div>
    </form>

    <template #footer>
      <div class="flex items-center gap-2">
        <Button
          v-if="expense && !isInvoiced"
          icon="pi pi-trash"
          severity="danger"
          text
          :loading="deleting"
          aria-label="Delete expense"
          @click="onDelete"
        />
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button v-if="!isInvoiced" label="Save" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
