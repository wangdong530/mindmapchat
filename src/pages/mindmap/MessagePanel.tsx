import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Button, Avatar, Spin, message } from 'antd'
import {
  BranchesOutlined,
  UserOutlined,
  RobotOutlined,
  RedoOutlined,
  CopyOutlined,
  ReloadOutlined,
  SelectOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  SendOutlined,
  CheckSquareOutlined,
  BorderOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from '../../components/MarkdownRenderer'
import { logUI } from '../../utils/logger'
import type { Message, Panel } from './types'
import { DEPTH_COLORS } from './types'
import { getDepth, truncate, copyMessageData } from './utils'
import MessageSuggestions from './MessageSuggestions'
import ChatInput from './ChatInput'

// ======================= MessagePanel =======================
interface MessagePanelProps {
  panel: Panel | null
  allPanels: Panel[]
  panelInput: string
  onInputChange: (v: string) => void
  onSend: (text?: string) => void
  loading: boolean
  selectedModel: string
  onModelChange: (v: string) => void
  onDerivedClick: (messageId: number, suggestion: string, suggestionIndex: number, sourcePanelId?: string) => void
  onOpenDerived?: (panelId: string) => void
  onSelectPanel?: (panelId: string) => void
  scrollNonce?: number
  conversationTitle?: string
  derivedLoading?: Record<string, boolean>
  onClose: () => void
  registerInputRef: (el: HTMLTextAreaElement | null) => void
  isMobile: boolean
  width?: number | string
  onResend?: (userMsgId: number) => void
  onRegenerate?: (userMsgId: number) => void
  images?: string[]
  onImagesChange?: (images: string[]) => void
}

export default function MessagePanel({
  panel, allPanels, panelInput, onInputChange, onSend, loading,
  selectedModel, onModelChange, onDerivedClick, onOpenDerived, onSelectPanel, scrollNonce, conversationTitle, derivedLoading, onClose, registerInputRef, isMobile, width,
  onResend, onRegenerate,
  images, onImagesChange,
}: MessagePanelProps) {
  const messagesRef = useRef<HTMLDivElement>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 以消息 id 作为选中 key（不依赖面板 id），避免跨面板 key 不匹配导致导出空白
  const toggleSelect = (msgId: number | string) =>
    setSelected((prev) => {
      const key = String(msgId)
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const handleExportSelected = useCallback(() => {
    if (selected.size === 0) { message.warning('请先选择要导出的消息'); return }
    // 打印区已在 DOM 中（visibility:hidden），调用浏览器打印，用户在对话框选「另存为 PDF」即可下载
    window.print()
    logUI('export_pdf', { messageCount: selected.size })
  }, [selected])

  // 打开/切换/跳转面板时，焦点定位到最后一条用户消息（而非拉到最底部）
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    // 用 rAF 等待异步内容（代码块/图片）布局稳定后再定位，避免偏差
    const raf = requestAnimationFrame(() => {
      const userMsgs = el.querySelectorAll('[data-role="user"]')
      const last = userMsgs[userMsgs.length - 1] as HTMLElement | undefined
      if (last) {
        last.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } else {
        el.scrollTop = 0
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [panel?.id, scrollNonce])

  // 发送消息（加载中）时跟随到底部，便于查看流式回复
  useEffect(() => {
    if (!loading) return
    const el = messagesRef.current
    if (!el) return
    const timer = setInterval(() => { el.scrollTop = el.scrollHeight }, 200)
    return () => clearInterval(timer)
  }, [loading])

  // 移动端点击输入框时：滚动消息到底部 + 确保输入框可见
  const handleInputFocus = useCallback(() => {
    if (!isMobile) return
    // 立即滚动消息到底部
    const el = messagesRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
    // 等键盘弹出完成后再调整
    setTimeout(() => {
      if (el) {
        el.scrollTop = el.scrollHeight
      }
      // 确保输入框可见：用 activeElement 找当前聚焦的元素，滚动到其父容器可见
      const focused = document.activeElement as HTMLElement | null
      if (focused?.tagName === 'TEXTAREA' || focused?.tagName === 'INPUT') {
        focused.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      // iOS: 修复 visualViewport offsetTop
      if (window.visualViewport && window.visualViewport.offsetTop > 0) {
        window.scrollTo(0, 0)
      }
    }, 300)
  }, [isMobile])

  // 必须在所有提前 return 之前调用，遵守 Hooks 规则（否则 panel 为 null 时跳过此 hook 会导致 hook 数量不一致）
  const panelMap = useMemo(() => new Map(allPanels.map(p => [p.id, p])), [allPanels])

  if (!panel) {
    return (
      <div style={{
        width: isMobile ? '100%' : (width ?? 480),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        background: '#fff',
        borderRight: '1px solid #e5e7eb',
        color: '#9ca3af',
        fontSize: 13,
        gap: 8,
      }}>
        <BranchesOutlined style={{ fontSize: 32, color: '#d1d5db' }} />
        <span>选择思维导图节点</span>
        <span>查看对话详情</span>
      </div>
    )
  }

  // 节点类型
  const isContainer = panel.type === 'container'
  const isMessage = panel.type === 'message'

  // 容器节点：展示自己的 Q+A；消息节点：只展示 Q（用户消息）
  interface DisplayMsg { msg: Message; panelId: string; panelTitle: string; showHeader: boolean }
  const displayMessages: DisplayMsg[] = panel.messages.map((msg) => ({
    msg, panelId: panel.id, panelTitle: panel.title, showHeader: false,
  }))

  // 容器节点：构建追问派生子容器映射
  // 注意：派生容器挂在消息节点下（msgNode.childrenIds），不在容器面板自身的 childrenIds，
  // 因此需扫描 allPanels 才能正确识别已派生的子容器
  const inlineChildMap: Record<number, Record<number, Panel[]>> = {}
  if (isContainer) {
    for (const child of allPanels) {
      if (child.sourceMessageId != null && child.sourceSuggestionIndex != null) {
        if (!inlineChildMap[child.sourceMessageId]) inlineChildMap[child.sourceMessageId] = {}
        if (!inlineChildMap[child.sourceMessageId][child.sourceSuggestionIndex]) {
          inlineChildMap[child.sourceMessageId][child.sourceSuggestionIndex] = []
        }
        inlineChildMap[child.sourceMessageId][child.sourceSuggestionIndex].push(child)
      }
    }
  }
  const displayChildMap = inlineChildMap
  const displayLoading = loading

  const depth = getDepth(panel, panelMap)
  const colors = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]

  return (
    <div style={{
      width: isMobile ? '100%' : (width ?? 480),
      minWidth: isMobile ? undefined : Math.min(320, typeof width === 'number' ? width : 320),
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      borderRight: '1px solid #e5e7eb',
      height: '100%',
    }}>
      {/* 来源链路：根 › 父节点 › … › 当前节点（点击切换面板） */}
      {(() => {
        const chain: Panel[] = []
        let pid: string | null = panel.parentId
        const guard = new Set<string>()
        while (pid && panelMap.has(pid) && !guard.has(pid)) {
          guard.add(pid)
          const p = panelMap.get(pid)!
          if (p.type === 'container') chain.unshift(p) // 只串容器，穿透消息节点
          pid = p.parentId
        }
        // 当前面板为容器时作为末项高亮；消息节点只展示其容器祖先
        const displayChain = panel.type === 'container' ? [...chain, panel] : chain
        // 根节点（parentId 为 null）使用会话名字，而非容器默认标题（如"新角色"）
        const nameOf = (c: Panel) => c.parentId === null ? (conversationTitle || c.title || '新面板') : (c.title || '新面板')
        // 构建最终显示项：始终以会话名为起点（即使 displayChain 为空也能显示）
        const items: { id: string; label: string; isCurrent: boolean; clickable: boolean }[] = []
        // 如果 displayChain 非空，直接用它（已包含路径信息）；否则手动构建最小路径
        if (displayChain.length > 0) {
          for (let i = 0; i < displayChain.length; i++) {
            const c = displayChain[i]
            items.push({ id: c.id, label: nameOf(c), isCurrent: c.id === panel.id, clickable: c.id !== panel.id })
          }
        } else {
          // 消息节点无任何容器祖先时，至少显示会话名
          items.push({ id: '__conv__', label: conversationTitle || panel.title || '新面板', isCurrent: true, clickable: false })
          // 如果有父级（消息节点的父可能是另一个消息节点或容器），也显示
          if (panel.parentId) {
            const parent = panelMap.get(panel.parentId)
            if (parent) {
              items[0].isCurrent = false
              items.push({ id: parent.id, label: nameOf(parent), isCurrent: true, clickable: false })
            }
          }
        }
        if (items.length === 0) return null
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12, color: '#92400e', overflow: 'hidden',
            whiteSpace: 'nowrap', padding: '6px 14px',
            background: '#fffbeb', borderBottom: `1px solid ${colors.border}`,
          }}>
            <span style={{ flexShrink: 0 }}>🔗</span>
            {items.map((item, i) => (
              <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: '#d97706', margin: '0 4px' }}>›</span>}
                {item.isCurrent ? (
                  <span style={{ fontWeight: 600, color: '#92400e' }}>
                    {truncate(item.label, 20)}
                  </span>
                ) : (
                  <span
                    onClick={() => item.clickable && onSelectPanel?.(item.id)}
                    title={`切换到：${item.label}`}
                    style={{ cursor: item.clickable ? 'pointer' : 'default', color: '#b45309' }}
                  >
                    {truncate(item.label, 20)}
                  </span>
                )}
              </span>
            ))}
          </div>
        )
      })()}

      {/* Messages */}
      <div ref={messagesRef} style={{
        flex: 1, overflowY: 'auto', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {displayMessages.map((dm) => {
          const { msg, panelId: srcPanelId } = dm
          const selKey = String(msg.id)
          return (
            <div key={`${srcPanelId}-${msg.id}`} data-role={msg.role}
              style={selected.has(selKey)
                ? { outline: '2px solid #6366f1', outlineOffset: 2, borderRadius: 8 }
                : undefined}>
              {selectMode && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
                  <span
                    onClick={() => toggleSelect(msg.id)}
                    title="选择此消息"
                    style={{ cursor: 'pointer', fontSize: 16, color: selected.has(selKey) ? '#6366f1' : '#cbd5e1' }}
                  >
                    {selected.has(selKey) ? <CheckSquareOutlined /> : <BorderOutlined />}
                  </span>
                </div>
              )}
              {msg.role === 'user' ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', maxWidth: '90%' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexDirection: 'row-reverse', width: '100%' }}>
                      <Avatar size={20} icon={<UserOutlined />} style={{ background: '#6366f1', flexShrink: 0 }} />
                      <div style={{
                        background: '#f3f4f6', padding: '6px 10px', borderRadius: 10,
                        fontSize: 12, lineHeight: 1.5, color: '#1f2937',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {/* 图片展示 */}
                        {msg.images && msg.images.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: msg.content ? 6 : 0 }}>
                            {msg.images.map((url, idx) => (
                              <div key={idx} style={{
                                width: 80, height: 80, borderRadius: 6, overflow: 'hidden',
                                border: '1px solid #e5e7eb', cursor: 'pointer',
                              }}>
                                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  onClick={() => window.open(url, '_blank')} />
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.content}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
                      {isContainer && onResend && (
                        <Button type="text" size="small" icon={<RedoOutlined />}
                          onClick={() => onResend(msg.id)} title="重新发送"
                          style={{ padding: '2px 6px', height: 22, fontSize: 11, color: '#9ca3af' }}>
                          重发
                        </Button>
                      )}
                      <Button
                        type="text" size="small" icon={<CopyOutlined />}
                        onClick={() => copyMessageData(msg)}
                        title="复制"
                        style={{ padding: '2px 6px', height: 22, fontSize: 11, color: '#9ca3af' }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, width: '100%' }}>
                    <Avatar size={20} icon={<RobotOutlined />} style={{ background: colors.accent, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        background: '#f9fafb', border: '1px solid #f3f4f6',
                        padding: '6px 10px', borderRadius: 10,
                        lineHeight: 1.35, color: '#1f2937',
                        wordBreak: 'break-word',
                      }}>
                        <MarkdownRenderer content={msg.content} done={!displayLoading} />
                        {displayLoading && !msg.suggestions && (
                          <span style={{
                            display: 'inline-block', width: 10, height: 10,
                            border: '2px solid #e5e7eb', borderTopColor: '#6366f1',
                            borderRadius: '50%', marginLeft: 4, verticalAlign: 'middle',
                            animation: 'mindmap-spin 0.6s linear infinite',
                          }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 4, marginTop: 2 }}>
                        {isContainer && onRegenerate && (
                          <Button type="text" size="small" icon={<ReloadOutlined />}
                            onClick={() => onRegenerate(msg.id)} title="重新生成"
                            style={{ padding: '2px 6px', height: 22, fontSize: 11, color: '#9ca3af' }}>
                            重新生成
                          </Button>
                        )}
                        <Button
                          type="text" size="small" icon={<CopyOutlined />}
                          onClick={() => copyMessageData(msg)}
                          title="复制"
                          style={{ padding: '2px 6px', height: 22, fontSize: 11, color: '#9ca3af' }}
                        >
                          复制
                        </Button>
                      </div>
                      {/* Suggestions - 仅容器节点可追问（系统追问 + 自定义追问） */}
                      {isContainer && (
                        <MessageSuggestions
                          msg={msg}
                          panelId={panel.id}
                          displayChildMap={displayChildMap}
                          colors={colors}
                          onDerivedClick={onDerivedClick}
                          onOpenDerived={onOpenDerived}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 总结中蒙层：覆盖整个节点，禁止点击，显示转圈 */}
              {isContainer && panel.summaryStatus === 'summarizing' && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 5,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    background: 'rgba(255,255,255,0.7)',
                    backdropFilter: 'blur(1px)',
                    borderRadius: 'inherit',
                    cursor: 'not-allowed',
                  }}
                >
                  <Spin size="default" />
                  <span style={{ fontSize: 11, color: '#6b7280' }}>总结中…</span>
                </div>
              )}
            </div>
          )
        })}

        {displayLoading && !(displayMessages.length > 0 && displayMessages[displayMessages.length - 1].msg.role === 'assistant') && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Avatar size={20} icon={<RobotOutlined />} style={{ background: colors.accent, flexShrink: 0 }} />
              <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', padding: '6px 10px', borderRadius: 10 }}>
                <Spin size="small" />
                <span style={{ marginLeft: 6, fontSize: 12, color: '#9ca3af' }}>思考中...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area - 仅容器节点可输入 */}
      {isContainer && (
        <div style={{
          padding: isMobile ? '4px 8px 6px' : '8px 14px 12px',
          borderTop: '1px solid #f3f4f6',
          flexShrink: 0,
        }}>
          <div style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: isMobile ? '4px 8px' : '6px 10px', boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
          }}>
            <ChatInput
              ref={registerInputRef}
              value={panelInput}
              onChange={onInputChange}
              onSend={() => onSend()}
              onSummarize={() => onSend('全部聊天记录，详细总结下')}
              loading={loading}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              images={images}
              onImagesChange={onImagesChange}
              isMobile={isMobile}
              onFocus={handleInputFocus}
            />
          </div>
        </div>
      )}

      {/* 消息节点提示 */}
      {isMessage && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid #f3f4f6',
          flexShrink: 0,
          textAlign: 'center',
          fontSize: 12,
          color: '#9ca3af',
          background: '#fafafa',
        }}>
          消息节点 · 只读（仅展示问题）
        </div>
      )}

      {/* 多选 / 导出工具条（面板底部，固定不随消息滚动） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8, padding: isMobile ? '4px 8px' : '8px 14px', borderTop: '1px solid #e5e7eb', background: '#fafafa', flexShrink: 0 }}>
        <Button size="small" icon={<SelectOutlined />} type={selectMode ? 'primary' : 'default'} onClick={() => setSelectMode((v) => !v)}>
          {selectMode ? '退出多选' : '多选'}
        </Button>
        {(panel?.messages.length ?? 0) > 0 && (
          <Button size="small" icon={<FileTextOutlined />} onClick={() => onSend('全部聊天记录，详细总结下')} disabled={loading}
            style={{ fontSize: 12, height: 24, borderRadius: 4, padding: '0 8px', color: '#6366f1', borderColor: '#c7d2fe', background: '#eef2ff' }}>
            总结
          </Button>
        )}
        {selectMode && (
          <>
            <span style={{ fontSize: 12, color: '#6b7280' }}>已选 {selected.size} 条</span>
            <Button size="small" onClick={() => setSelected(new Set(panel.messages.map((m) => String(m.id))))}>全选本节点</Button>
            <Button size="small" onClick={() => setSelected(new Set())}>取消</Button>
            <Button size="small" type="primary" icon={<FilePdfOutlined />} disabled={selected.size === 0} onClick={handleExportSelected}>
              导出选中
            </Button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<SendOutlined />}
          onClick={() => onSend()}
          disabled={!panelInput.trim() || loading}
          loading={loading}
          style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 12px', height: isMobile ? 34 : 28, fontSize: isMobile ? 14 : 13 }}>
          发送
        </Button>
      </div>

      {/* 导出用打印区：平时隐藏，打印时通过 @media print 仅显示此区域 */}
      {selected.size > 0 && (
        <div className="pdf-print-area">
          <div className="pdf-head">
            <h1 className="pdf-title">{conversationTitle || '对话导出'}</h1>
            <div className="pdf-meta">共 {selected.size} 条消息 · 导出于 {new Date().toLocaleString('zh-CN')}</div>
          </div>
          {allPanels
            .flatMap((p) => p.messages.map((m) => ({ p, m })))
            .filter(({ m }) => selected.has(String(m.id)))
            .map(({ p, m }) => (
              <div key={`${p.id}-${m.id}`} className={`pdf-msg ${m.role === 'user' ? 'pdf-msg--user' : 'pdf-msg--ai'}`}>
                <div className="pdf-msg__role">
                  {m.role === 'user' ? '👤 用户' : '🤖 AI'} · {p.title || '面板'}
                </div>
                <div className="pdf-msg__body">
                  {m.role === 'assistant' ? (
                    <MarkdownRenderer content={m.content} />
                  ) : (
                    <div className="pdf-msg__text">{m.content}</div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
