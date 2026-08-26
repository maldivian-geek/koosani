import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiFetch } from '../lib/apiFetch.js'
import type { Permission, PermissionResource, PermissionAction, Role } from '@koosani/shared'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  businessId: string
  emailVerified: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const permissions = ref<Permission[]>([])
  const bootstrapped = ref(false)

  const isAuthenticated = computed(() => user.value !== null)

  // Mirrors the backend default policy exactly (middleware/authorize.ts,
  // SECURITY.md §Authorization Model, Phase 37): admin bypasses everything;
  // 'export' (reports bulk CSV) needs an explicit grant regardless of role;
  // 'view' is allowed for manager by default, and for staff iff they hold
  // ANY grant on the resource (an explicit view grant, or an add/edit/delete
  // grant, which implies view); manager gets add/edit/delete by default;
  // staff needs an explicit grant for anything beyond view.
  function hasPermission(resource: PermissionResource, action: PermissionAction): boolean {
    const role = user.value?.role
    if (!role) return false
    if (role === 'admin') return true
    const granted = permissions.value.some((p) => p.resource === resource && p.action === action)
    if (action === 'export') return granted
    if (action === 'view') {
      if (role === 'manager') return true
      return permissions.value.some((p) => p.resource === resource)
    }
    if (role === 'manager') return true
    return granted
  }

  async function bootstrap(): Promise<void> {
    if (bootstrapped.value) return
    bootstrapped.value = true
    try {
      const me = await apiFetch<AuthUser & { permissions: Permission[] }>('/me', {
        noRedirect: true,
      })
      const { permissions: perms, ...profile } = me
      user.value = profile
      permissions.value = perms
    } catch {
      user.value = null
      permissions.value = []
    }
  }

  function setUser(u: AuthUser, perms: Permission[] = []): void {
    user.value = u
    permissions.value = perms
    bootstrapped.value = true
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      permissions.value = []
      bootstrapped.value = false
      window.location.replace('/login')
    }
  }

  return {
    user,
    permissions,
    bootstrapped,
    isAuthenticated,
    hasPermission,
    bootstrap,
    setUser,
    logout,
  }
})
