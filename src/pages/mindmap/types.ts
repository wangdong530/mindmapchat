// ======================= Types =======================
export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  suggestions?: string[]
  parentMessageId?: number
  reasoning?: string
  images?: string[]  // 多模态图片 URL 数组
}

export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

export interface Panel {
  id: string
  type: 'container' | 'message'
  title: string
  parentId: string | null
  messages: Message[]
  childrenIds: string[]
  sourceMessageId?: number
  sourceSuggestionIndex?: number
  // 容器状态：1=正在思考(AI 输出中)，2=已完成(AI 输出结束)
  status?: 1 | 2
  // 容器对话总结（后台调大模型生成，落库 panels.summary）
  summary?: string
  summaryMsgCount?: number
  // 前端态：总结中 / 已完成（不落库）
  summaryStatus?: 'idle' | 'summarizing' | 'done'
}

export interface Conversation {
  id: string
  title: string
  panels: Panel[]
  background?: string
  // 会话级模型配置（留空则沿用全局 user_configs）
  convSystem?: string
  convTemperature?: number
  convThinking?: boolean
  convReasoning?: 'high' | 'max' | 'low'
  // 开场白（创建会话时自动显示的第一条系统消息）
  greeting?: string
  // 分组与置顶
  group?: string
  pinned?: boolean
  // 会话级画像采集开关（默认开；未定义按开处理）
  profileEnabled?: boolean
  // 来源角色模板；服务端保证同一用户与模板仅关联一个会话
  roleTemplateId?: string
}

export interface RoleTemplate {
  id: string
  name: string
  title?: string
  background?: string
  convSystem?: string
  convTemperature?: number
  convThinking?: boolean
  convReasoning?: string
  convGroup?: string
  greeting?: string
  sortOrder?: number
  isEnabled?: boolean
}

export interface NodeLayout {
  x: number
  y: number
  w: number
  h: number
}

// ======================= Constants =======================
export const NODE_W = 220
export const NODE_H = 90
export const H_GAP = 80
export const V_GAP = 40
export const START_X = 40
export const START_Y = 40

export const DEPTH_COLORS = [
  { bg: '#f5f3ff', border: '#a78bfa', text: '#6d28d9', accent: '#8b5cf6' },
  { bg: '#eff6ff', border: '#60a5fa', text: '#2563eb', accent: '#3b82f6' },
  { bg: '#fef3c7', border: '#f59e0b', text: '#d97706', accent: '#f59e0b' },
  { bg: '#ecfdf5', border: '#34d399', text: '#059669', accent: '#10b981' },
  { bg: '#fdf2f8', border: '#f472b6', text: '#db2777', accent: '#ec4899' },
]

export const suggestionTags: string[][] = []

// 对话背景预设色板
export const BG_COLORS = ['#f9fafb', '#f5f3ff', '#eff6ff', '#fef3c7', '#ecfdf5', '#fdf2f8', '#f0fdfa', '#fff7ed', '#f1f5f9']
