<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import { useAuthStore } from '../../../stores/auth.js'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { LoginSchema } from '@koosani/shared'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

const emailError = ref('')
const passwordError = ref('')

async function onSubmit() {
  emailError.value = ''
  passwordError.value = ''
  errorMsg.value = ''

  const result = LoginSchema.safeParse({ email: email.value, password: password.value })
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.path[0] === 'email') emailError.value = issue.message
      if (issue.path[0] === 'password') passwordError.value = issue.message
    }
    return
  }

  loading.value = true
  try {
    const res = await apiFetch<{
      user: import('../../../stores/auth.js').AuthUser
      permissions: import('@koosani/shared').Permission[]
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(result.data),
    })
    authStore.setUser(res.user, res.permissions)
    const redirect = route.query['redirect'] as string | undefined
    await router.push(redirect && redirect.startsWith('/') ? redirect : '/dashboard')
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      errorMsg.value = 'Invalid email or password.'
    } else if (err instanceof ApiError && err.status !== 401) {
      errorMsg.value = 'Invalid email or password.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8">
      <h1 class="text-2xl font-semibold mb-2">Sign in</h1>
      <p class="text-surface-500 mb-8">Enter your credentials to access Koosani.</p>

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

        <div class="flex flex-col gap-1">
          <label for="password" class="font-medium text-sm">Password</label>
          <Password
            id="password"
            v-model="password"
            :feedback="false"
            toggle-mask
            :invalid="!!passwordError"
            fluid
          />
          <small v-if="passwordError" class="text-red-500">{{ passwordError }}</small>
        </div>

        <div v-if="errorMsg" class="text-red-500 text-sm">{{ errorMsg }}</div>

        <Button type="submit" label="Sign in" :loading="loading" fluid />

        <div class="text-center">
          <RouterLink to="/forgot-password" class="text-sm text-surface-500 hover:underline">
            Forgot your password?
          </RouterLink>
        </div>
      </form>
    </div>
  </div>
</template>
