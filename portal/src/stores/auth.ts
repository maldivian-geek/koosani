import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiFetch } from '../lib/apiFetch.js'

export interface PortalCustomer {
  id: string
  name: string
  email: string | null
}

export const usePortalAuthStore = defineStore('portalAuth', () => {
  const customer = ref<PortalCustomer | null>(null)
  const bootstrapped = ref(false)

  const isAuthenticated = computed(() => customer.value !== null)

  async function bootstrap(): Promise<void> {
    if (bootstrapped.value) return
    bootstrapped.value = true
    try {
      customer.value = await apiFetch<PortalCustomer>('/portal/me', { noRedirect: true })
    } catch {
      customer.value = null
    }
  }

  function setCustomer(c: PortalCustomer): void {
    customer.value = c
    bootstrapped.value = true
  }

  async function logout(): Promise<void> {
    await apiFetch('/portal/auth/logout', { method: 'POST', noRedirect: true }).catch(() => {})
    customer.value = null
    bootstrapped.value = false
  }

  return { customer, bootstrapped, isAuthenticated, bootstrap, setCustomer, logout }
})
