<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { AcceptInviteSchema } from '@koosani/shared'
import { z } from 'zod'

const route = useRoute()
const router = useRouter()

const token = computed(() => (route.query['token'] as string | undefined) ?? '')

const name = ref('')
const password = ref('')
const confirmPassword = ref('')
const nameError = ref('')
const passwordError = ref('')
const confirmError = ref('')
const errorMsg = ref('')
const loading = ref(false)
const done = ref(false)

const FormSchema = AcceptInviteSchema.extend({
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

async function onSubmit() {
  nameError.value = ''
  passwordError.value = ''
  confirmError.value = ''
  errorMsg.value = ''

  const result = FormSchema.safeParse({
    token: token.value,
    name: name.value,
    password: password.value,
    confirmPassword: confirmPassword.value,
  })

  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.path[0] === 'name') nameError.value = issue.message
      if (issue.path[0] === 'password') passwordError.value = issue.message
      if (issue.path[0] === 'confirmPassword') confirmError.value = issue.message
    }
    return
  }

  loading.value = true
  try {
    await apiFetch('/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({
        token: result.data.token,
        name: result.data.name,
        password: result.data.password,
      }),
      noRedirect: true,
    })
    done.value = true
    setTimeout(() => void router.push('/login'), 2000)
  } catch (err) {
    errorMsg.value =
      err instanceof ApiError && err.status === 401
        ? 'This invitation link is invalid or has expired.'
        : 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8">
      <template v-if="!done">
        <h1 class="text-2xl font-semibold mb-2">Accept invitation</h1>
        <p class="text-surface-500 mb-8">Create your account to get started.</p>

        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <div class="flex flex-col gap-1">
            <label for="name" class="font-medium text-sm">Full name</label>
            <InputText id="name" v-model="name" autocomplete="name" :invalid="!!nameError" fluid />
            <small v-if="nameError" class="text-red-500">{{ nameError }}</small>
          </div>

          <div class="flex flex-col gap-1">
            <label for="password" class="font-medium text-sm">Password</label>
            <Password
              id="password"
              v-model="password"
              :feedback="true"
              toggle-mask
              :invalid="!!passwordError"
              fluid
            />
            <small v-if="passwordError" class="text-red-500">{{ passwordError }}</small>
          </div>

          <div class="flex flex-col gap-1">
            <label for="confirm" class="font-medium text-sm">Confirm password</label>
            <Password
              id="confirm"
              v-model="confirmPassword"
              :feedback="false"
              toggle-mask
              :invalid="!!confirmError"
              fluid
            />
            <small v-if="confirmError" class="text-red-500">{{ confirmError }}</small>
          </div>

          <div v-if="errorMsg" class="text-red-500 text-sm">{{ errorMsg }}</div>

          <Button type="submit" label="Create account" :loading="loading" fluid />
        </form>
      </template>

      <template v-else>
        <h1 class="text-2xl font-semibold mb-2">Account created</h1>
        <p class="text-surface-500">Your account is ready. Redirecting to sign in…</p>
      </template>
    </div>
  </div>
</template>
