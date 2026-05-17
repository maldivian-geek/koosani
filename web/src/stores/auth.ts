import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiFetch } from '../lib/apiFetch.js'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'accountant' | 'viewer'
  businessId: string
  businessName: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const bootstrapped = ref(false)

  const isAuthenticated = computed(() => user.value !== null)

  async function bootstrap(): Promise<void> {
    if (bootstrapped.value) return
    bootstrapped.value = true
    try {
      user.value = await apiFetch<AuthUser>('/me', { noRedirect: true })
    } catch {
      user.value = null
    }
  }

  function setUser(u: AuthUser): void {
    user.value = u
    bootstrapped.value = true
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      bootstrapped.value = false
      window.location.replace('/login')
    }
  }

  return { user, bootstrapped, isAuthenticated, bootstrap, setUser, logout }
})
