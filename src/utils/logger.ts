/**
 * 前端统一操作日志工具
 * 输出结构化日志到浏览器 console，便于开发者调试和审计用户行为
 */

export type LogCategory =
  | 'auth'
  | 'chat'
  | 'conversation'
  | 'settings'
  | 'model_config'
  | 'admin'
  | 'learn'
  | 'ui'

interface LogEntry {
  action: string
  category: LogCategory
  detail?: Record<string, unknown>
  timestamp: string
  userId?: string
}

function getUserId(): string | undefined {
  try {
    const raw = localStorage.getItem('thinkchat_user')
    if (!raw) return undefined
    const user = JSON.parse(raw)
    return `${user.username}(${user.id})`
  } catch {
    return undefined
  }
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

const STYLE_MAP: Record<LogCategory, string> = {
  auth: 'color: #fff; background: #6366f1; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  chat: 'color: #fff; background: #10b981; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  conversation: 'color: #fff; background: #f59e0b; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  settings: 'color: #fff; background: #8b5cf6; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  model_config: 'color: #fff; background: #ec4899; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  admin: 'color: #fff; background: #ef4444; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  learn: 'color: #fff; background: #06b6d4; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  ui: 'color: #333; background: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
}

/**
 * 记录一条操作日志到 console
 */
export function logAction(action: string, category: LogCategory, detail?: Record<string, unknown>): void {
  const entry: LogEntry = {
    action,
    category,
    detail,
    timestamp: formatTimestamp(),
    userId: getUserId(),
  }

  const style = STYLE_MAP[category] || ''
  console.groupCollapsed(
    `%c[USER_ACTION]%c ${category}/${action} %c${entry.timestamp}`,
    'color: #fff; background: #3b82f6; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    style,
    'color: #9ca3af; font-size: 11px;',
  )
  console.log('Action:', action)
  console.log('Category:', category)
  if (entry.userId) console.log('User:', entry.userId)
  console.log('Timestamp:', entry.timestamp)
  if (detail && Object.keys(detail).length > 0) {
    console.log('Detail:', detail)
  }
  console.groupEnd()
}

/**
 * 便捷方法：记录认证相关操作
 */
export function logAuth(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'auth', detail)
}

/**
 * 便捷方法：记录聊天相关操作
 */
export function logChat(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'chat', detail)
}

/**
 * 便捷方法：记录会话相关操作
 */
export function logConversation(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'conversation', detail)
}

/**
 * 便捷方法：记录设置相关操作
 */
export function logSettings(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'settings', detail)
}

/**
 * 便捷方法：记录模型配置相关操作
 */
export function logModelConfig(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'model_config', detail)
}

/**
 * 便捷方法：记录管理员操作
 */
export function logAdmin(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'admin', detail)
}

/**
 * 便捷方法：记录 UI 交互
 */
export function logUI(action: string, detail?: Record<string, unknown>) {
  logAction(action, 'ui', detail)
}

export default logAction
