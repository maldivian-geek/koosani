import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
import 'primeicons/primeicons.css'
import App from './App.vue'
import { router } from './router/index.js'
import './assets/main.css'

const Roanuedhuru = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{surface.50}',
      100: '{surface.100}',
      200: '{surface.200}',
      300: '{surface.300}',
      400: '{surface.400}',
      500: '{surface.500}',
      600: '{surface.600}',
      700: '{surface.700}',
      800: '{surface.800}',
      900: '{surface.900}',
      950: '{surface.950}',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{surface.950}',
          inverseColor: '#ffffff',
          hoverColor: '{surface.900}',
          activeColor: '{surface.800}',
        },
        highlight: {
          background: '{surface.200}',
          focusBackground: '{surface.300}',
          color: '{surface.800}',
          focusColor: '{surface.900}',
        },
      },
      dark: {
        primary: {
          color: '{surface.50}',
          inverseColor: '{surface.950}',
          hoverColor: '{surface.100}',
          activeColor: '{surface.200}',
        },
        highlight: {
          background: 'rgba(250,250,250,.16)',
          focusBackground: 'rgba(250,250,250,.24)',
          color: 'rgba(255,255,255,.87)',
          focusColor: 'rgba(255,255,255,.87)',
        },
      },
    },
  },
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  // PrimeUI community license (PrimeVue 5+). Build-time only — baked into the
  // JS bundle, not a server secret; without it PrimeVue shows a small
  // "Invalid PrimeUI License" corner banner but nothing breaks.
  license: import.meta.env.VITE_PRIMEVUE_LICENSE_KEY as string | undefined,
  theme: {
    preset: Roanuedhuru,
    options: { darkModeSelector: '.dark' },
  },
})
app.use(ConfirmationService)
app.use(ToastService)

app.mount('#app')
