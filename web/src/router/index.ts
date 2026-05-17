import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

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
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      component: () => import('../modules/auth/views/LoginView.vue'),
      meta: { public: true, title: 'Login' },
    },
    {
      path: '/forgot-password',
      component: () => import('../modules/auth/views/MagicLinkView.vue'),
      meta: { public: true, title: 'Forgot Password' },
    },
    {
      path: '/reset-password',
      component: () => import('../modules/auth/views/ResetPasswordView.vue'),
      meta: { public: true, title: 'Reset Password' },
    },
    {
      path: '/accept-invite',
      component: () => import('../modules/auth/views/AcceptInviteView.vue'),
      meta: { public: true, title: 'Accept Invitation' },
    },
    {
      path: '/',
      component: () => import('../shared/ui/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          component: () => import('../modules/dashboard/views/DashboardView.vue'),
          meta: { requiresAuth: true, title: 'Dashboard' },
        },
        {
          path: 'customers',
          component: () => import('../modules/customers/views/CustomersView.vue'),
          meta: { requiresAuth: true, title: 'Customers' },
        },
        {
          path: 'suppliers',
          component: () => import('../modules/suppliers/views/SuppliersView.vue'),
          meta: { requiresAuth: true, title: 'Suppliers' },
        },
        {
          path: 'items',
          component: () => import('../modules/items/views/ItemsView.vue'),
          meta: { requiresAuth: true, title: 'Items' },
        },
        {
          path: 'customers/:id/soa',
          component: () => import('../modules/customers/views/CustomerSoaView.vue'),
          meta: { requiresAuth: true, title: 'Statement of Account' },
        },
        {
          path: 'invoices',
          component: () => import('../modules/invoicing/views/InvoiceListView.vue'),
          meta: { requiresAuth: true, title: 'Invoices' },
        },
        {
          path: 'invoices/new',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Invoice' },
        },
        {
          path: 'invoices/:id',
          component: () => import('../modules/invoicing/views/InvoiceDetailView.vue'),
          meta: { requiresAuth: true, title: 'Invoice' },
        },
        {
          path: 'invoices/:id/edit',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Invoice' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('../modules/auth/views/NotFoundView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  await authStore.bootstrap()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (to.meta.public && authStore.isAuthenticated) {
    return { path: '/dashboard' }
  }
})

export default router
