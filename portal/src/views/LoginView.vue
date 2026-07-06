<script setup lang="ts">
import { ref } from 'vue'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { z } from 'zod'
import { apiFetch } from '../lib/apiFetch.js'

const EmailSchema = z.object({ email: z.string().email('Enter a valid email address') })

const email = ref('')
const emailError = ref('')
const submitted = ref(false)
const loading = ref(false)

async function onSubmit() {
  emailError.value = ''
  const result = EmailSchema.safeParse({ email: email.value })
  if (!result.success) {
    emailError.value = result.error.issues[0]?.message ?? 'Invalid email'
    return
  }

  loading.value = true
  try {
    await apiFetch('/portal/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify(result.data),
      noRedirect: true,
    })
  } catch {
    // Intentionally swallow — never reveal whether the email matches any customer
  } finally {
    loading.value = false
    submitted.value = true
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8">
      <h1 class="text-2xl font-semibold mb-2">Customer portal</h1>

      <template v-if="!submitted">
        <p class="text-surface-500 mb-8">
          Enter the email address you use with us and we'll send you a sign-in link. No password
          needed.
        </p>

        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <div class="flex flex-col gap-1">
            <label for="email" class="font-medium text-sm">Email</label>
            <InputText
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              :invalid="!!emailError"
              fluid
            />
            <small v-if="emailError" class="text-red-500">{{ emailError }}</small>
          </div>

          <Button type="submit" label="Send sign-in link" :loading="loading" fluid />
        </form>
      </template>

      <template v-else>
        <h2 class="text-xl font-semibold mb-2">Check your email</h2>
        <p class="text-surface-500">
          If that email matches an account, a sign-in link is on its way. It expires in 15 minutes.
        </p>
      </template>
    </div>
  </div>
</template>
