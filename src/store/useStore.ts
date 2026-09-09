import { create } from 'zustand'
import type { UserSettings } from '../types'

interface Store {
  // User settings
  userSettings: UserSettings
  setUserSettings: (s: Partial<UserSettings>) => void

  // Settings panel
  settingsOpen: boolean
  toggleSettings: () => void
  closeSettings: () => void

  // 多页面数据同步设置
  autoSync: boolean
  setAutoSync: (v: boolean) => void
  syncInterval: number
  setSyncInterval: (v: number) => void
}

const defaultSettings: UserSettings = {
  avatar: '👤',
  name: '我',
  role: '',
  color: '#6366f1',
  bio: '',
  model: 'GPT-4o',
}

const saved = localStorage.getItem('ai-flow-settings')
const initial = saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings

const savedAutoSync = localStorage.getItem('ai-flow-autosync')
const initialAutoSync = savedAutoSync === null ? true : savedAutoSync === '1'
const savedInterval = localStorage.getItem('ai-flow-syncinterval')
const initialInterval = savedInterval ? parseInt(savedInterval, 10) : 8000

export const useStore = create<Store>((set) => ({
  userSettings: initial,
  setUserSettings: (partial) =>
    set((s) => {
      const next = { ...s.userSettings, ...partial }
      localStorage.setItem('ai-flow-settings', JSON.stringify(next))
      return { userSettings: next }
    }),

  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeSettings: () => set({ settingsOpen: false }),

  autoSync: initialAutoSync,
  setAutoSync: (v) => {
    localStorage.setItem('ai-flow-autosync', v ? '1' : '0')
    set({ autoSync: v })
  },
  syncInterval: initialInterval,
  setSyncInterval: (v) => {
    localStorage.setItem('ai-flow-syncinterval', String(v))
    set({ syncInterval: v })
  },
}))
