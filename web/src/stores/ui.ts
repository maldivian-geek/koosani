import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'koosani-theme'

export const useUiStore = defineStore('ui', () => {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null
  const theme = ref<ThemeChoice>(stored ?? 'system')

  function getSystemDark(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  const isDark = computed<boolean>(() => {
    if (theme.value === 'dark') return true
    if (theme.value === 'light') return false
    return getSystemDark()
  })

  function apply() {
    document.documentElement.classList.toggle('app-dark', isDark.value)
  }

  function setTheme(t: ThemeChoice) {
    theme.value = t
    localStorage.setItem(STORAGE_KEY, t)
    apply()
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') apply()
  })

  apply()

  return { theme, isDark, setTheme }
})
