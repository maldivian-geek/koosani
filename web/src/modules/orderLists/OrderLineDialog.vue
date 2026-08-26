<script setup lang="ts">
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { OrderLineCreate, OrderLinePatch } from '@koosani/shared'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import type { OrderListLine } from './views/OrderListDetailView.vue'

// Add mode when `line` is absent; edit mode (PATCH) when present — used by
// the mobile card layout, where inline cell editing isn't available.
const props = defineProps<{ orderListId: string; line?: OrderListLine }>()
const emit = defineEmits<{ close: []; added: [OrderListLine]; saved: [OrderListLine] }>()

const toast = useToast()
const visible = ref(true)
const loading = ref(false)
const error = ref('')
const form = ref({
  itemName: props.line?.itemName ?? '',
  qty: props.line?.qty ?? '1',
  uom: props.line?.uom ?? 'Each',
  note: props.line?.note ?? '',
  additionalNote: props.line?.additionalNote ?? '',
})

async function submit() {
  error.value = ''

  if (props.line) {
    const payload = {
      itemName: form.value.itemName,
      qty: form.value.qty || '1',
      uom: form.value.uom || 'Each',
      note: form.value.note || null,
      additionalNote: form.value.additionalNote || null,
    }
    const parsed = OrderLinePatch.safeParse(payload)
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    loading.value = true
    try {
      const line = await apiFetch<OrderListLine>(
        `/order-lists/${props.orderListId}/lines/${props.line.id}`,
        { method: 'PATCH', body: JSON.stringify(parsed.data) },
      )
      emit('saved', line)
    } catch (err) {
      error.value =
        err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
      toast.add({ severity: 'error', summary: 'Error', detail: error.value, life: 5000 })
    } finally {
      loading.value = false
    }
    return
  }

  const payload = {
    itemName: form.value.itemName,
    qty: form.value.qty || '1',
    uom: form.value.uom || 'Each',
    note: form.value.note || undefined,
    additionalNote: form.value.additionalNote || undefined,
  }
  const parsed = OrderLineCreate.safeParse(payload)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }

  loading.value = true
  try {
    const line = await apiFetch<OrderListLine>(`/order-lists/${props.orderListId}/lines`, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    })
    emit('added', line)
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: error.value, life: 5000 })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="line ? 'Edit Line' : 'Add Line'"
    modal
    :style="{ width: '36rem' }"
    :closable="false"
    :pt="{ content: { class: 'space-y-4 pt-2!' } }"
    @after-hide="emit('close')"
  >
    <div class="space-y-1.5">
      <label class="block text-sm font-semibold text-surface-800"
        >Item <span class="text-red-500">*</span></label
      >
      <InputText v-model="form.itemName" class="w-full" autofocus />
    </div>

    <div class="flex gap-3">
      <div class="flex-1 space-y-1.5">
        <label class="block text-sm font-semibold text-surface-800">Qty</label>
        <InputText v-model="form.qty" inputmode="decimal" class="w-full" />
      </div>
      <div class="flex-1 space-y-1.5">
        <label class="block text-sm font-semibold text-surface-800">UOM</label>
        <InputText v-model="form.uom" class="w-full" />
      </div>
    </div>

    <div class="space-y-1.5">
      <label class="block text-sm font-semibold text-surface-800">Note</label>
      <Textarea v-model="form.note" rows="2" class="w-full resize-none" />
    </div>
    <div class="space-y-1.5">
      <label class="block text-sm font-semibold text-surface-800">Additional Note</label>
      <Textarea v-model="form.additionalNote" rows="2" class="w-full resize-none" />
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" @click="emit('close')" />
        <Button :label="line ? 'Save' : 'Add Line'" :loading="loading" @click="submit" />
      </div>
    </template>
  </Dialog>
</template>
