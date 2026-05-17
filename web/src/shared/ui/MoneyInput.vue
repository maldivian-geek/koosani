<script setup lang="ts">
import { ref, watch } from 'vue'
import InputText from 'primevue/inputtext'

const props = defineProps<{
  modelValue: string
  invalid?: boolean
  disabled?: boolean
  id?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const internal = ref(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== internal.value) internal.value = v
  },
)

function onBlur() {
  const n = parseFloat(internal.value.replace(/[^0-9.-]/g, ''))
  if (isNaN(n)) {
    internal.value = props.modelValue
    return
  }
  const formatted = n.toFixed(2)
  internal.value = formatted
  emit('update:modelValue', formatted)
}

function onInput(e: Event) {
  internal.value = (e.target as HTMLInputElement).value
  emit('update:modelValue', internal.value)
}
</script>

<template>
  <InputText
    :id="id"
    v-model="internal"
    type="text"
    inputmode="decimal"
    :invalid="invalid"
    :disabled="disabled"
    class="text-right tabular-nums"
    @blur="onBlur"
    @input="onInput"
  />
</template>
