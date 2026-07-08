<script setup lang="ts">
import { ref } from 'vue'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { apiFetch } from '../../../lib/apiFetch.js'
import { ForgotPasswordSchema } from '@koosani/shared'

const email = ref('')
const emailError = ref('')
const submitted = ref(false)
const loading = ref(false)

async function onSubmit() {
  emailError.value = ''

  const result = ForgotPasswordSchema.safeParse({ email: email.value })
  if (!result.success) {
    emailError.value = result.error.issues[0]?.message ?? 'Invalid email'
    return
  }

  loading.value = true
  try {
    await apiFetch('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify(result.data),
      noRedirect: true,
    })
  } catch {
    // Intentionally swallow — never reveal whether the account exists
  } finally {
    loading.value = false
    submitted.value = true
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8">
      <RouterLink to="/login" class="text-sm text-surface-500 hover:underline mb-6 inline-block">
        ← Back to sign in
      </RouterLink>

      <template v-if="!submitted">
        <h1 class="text-2xl font-semibold mb-2">Sign in with a link</h1>
        <p class="text-surface-500 mb-8">
          Enter your email and we'll send you a link to sign in — no password needed.
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
        <h1 class="text-2xl font-semibold mb-2">Check your email</h1>
        <p class="text-surface-500">
          If an account exists for that email, you'll receive a sign-in link shortly. It expires in
          15 minutes.
        </p>
      </template>
    </div>
  </div>
</template>
