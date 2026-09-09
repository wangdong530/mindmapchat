import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { Button, Tooltip, Spin } from 'antd'
import { BranchesOutlined, MessageOutlined, ZoomInOutlined, ZoomOutOutlined, CompressOutlined } from '@ant-design/icons'
import type { Panel, NodeLayout } from './types'
import { DEPTH_COLORS } from './types'
import { getDepth } from './utils'

// ======================= MindMapView =======================
interface MindMapViewProps {
  panels: Panel[]
  activePanelId: string | null
  onSelectPanel: (panelId: string) => void
  layout: Map<string, NodeLayout>
  canvasWidth: number
  canvasHeight: number
  panelMap: Map<string, Panel>
  isMindmapFullscreen?: boolean
  isMobile?: boolean
  onFocus?: () => void
  onSummarize: (panelId: string) => void
  // 暴露 fitView 给父组件，用于在调整对话框宽度/添加子节点时自动适配视图
  fitViewRef?: React.MutableRefObject<(() => void) | null>
}

export default function MindMapView({ panels, activePanelId, onSelectPanel, layout, canvasWidth, canvasHeight, panelMap, isMindmapFullscreen, isMobile, onSummarize, fitViewRef }: MindMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const fitView = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const cw = canvasWidth + 120
    const ch = canvasHeight + 120
    const scale = Math.min(el.clientWidth / cw, el.clientHeight / ch)
    const z = Math.max(0.2, Math.min(scale, 1.2))
    setZoom(Number(z.toFixed(2)))
    requestAnimationFrame(() => {
      const el2 = containerRef.current
      if (!el2) return
      el2.scrollTo({
        left: Math.max(0, (cw * z - el2.clientWidth) / 2),
        top: Math.max(0, (ch * z - el2.clientHeight) / 2),
        behavior: 'smooth',
      })
    })
  }, [canvasWidth, canvasHeight])

  const zoomIn = () => setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))))
  const zoomOut = () => setZoom((z) => Math.max(0.2, Number((z - 0.1).toFixed(2))))
  const resetZoom = () => setZoom(1)

  // 平滑居中到指定 panel（来源链路点击跳转）
  const jumpToPanel = useCallback((panelId: string) => {
    const el = containerRef.current
    const pos = layout.get(panelId)
    if (!el || !pos) return
    const z = zoomRef.current
    const targetX = (pos.x + pos.w / 2) * z - el.clientWidth / 2
    const targetY = (pos.y + pos.h / 2) * z - el.clientHeight / 2
    el.scrollTo({ left: targetX, top: targetY, behavior: 'smooth' })
  }, [layout])

  // 把 fitView 暴露给父组件（调整宽度/添加子节点时调用）
  useEffect(() => {
    if (fitViewRef) fitViewRef.current = fitView
  }, [fitView, fitViewRef])

  // 进入全屏时自动适配视图
  useEffect(() => {
    if (isMindmapFullscreen) {
      const t = setTimeout(fitView, 80)
      return () => clearTimeout(t)
    }
  }, [isMindmapFullscreen, fitView])

  // 移动端首次挂载时自动适配视图，避免节点超出屏幕
  useEffect(() => {
    if (isMobile) {
      const t = setTimeout(fitView, 150)
      return () => clearTimeout(t)
    }
  }, [isMobile, fitView])

  // Auto-scroll to active panel (考虑缩放比例)
  useEffect(() => {
    if (!activePanelId || !containerRef.current) return
    const pos = layout.get(activePanelId)
    if (!pos) return
    const el = containerRef.current
    const z = zoomRef.current
    const targetX = (pos.x + pos.w / 2) * z - el.clientWidth / 2
    const targetY = (pos.y + pos.h / 2) * z - el.clientHeight / 2
    el.scrollTo({ left: targetX, top: targetY, behavior: 'smooth' })
  }, [activePanelId, layout])

  // Generate SVG connectors
  const connectors = useMemo(() => {
    const paths: { d: string; color: string; isDerived?: boolean; midX: number; midY: number }[] = []
    for (const panel of panels) {
      if (!panel.parentId) continue
      const parentPos = layout.get(panel.parentId)
      const childPos = layout.get(panel.id)
      if (!parentPos || !childPos) continue

      const x1 = parentPos.x + parentPos.w
      const y1 = parentPos.y + parentPos.h / 2
      const x2 = childPos.x
      const y2 = childPos.y + childPos.h / 2
      const cx = (x1 + x2) / 2
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
      // 仅在「点击追问按钮」场景下显示标签：即 消息节点(message) → 追问容器(container，带 sourceSuggestionIndex)
      // 普通容器里发消息（容器 → 消息节点）不显示，避免误标
      const parentPanel = panels.find((p) => p.id === panel.parentId)
      const isDerived =
        panel.sourceSuggestionIndex !== undefined &&
        panel.type === 'container' &&
        parentPanel?.type === 'message'
      paths.push({ d, color: '#c4b5fd', isDerived, midX: cx, midY: (y1 + y2) / 2 })
    }
    return paths
  }, [panels, layout])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'auto',
        position: 'relative',
        background: '#fafbfc',
        backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div style={{
        position: 'relative',
        width: (canvasWidth + 120) * zoom,
        height: (canvasHeight + 120) * zoom,
        minWidth: '100%',
        minHeight: '100%',
      }}>
        <div style={{
          transform: `scale(${zoom})`,
          transformOrigin: '0 0',
          width: canvasWidth + 120,
          height: canvasHeight + 120,
          position: 'relative',
        }}>
        {/* SVG connectors layer */}
        <svg style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 0,
        }}>
          {connectors.map((path, i) => (
            <g key={i}>
              <path
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.6}
              />
              {path.isDerived && (
                <foreignObject
                  x={path.midX - 22}
                  y={path.midY - 11}
                  width={44}
                  height={22}
                  style={{ pointerEvents: 'none' }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    background: '#ede9fe',
                    color: '#7c3aed',
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 11,
                    border: '1px solid #c4b5fd',
                    boxSizing: 'border-box',
                  }}>追问</div>
                </foreignObject>
              )}
            </g>
          ))}
        </svg>

        {/* Panel nodes */}
        {panels.map((panel) => {
          const pos = layout.get(panel.id)
          if (!pos) return null
          const isActive = panel.id === activePanelId
          const depth = getDepth(panel, panelMap)
          const colors = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]
          const lastMsg = panel.messages[panel.messages.length - 1]
          const isContainer = panel.type === 'container'

          return (
            <div
              key={panel.id}
              onClick={isContainer ? () => onSelectPanel(panel.id) : undefined}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: pos.w,
                height: isContainer ? pos.h : 'auto',
                minHeight: isContainer ? undefined : pos.h,
                padding: isContainer ? '10px 14px' : 0,
                borderRadius: isContainer ? 6 : 0,
                background: isContainer ? (isActive ? colors.bg : '#fff') : 'transparent',
                border: isContainer
                  ? `2px solid ${isActive ? colors.border : '#c4b5fd'}`
                  : 'none',
                boxShadow: isActive && isContainer
                  ? `0 4px 16px ${colors.accent}30`
                  : 'none',
                cursor: isContainer ? 'pointer' : 'default',
                transition: isContainer ? 'all 0.2s ease' : 'none',
                zIndex: isActive ? 2 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: isContainer ? 4 : 0,
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                if (isContainer && !isActive) {
                  e.currentTarget.style.borderColor = colors.border
                  e.currentTarget.style.boxShadow = `0 4px 12px ${colors.accent}20`
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }
              }}
              onMouseLeave={(e) => {
                if (isContainer && !isActive) {
                  e.currentTarget.style.borderColor = '#e5e7eb'
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }
              }}
            >
              {isContainer ? (
                <>
                  {/* Node header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BranchesOutlined style={{ fontSize: 13, color: colors.accent, flexShrink: 0 }} />
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isActive ? colors.text : '#374151',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {panel.title || '新面板'}
                    </span>
                    <span style={{
                      fontSize: 9, color: colors.text,
                      background: colors.bg,
                      padding: '1px 6px', borderRadius: 8, flexShrink: 0, fontWeight: 500,
                    }}>
                      容器
                    </span>
                    {isContainer && (
                      <Tooltip title={panel.summary ? panel.summary : (panel.summaryStatus === 'summarizing' ? '总结中…' : '总结该容器的对话')}>
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onSummarize(panel.id)
                          }}
                          style={{
                            fontSize: 9,
                            flexShrink: 0,
                            cursor: 'pointer',
                            color: panel.summaryStatus === 'summarizing' ? '#9ca3af' : (panel.summary ? '#059669' : colors.accent),
                            border: `1px solid ${panel.summary ? '#a7f3d0' : colors.border}`,
                            background: panel.summary ? '#ecfdf5' : colors.bg,
                            padding: '1px 6px',
                            borderRadius: 8,
                            fontWeight: 500,
                          }}
                        >
                          {panel.summaryStatus === 'summarizing' ? '总结中…' : (panel.summary ? '✓已总结' : '总结')}
                        </span>
                      </Tooltip>
                    )}
                  </div>

                  {/* Message count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MessageOutlined style={{ fontSize: 10, color: '#9ca3af' }} />
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      {panel.messages.length} 条消息
                    </span>
                  </div>

                  {/* Last message preview */}
                  {lastMsg && (
                    <div style={{
                      fontSize: 11,
                      color: '#9ca3af',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}>
                      {lastMsg.role === 'user' ? '👤 ' : '🤖 '}
                      {lastMsg.content.slice(0, 40)}{lastMsg.content.length > 40 ? '...' : ''}
                    </div>
                  )}
                </>
              ) : (
                /* Message node: compact, read-only, size grows with text */
                <div style={{
                  fontSize: 12,
                  color: '#374151',
                  lineHeight: 1.5,
                  padding: '4px 8px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {lastMsg
                    ? (lastMsg.role === 'user' ? '👤 ' : '🤖 ') + (lastMsg.content.length > 30 ? lastMsg.content.slice(0, 30) + '..' : lastMsg.content)
                    : (panel.title.length > 30 ? panel.title.slice(0, 30) + '..' : panel.title)}
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
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12, display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '2px 4px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)', zIndex: 10,
      }}>
        <Tooltip title="缩小">
          <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={zoomOut} style={{ color: '#6366f1' }} />
        </Tooltip>
        <span style={{ fontSize: 12, color: '#6b7280', minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <Tooltip title="放大">
          <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={zoomIn} style={{ color: '#6366f1' }} />
        </Tooltip>
        <Tooltip title="适应视图">
          <Button type="text" size="small" icon={<CompressOutlined />} onClick={fitView} style={{ color: '#9ca3af' }} />
        </Tooltip>
        <Tooltip title="重置 100%">
          <Button type="text" size="small" onClick={resetZoom} style={{ color: '#9ca3af', fontSize: 12 }}>1:1</Button>
        </Tooltip>
      </div>

    </div>
  )
}
