import { useState } from 'react'
import { Input, Button, Spin } from 'antd'
import { BranchesOutlined } from '@ant-design/icons'
import type { Message, Panel } from './types'

// ======================= MessageSuggestions =======================
// assistant 消息下方的「系统追问 + 自定义追问」区域
export default function MessageSuggestions({
  msg, panelId, displayChildMap, colors, onDerivedClick, onOpenDerived,
}: {
  msg: Message
  panelId: string
  displayChildMap: Record<number, Record<number, Panel[]>>
  colors: { bg: string; border: string; text: string; accent: string }
  onDerivedClick: (messageId: number, suggestion: string, suggestionIndex: number, sourcePanelId?: string) => void
  onOpenDerived?: (panelId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [customText, setCustomText] = useState('')
  // 已发出的自定义追问使用的负索引（每条独立成支，避免与系统追问 0..n-1 冲突）
  const [customIndices, setCustomIndices] = useState<number[]>([])

  const childMap = displayChildMap[msg.id] ?? {}

  const sendCustom = () => {
    const text = customText.trim()
    if (!text) return
    const idx = -(customIndices.length + 1)
    setCustomIndices((prev) => [...prev, idx])
    setCustomText('')
    setAdding(false)
    onDerivedClick(msg.id, text, idx, panelId)
  }

  const renderSpawned = (idx: number) => {
    const spawnedPanel = (childMap[idx] ?? [])[0]
    if (!spawnedPanel) return null
    const isThinking = spawnedPanel.status === 1
    return (
      <div
        key={idx}
        onClick={() => { if (isThinking) return; onOpenDerived?.(spawnedPanel.id) }}
        style={{
          padding: '5px 10px', borderRadius: 6,
          background: isThinking ? '#f8f7ff' : colors.bg,
          border: `1px solid ${isThinking ? '#e0e7ff' : colors.border}`,
          fontSize: 11, color: isThinking ? '#a5b4fc' : colors.text,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: isThinking ? 'default' : 'pointer', transition: 'all 0.15s',
          opacity: isThinking ? 0.85 : 1, overflow: 'hidden',
        }}>
        {isThinking ? (
          <Spin size="small" />
        ) : (
          <BranchesOutlined style={{ fontSize: 11, color: colors.accent }} />
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {spawnedPanel.title}
        </span>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>
          {isThinking ? '追问中' : '已追问'}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
      {/* 系统追问 */}
      {(msg.suggestions ?? []).map((s, sIdx) => {
        const spawnedPanel = (childMap[sIdx] ?? [])[0]
        if (spawnedPanel) {
          const isThinking = spawnedPanel.status === 1
          return (
            <div
              key={sIdx}
              onClick={() => { if (isThinking) return; onOpenDerived?.(spawnedPanel.id) }}
              style={{
                padding: '5px 10px', borderRadius: 6,
                background: isThinking ? '#f8f7ff' : colors.bg,
                border: `1px solid ${isThinking ? '#e0e7ff' : colors.border}`,
                fontSize: 11, color: isThinking ? '#a5b4fc' : colors.text,
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: isThinking ? 'default' : 'pointer', transition: 'all 0.15s',
                opacity: isThinking ? 0.85 : 1, overflow: 'hidden',
              }}>
              {isThinking ? (
                <Spin size="small" />
              ) : (
                <BranchesOutlined style={{ fontSize: 11, color: colors.accent }} />
              )}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isThinking ? s : spawnedPanel.title}
              </span>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>
                {isThinking ? '追问中' : '已追问'}
              </span>
            </div>
          )
        }
        return (
          <div
            key={sIdx}
            onClick={() => onDerivedClick(msg.id, s, sIdx, panelId)}
            style={{
              padding: '5px 10px', borderRadius: 6,
              border: '1px solid #e0e7ff', background: '#f8f7ff',
              fontSize: 11, color: '#6366f1', fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            追问：{s}
          </div>
        )
      })}

      {/* 已发出的自定义追问 */}
      {customIndices.map((idx) => renderSpawned(idx))}

      {/* 自定义追问入口 */}
      {adding ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <Input
              autoFocus
              size="small"
              value={customText}
              placeholder="输入你的追问..."
              onChange={(e) => setCustomText(e.target.value)}
              onPressEnter={sendCustom}
              style={{ flex: 1, fontSize: 11, borderRadius: 6 }}
            />
            <Button
              size="small"
              type="primary"
              onClick={sendCustom}
              disabled={!customText.trim()}
              style={{ fontSize: 11, borderRadius: 6, flexShrink: 0 }}
            >
              追问
            </Button>
            <Button
              size="small"
              onClick={() => { setAdding(false); setCustomText('') }}
              style={{ fontSize: 11, borderRadius: 6, flexShrink: 0 }}
            >
              取消
            </Button>
          </div>
        ) : (
          <div
            onClick={() => setAdding(true)}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px', borderRadius: 12,
              border: '1px dashed #d1d5db', background: '#f9fafb',
              fontSize: 11, color: '#9ca3af', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#9ca3af' }}
          >
            ✏️ 自定义追问
          </div>
        )}
    </div>
  )
}
