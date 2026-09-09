export interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  time?: string
}

export interface UserSettings {
  avatar: string
  name: string
  role: string
  color: string
  bio: string
  model: string
}
