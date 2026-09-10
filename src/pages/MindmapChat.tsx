import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layout,
  Button,
  Input,
  Avatar,
  ColorPicker,
  Tooltip,
  Divider,
  ConfigProvider,
  theme,
  Select,
  Slider,
  Switch,
  Spin,
  message,
  Drawer,
  Modal,
  Popconfirm,
} from 'antd'
import type { InputRef } from 'antd'
import {
  SearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  SendOutlined,
  UserOutlined,
  MessageOutlined,
  LogoutOutlined,
  TeamOutlined,
  MenuOutlined,
  BranchesOutlined,
  PlusOutlined,
  PushpinOutlined,
  PushpinFilled,
  FullscreenOutlined,
  FullscreenExitOutlined,
  EyeOutlined,
  SwapOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  CompressOutlined,
  CopyOutlined,
  ReloadOutlined,
  RedoOutlined,
  FilePdfOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  BorderOutlined,
  SelectOutlined,
  PictureOutlined,
  DeleteOutlined,
  FileTextOutlined,
  BulbOutlined,
  IdcardOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import { ModelConfigModal, loadConfig, type ModelConfig } from '../components/ModelConfigModal'
import SettingsPanel from '../components/SettingsPanel'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { getToken, getUser, logout as doLogout } from './LoginPage'
import { useStore } from '../store/useStore'
import { useResponsive } from '../hooks/useResponsive'
import { logAction, logAuth, logChat, logConversation, logSettings, logModelConfig, logUI, logAdmin } from '../utils/logger'
import { parseSuggestions, fetchFollowUpSuggestions } from '../utils/suggestions'
import type { Message, Panel, Conversation, RoleTemplate } from './mindmap/types'
import { BG_COLORS, suggestionTags } from './mindmap/types'
import { groupConversations, generateId, generateMsgId, authHeaders, apiGet, apiPost, toPanels, buildMessagesPath, computeLayout } from './mindmap/utils'
import MindMapView from './mindmap/MindMapView'
import MessagePanel from './mindmap/MessagePanel'
import ChatInput from './mindmap/ChatInput'

const { Sider, Content } = Layout
let msgSeq = 0

// ======================= Main Component =======================
export default function MindmapChatPage() {
  const navigate = useNavigate()
  const toggleSettings = useStore((s) => s.toggleSettings)
  const { isMobile, isTablet } = useResponsive()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState('MindmapChat')
  const [collapsed, setCollapsed] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileSheetCollapsed, setMobileSheetCollapsed] = useState(false)
  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(false)
  const [convSettingsVisible, setConvSettingsVisible] = useState(false)
  const [settingsConvId, setSettingsConvId] = useState<string | null>(null)
  const [settingsTitle, setSettingsTitle] = useState('')
  const [settingsBackground, setSettingsBackground] = useState('')
  const [settingsConvSystem, setSettingsConvSystem] = useState('')
  const [settingsConvTemperature, setSettingsConvTemperature] = useState<number>(0.3)
  const [settingsConvThinking, setSettingsConvThinking] = useState(false)
  const [settingsConvReasoning, setSettingsConvReasoning] = useState<'high' | 'max' | 'low'>('high')
  const [settingsGroup, setSettingsGroup] = useState('')
  const [settingsGreeting, setSettingsGreeting] = useState('')
  const [settingsProfileEnabled, setSettingsProfileEnabled] = useState(true)
  const [isMindmapVisible, setIsMindmapVisible] = useState(false)

  // 移动端/平板强制关闭思维导图（双重保险，配合 CSS 媒体查询）
  useEffect(() => {
    if (isMobile || isTablet) {
      setIsMindmapVisible(false)
    }
  }, [isMobile, isTablet])

  // 移动端键盘适配：visualViewport 动态设置 Layout 高度
  // - 100dvh 作为兜底；键盘弹出时用 visualViewport.height 精确适配（兼容 iOS Safari）
  // - 仅设置高度，不覆写 position/overflow，避免布局崩溃
  const keyboardOpenRef = useRef(false)
  const layoutRef = useRef<HTMLDivElement>(null)
  // 拖拽星球结束后的冷却时间戳，防止残留 viewport 事件误判为键盘弹出
  const sphereDragCooldownRef = useRef(0)
  // 流式输出时的最后编辑时间，用于会话保存节流
  const lastEditRef = useRef<number>(0)
  useEffect(() => {
    if (!window.visualViewport) return

    const initialHeight = window.innerHeight
    let debounceTimer: ReturnType<typeof setTimeout>

    const handler = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        // 拖拽星球期间跳过
        if (sphereDraggingRef.current) return
        // 拖拽结束后 500ms 冷却期内跳过，防止残留 viewport 变化被误判
        if (Date.now() < sphereDragCooldownRef.current) return
        const vv = window.visualViewport!
        // 仅当视口高度明显变化时才判定为键盘弹出/收起（阈值 80%）
        const isOpen = vv.height < initialHeight * 0.8
        keyboardOpenRef.current = isOpen

        const el = layoutRef.current
        if (el) {
          if (isOpen) {
            // 键盘弹出：Layout 高度 = 可视区域高度（键盘上方剩余空间）
            el.style.height = vv.height + 'px'
          } else {
            // 键盘收起：显式恢复 100dvh
            el.style.height = '100dvh'
          }
        }
      }, 150)
    }

    const vv = window.visualViewport!
    vv.addEventListener('resize', handler)
    vv.addEventListener('scroll', handler)
    return () => {
      clearTimeout(debounceTimer)
      vv.removeEventListener('resize', handler)
      vv.removeEventListener('scroll', handler)
    }
  }, [])

  const [isMindmapFullscreen, setIsMindmapFullscreen] = useState(false)
  const [chatWidth, setChatWidth] = useState(460)
  const splitRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const chatWidthInitRef = useRef(false)
  // 思维导图 fitView 引用：用于在调整对话框宽度/添加子节点时自动适配视图
  const mindmapFitViewRef = useRef<(() => void) | null>(null)
  const triggerFitView = useCallback(() => { mindmapFitViewRef.current?.() }, [])

  // 页面首次进入对话/导图视图时，对话框占 60%、思维导图占 40%
  useEffect(() => {
    if (chatWidthInitRef.current || isMobile) return
    const rect = splitRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0) {
      setChatWidth(Math.round(rect.width * 0.6))
      chatWidthInitRef.current = true
    }
  })

  // 拖拽分隔条调整对话框/思维导图宽度
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current) return
      const rect = splitRef.current.getBoundingClientRect()
      let w = ev.clientX - rect.left
      const min = 320
      const max = rect.width - 320
      w = Math.max(min, Math.min(w, max))
      setChatWidth(w)
      // 调整对话框宽度时实时适配思维导图视图，确保整图可见
      triggerFitView()
    }
    const onUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // 切换对话框/思维导图主导宽度
  const toggleLayout = useCallback(() => {
    const rect = splitRef.current?.getBoundingClientRect()
    const total = rect?.width ?? 1000
    const half = total / 2
    setChatWidth((prev) => (prev < half ? Math.round(total * 0.68) : Math.round(total * 0.32)))
  }, [])

  const [panelInputs, setPanelInputs] = useState<Record<string, string>>({})
  const [panelImages, setPanelImagesRaw] = useState<Record<string, string[]>>({})
  const [panelLoadings, setPanelLoadings] = useState<Record<string, boolean>>({})
  // 追问生成中状态：key = `${messageId}:${suggestionIndex}`，用于追问按钮转圈
  const [derivedLoading, setDerivedLoading] = useState<Record<string, boolean>>({})

  const [modelConfig, setModelConfig] = useState<ModelConfig>(loadConfig)
  const [configModalVisible, setConfigModalVisible] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(!!getUser()?.isAdmin)

  // 角色模板
  const [roleTemplates, setRoleTemplates] = useState<RoleTemplate[]>([])
  const [roleTemplateModalVisible, setRoleTemplateModalVisible] = useState(false)
  const [editingRoleTemplate, setEditingRoleTemplate] = useState<RoleTemplate | null>(null)
  const [rtName, setRtName] = useState('')
  const [rtTitle, setRtTitle] = useState('')
  const [rtBackground, setRtBackground] = useState('')
  const [rtConvSystem, setRtConvSystem] = useState('')
  const [rtConvTemperature, setRtConvTemperature] = useState(0.3)
  const [rtConvThinking, setRtConvThinking] = useState(false)
  const [rtConvReasoning, setRtConvReasoning] = useState('high')
  const [rtGroup, setRtGroup] = useState('')
  const [rtEnabled, setRtEnabled] = useState(true)
  const [rtGreeting, setRtGreeting] = useState('')
  const [rtCreatingConv, setRtCreatingConv] = useState<string | null>(null) // 正在基于角色创建会话的模板 id

  const [welcomeInput, setWelcomeInput] = useState('')
  const [welcomeImages, setWelcomeImages] = useState<string[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)

  // Active panel (selected in mind map)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  // 摘要生成底部通知条（轻量、不抢眼）
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  // 每次显式选择面板时自增，用于强制重新定位滚动（含重复选中同一面板）
  const [panelSelectNonce, setPanelSelectNonce] = useState(0)
  const selectPanel = useCallback((panelId: string) => {
    setActivePanelId(panelId)
    setPanelSelectNonce((n) => n + 1)
  }, [])

  const filteredConversations = searchTerm.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : conversations
  const groupedConversations = useMemo(() => groupConversations(filteredConversations), [filteredConversations])

  // 角色圆圈 —— CSS 3D 球体，鼠标拖拽旋转
  const roleContainerRef = useRef<HTMLDivElement>(null)
  const sphereRef = useRef<HTMLDivElement>(null)
  // 旋转值用 ref 存储，避免 React state 更新导致每帧重渲染
  const rotationXRef = useRef(-15)
  const rotationYRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false) // 仅用于 cursor 样式
  const sphereDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const autoRotateRef = useRef(true)
  const animFrameRef = useRef<number | null>(null)

  // 直接操作 DOM 应用旋转，绕过 React 渲染周期
  const applyRotation = useCallback(() => {
    if (sphereRef.current) {
      sphereRef.current.style.transform = `rotateX(${rotationXRef.current}deg) rotateY(${rotationYRef.current}deg)`
    }
  }, [])

  // Fibonacci 球面分布 + y 压缩：让节点集中在赤道带（中间），两极稀疏
  const spherePositions = useMemo(() => {
    const n = roleTemplates.length
    if (n === 0) return []
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const points: { x: number; y: number; z: number }[] = []
    for (let i = 0; i < n; i++) {
      const yRaw = 1 - (i / (n - 1)) * 2  // -1 ~ 1
      // 幂次压缩：|y|^3.0 让节点强力向赤道(y=0)集中，两极极少
      // 示例: 0.9^3=0.73, 0.5^3=0.125, 0.3^3=0.027, 0.1^3=0.001
      const yCompressed = Math.sign(yRaw) * Math.pow(Math.abs(yRaw), 3.0)
      const radiusAtY = Math.sqrt(1 - yCompressed * yCompressed)
      const theta = i * goldenAngle
      points.push({
        x: Math.cos(theta) * radiusAtY,
        y: yCompressed,
        z: Math.sin(theta) * radiusAtY,
      })
    }
    return points
  }, [roleTemplates.length])

  // 球体半径根据容器大小动态计算，让球尽量铺满屏幕（椭圆球体）
  const getSphereRadius = useCallback(() => {
    const w = roleContainerRef.current?.offsetWidth || window.innerWidth
    const h = roleContainerRef.current?.offsetHeight || window.innerHeight
    // 预留节点尺寸空间（~100px），按可用空间的较大部分计算
    // 宽度方向用更大系数让节点铺满红色框的宽度
    const nodeReserve = 120
    return { radiusX: (w - nodeReserve) * 0.38, radiusY: (h - nodeReserve) * 0.20 }
  }, [])

  const [sphereRadius, setSphereRadius] = useState({ radiusX: 200, radiusY: 200 })

  useEffect(() => {
    const updateRadius = () => setSphereRadius(getSphereRadius())
    updateRadius()
    window.addEventListener('resize', updateRadius)
    return () => window.removeEventListener('resize', updateRadius)
  }, [getSphereRadius])

  // ============ 客户端可调球体参数（倾斜度 / 大小 / 宽度 / 高度） ============
  const [sphereTilt, setSphereTilt] = useState(0)          // 倾斜度（rotateX 初始角度，度）
  const [sphereSizeScale, setSphereSizeScale] = useState(1) // 节点大小缩放
  const [sphereWidthScale, setSphereWidthScale] = useState(0.95) // 球体横向宽度缩放
  const [sphereHeightScale, setSphereHeightScale] = useState(2) // 球体纵向高度缩放
  const [spherePanelOpen, setSpherePanelOpen] = useState(false)

  // 倾斜度变化时，直接写回旋转基准并应用（拖拽时会被覆盖，属正常交互）
  useEffect(() => {
    rotationXRef.current = sphereTilt
    applyRotation()
  }, [sphereTilt, applyRotation])

  // 复制当前球体参数为 JSON 到剪贴板
  const copySphereParams = useCallback(() => {
    const params = {
      tilt: sphereTilt,
      sizeScale: Number(sphereSizeScale.toFixed(2)),
      widthScale: Number(sphereWidthScale.toFixed(2)),
      heightScale: Number(sphereHeightScale.toFixed(2)),
    }
    const text = JSON.stringify(params, null, 2)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => message.success('球体参数已复制到剪贴板'),
        () => message.error('复制失败，请手动复制')
      )
    } else {
      message.error('当前环境不支持剪贴板')
    }
  }, [sphereTilt, sphereSizeScale, sphereWidthScale, sphereHeightScale])

  // 应用宽度/高度缩放后的有效半径
  const effRadiusX = sphereRadius.radiusX * sphereWidthScale
  const effRadiusY = sphereRadius.radiusY * sphereHeightScale

  // 空闲自动旋转（直接操作 DOM，不触发 React 重渲染）
  useEffect(() => {
    // 设置初始旋转位置
    applyRotation()
    let animId: number
    const animate = () => {
      if (autoRotateRef.current && !sphereDraggingRef.current) {
        rotationYRef.current += 0.15
        applyRotation()
      }
      animId = requestAnimationFrame(animate)
    }
    animId = requestAnimationFrame(animate)
    animFrameRef.current = animId
    return () => cancelAnimationFrame(animId)
  }, [applyRotation])

  // 鼠标/触摸拖拽
  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    sphereDraggingRef.current = true
    autoRotateRef.current = false
    setIsDragging(true)
    if ('touches' in e) {
      const t = e.touches[0]
      lastMouseRef.current = { x: t.clientX, y: t.clientY }
    } else {
      lastMouseRef.current = { x: e.clientX, y: e.clientY }
    }
  }, [])

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!sphereDraggingRef.current) return
      let clientX: number, clientY: number
      if ('touches' in e) {
        clientX = e.touches[0].clientX
        clientY = e.touches[0].clientY
      } else {
        clientX = e.clientX
        clientY = e.clientY
      }
      const dx = clientX - lastMouseRef.current.x
      const dy = clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: clientX, y: clientY }
      rotationYRef.current += dx * 0.4
      rotationXRef.current = Math.max(-80, Math.min(80, rotationXRef.current - dy * 0.4))
      applyRotation()
    }
    const handleUp = () => {
      if (sphereDraggingRef.current) {
        sphereDraggingRef.current = false
        // 设置 500ms 冷却期，防止残留 viewport 事件误判
        sphereDragCooldownRef.current = Date.now() + 500
        setIsDragging(false)
        // 松手后 1.5 秒恢复自动旋转
        setTimeout(() => { autoRotateRef.current = true }, 1500)
      }
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove, { passive: true })
    window.addEventListener('touchend', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
    }
  }, [])

  // ======================= Data loading =======================
  useEffect(() => {
    const loadData = async () => {
      try {
        // 加载当前用户信息（含管理员标识）
        const me = await apiGet('/api/me').catch(() => null)
        if (me?.isAdmin !== undefined) setIsAdmin(!!me.isAdmin)

        // 加载全局模型配置（管理员统一配置，全局生效）
        const cfg = await apiGet('/api/config/global')
        if (cfg && cfg.model) {
          setModelConfig({ ...loadConfig(), ...cfg })
        }
        const convList = await apiGet('/api/conversations')
        if (convList.length > 0) {
          const full = await apiGet(`/api/conversations/${convList[0].id}/full`)
          const fullPanels: Panel[] = toPanels(full)
          const fullConvs: Conversation[] = convList.map((c: Record<string, unknown>) => ({
            id: c.id as string,
            title: c.title as string,
            panels: (c.id === convList[0].id) ? fullPanels : [],
            background: (c.background as string) || undefined,
            convSystem: (c.convSystem as string) || undefined,
            convTemperature: (c.convTemperature as number) ?? undefined,
            convThinking: (c.convThinking as boolean) ?? undefined,
            convReasoning: (c.convReasoning as 'high' | 'max' | 'low') || undefined,
            greeting: (c.greeting as string) || undefined,
            group: (c.convGroup as string) || undefined,
            pinned: !!c.pinned,
            roleTemplateId: (c.roleTemplateId as string) || undefined,
          }))
          setConversations(fullConvs)
          if (isMobile) setMobileSheetCollapsed(true)

          // Init msgSeq
          if (fullPanels.length > 0) {
            let maxId = 0
            for (const p of fullPanels) {
              for (const m of p.messages) {
                if (m.id > maxId) maxId = m.id
              }
            }
            msgSeq = maxId
          }
        }
      } catch (err) {
        console.warn('加载数据失败，使用本地模式:', err)
      }

      // 加载角色模板（所有用户可见）
      try {
        const templates = await apiGet('/api/role-templates')
        if (Array.isArray(templates)) {
          setRoleTemplates(templates)
        }
      } catch {
        // 静默失败
      }

      setDataLoaded(true)
    }
    loadData()
  }, [])

  // ===================== 会话持久化（防抖保存，无轮询/版本/锁） =====================
  const activeIdRef = useRef<string | null>(activeId)
  const panelLoadingsRef = useRef<Record<string, boolean>>(panelLoadings)
  const syncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => { activeIdRef.current = activeId; console.log('[LOG] Mindmap activeIdRef 更新为', activeId) }, [activeId])
  useEffect(() => { panelLoadingsRef.current = panelLoadings }, [panelLoadings])

  // 惰性同步：延迟保存会话到数据库（仅持久化，不做远程拉取/版本比对/抢锁）
  const scheduleSync = useCallback((conv: Conversation) => {
    const existing = syncTimersRef.current.get(conv.id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      syncTimersRef.current.delete(conv.id)
      apiPost(`/api/conversations/${conv.id}/sync`, {
        title: conv.title,
        panels: conv.panels.map((p) => ({
          id: p.id, type: p.type, parentId: p.parentId, title: p.title,
          sourceMessageId: p.sourceMessageId, sourceSuggestionIndex: p.sourceSuggestionIndex,
          summary: p.summary, summaryMsgCount: p.summaryMsgCount,
          messages: p.messages.map((m) => ({
            id: m.id, panelId: p.id, role: m.role, content: m.content,
            parentMessageId: m.parentMessageId, suggestions: m.suggestions, reasoning: m.reasoning,
            images: m.images,
          })),
        })),
      }).catch(() => {
        // 静默失败 - 下次同步时重试
      })
    }, 2000)
    syncTimersRef.current.set(conv.id, timer)
  }, [])

  useEffect(() => () => {
    syncTimersRef.current.forEach((timer) => clearTimeout(timer))
    syncTimersRef.current.clear()
  }, [])

  // Sync to database
  useEffect(() => {
    if (!dataLoaded) return
    const conv = conversations.find((c) => c.id === activeId)
    if (conv && conv.panels.some((p) => p.messages.length > 0)) {
      scheduleSync(conv)
    }
  }, [conversations, activeId, dataLoaded, scheduleSync])

  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const welcomeInputRef = useRef<HTMLTextAreaElement>(null)

  const conversationsRef = useRef(conversations)
  const modelConfigRef = useRef(modelConfig)
  useEffect(() => {
    conversationsRef.current = conversations
    modelConfigRef.current = modelConfig
  }, [conversations, modelConfig])

  const registerInputRef = useCallback((panelId: string) => (el: HTMLTextAreaElement | null) => {
    inputRefs.current[panelId] = el
  }, [])

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const handleNewConversation = useCallback(() => {
    const panelId = generateId()
    const newConvId = generateId()
    const newConv: Conversation = {
      id: newConvId,
      title: '新角色',
      panels: [{ id: panelId, type: 'container', title: '新角色', parentId: null, messages: [], childrenIds: [] }],
    }
    setConversations((prev) => [newConv, ...prev])
    setActiveId(newConvId)
    setActivePanelId(panelId)
    setPanelInputs({ [panelId]: '' })
    apiPost('/api/conversations', { id: newConvId, title: '新角色', panels: [] }).catch((err) => {
      message.error('创建对话失败: ' + (err instanceof Error ? err.message : '未知错误'))
    })
    if (isMobile) setMobileSheetCollapsed(true)
    logConversation('create_conversation', { convId: newConvId, title: '新角色' })
  }, [])

  const getPanelInput = (panelId: string) => panelInputs[panelId] ?? ''
  const setPanelInput = (panelId: string, value: string) =>
    setPanelInputs((prev) => ({ ...prev, [panelId]: value }))

  // ======================= 角色模板操作 =======================

  // 基于角色模板获取或创建唯一会话
  const handleRoleTemplateClick = useCallback(async (tpl: RoleTemplate) => {
    setRtCreatingConv(tpl.id)
    try {
      const requestedConvId = generateId()
      const requestedPanelId = generateId()
      const res = await apiPost('/api/conversations/from-role-template', {
        templateId: tpl.id,
        convId: requestedConvId,
        panelId: requestedPanelId,
      })
      const convId = (res?.convId as string) || requestedConvId

      // 当前页面已经加载过该会话时直接切换，保留尚未完成同步的本地输入与消息。
      const localConversation = conversationsRef.current.find((conv) => conv.id === convId)
      if (!res?.created && localConversation?.panels.length) {
        const rootPanel = localConversation.panels.find((panel) => panel.parentId === null) || localConversation.panels[0]
        setConversations((prev) => prev.map((conv) => conv.id === convId ? {
          ...conv,
          title: tpl.name,
          panels: conv.panels.map((panel) => panel.parentId === null ? { ...panel, title: tpl.name } : panel),
        } : conv))
        setActiveId(convId)
        if (rootPanel) setActivePanelId(rootPanel.id)
        if (isMobile) setMobileSheetCollapsed(true)
        logConversation('open_conversation_from_role_template', { convId, templateId: tpl.id, templateName: tpl.name, source: 'local' })
        return
      }

      if (!res?.created) {
        const full = await apiGet(`/api/conversations/${convId}/full`)
        let panels = toPanels(full)
        if (panels.length === 0) {
          const fallbackPanelId = generateId()
          await apiPost('/api/panels', {
            id: fallbackPanelId,
            conversationId: convId,
            parentId: null,
            title: tpl.name,
            type: 'container',
          })
          panels = [{
            id: fallbackPanelId,
            type: 'container',
            title: tpl.name,
            parentId: null,
            messages: [],
            childrenIds: [],
          }]
        }

        const loadedConversation: Conversation = {
          id: convId,
          title: tpl.name,
          panels: panels.map((panel) => panel.parentId === null ? { ...panel, title: tpl.name } : panel),
          background: full.background || undefined,
          convSystem: full.convSystem || undefined,
          convTemperature: full.convTemperature ?? undefined,
          convThinking: full.convThinking ?? undefined,
          convReasoning: full.convReasoning || undefined,
          greeting: full.greeting || undefined,
          group: localConversation?.group || tpl.convGroup,
          pinned: localConversation?.pinned,
          roleTemplateId: full.roleTemplateId || tpl.id,
        }
        setConversations((prev) => {
          const exists = prev.some((conv) => conv.id === convId)
          return exists
            ? prev.map((conv) => conv.id === convId ? { ...conv, ...loadedConversation } : conv)
            : [loadedConversation, ...prev]
        })
        setActiveId(convId)
        const rootPanel = panels.find((panel) => panel.parentId === null) || panels[0]
        if (rootPanel) {
          setActivePanelId(rootPanel.id)
          setPanelInputs((prev) => ({ ...prev, [rootPanel.id]: prev[rootPanel.id] ?? '' }))
        }
        if (isMobile) setMobileSheetCollapsed(true)
        logConversation('open_conversation_from_role_template', {
          convId,
          templateId: tpl.id,
          templateName: tpl.name,
          adopted: !!res?.adopted,
          source: 'server',
        })
        return
      }

      const panelId = (res?.panelId as string) || requestedPanelId
      const greetingText = res?.template?.greeting || tpl.greeting
      const greetingMessage: Message | null = greetingText ? {
        id: ++msgSeq,
        role: 'assistant',
        content: greetingText,
      } : null
      const newConv: Conversation = {
        id: convId,
        title: tpl.name,
        panels: [{ id: panelId, type: 'container', title: tpl.name, parentId: null, messages: greetingMessage ? [greetingMessage] : [], childrenIds: [] }],
        background: tpl.background || undefined,
        convSystem: res?.template?.convSystem || tpl.convSystem,
        convTemperature: res?.template?.convTemperature ?? tpl.convTemperature,
        convThinking: res?.template?.convThinking ?? tpl.convThinking,
        convReasoning: res?.template?.convReasoning || tpl.convReasoning,
        group: res?.template?.group || tpl.convGroup,
        greeting: greetingText || undefined,
        roleTemplateId: tpl.id,
      }
      // 双击或多窗口响应乱序时按 convId 合并，前端列表也不产生重复项。
      setConversations((prev) => prev.some((conv) => conv.id === convId)
        ? prev.map((conv) => conv.id === convId ? { ...conv, ...newConv } : conv)
        : [newConv, ...prev])
      setActiveId(convId)
      setActivePanelId(panelId)
      setPanelInputs({ [panelId]: '' })
      if (isMobile) setMobileSheetCollapsed(true)
      logConversation('create_conversation_from_role_template', { convId, templateId: tpl.id, templateName: tpl.name })
    } catch (err) {
      message.error('进入角色失败: ' + (err instanceof Error ? err.message : '未知错误'))
    } finally {
      setRtCreatingConv(null)
    }
  }, [isMobile])

  // 刷新角色模板列表
  const refreshRoleTemplates = useCallback(async () => {
    try {
      const templates = isAdmin
        ? await apiGet('/api/role-templates/all')
        : await apiGet('/api/role-templates')
      if (Array.isArray(templates)) {
        setRoleTemplates(templates)
      }
    } catch {
      // 静默失败
    }
  }, [isAdmin])

  // 打开角色模板编辑弹窗
  const openRoleTemplateModal = useCallback((tpl?: RoleTemplate) => {
    if (tpl) {
      setEditingRoleTemplate(tpl)
      setRtName(tpl.name || '')
      setRtTitle(tpl.title || '')
      setRtBackground(tpl.background || '')
      setRtConvSystem(tpl.convSystem || '')
      setRtConvTemperature(tpl.convTemperature ?? 0.3)
      setRtConvThinking(tpl.convThinking ?? false)
      setRtConvReasoning(tpl.convReasoning || 'high')
      setRtGroup(tpl.convGroup || '')
      setRtEnabled(tpl.isEnabled ?? true)
      setRtGreeting(tpl.greeting || '')
    } else {
      setEditingRoleTemplate(null)
      setRtName('')
      setRtTitle('')
      setRtBackground('')
      setRtConvSystem('')
      setRtConvTemperature(0.3)
      setRtConvThinking(false)
      setRtConvReasoning('high')
      setRtGroup('')
      setRtEnabled(true)
      setRtGreeting('')
    }
    setRoleTemplateModalVisible(true)
  }, [])

  // 保存角色模板
  const saveRoleTemplate = useCallback(async () => {
    const name = rtName.trim()
    if (!name) {
      message.error('请输入角色名称')
      return
    }
    try {
      if (editingRoleTemplate) {
        await fetch(`/api/role-templates/${editingRoleTemplate.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            name, title: rtTitle.trim() || name,
            background: rtBackground, convSystem: rtConvSystem, convTemperature: rtConvTemperature,
            convThinking: rtConvThinking, convReasoning: rtConvReasoning,
            group: rtGroup, isEnabled: rtEnabled, greeting: rtGreeting,
          }),
        })
        message.success('角色模板已更新')
      } else {
        const id = generateId()
        await fetch('/api/role-templates', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            id, name, title: rtTitle.trim() || name,
            background: rtBackground, convSystem: rtConvSystem, convTemperature: rtConvTemperature,
            convThinking: rtConvThinking, convReasoning: rtConvReasoning,
            group: rtGroup, isEnabled: rtEnabled, greeting: rtGreeting,
          }),
        })
        message.success('角色模板已创建')
      }
      setRoleTemplateModalVisible(false)
      refreshRoleTemplates()
    } catch (err) {
      message.error('保存失败: ' + (err instanceof Error ? err.message : '未知错误'))
    }
  }, [editingRoleTemplate, rtName, rtTitle, rtBackground, rtConvSystem, rtConvTemperature, rtConvThinking, rtConvReasoning, rtGroup, rtEnabled, rtGreeting, refreshRoleTemplates])

  // 删除角色模板
  const deleteRoleTemplateHandler = useCallback(async (id: string) => {
    try {
      await fetch(`/api/role-templates/${id}`, { method: 'DELETE', headers: authHeaders() })
      message.success('已删除')
      refreshRoleTemplates()
    } catch (err) {
      message.error('删除失败: ' + (err instanceof Error ? err.message : '未知错误'))
    }
  }, [refreshRoleTemplates])
  const getPanelImages = (panelId: string) => panelImages[panelId] ?? []
  const setPanelImages = (panelId: string, images: string[]) =>
    setPanelImagesRaw((prev) => ({ ...prev, [panelId]: images }))
  const addPanelImage = (panelId: string, imageUrl: string) =>
    setPanelImagesRaw((prev) => ({ ...prev, [panelId]: [...(prev[panelId] ?? []), imageUrl] }))
  const removePanelImage = (panelId: string, index: number) =>
    setPanelImagesRaw((prev) => ({ ...prev, [panelId]: (prev[panelId] ?? []).filter((_, i) => i !== index) }))
  const getPanelLoading = (panelId: string) => panelLoadings[panelId] ?? false
  const setPanelLoading = (panelId: string, value: boolean) =>
    setPanelLoadings((prev) => ({ ...prev, [panelId]: value }))

  // ======================= handlePanelSend =======================
  // ======================= runChatStream =======================
  // 核心流式调用：负责 fetch + 流式填充 + 解析建议 + 状态置位。
  // 调用方需先确保空 AI 消息(aiMsgId)已写入 state，并在 catch 中处理错误替换。
  const runChatStream = useCallback(async (opts: {
    panelId: string
    aiMsgId: number
    userMsgId: number
    apiMessages: { role: string; content: string }[]
  }) => {
    const mc = modelConfigRef.current
    // 会话级配置优先于全局配置；留空/未设置则回退全局
    const conv = conversationsRef.current.find((c) => c.id === activeId) ?? null
    const effSystem = (conv?.convSystem && conv.convSystem.trim()) ? conv.convSystem.trim() : mc.system
    const effTemperature = conv?.convTemperature != null ? conv.convTemperature : mc.temperature
    const effThinking = conv?.convThinking != null ? conv.convThinking : mc.enableThinking
    const effReasoning = conv?.convReasoning ? conv.convReasoning : mc.reasoningEffort

    const SUGGESTION_PROMPT = '在每次回复的最后，根据AI回复的内容，生成针对该内容 1-5 条后续追问。注意：追问要站在用户的角度。以【追问】标记开头，严格按以下格式输出（标记与追问之间换行，每行一条）：\n【追问】\n1. 追问问题一\n2. 追问问题二\n3. 追问问题三\n4. 追问问题四\n5. 追问问题五'
    const systemParts = [SUGGESTION_PROMPT]
    if (effSystem && effSystem.trim()) systemParts.unshift(effSystem.trim())
    const systemContent = systemParts.join('\n\n')
    const finalMessages = [
      { role: 'system', content: systemContent },
      ...opts.apiMessages,
    ]
    if (opts.apiMessages.length === 0) throw new Error('消息链为空')
    if (opts.apiMessages[opts.apiMessages.length - 1].role !== 'user') {
      throw new Error('最后一条消息必须是用户消息')
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        messages: finalMessages,
        convId: activeId,
        stream: mc.stream,
        provider: mc.provider,
        apiKey: mc.apiKey,
        region: mc.region,
        workspaceId: mc.workspaceId,
        baseUrl: mc.baseUrl,
        model: mc.model,
        temperature: effTemperature,
        enableSearch: mc.enableSearch,
        enableThinking: effThinking,
        reasoningEffort: effReasoning,
      }),
    })

    if (!response.ok) {
      let errMsg = 'API 请求失败: ' + response.status
      try { const errBody = await response.json(); errMsg = errBody.error || errMsg } catch { /* */ }
      // 区分认证层 401（登录过期）和上游 AI 服务返回的 401（API Key 问题）
      if (response.status === 401) {
        if (errMsg.includes('登录') || errMsg.includes('未登录')) {
          message.error('登录已过期，请刷新页面后重新登录')
        } else {
          message.error('请求失败：' + errMsg + '（可能是 API Key 无效或已过期）')
        }
      }
      throw new Error(errMsg)
    }

    let aiContent = ''
    let aiReasoning = ''

    const updateStreamingMessage = (content: string, reasoning: string) => {
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv
          return {
            ...conv,
            panels: conv.panels.map((p) =>
              p.id !== opts.panelId ? p : {
                ...p,
                messages: p.messages.map((m) =>
                  m.id === opts.aiMsgId
                    ? { ...m, content, reasoning: reasoning || undefined }
                    : m
                ),
              }
            ),
          }
        })
      )
    }

    const contentType = response.headers.get('content-type') || ''
    const isEventStream = mc.stream && contentType.includes('text/event-stream')
    if (!isEventStream) {
      const json = await response.json()
      aiContent = json?.choices?.[0]?.message?.content || json?.content || ''
      aiReasoning = json?.choices?.[0]?.message?.reasoning_content || ''
      updateStreamingMessage(aiContent, aiReasoning)
    } else {
      if (!response.body) throw new Error('模型响应为空')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const consumeLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content
          if (reasoningDelta) aiReasoning += reasoningDelta
          if (delta) aiContent += delta
          if (delta || reasoningDelta) updateStreamingMessage(aiContent, aiReasoning)
        } catch { /* 忽略不完整或非 JSON 的 SSE 行 */ }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        lastEditRef.current = Date.now()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        lines.forEach(consumeLine)
      }
      buffer += decoder.decode()
      if (buffer.trim()) consumeLine(buffer)
    }

    // 解析追问块（健壮解析，兼容多种列表格式）
    const parsed = parseSuggestions(aiContent)
    let displayContent = parsed.displayContent
    let suggestions = parsed.suggestions
    // 兜底：未解析到追问时，发起一次轻量请求补生成
    if (!suggestions || suggestions.length === 0) {
      try {
        const ctx = [...opts.apiMessages, { role: 'assistant', content: displayContent }]
        const fb = await fetchFollowUpSuggestions(ctx, mc, authHeaders())
        if (fb && fb.length) suggestions = fb
      } catch { /* 追问非关键，忽略失败 */ }
    }

    const finalAiMsg: Message = {
      id: opts.aiMsgId, role: 'assistant', content: displayContent, suggestions, parentMessageId: opts.userMsgId,
      reasoning: aiReasoning || undefined,
    }

    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== activeId) return conv
        return {
          ...conv,
          panels: conv.panels.map((p) =>
            // AI 输出完成 → 容器状态置为 2（已完成）
            p.id !== opts.panelId ? p : {
              ...p,
              status: 2 as const,
              messages: p.messages.map((m) =>
                m.id === opts.aiMsgId ? finalAiMsg : m
              ),
            }
          ),
        }
      })
    )
  }, [activeId])

  const handlePanelSend = useCallback(
    async (panelId: string, text?: string, parentMessageId?: number) => {
      const inputVal = text ?? getPanelInput(panelId)
      const msgText = inputVal.trim()
      const sentImages = getPanelImages(panelId)
      if ((!msgText && sentImages.length === 0) || getPanelLoading(panelId)) return
      if (!activeId) return

      logChat('send_message', { panelId, convId: activeId, contentLength: msgText.length, parentMessageId, imageCount: sentImages.length })
      console.log('%c[LOG] Mindmap handlePanelSend 触发 | panelId=', 'color:#1890ff', panelId, '| activeId=', activeId, '| text=', JSON.stringify(msgText), '| images=', sentImages.length)

      const currentConv = conversationsRef.current.find((c) => c.id === activeId)
      const currentPanel = currentConv?.panels.find((p) => p.id === panelId)
      // 只有容器节点可以输入消息；消息节点不可输入
      if (!currentPanel || currentPanel.type !== 'container') return

      const targetPanelId = panelId  // 焦点始终停留在容器节点上

      setPanelInput(targetPanelId, '')
      setPanelImages(targetPanelId, [])

      // 直接发消息时，把 parentMessageId 指向上一条 assistant 回复，使消息堆栈链连续；
      // 追问场景则使用传入的 parentMessageId（源 assistant 消息）
      const lastAssistantId = [...(currentPanel?.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant')?.id
      const userMsgId = generateMsgId()
      const userMsg: Message = {
        id: userMsgId,
        role: 'user',
        content: msgText,
        parentMessageId: parentMessageId ?? lastAssistantId,
        images: sentImages.length > 0 ? sentImages : undefined,
      }

      // 在容器节点输入消息 → 创建消息子节点（只存 Q），焦点不切换
      const msgNodeId = generateId()
      const msgNode: Panel = {
        id: msgNodeId,
        type: 'message',
        title: msgText ? (msgText.length > 20 ? msgText.slice(0, 20) + '...' : msgText) : '[图片]',
        parentId: panelId,
        messages: [userMsg],
        childrenIds: [],
        sourceMessageId: userMsgId,
      }

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv
          return {
            ...conv,
            title: conv.title,
            panels: conv.panels.map((p) =>
              p.id === panelId
                ? { ...p, messages: [...p.messages, userMsg], childrenIds: [...p.childrenIds, msgNodeId] }
                : p,
            ).concat(msgNode),
          }
        })
      )

      setPanelLoading(targetPanelId, true)
      if (isMobile) setMobileSheetCollapsed(false)
      // 新增消息子节点会改变布局，自动适配视图确保整图可见
      setTimeout(triggerFitView, 200)
      const aiMsgId = generateMsgId()

      const emptyAiMsg: Message = { id: aiMsgId, role: 'assistant', content: '', parentMessageId: userMsgId }

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv
          return {
            ...conv,
            panels: conv.panels.map((p) =>
              // 容器开始接收 AI 输出 → 状态置为 1（正在思考）
              p.id !== targetPanelId ? p : { ...p, status: 1 as const, messages: [...p.messages, emptyAiMsg] }
            ),
          }
        })
      )

      try {
        const liveConv = conversationsRef.current.find((c) => c.id === activeId)
        if (!liveConv) throw new Error('未找到当前会话')

        // 构建包含新消息子节点的模拟对话，用于 buildMessagesPath
        const simulatedConv: Conversation = {
          ...liveConv,
          panels: liveConv.panels.map((p) =>
            p.id === panelId
              ? { ...p, messages: [...p.messages, userMsg], childrenIds: [...p.childrenIds, msgNodeId] }
              : p,
          ).concat(msgNode),
        }
        const pathMsgs = buildMessagesPath(simulatedConv, targetPanelId)
        const apiMessages = pathMsgs
          .filter((m) => m.content.trim() || (m.images && m.images.length > 0))
          .map((m) => {
            const entry: any = { role: m.role, content: m.content }
            if (m.images && m.images.length > 0) entry.images = m.images
            return entry
          })

        await runChatStream({ panelId: targetPanelId, aiMsgId, userMsgId, apiMessages })
      } catch (err) {
        const errorMsg: Message = {
          id: aiMsgId, role: 'assistant',
          content: '抱歉，请求失败：' + (err instanceof Error ? err.message : '未知错误'),
          parentMessageId: userMsgId,
        }
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== activeId) return conv
            return {
              ...conv,
              panels: conv.panels.map((p) =>
                // 出错也视为思考结束 → 容器状态置为 2
                p.id !== targetPanelId ? p : {
                  ...p,
                  status: 2 as const,
                  messages: p.messages.map((m) =>
                    m.id === aiMsgId ? errorMsg : m
                  ),
                }
              ),
            }
          })
        )
      }

      setPanelLoading(targetPanelId, false)

      // 追问子容器回复完成 → 清除对应的"生成中"转圈状态
      const donePanel = conversationsRef.current
        .find((c) => c.id === activeId)
        ?.panels.find((p) => p.id === targetPanelId)
      if (donePanel?.sourceMessageId != null && donePanel?.sourceSuggestionIndex != null) {
        const dk = `${donePanel.sourceMessageId}:${donePanel.sourceSuggestionIndex}`
        setDerivedLoading((prev) => {
          if (!prev[dk]) return prev
          const np = { ...prev }
          delete np[dk]
          return np
        })
      }
    },
    [activeId, getPanelInput, getPanelLoading, isMobile, triggerFitView, runChatStream],
  )

  // 摘要生成通知：同时打印到控制台；autohide 时短暂显示后自动消失
  const showSummaryNotice = useCallback((text: string, autohide = false) => {
    console.log('[摘要] ' + text)
    setSummaryNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    if (autohide) {
      noticeTimer.current = setTimeout(() => setSummaryNotice(null), 2600)
    }
  }, [])

  // ======================= 容器节点总结 =======================
  // 总结单个容器：自身消息 + 已总结的子分支摘要 -> 后台调大模型 -> 落库
  const summarizePanel = useCallback(
    async (panelId: string) => {
      const conv = conversationsRef.current.find((c) => c.id === activeId)
      const panel = conv?.panels.find((p) => p.id === panelId)
      if (!panel || panel.type !== 'container' || panel.messages.length === 0) return
      const nodeTitle = panel.title || '新面板'
      showSummaryNotice(`「${nodeTitle}」节点自动生成摘要…`)
      const mc = modelConfigRef.current

      const ownText = panel.messages
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
        .join('\n')
      const childSummaries = (panel.childrenIds || [])
        .map((cid) => conv?.panels.find((p) => p.id === cid)?.summary)
        .filter((s): s is string => !!s)
      const parts: string[] = []
      if (childSummaries.length) parts.push('## 子分支摘要\n' + childSummaries.join('\n---\n'))
      parts.push('## 本分支对话\n' + ownText)
      const text = parts.join('\n\n')

      setConversations((prev) =>
        prev.map((c) =>
          c.id !== activeId
            ? c
            : { ...c, panels: c.panels.map((p) => (p.id === panelId ? { ...p, summaryStatus: 'summarizing' } : p)) },
        ),
      )

      try {
        const data = await apiPost(`/api/panels/${panelId}/summarize`, {
          text,
          msgCount: panel.messages.length,
          provider: mc.provider,
          apiKey: mc.apiKey,
          region: mc.region,
          workspaceId: mc.workspaceId,
          baseUrl: mc.baseUrl,
          model: mc.model,
          temperature: mc.temperature,
        })
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== activeId
              ? c
              : {
                  ...c,
                  panels: c.panels.map((p) =>
                    p.id === panelId
                      ? { ...p, summary: data.summary, summaryMsgCount: data.msgCount, summaryStatus: 'done' }
                      : p,
                  ),
                },
          ),
        )
        showSummaryNotice(`「${nodeTitle}」摘要已生成`, true)
      } catch (e) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== activeId
              ? c
              : { ...c, panels: c.panels.map((p) => (p.id === panelId ? { ...p, summaryStatus: 'idle' } : p)) },
          ),
        )
        showSummaryNotice(`「${nodeTitle}」摘要生成失败`, true)
        message.error('总结失败: ' + (e instanceof Error ? e.message : '未知错误'))
      }
    },
    [activeId],
  )

  // 自动总结：后序 DFS（先子容器后父容器，root 最后），父容器吸收子容器摘要
  const summarizingRef = useRef(false)
  const runAutoSummarize = useCallback(async () => {
    if (summarizingRef.current) return
    const conv = conversationsRef.current.find((c) => c.id === activeId)
    if (!conv) return
    const map = new Map(conv.panels.map((p) => [p.id, p]))
    const order: string[] = []
    const visit = (pid: string) => {
      const p = map.get(pid)
      if (!p || p.type !== 'container') return
      for (const cId of p.childrenIds || []) visit(cId)
      order.push(pid)
    }
    for (const p of conv.panels) if (p.parentId === null) visit(p.id)

    summarizingRef.current = true
    try {
      for (const pid of order) {
        if (pid === activePanelId) continue // 正在输入的容器不自动总结
        const p = map.get(pid)
        if (!p || p.messages.length === 0) continue
        const covered = p.summaryMsgCount ?? 0
        if (p.summary && covered >= p.messages.length) continue // 已是最新
        await summarizePanel(pid)
      }
    } finally {
      summarizingRef.current = false
    }
  }, [activeId, activePanelId, summarizePanel])

  // 触发策略：定时轮询（每 5 分钟）+ 消息数阈值（>=40 条）两者结合
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => {
      runAutoSummarize()
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [activeId, runAutoSummarize])

  useEffect(() => {
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv) return
    const total = conv.panels.reduce((s, p) => s + p.messages.length, 0)
    if (total >= 40) runAutoSummarize()
  }, [conversations, activeId, runAutoSummarize])

  // ======================= handleRegenerate / handleResend =======================
  // 重新生成：对已有 AI 回复，基于同一条用户消息重新调用模型并替换
  const handleRegenerate = useCallback(
    async (panelId: string, userMsgId: number) => {
      const currentConv = conversationsRef.current.find((c) => c.id === activeId)
      const currentPanel = currentConv?.panels.find((p) => p.id === panelId)
      if (!currentPanel || currentPanel.type !== 'container') return
      if (getPanelLoading(panelId)) return

      logChat('regenerate', { panelId, userMsgId, convId: activeId })

      const userMsg = currentPanel.messages.find((m) => m.id === userMsgId)
      if (!userMsg || userMsg.role !== 'user') return
      // 定位对应的旧 AI 回复（取最后一条 parentMessageId === userMsgId 的 assistant 消息）
      const oldAiMsg = [...currentPanel.messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.parentMessageId === userMsgId)
      if (!oldAiMsg) return

      const aiMsgId = generateMsgId()
      const emptyAiMsg: Message = { id: aiMsgId, role: 'assistant', content: '', parentMessageId: userMsgId }

      // 用新的空 AI 消息替换旧的，容器置为思考中
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv
          return {
            ...conv,
            panels: conv.panels.map((p) =>
              p.id !== panelId ? p : {
                ...p,
                status: 1 as const,
                messages: p.messages.map((m) => (m.id === oldAiMsg.id ? emptyAiMsg : m)),
              }
            ),
          }
        })
      )
      setPanelLoading(panelId, true)
      if (isMobile) setMobileSheetCollapsed(false)

      try {
        const liveConv = conversationsRef.current.find((c) => c.id === activeId)
        if (!liveConv) throw new Error('未找到当前会话')
        // 构建上下文：剔除旧 AI 回复，仅保留到该用户消息为止
        const simulatedConv: Conversation = {
          ...liveConv,
          panels: liveConv.panels.map((p) =>
            p.id === panelId
              ? { ...p, messages: p.messages.filter((m) => m.id !== oldAiMsg.id) }
              : p,
          ),
        }
        const pathMsgs = buildMessagesPath(simulatedConv, panelId)
        const apiMessages = pathMsgs
          .filter((m) => m.content.trim() || (m.images && m.images.length > 0))
          .map((m) => {
            const entry: any = { role: m.role, content: m.content }
            if (m.images && m.images.length > 0) entry.images = m.images
            return entry
          })

        await runChatStream({ panelId, aiMsgId, userMsgId, apiMessages })
      } catch (err) {
        const errorMsg: Message = {
          id: aiMsgId, role: 'assistant',
          content: '抱歉，请求失败：' + (err instanceof Error ? err.message : '未知错误'),
          parentMessageId: userMsgId,
        }
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== activeId) return conv
            return {
              ...conv,
              panels: conv.panels.map((p) =>
                p.id !== panelId ? p : {
                  ...p,
                  status: 2 as const,
                  messages: p.messages.map((m) =>
                    m.id === aiMsgId ? errorMsg : m
                  ),
                }
              ),
            }
          })
        )
      }

      setPanelLoading(panelId, false)
    },
    [activeId, getPanelLoading, isMobile, runChatStream],
  )

  // 重新发送：把已有用户消息的原文重新提交到所属容器
  const handleResend = useCallback(
    (panelId: string, userMsgId: number) => {
      const currentConv = conversationsRef.current.find((c) => c.id === activeId)
      const currentPanel = currentConv?.panels.find((p) => p.id === panelId)
      if (!currentPanel || currentPanel.type !== 'container') return
      const userMsg = currentPanel.messages.find((m) => m.id === userMsgId)
      if (!userMsg || userMsg.role !== 'user') return
      logChat('resend', { panelId, userMsgId, convId: activeId })
      handlePanelSend(panelId, userMsg.content)
    },
    [activeId, handlePanelSend],
  )

  // ======================= handleDerivedClick =======================
  // 在容器节点对 A 的追问 → 立即创建子容器节点并发送（不直接打开派生的容器）
  const handleDerivedClick = useCallback(
    (panelId: string, messageId: number, suggestion: string, suggestionIndex: number) => {
      const currentConv = conversationsRef.current.find((c) => c.id === activeId)
      const containerPanel = currentConv?.panels.find((p) => p.id === panelId)
      if (!containerPanel) return

      logChat('derived_click', { panelId, messageId, suggestionIndex, suggestion: suggestion.substring(0, 50), convId: activeId })

      // 找到该 assistant 消息对应的 user Q 消息
      const msgs = containerPanel.messages
      const aiIdx = msgs.findIndex((m) => m.id === messageId)
      const userQ = aiIdx > 0 ? msgs[aiIdx - 1] : undefined

      // 找到对应的消息节点（sourceMessageId === userQ.id）
      const msgNode = currentConv?.panels.find(
        (p) => p.parentId === panelId && p.type === 'message' && p.sourceMessageId === userQ?.id,
      )

      // 在 functional update 内基于最新 state 判断是否已派生，避免并发点击 / ref 滞后导致重复创建
      let createdPanelId: string | null = null
      let isNew = false
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv
          const existed = conv.panels.find(
            (p) => p.sourceMessageId === messageId && p.sourceSuggestionIndex === suggestionIndex,
          )
          if (existed) {
            createdPanelId = existed.id
            return conv
          }
          const newPanel: Panel = {
            id: generateId(),
            type: 'container',
            title: suggestion.length > 20 ? suggestion.slice(0, 20) + '...' : suggestion,
            parentId: msgNode ? msgNode.id : panelId,
            messages: [],
            childrenIds: [],
            sourceMessageId: messageId,
            sourceSuggestionIndex: suggestionIndex,
            // 点击追问 → 子容器状态为 1（正在思考）
            status: 1,
          }
          createdPanelId = newPanel.id
          isNew = true
          return {
            ...conv,
            panels: conv.panels.map((p) =>
              p.id === (msgNode ? msgNode.id : panelId)
                ? { ...p, childrenIds: [...p.childrenIds, newPanel.id] }
                : p,
            ).concat(newPanel),
          }
        }),
      )

      // 已派生：直接打开对应容器，不重复发送
      if (createdPanelId && !isNew) {
        setActivePanelId(createdPanelId)
        return
      }

      // 新创建：标记该追问正在生成（按钮转圈），发送完成后再清除
      const derivedKey = `${messageId}:${suggestionIndex}`
      setDerivedLoading((prev) => ({ ...prev, [derivedKey]: true }))
      // 保持原逻辑立即发送，但不直接打开派生的容器
      setTimeout(() => {
        if (createdPanelId) handlePanelSend(createdPanelId, suggestion, messageId)
      }, 100)
      // 新派生子容器已加入视图，布局变化后自动适配，确保整图可见
      setTimeout(triggerFitView, 200)
    },
    [activeId, handlePanelSend, triggerFitView],
  )

  const conversationLoadSeqRef = useRef(0)

  const handleSwitchConversation = useCallback((id: string) => {
    const loadSeq = ++conversationLoadSeqRef.current
    console.log('[LOG] Mindmap handleSwitchConversation 切换到', id, '| 当前activeId=', activeId)
    logConversation('switch_conversation', { convId: id, previousActiveId: activeId })
    // 立即更新 activeId，不等后端返回，确保发送时定位到正确会话
    if (id !== activeId) {
      console.log('[LOG] Mindmap 立即 setActiveId 为', id)
      setActiveId(id)
    }
    const currentConv = conversations.find((c) => c.id === activeId)
    if (currentConv && currentConv.panels.some((p) => p.messages.length > 0)) {
      apiPost(`/api/conversations/${currentConv.id}/sync`, {
        title: currentConv.title,
        panels: currentConv.panels.map((p) => ({
          id: p.id, type: p.type, parentId: p.parentId, title: p.title,
          sourceMessageId: p.sourceMessageId, sourceSuggestionIndex: p.sourceSuggestionIndex,
          summary: p.summary, summaryMsgCount: p.summaryMsgCount,
          messages: p.messages.map((m) => ({
            id: m.id, panelId: p.id, role: m.role, content: m.content,
            parentMessageId: m.parentMessageId, suggestions: m.suggestions, reasoning: m.reasoning,
            images: m.images,
          })),
        })),
      }).catch((err) => { console.warn('同步失败:', err) })
    }

    apiGet(`/api/conversations/${id}/full`).then((full) => {
      if (loadSeq !== conversationLoadSeqRef.current) return
      let fullPanels: Panel[] = toPanels(full)
      // 空壳会话：服务器上 panels 为空，补一个默认容器面板，避免切回后无面板可发送
      if (fullPanels.length === 0) {
        const panelId = generateId()
        const convTitle = (conversations.find((c) => c.id === id)?.title) ?? (full.title as string) ?? '新角色'
        fullPanels = [{ id: panelId, type: 'container', title: convTitle, parentId: null, messages: [], childrenIds: [] }]
        console.log('[LOG] Mindmap 切换会话 /full 返回空，补默认容器面板 panelId=', panelId, ' convId=', id)
      }
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? {
          ...c, panels: fullPanels, title: full.title ?? c.title, background: full.background,
          convSystem: full.convSystem ?? undefined,
          convTemperature: full.convTemperature ?? undefined,
          convThinking: full.convThinking ?? undefined,
          convReasoning: full.convReasoning ?? undefined,
          greeting: full.greeting ?? undefined,
          roleTemplateId: full.roleTemplateId ?? c.roleTemplateId,
        } : c)),
      )

      // Select root panel
      const rootPanel = fullPanels.find(p => p.parentId === null)
      if (rootPanel) setActivePanelId(rootPanel.id)
      if (isMobile) setMobileSheetCollapsed(true)
    }).catch(() => {
      if (loadSeq !== conversationLoadSeqRef.current) return
      message.error('加载会话失败，请重试')
    })
    // 注意：setActiveId 已在函数开头立即执行，不再延迟到 finally
  }, [activeId, conversations])

  const handleDeleteConversation = useCallback(async (convId: string) => {
    fetch(`/api/conversations/${convId}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {
      message.error('删除会话失败')
    })
    logConversation('delete_conversation', { convId })
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== convId)
      if (activeId === convId) {
        const next = filtered[0] ?? null
        setActiveId(next?.id ?? null)
        // 同步重置激活面板，避免 activePanelId 指向已删会话的面板导致 MessagePanel 收到 null 崩溃
        const root = next?.panels.find((p) => p.parentId === null)
        setActivePanelId(root?.id ?? null)
      }
      return filtered
    })
  }, [activeId])

  const openConvSettings = (conv: Conversation) => {
    setSettingsConvId(conv.id)
    setSettingsTitle(conv.title)
    setSettingsBackground(conv.background || '')
    setSettingsConvSystem(conv.convSystem || '')
    setSettingsConvTemperature(conv.convTemperature ?? 0.3)
    setSettingsConvThinking(conv.convThinking ?? false)
    setSettingsConvReasoning(conv.convReasoning || 'high')
    setSettingsGroup(conv.group || '')
    setSettingsGreeting(conv.greeting || '')
    setSettingsProfileEnabled(conv.profileEnabled ?? true)
    setConvSettingsVisible(true)
  }

  const saveConvSettings = async () => {
    if (!settingsConvId) return
    const title = settingsTitle.trim() || '新对话'
    const background = settingsBackground
    // 仅管理员可设置会话级模型参数；普通用户始终沿用全局配置，避免越权写入
    const convSystem = isAdmin ? (settingsConvSystem.trim() || undefined) : undefined
    const convTemperature = isAdmin ? settingsConvTemperature : undefined
    const convThinking = isAdmin ? settingsConvThinking : undefined
    const convReasoning = isAdmin ? settingsConvReasoning : undefined
    const group = settingsGroup.trim() || undefined
    const greeting = settingsGreeting.trim() || undefined
    const profileEnabled = settingsProfileEnabled
    setConversations((prev) => prev.map((c) => (c.id === settingsConvId
      ? { ...c, title, background, convSystem, convTemperature, convThinking, convReasoning, group, greeting, profileEnabled }
      : c)))
    try {
      await fetch(`/api/conversations/${settingsConvId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ title, background, convSystem, convTemperature, convThinking, convReasoning, group, greeting, profileEnabled }),
      })
    } catch {
      message.error('保存对话设置失败')
    }
    logConversation('save_conversation_settings', { convId: settingsConvId, title })
    setConvSettingsVisible(false)
  }

  // 点击品牌区回到欢迎页（清空当前选中会话）
  const goHome = useCallback(() => {
    conversationLoadSeqRef.current += 1
    setActiveId(null)
    setActivePanelId(null)
  }, [])

  // 切换会话置顶
  const handleTogglePin = useCallback((conv: Conversation) => {
    const pinned = !conv.pinned
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, pinned } : c)))
    apiPost(`/api/conversations/${conv.id}`, { pinned }).catch(() => message.error('置顶操作失败'))
    logConversation('toggle_pin', { convId: conv.id, pinned })
  }, [])

  const handleLogout = useCallback(() => {
    logAuth('logout', {})
    doLogout()
    window.location.href = '/login'
  }, [])

  const user = getUser()
  const isEmpty = !activeConversation || activeConversation.panels.every(p => p.messages.length === 0)

  // ======================= Mind Map Layout =======================
  const panels = activeConversation?.panels ?? []
  const panelMap = useMemo(() => new Map(panels.map(p => [p.id, p])), [panels])
  const layout = useMemo(() => computeLayout(panels), [panels])

  // Canvas dimensions
  const canvasDimensions = useMemo(() => {
    let maxX = 0, maxY = 0
    layout.forEach((pos) => {
      maxX = Math.max(maxX, pos.x + pos.w)
      maxY = Math.max(maxY, pos.y + pos.h)
    })
    return { width: maxX + 60, height: maxY + 60 }
  }, [layout])

  const activePanel = activePanelId ? panels.find(p => p.id === activePanelId) ?? null : null

  // Keyboard shortcut ⌘K
  const searchInputRef = useRef<InputRef>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCollapsed(false)
        setTimeout(() => searchInputRef.current?.focus(), 50)
        logUI('search_shortcut', {})
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (isEmpty) {
      setTimeout(() => welcomeInputRef.current?.focus(), 200)
    }
  }, [isEmpty])

  // Auto-select root panel when conversation changes
  useEffect(() => {
    if (activeConversation && activeConversation.panels.length > 0) {
      const rootPanel = activeConversation.panels.find(p => p.parentId === null)
      if (rootPanel && !activePanelId) {
        setActivePanelId(rootPanel.id)
      }
    }
  }, [activeConversation])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
      <style>{`@keyframes mindmap-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <Layout ref={layoutRef} style={{ height: '100dvh', overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <Sider
          width={isMindmapFullscreen ? 0 : (isMobile ? 180 : (isTablet ? 240 : 260))}
          collapsed={isMindmapFullscreen ? true : (isMobile ? !mobileSidebarVisible : collapsed)}
          collapsedWidth={0}
          style={{ background: '#fff', borderRight: '1px solid #e5e7eb', display: (isMindmapFullscreen || isMobile) ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}
        >
          {isMobile && !mobileSidebarVisible ? null : (collapsed && !isMobile && !isMindmapFullscreen ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
              <Tooltip title="展开侧边栏">
                <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setCollapsed(false)} style={{ color: '#6b7280' }} />
              </Tooltip>
            </div>
          ) : (
            <>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Input
                ref={searchInputRef}
                prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
                placeholder="搜索对话..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                allowClear
                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, height: 36 }}
              />
              {!searchTerm && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 12 }}>⌘K</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', marginBottom: 8, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={goHome}>
                <Avatar size={32} icon={<RobotOutlined />} style={{ background: '#6366f1', cursor: 'pointer' }} onClick={goHome} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>MindmapChat</span>
              </div>
              <Tooltip title={isMobile ? "关闭侧边栏" : "收起侧边栏"}>
                <Button type="text" size="small" icon={<MenuFoldOutlined />}
                  onClick={() => { if (isMobile) { setMobileSidebarVisible(false) } else { setCollapsed(true) } }} style={{ color: '#9ca3af' }} />
              </Tooltip>
            </div>

            <Button type="default" onClick={handleNewConversation}
              style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, border: '1px solid #e5e7eb' }}>
              新角色
            </Button>

            <Button type="text" icon={<BulbOutlined />}
              onClick={() => navigate('/personality-split')}
              style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
              人格分裂
            </Button>

            <Button type="text" icon={<IdcardOutlined />}
              onClick={() => navigate('/profile')}
              style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
              人物画像
            </Button>

            {isAdmin && (
              <Button type="text" icon={<TeamOutlined />}
                onClick={() => navigate('/user-questions')}
                style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                用户问答
              </Button>
            )}

            {isAdmin && (
              <Button type="text" icon={<RobotOutlined />}
                onClick={() => openRoleTemplateModal()}
                style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                角色管理
              </Button>
            )}

            <Divider style={{ margin: '8px 0', borderColor: '#e5e7eb' }} />

            <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>
                {searchTerm ? `搜索结果 (${filteredConversations.length})` : '历史对话'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {filteredConversations.length === 0 && (
                <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                  {searchTerm ? '未找到匹配的对话' : '暂无对话'}
                </div>
              )}
              {groupedConversations.map(({ group, items }) => (
                <div key={group}>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, padding: '6px 4px 2px', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>{group}</div>
                  {items.map((conv) => (
                    <div key={conv.id} className="db-history-item"
                      onClick={() => { handleSwitchConversation(conv.id); setSearchTerm('') }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 13, color: activeId === conv.id ? '#6366f1' : '#4b5563',
                        background: activeId === conv.id ? '#f5f3ff' : 'transparent', transition: 'background 0.15s',
                      }}>
                      <Tooltip title={conv.pinned ? '取消置顶' : '置顶'}>
                        {conv.pinned
                          ? <PushpinFilled onClick={(e) => { e.stopPropagation(); handleTogglePin(conv) }} style={{ color: '#6366f1', fontSize: 14, cursor: 'pointer', flexShrink: 0 }} />
                          : <PushpinOutlined onClick={(e) => { e.stopPropagation(); handleTogglePin(conv) }} style={{ color: '#d1d5db', fontSize: 14, cursor: 'pointer', flexShrink: 0 }} />}
                      </Tooltip>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{conv.title}</span>
                      <Tooltip title="设置">
                        <SettingOutlined
                          onClick={(e) => { e.stopPropagation(); openConvSettings(conv) }}
                          style={{ color: '#d1d5db', fontSize: 13, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#6366f1')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#d1d5db')}
                        />
                      </Tooltip>
                    </div>
                  ))}
                </div>
              ))}
            </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 8px', flexShrink: 0 }}>
            <Avatar size={32} icon={<UserOutlined />} style={{ background: '#6366f1', cursor: 'pointer' }} onClick={toggleSettings} />
            <span style={{ fontSize: 14, color: '#374151', flex: 1, cursor: 'pointer' }} onClick={toggleSettings}>
              {user?.nickname || user?.username || '用户'}
            </span>
            {isAdmin && (
              <Tooltip title="模型配置">
                <SettingOutlined style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={() => setConfigModalVisible(true)} />
              </Tooltip>
            )}
            <Tooltip title="退出登录">
              <LogoutOutlined style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={handleLogout} />
            </Tooltip>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#c4c4c4', padding: '6px 0 4px', borderTop: '1px solid #f0f0f0' }}>
            v{__APP_VERSION__}
          </div>
          </div>
          </>
          ))}
        </Sider>
        <ModelConfigModal
          visible={configModalVisible}
          onClose={() => setConfigModalVisible(false)}
          initialConfig={modelConfig}
          isAdmin={isAdmin}
          onSave={(cfg) => {
            logModelConfig('save_global_config', { provider: cfg.provider, model: cfg.model })
            setModelConfig(cfg)
          }}
        />
        <SettingsPanel />
        {/* 对话设置弹窗 */}
        <Modal
          title="对话设置"
          open={convSettingsVisible}
          onCancel={() => setConvSettingsVisible(false)}
          onOk={saveConvSettings}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>对话名称</div>
              <Input
                value={settingsTitle}
                onChange={(e) => setSettingsTitle(e.target.value)}
                placeholder="请输入对话名称"
                maxLength={50}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>分组（留空为「未分组」）</div>
              <Input
                value={settingsGroup}
                onChange={(e) => setSettingsGroup(e.target.value)}
                placeholder="如：工作 / 学习 / 生活"
                maxLength={20}
                allowClear
              />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>对话背景</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {BG_COLORS.map((c) => (
                  <div
                    key={c}
                    onClick={() => setSettingsBackground(c)}
                    style={{
                      width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer',
                      border: settingsBackground === c ? '2px solid #6366f1' : '1px solid #e5e7eb',
                    }}
                  />
                ))}
                <ColorPicker
                  value={settingsBackground.startsWith('http') ? '#f9fafb' : (settingsBackground || '#f9fafb')}
                  onChange={(c) => setSettingsBackground(c.toHexString())}
                />
              </div>
              <Input
                style={{ marginTop: 8 }}
                value={settingsBackground.startsWith('http') ? settingsBackground : ''}
                onChange={(e) => setSettingsBackground(e.target.value)}
                placeholder="或输入背景图片 URL"
              />
            </div>

            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>开场白（Greeting）</div>
              <Input.TextArea
                value={settingsGreeting}
                onChange={(e) => setSettingsGreeting(e.target.value)}
                placeholder="可选，例如：你好！我是你的AI助手，可以帮你回答各种问题。创建会话时会自动显示为第一条消息。"
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={2000}
              />
            </div>

            <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>参与人物画像采集</div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>
                    开启后，本会话中的提问会被异步归类为你的人物画像。只保存截断片段与分类结果，不保存提问原文。
                  </div>
                </div>
                <Switch checked={settingsProfileEnabled} onChange={setSettingsProfileEnabled} />
              </div>
            </div>

            {isAdmin && (
            <>
            <Divider style={{ margin: '4px 0 14px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 2 }}>会话级模型配置</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
              留空 / 默认则沿用全局「模型配置」。设置后仅对本会话生效。
            </div>

            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>背景提示词（System）</div>
              <Input.TextArea
                value={settingsConvSystem}
                onChange={(e) => setSettingsConvSystem(e.target.value)}
                placeholder="例如：你是一名资深中国公司法务，回答需引用法条。留空则使用全局系统提示。"
                autoSize={{ minRows: 3, maxRows: 6 }}
                maxLength={4000}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>温度（Temperature）</span>
                <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 600 }}>{settingsConvTemperature.toFixed(1)}</span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.1}
                value={settingsConvTemperature}
                onChange={(v) => setSettingsConvTemperature(v)}
                marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
              />
            </div>
            </>
            )}
          </div>
          <Divider style={{ margin: '16px 0' }} />
          <Popconfirm
            title="确定删除该对话吗？"
            description="删除后不可恢复"
            onConfirm={() => { if (settingsConvId) handleDeleteConversation(settingsConvId); setConvSettingsVisible(false) }}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger block>删除对话</Button>
          </Popconfirm>
        </Modal>

        {/* 角色模板管理弹窗（仅管理员） */}
        {isAdmin && (
        <Modal
          title={editingRoleTemplate ? '编辑角色模板' : '新建角色模板'}
          open={roleTemplateModalVisible}
          onCancel={() => setRoleTemplateModalVisible(false)}
          onOk={saveRoleTemplate}
          okText="保存"
          cancelText="取消"
          destroyOnClose
          width={520}
          footer={null}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>角色名称 *（首页圆圈上方显示）</div>
              <Input value={rtName} onChange={(e) => setRtName(e.target.value)} placeholder="如：产品经理" maxLength={20} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>角色描述（可选，不作为会话名称）</div>
              <Input value={rtTitle} onChange={(e) => setRtTitle(e.target.value)} placeholder="如：负责产品规划、需求分析与项目推进" maxLength={50} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>分组</div>
              <Input value={rtGroup} onChange={(e) => setRtGroup(e.target.value)} placeholder="如：工作 / 学习 / 生活" maxLength={20} allowClear />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>背景色（首页圆圈颜色）</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {BG_COLORS.map((c) => (
                  <div
                    key={c}
                    onClick={() => setRtBackground(c)}
                    style={{
                      width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer',
                      border: rtBackground === c ? '2px solid #6366f1' : '1px solid #e5e7eb',
                    }}
                  />
                ))}
                <ColorPicker value={rtBackground || '#f9fafb'} onChange={(c) => setRtBackground(c.toHexString())} />
              </div>
            </div>
            <Divider style={{ margin: '4px 0 10px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>会话级模型配置</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: -8 }}>留空则沿用全局模型配置</div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>背景提示词（System）</div>
              <Input.TextArea
                value={rtConvSystem}
                onChange={(e) => setRtConvSystem(e.target.value)}
                placeholder="例如：你是一名资深中国公司法务，回答需引用法条。"
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={4000}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>开场白（Greeting）</div>
              <Input.TextArea
                value={rtGreeting}
                onChange={(e) => setRtGreeting(e.target.value)}
                placeholder="可选，例如：你好！我是你的专属产品经理助手，可以帮你梳理需求、写PRD、分析竞品等。创建会话时会自动显示为第一条消息。"
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={2000}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>温度（Temperature）</span>
                <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 600 }}>{rtConvTemperature.toFixed(1)}</span>
              </div>
              <Slider min={0} max={1} step={0.1} value={rtConvTemperature} onChange={(v) => setRtConvTemperature(v)} marks={{ 0: '0', 0.5: '0.5', 1: '1' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>启用（显示在首页）</span>
              <Switch checked={rtEnabled} onChange={(v) => setRtEnabled(v)} />
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" onClick={saveRoleTemplate} style={{ flex: 1 }}>
                {editingRoleTemplate ? '更新' : '创建'}
              </Button>
              <Button onClick={() => setRoleTemplateModalVisible(false)} style={{ flex: 1 }}>取消</Button>
            </div>

            {/* 已有角色模板列表 */}
            {(() => {
              const adminTemplates = roleTemplates
              if (adminTemplates.length === 0) return null
              const sorted = [...adminTemplates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              return (
                <>
                  <Divider style={{ margin: '4px 0 10px' }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>已有角色（点击编辑）</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sorted.map((tpl) => (
                      <div key={tpl.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb',
                        cursor: 'pointer', background: editingRoleTemplate?.id === tpl.id ? '#f5f3ff' : '#fff',
                      }} onClick={() => openRoleTemplateModal(tpl)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: tpl.background || '#e5e7eb',
                            border: '1px solid #d1d5db',
                          }} />
                          <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{tpl.name}</span>
                          {!tpl.isEnabled && <span style={{ fontSize: 11, color: '#9ca3af' }}>(已隐藏)</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <SettingOutlined style={{ fontSize: 12, color: '#9ca3af' }} />
                          <Popconfirm title="确定删除该角色模板？" onConfirm={(e) => { e?.stopPropagation(); deleteRoleTemplateHandler(tpl.id) }} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                            <DeleteOutlined style={{ fontSize: 12, color: '#ef4444', cursor: 'pointer' }} onClick={(e) => e.stopPropagation()} />
                          </Popconfirm>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        </Modal>
        )}

        {/* Mobile Drawer - fixed overlay */}
        {isMobile && mobileDrawerOpen && (
          <>
            {/* Mask */}
            <div
              onClick={() => setMobileDrawerOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }}
            />
            {/* Panel */}
            <div style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 1001,
              background: '#fff', boxShadow: '2px 0 8px rgba(0,0,0,0.15)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
                  placeholder="搜索对话..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  allowClear
                  style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, height: 36 }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', marginBottom: 8, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={goHome}>
                  <Avatar size={32} icon={<RobotOutlined />} style={{ background: '#6366f1', cursor: 'pointer' }} onClick={goHome} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>MindmapChat</span>
                </div>
              </div>

              <Button type="default" onClick={() => { handleNewConversation(); setMobileDrawerOpen(false) }}
                style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, border: '1px solid #e5e7eb' }}>
                新角色
              </Button>

              <Button type="text" icon={<BulbOutlined />}
                onClick={() => { navigate('/personality-split'); setMobileDrawerOpen(false) }}
                style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                人格分裂
              </Button>

              <Button type="text" icon={<IdcardOutlined />}
                onClick={() => { navigate('/profile'); setMobileDrawerOpen(false) }}
                style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                人物画像
              </Button>

              {isAdmin && (
                <Button type="text" icon={<TeamOutlined />}
                  onClick={() => { navigate('/user-questions'); setMobileDrawerOpen(false) }}
                  style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                  用户问答
                </Button>
              )}

              {isAdmin && (
                <Button type="text" icon={<RobotOutlined />}
                  onClick={() => { openRoleTemplateModal(); setMobileDrawerOpen(false) }}
                  style={{ width: '100%', marginBottom: 8, textAlign: 'left', height: 36, borderRadius: 8, color: '#6b7280', fontSize: 13 }}>
                  角色管理
                </Button>
              )}

              <Divider style={{ margin: '8px 0', borderColor: '#e5e7eb' }} />

              <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>
                  {searchTerm ? `搜索结果 (${filteredConversations.length})` : '历史对话'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                {filteredConversations.length === 0 && (
                  <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                    {searchTerm ? '未找到匹配的对话' : '暂无对话'}
                  </div>
                )}
                {groupedConversations.map(({ group, items }) => (
                <div key={group}>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, padding: '6px 4px 2px', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>{group}</div>
                  {items.map((conv) => (
                  <div key={conv.id} className="db-history-item"
                    onClick={() => { handleSwitchConversation(conv.id); setSearchTerm(''); setMobileDrawerOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                      fontSize: 13, color: activeId === conv.id ? '#6366f1' : '#4b5563',
                      background: activeId === conv.id ? '#f5f3ff' : 'transparent', transition: 'background 0.15s',
                    }}>
                    <Tooltip title={conv.pinned ? '取消置顶' : '置顶'}>
                      {conv.pinned
                        ? <PushpinFilled onClick={(e) => { e.stopPropagation(); handleTogglePin(conv) }} style={{ color: '#6366f1', fontSize: 14, cursor: 'pointer', flexShrink: 0 }} />
                        : <PushpinOutlined onClick={(e) => { e.stopPropagation(); handleTogglePin(conv) }} style={{ color: '#d1d5db', fontSize: 14, cursor: 'pointer', flexShrink: 0 }} />}
                    </Tooltip>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{conv.title}</span>
                    <Tooltip title="设置">
                      <SettingOutlined
                        onClick={(e) => { e.stopPropagation(); openConvSettings(conv); setMobileDrawerOpen(false) }}
                        style={{ color: '#d1d5db', fontSize: 13, flexShrink: 0 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#6366f1')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#d1d5db')}
                      />
                    </Tooltip>
                  </div>
                  ))}
                </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 8px', flexShrink: 0 }}>
              <Avatar size={32} icon={<UserOutlined />} style={{ background: '#6366f1', cursor: 'pointer' }} onClick={() => { toggleSettings(); setMobileDrawerOpen(false) }} />
              <span style={{ fontSize: 14, color: '#374151', flex: 1, cursor: 'pointer' }} onClick={() => { toggleSettings(); setMobileDrawerOpen(false) }}>
                {user?.nickname || user?.username || '用户'}
              </span>
              {isAdmin && (
                <Tooltip title="模型配置">
                  <SettingOutlined style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={() => { setConfigModalVisible(true); setMobileDrawerOpen(false) }} />
                </Tooltip>
              )}
              <Tooltip title="退出登录">
                <LogoutOutlined style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={handleLogout} />
              </Tooltip>
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#c4c4c4', padding: '6px 0 4px', borderTop: '1px solid #f0f0f0' }}>
              v{__APP_VERSION__}
            </div>
          </div>
            </div>
          </>
        )}

        {/* Main Content */}
        <Content style={{ background: activeConversation?.background
          ? (activeConversation.background.startsWith('http')
              ? `url(${activeConversation.background}) center/cover no-repeat`
              : activeConversation.background)
          : '#f9fafb', display: 'flex', flexDirection: 'column' }}>
          {/* Mobile: show menu button when sidebar is hidden */}
          {isMobile && !mobileDrawerOpen && !isMindmapFullscreen && (
            <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 50 }}>
              <Button
                type="primary"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawerOpen(true)}
                style={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            </div>
          )}

          {/* Content Area */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {!activeId || conversations.length === 0 ? (
              /* Welcome - no active conversation / no conversations */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'transparent', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 16, right: 20, display: 'flex', gap: 12, alignItems: 'center', zIndex: 5 }}>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{user?.nickname || user?.username || '用户'}</span>
                  <Tooltip title="退出登录">
                    <Button size="small" icon={<LogoutOutlined />} onClick={handleLogout} style={{ borderRadius: 6, color: '#ef4444', borderColor: '#fecaca' }}>退出</Button>
                  </Tooltip>
                </div>
                {/* 标题放在球体上方 */}
                <div style={{ position: 'absolute', top: 20, left: 0, right: 0, textAlign: 'center', zIndex: 5, pointerEvents: 'none' }}>
                  <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 600, color: '#111827', marginBottom: 6 }}>思维导图聊天</h1>
                  <p style={{ fontSize: isMobile ? 13 : 14, color: '#6b7280', maxWidth: 360, textAlign: 'center', lineHeight: 1.6, margin: '0 auto' }}>
                    以思维导图的方式展开你的对话树，可视化层层追问。
                  </p>
                </div>
                {roleTemplates.length > 0 && (
                  <div ref={roleContainerRef}
                    onMouseDown={handlePointerDown}
                    onTouchStart={handlePointerDown}
                    style={{
                      position: 'absolute', top: 80, left: 0, right: 0, bottom: 0, pointerEvents: 'auto', overflow: 'hidden',
                      perspective: `${Math.max(effRadiusX, effRadiusY) * 2.2}px`, cursor: isDragging ? 'grabbing' : 'grab',
                    }}>
                    <div ref={sphereRef}
                      style={{
                        position: 'absolute', top: '50%', left: '50%', width: 0, height: 0,
                        transformStyle: 'preserve-3d',
                        willChange: 'transform',
                      }}>
                      {roleTemplates.map((tpl, idx) => {
                        const sp = spherePositions[idx]
                        if (!sp) return null
                        const baseSize = Math.max(effRadiusX, effRadiusY) * 0.16
                        const size = Math.max(40, Math.min(160, Math.round(baseSize * sphereSizeScale)))
                        const chars = tpl.name.length
                        const isShort = chars <= 2
                        const lineCount = isShort ? 1 : 2
                        const maxCharsPerLine = Math.max(1, Math.ceil(chars / lineCount))
                        const fontSize = Math.max(11, Math.round(Math.min(size * (isShort ? 0.46 : 0.32), (size * 0.88) / maxCharsPerLine)))
                        const lineHeight = 1.1
                        const mid = Math.ceil(chars / lineCount)
                        const nameLines = isShort ? [tpl.name] : [tpl.name.slice(0, mid), tpl.name.slice(mid)]
                        // 将球面坐标转换为旋转角度
                        const longY = Math.atan2(sp.x, sp.z) * (180 / Math.PI)
                        const latX = Math.asin(sp.y) * (180 / Math.PI)
                        // z-index 根据 z 坐标决定
                        const zIndex = Math.round(sp.z * 100)
                        return (
                        <div key={tpl.id}
                          onClick={(e) => { e.stopPropagation(); handleRoleTemplateClick(tpl) }}
                          style={{
                            position: 'absolute',
                            left: -size / 2, top: -size / 2,
                            width: size, height: size, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.55)',
                            backdropFilter: 'blur(8px)',
                            border: '1.5px solid #e5e7eb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            textAlign: 'center',
                            cursor: rtCreatingConv === tpl.id ? 'default' : 'pointer',
                            opacity: rtCreatingConv === tpl.id ? 0.5 : 1,
                            pointerEvents: 'auto',
                            transform: `rotateY(${longY}deg) rotateX(${-latX}deg) translateZ(${Math.abs(sp.y) < 0.01 ? effRadiusX : effRadiusX * (1 - Math.abs(sp.y)) + effRadiusY * Math.abs(sp.y)}px)`,
                            transition: 'box-shadow 0.2s, border-color 0.2s',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                            zIndex: zIndex,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.4), 0 0 20px rgba(99,102,241,0.2)'
                            e.currentTarget.style.borderColor = '#6366f1'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'
                            e.currentTarget.style.borderColor = '#e5e7eb'
                          }}
                          >
                          <span style={{
                            fontSize: fontSize,
                            color: '#6b7280',
                            fontWeight: 500,
                            lineHeight: lineHeight,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            width: '100%',
                            padding: size * 0.1,
                            boxSizing: 'border-box',
                          }}>
                            {nameLines.map((line, i) => (
                              <span key={i} style={{ display: 'block', pointerEvents: 'none' }}>{line}</span>
                            ))}
                          </span>
                        </div>
                      )})}
                    </div>
                  </div>
                )}

                {/* 球体参数调整面板（倾斜度 / 大小 / 宽度） */}
                <div style={{
                  position: 'absolute', left: 16, bottom: 16, zIndex: 20,
                  width: 240, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
                  border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  padding: spherePanelOpen ? 14 : 10, userSelect: 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                    onClick={() => setSpherePanelOpen((v) => !v)}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>球体参数</span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{spherePanelOpen ? '收起 ▾' : '展开 ▸'}</span>
                  </div>
                  {spherePanelOpen && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>倾斜度</span><span>{sphereTilt}°</span>
                        </div>
                        <Slider min={-80} max={80} step={1} value={sphereTilt} onChange={setSphereTilt} tooltip={{ open: false }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>大小</span><span>{sphereSizeScale.toFixed(2)}×</span>
                        </div>
                        <Slider min={0.5} max={2} step={0.05} value={sphereSizeScale} onChange={setSphereSizeScale} tooltip={{ open: false }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>宽度</span><span>{sphereWidthScale.toFixed(2)}×</span>
                        </div>
                        <Slider min={0.5} max={2} step={0.05} value={sphereWidthScale} onChange={setSphereWidthScale} tooltip={{ open: false }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>高度</span><span>{sphereHeightScale.toFixed(2)}×</span>
                        </div>
                        <Slider min={0.5} max={2} step={0.05} value={sphereHeightScale} onChange={setSphereHeightScale} tooltip={{ open: false }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button size="small" icon={<CopyOutlined />} onClick={copySphereParams} style={{ flex: 1 }}>
                          复制参数
                        </Button>
                        <Button size="small" onClick={() => { setSphereTilt(0); setSphereSizeScale(1); setSphereWidthScale(0.95); setSphereHeightScale(2) }}>
                          重置
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : isEmpty ? (
              /* Welcome - empty active conversation */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: 'transparent' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px 40px' }}>
                  <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 600, color: '#111827', marginBottom: 28 }}>
                    有什么我能帮你的吗？
                  </h1>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', maxWidth: isMobile ? '100%' : 800, width: '100%' }}>
                    {suggestionTags.map((row, rowIdx) => (
                      <div key={rowIdx} style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {row.map((tag, tagIdx) => (
                          <button key={tagIdx} className="db-suggestion-btn"
                            onClick={() => {
                              if (!activeConversation) {
                                const panelId = generateId()
                                const newConv: Conversation = {
                                  id: generateId(),
                                  title: tag.length > 20 ? tag.slice(0, 20) + '...' : tag,
                                  panels: [{ id: panelId, type: 'container', title: tag.length > 20 ? tag.slice(0, 20) + '...' : tag, parentId: null, messages: [], childrenIds: [] }],
                                }
                                setConversations((prev) => [newConv, ...prev])
                                setActiveId(newConv.id)
                                setActivePanelId(panelId)
                                setTimeout(() => handlePanelSend(panelId, tag), 100)
                              } else if (activeConversation.panels.length > 0) {
                                const panelId = activeConversation.panels[0].id
                                handlePanelSend(panelId, tag)
                              }
                            }}
                            style={{
                              padding: '6px 12px', borderRadius: 20, border: '1px solid #e5e7eb',
                              background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer',
                              whiteSpace: 'nowrap', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            }}>
                            {tag}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: isMobile ? '8px 12px 16px' : '8px 20px 20px', maxWidth: isMobile ? '100%' : 800, width: '100%', margin: '0 auto' }}>
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '8px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                    <ChatInput
                      ref={welcomeInputRef}
                      value={activeConversation && activeConversation.panels.length > 0 ? getPanelInput(activeConversation.panels[0].id) : welcomeInput}
                      onChange={activeConversation && activeConversation.panels.length > 0 ? (v) => setPanelInput(activeConversation.panels[0].id, v) : setWelcomeInput}
                      images={activeConversation && activeConversation.panels.length > 0 ? getPanelImages(activeConversation.panels[0].id) : welcomeImages}
                      onImagesChange={activeConversation && activeConversation.panels.length > 0 ? (imgs) => setPanelImages(activeConversation.panels[0].id, imgs) : setWelcomeImages}
                      onSend={() => {
                        console.log('%c[LOG] Mindmap 欢迎页 onSend 触发', 'color:#fa8c16', '| activeConversation=', !!activeConversation, '| panels数量=', activeConversation?.panels.length ?? 0)
                        const hasPanels = !!(activeConversation && activeConversation.panels.length > 0)
                        const text = hasPanels ? getPanelInput(activeConversation!.panels[0].id) : welcomeInput
                        const imgs = hasPanels ? getPanelImages(activeConversation!.panels[0].id) : welcomeImages
                        if (!text.trim() && imgs.length === 0) { console.warn('[LOG] Mindmap 欢迎页 onSend 提前 return：text/images为空'); return }
                        if (!activeConversation) {
                          const panelId = generateId()
                          const newConv: Conversation = { id: generateId(), title: text.length > 20 ? text.slice(0, 20) + '...' : text || '[图片]', panels: [{ id: panelId, type: 'container', title: text.length > 20 ? text.slice(0, 20) + '...' : text, parentId: null, messages: [], childrenIds: [] }] }
                          console.log('[LOG] Mindmap 欢迎页新建会话 convId=', newConv.id, ' panelId=', panelId)
                          setConversations((prev) => [newConv, ...prev])
                          setActiveId(newConv.id)
                          setActivePanelId(panelId)
                          setWelcomeInput('')
                          setWelcomeImages([])
                          // 将欢迎页图片转移到新面板
                          if (imgs.length > 0) setPanelImages(panelId, imgs)
                          setTimeout(() => handlePanelSend(panelId, text), 100)
                        } else if (hasPanels) {
                          console.log('[LOG] Mindmap 欢迎页已有会话+面板，直接 handlePanelSend panelId=', activeConversation.panels[0].id)
                          handlePanelSend(activeConversation.panels[0].id)
                        } else {
                          // 兜底：会话存在但无面板（空壳会话），即时补一个容器面板再发送，复用当前会话
                          const panelId = generateId()
                          console.log('[LOG] Mindmap 欢迎页会话无面板，补容器面板 panelId=', panelId, ' convId=', activeConversation!.id, ' 并发送')
                          setConversations((prev) =>
                            prev.map((c) => (c.id === activeConversation!.id ? {
                              ...c, panels: [{ id: panelId, type: 'container', title: c.title, parentId: null, messages: [], childrenIds: [] }],
                            } : c)),
                          )
                          setActivePanelId(panelId)
                          setWelcomeInput('')
                          setWelcomeImages([])
                          if (imgs.length > 0) setPanelImages(panelId, imgs)
                          setTimeout(() => handlePanelSend(panelId, text), 100)
                        }
                      }}
                      onSummarize={activeConversation && activeConversation.panels.length > 0 ? () => handlePanelSend(activeConversation.panels[0].id, '全部聊天记录，详细总结下') : undefined}
                      loading={activeConversation && activeConversation.panels.length > 0 ? getPanelLoading(activeConversation.panels[0].id) : false}
                      selectedModel={selectedModel}
                      onModelChange={setSelectedModel}
                      isMobile={isMobile}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                      {activeConversation && activeConversation.panels.length > 0 && activeConversation.panels.some(p => p.messages.length > 0) && (
                        <Button size="small" onClick={() => handlePanelSend(activeConversation.panels[0].id, '全部聊天记录，详细总结下')}
                          disabled={getPanelLoading(activeConversation.panels[0].id)}
                          style={{ fontSize: 11, height: 24, borderRadius: 4, padding: '0 8px' }}>
                          总结
                        </Button>
                      )}
                      <Button type="primary" icon={<SendOutlined />}
                        onClick={() => {
                          const text = activeConversation && activeConversation.panels.length > 0 ? getPanelInput(activeConversation.panels[0].id) : welcomeInput
                          if (!text.trim()) return
                          if (!activeConversation) {
                            const panelId = generateId()
                            const newConv: Conversation = { id: generateId(), title: text.length > 20 ? text.slice(0, 20) + '...' : text, panels: [{ id: panelId, type: 'container', title: text.length > 20 ? text.slice(0, 20) + '...' : text, parentId: null, messages: [], childrenIds: [] }] }
                            setConversations((prev) => [newConv, ...prev])
                            setActiveId(newConv.id)
                            setActivePanelId(panelId)
                            setWelcomeInput('')
                            setTimeout(() => handlePanelSend(panelId, text), 100)
                          } else if (activeConversation.panels.length > 0) {
                            handlePanelSend(activeConversation.panels[0].id)
                          }
                        }}
                        disabled={!(activeConversation && activeConversation.panels.length > 0 ? getPanelInput(activeConversation.panels[0].id) : welcomeInput).trim() || (activeConversation && activeConversation.panels.length > 0 ? getPanelLoading(activeConversation.panels[0].id) : false)}
                        loading={activeConversation && activeConversation.panels.length > 0 ? getPanelLoading(activeConversation.panels[0].id) : false}
                        style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Mind Map + Chat View */
              <div ref={splitRef} style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {/* Chat dialog - left side (desktop always; mobile/tablet when mindmap hidden) */}
                {(!isMobile || !isMindmapVisible) && !isMindmapFullscreen && (
                  <MessagePanel
                    panel={activePanel}
                    allPanels={panels}
                    panelInput={activePanelId ? getPanelInput(activePanelId) : ''}
                    images={activePanelId ? getPanelImages(activePanelId) : (activePanel ? getPanelImages(activePanel.id) : [])}
                    onImagesChange={activePanelId ? (imgs) => setPanelImages(activePanelId, imgs) : (activePanel ? (imgs) => setPanelImages(activePanel.id, imgs) : () => {})}
                    onOpenDerived={selectPanel}
                    onSelectPanel={selectPanel}
                    scrollNonce={panelSelectNonce}
                    conversationTitle={activeConversation?.title}
                    onInputChange={activePanelId ? (v) => setPanelInput(activePanelId, v) : () => {}}
                    onSend={(text) => {
                      if (activePanelId) handlePanelSend(activePanelId, text)
                    }}
                    loading={activePanelId ? getPanelLoading(activePanelId) : false}
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                    onDerivedClick={(msgId, suggestion, sIdx, srcPanelId) => {
                      handleDerivedClick(srcPanelId || activePanelId || '', msgId, suggestion, sIdx)
                    }}
                    onResend={(msgId) => { if (activePanelId) handleResend(activePanelId, msgId) }}
                    onRegenerate={(msgId) => { if (activePanelId) handleRegenerate(activePanelId, msgId) }}
                    derivedLoading={derivedLoading}
                    onClose={() => setActivePanelId(null)}
                    registerInputRef={activePanelId ? registerInputRef(activePanelId) : () => {}}
                    isMobile={isMobile && !isMindmapVisible}
                    width={isMindmapVisible ? chatWidth : '100%'}
                  />
                )}

                {/* Draggable resizer between chat and mindmap (desktop only) */}
                {!isMobile && !isMindmapFullscreen && isMindmapVisible && (
                  <div
                    onMouseDown={startResize}
                    style={{
                      width: 6, flexShrink: 0, cursor: 'col-resize',
                      background: 'transparent', position: 'relative', zIndex: 5,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#6366f133')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 28, background: '#d1d5db', borderRadius: 2 }} />
                  </div>
                )}

                {/* Mind map - right side */}
                {isMindmapVisible && (
                  <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <MindMapView
                      panels={panels}
                      activePanelId={activePanelId}
                      onSelectPanel={selectPanel}
                      layout={layout}
                      canvasWidth={canvasDimensions.width}
                      canvasHeight={canvasDimensions.height}
                      panelMap={panelMap}
                      isMindmapFullscreen={isMindmapFullscreen}
                      isMobile={isMobile}
                      onSummarize={summarizePanel}
                      fitViewRef={mindmapFitViewRef}
                    />
                    {/* Mind map floating controls */}
                    <div style={{
                      position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4,
                      background: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '2px 4px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.1)', zIndex: 10,
                    }}>
                      {isMindmapFullscreen && (isMobile || isTablet) && (
                        <Tooltip title="关闭思维导图">
                          <Button type="text" size="small" icon={<CloseOutlined />}
                            onClick={() => { setIsMindmapFullscreen(false); setIsMindmapVisible(false) }}
                            style={{ color: '#ef4444' }} />
                        </Tooltip>
                      )}
                      <Tooltip title={isMindmapFullscreen ? '退出全屏' : '全屏'}>
                        <Button type="text" size="small"
                          icon={isMindmapFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                          onClick={() => {
                            const next = !isMindmapFullscreen
                            setIsMindmapFullscreen(next)
                            if (next) setIsMindmapVisible(true)
                          }}
                          style={{ color: '#6366f1' }} />
                      </Tooltip>
                      {!isMindmapFullscreen && (
                        <Tooltip title="切换对话/导图大小">
                          <Button type="text" size="small" icon={<SwapOutlined />}
                            onClick={toggleLayout}
                            style={{ color: '#9ca3af' }} />
                        </Tooltip>
                      )}
                      {!isMindmapFullscreen && (
                        <Tooltip title="隐藏思维导图">
                          <Button type="text" size="small" icon={<MenuFoldOutlined />}
                            onClick={() => setIsMindmapVisible(false)}
                            style={{ color: '#9ca3af' }} />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}

                {/* Show mindmap button when hidden (desktop/tablet only, not on mobile) */}
                {!isMindmapVisible && !isMindmapFullscreen && !isMobile && (
                  <Tooltip title="显示思维导图" placement="left">
                    <Button
                      icon={<EyeOutlined />}
                      onClick={() => setIsMindmapVisible(true)}
                      style={{
                        position: 'absolute', right: 12, top: 12, zIndex: 10,
                        borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      思维导图
                    </Button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>


        </Content>
      </Layout>
      {summaryNotice && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)',
          zIndex: 1000, pointerEvents: 'none',
          background: 'rgba(17,24,39,0.78)', color: '#fff',
          fontSize: 12, padding: '6px 14px', borderRadius: 18,
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: '80vw', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <Spin size="small" />
          <span>{summaryNotice}</span>
        </div>
      )}
    </ConfigProvider>
  )
}
