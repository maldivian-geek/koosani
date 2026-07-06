import { createRouter, createWebHistory } from 'vue-router'
import { usePortalAuthStore } from '../stores/auth.js'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    public?: boolean
    title?: string
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/invoices' },
    {
      path: '/login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true, title: 'Sign in' },
    },
    {
      path: '/auth/verify',
      component: () => import('../views/VerifyView.vue'),
      meta: { public: true, title: 'Signing in…' },
    },
    {
      path: '/',
      component: () => import('../views/PortalLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'invoices',
          component: () => import('../views/InvoicesView.vue'),
          meta: { requiresAuth: true, title: 'Invoices' },
        },
        {
          path: 'invoices/:id',
          component: () => import('../views/InvoiceDetailView.vue'),
          meta: { requiresAuth: true, title: 'Invoice' },
        },
        {
          path: 'estimates',
          component: () => import('../views/EstimatesView.vue'),
          meta: { requiresAuth: true, title: 'Estimates' },
        },
        {
          path: 'estimates/:id',
          component: () => import('../views/EstimateDetailView.vue'),
          meta: { requiresAuth: true, title: 'Estimate' },
        },
        {
          path: 'statement',
          component: () => import('../views/StatementView.vue'),
          meta: { requiresAuth: true, title: 'Statement of account' },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = usePortalAuthStore()
  await authStore.bootstrap()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.meta.public && authStore.isAuthenticated && to.path !== '/auth/verify') {
    return { path: '/invoices' }
  }
})
