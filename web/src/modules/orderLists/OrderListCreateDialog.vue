<script setup lang="ts">
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { OrderListCreate } from '@koosani/shared'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'

const emit = defineEmits<{ close: []; created: [string] }>()

const toast = useToast()
const visible = ref(true)
const loading = ref(false)
const error = ref('')
const form = ref({ title: '', notes: '' })

async function submit() {
  error.value = ''

  const payload = { title: form.value.title, notes: form.value.notes || undefined }
  const parsed = OrderListCreate.safeParse(payload)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }

  loading.value = true
  try {
    const created = await apiFetch<{ id: string }>('/order-lists', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    })
    emit('created', created.id)
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
    header="New Order List"
    modal
    :style="{ width: '36rem' }"
    :closable="false"
    :pt="{ content: { class: 'space-y-4 pt-2!' } }"
    @after-hide="emit('close')"
  >
    <div class="space-y-1.5">
      <label class="block text-sm font-semibold text-surface-800"
        >Title <span class="text-red-500">*</span></label
      >
      <InputText v-model="form.title" class="w-full" autofocus />
    </div>
    <div class="space-y-1.5">
      <label class="block text-sm font-semibold text-surface-800">Notes</label>
      <Textarea v-model="form.notes" rows="3" class="w-full resize-none" />
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" @click="emit('close')" />
        <Button label="Create" :loading="loading" @click="submit" />
      </div>
    </template>
  </Dialog>
</template>
