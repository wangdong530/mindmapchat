import { message } from 'antd'
import { getToken, logout as doLogout } from '../LoginPage'
import { logChat } from '../../utils/logger'
import type { ContextMessage, Conversation, Message, Panel } from './types'
import type { NodeLayout } from './types'
import { NODE_W, NODE_H, H_GAP, V_GAP, START_X, START_Y } from './types'

// 复制单条消息的纯文本到剪贴板
export async function copyMessageData(msg: Message) {
  const text = msg.content
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    message.success('已复制')
    logChat('copy_message', { messageId: msg.id, contentLength: text.length })
  } catch {
    message.error('复制失败')
  }
}

// 按分组聚合会话（未分组排最后），组内顺序沿用传入数组（后端已按置顶 + 更新时间排序）
export function groupConversations(convs: Conversation[]): { group: string; items: Conversation[] }[] {
  const map = new Map<string, Conversation[]>()
  for (const c of convs) {
    const g = (c.group ?? '').trim() || '未分组'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(c)
  }
  const groups = Array.from(map.keys()).sort((a, b) => {
    if (a === '未分组') return 1
    if (b === '未分组') return -1
    return a.localeCompare(b, 'zh')
  })
  return groups.map((g) => ({ group: g, items: map.get(g)! }))
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

let msgSeq = 0
export function generateMsgId(): number {
  return ++msgSeq
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

export async function handleAuthError(res: Response): Promise<never> {
  if (res.status === 401) {
    doLogout()
    window.location.href = '/login'
    throw new Error('未登录')
  }
  let errMsg = await res.text()
  try {
    const errBody = JSON.parse(errMsg)
    errMsg = errBody.error || errMsg
  } catch { /* not JSON */ }
  throw new Error(errMsg)
}

export async function apiGet(url: string) {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw await handleAuthError(res)
  return res.json()
}

export async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await handleAuthError(res)
  return res.json()
}

// 将服务端 /full 返回结构转换为前端 Panel[]（构建 childrenIds 与消息字段映射）
export function toPanels(full: { panels?: any[] }): Panel[] {
  const raw = full.panels || []
  const childrenMap: Record<string, string[]> = {}
  for (const p of raw) {
    if (p.parent_id) {
      if (!childrenMap[p.parent_id]) childrenMap[p.parent_id] = []
      childrenMap[p.parent_id].push(p.id)
    }
  }
  return raw.map((p: any) => ({
    id: p.id as string,
    type: (p.type as 'container' | 'message') || 'container',
    title: p.title as string,
    parentId: (p.parent_id as string) || null,
    messages: ((p.messages as any[]) || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      suggestions: m.suggestions,
      reasoning: m.reasoning,
      images: m.images,
      parentMessageId: m.parent_message_id ?? m.parentMessageId,
    })),
    childrenIds: childrenMap[p.id as string] || [],
    sourceMessageId: p.source_message_id as number | undefined,
    sourceSuggestionIndex: p.source_suggestion_index as number | undefined,
    summary: (p.summary as string) || undefined,
    summaryMsgCount: (p.summary_msg_count as number) || undefined,
  }))
}

// ======================= buildMessagesPath =======================
// 与 thinkchat 一致的消息采集：沿父链收集祖先上下文（到 fork 点为止），
// 并用 DFS 收集目标面板及其子孙容器（子容器）的消息，目标面板自身消息放最后
export function buildMessagesPath(conv: Conversation, targetPanelId: string): ContextMessage[] {
  const panelMap = new Map(conv.panels.map((p) => [p.id, p]))

  // 构建 panel 祖先链 [root, ..., parent, target]
  const panelPath: Panel[] = []
  let pid: string | null = targetPanelId
  while (pid) {
    const p = panelMap.get(pid)
    if (!p) break
    panelPath.unshift(p)
    pid = p.parentId
  }

  const targetPanel = panelPath[panelPath.length - 1]
  // 防御：panelPath 为空时 targetPanel 为 undefined
  if (!targetPanel) return []

  // 标记哪些消息需要包含
  const included = new Set<number>()
  if (targetPanel.parentId === null) {
    // root panel：所有容器消息都包含
    for (const panel of conv.panels) {
      if (panel.type === 'container') for (const msg of panel.messages) included.add(msg.id)
    }
  } else {
    // 子 panel：沿祖先链收集（每个祖先取到 fork 点，当前 panel 取全部）
    // fork 点之后的内容（如下一条用户提问及其答案）不属于本次追问上下文，需截断；
    // 但被追问的答案（fork 消息之后的 assistant 回复）必须包含，否则追问会"答非所问/消息错乱"
    for (let i = 0; i < panelPath.length; i++) {
      const panel = panelPath[i]
      if (i < panelPath.length - 1) {
        const forkMsgId = panelPath[i + 1].sourceMessageId
        let forked = false
        for (const msg of panel.messages) {
          // 遇到下一条用户提问则停止（其后的内容不属于本次追问上下文）
          if (forked && msg.role === 'user') break
          if (panel.type === 'container') included.add(msg.id)
          if (forkMsgId !== undefined && msg.id === forkMsgId) forked = true
        }
      } else {
        panel.messages.forEach((m) => { if (panel.type === 'container') included.add(m.id) })
      }
    }
  }

  // 深度优先遍历收集：目标 panel 自身消息放在 children 之后，确保最后一条是当前发送的 user 消息
  const result: ContextMessage[] = []
  // 判断某 panel 是否在 祖先链 -> target 的路径上
  const onPath = (pId: string) => panelPath.some((p) => p.id === pId)
  // 注入某容器的总结：用摘要替代原始消息，并补上摘要之后新增的未总结消息
  function pushSummary(panel: Panel) {
    result.push({ role: 'user', content: '【以下为该分支的对话总结】\n' + panel.summary! })
    const cover = panel.summaryMsgCount ?? panel.messages.length
    for (let i = cover; i < panel.messages.length; i++) {
      const m = panel.messages[i]
      if (included.has(m.id)) result.push(m)
    }
  }
  function dfsCollect(pId: string) {
    const panel = panelMap.get(pId)
    if (!panel) return
    const isTarget = pId === targetPanelId
    const hasSummary = panel.type === 'container' && !!panel.summary

    // 离路径容器：有摘要则整体替换（不再递归子树），否则原始递归
    if (!onPath(pId)) {
      if (hasSummary) {
        pushSummary(panel)
        return
      }
      if (panel.type === 'container') {
        for (const msg of panel.messages) {
          if (included.has(msg.id)) result.push(msg)
        }
      }
      for (const cId of panel.childrenIds) dfsCollect(cId)
      return
    }

    // 在路径上（祖先或 target）
    if (isTarget) {
      // 目标 panel：先遍历 children，再把自身消息放最后（始终原始消息）
      for (const cId of panel.childrenIds) dfsCollect(cId)
      if (panel.type === 'container') {
        for (const msg of panel.messages) {
          if (included.has(msg.id)) result.push(msg)
        }
      }
      return
    }

    // 路径上的祖先容器：自身用摘要（或原始），再向下打通到 target
    // 找出通向 target 的子节点
    const idx = panelPath.findIndex((p) => p.id === pId)
    const pathChildId = idx >= 0 && idx < panelPath.length - 1 ? panelPath[idx + 1].id : null
    if (hasSummary) {
      pushSummary(panel)
    } else if (panel.type === 'container') {
      for (const msg of panel.messages) {
        if (included.has(msg.id)) result.push(msg)
      }
    }
    // 路径子节点继续递归（保持可达）；其余子节点按离路径规则（有摘要则替换）
    for (const cId of panel.childrenIds) dfsCollect(cId)
  }

  if (panelPath[0]) dfsCollect(panelPath[0].id)

  return result
}

// ======================= Tree Layout =======================
// Message node sizing: grows with its text content
const MSG_MIN_W = 60
const MSG_MAX_W = 200
const MSG_LINE_H = 17

function getNodeText(panel: Panel): string {
  const last = panel.messages[panel.messages.length - 1]
  const raw = last ? (last.role === 'user' ? '👤 ' : '🤖 ') + last.content : (panel.title || '消息')
  return raw.length > 30 ? raw.slice(0, 30) + '..' : raw
}

// Estimate a message node's box size based on its text length
function measureMessageNode(text: string): { w: number; h: number } {
  const padX = 20 // 10px * 2
  const padY = 10 // 5px * 2
  // avg char width at fontSize 12 (CJK ~12, latin ~7 -> use 10 as blend)
  const charW = 10
  const textW = Math.max(text.length * charW, 8)
  const contentW = Math.min(textW, MSG_MAX_W)
  const lines = Math.max(1, Math.ceil(textW / MSG_MAX_W))
  const w = Math.max(MSG_MIN_W, Math.min(textW, MSG_MAX_W) + padX)
  const h = lines * MSG_LINE_H + padY
  return { w: Math.round(Math.min(contentW + padX, MSG_MAX_W + padX)), h: Math.round(h) }
}

export function measureNode(panel: Panel): { w: number; h: number } {
  if (panel.type === 'container') return { w: NODE_W, h: NODE_H }
  return measureMessageNode(getNodeText(panel))
}

export function computeLayout(panels: Panel[]): Map<string, NodeLayout> {
  const positions = new Map<string, NodeLayout>()

  const idMap = new Map<string, Panel>()
  const sizeMap = new Map<string, { w: number; h: number }>()
  for (const p of panels) {
    idMap.set(p.id, p)
    sizeMap.set(p.id, measureNode(p))
  }

  const childrenMap = new Map<string, Panel[]>()
  for (const p of panels) {
    if (p.parentId) {
      if (!childrenMap.has(p.parentId)) childrenMap.set(p.parentId, [])
      childrenMap.get(p.parentId)!.push(p)
    }
  }

  const roots = panels.filter((p) => p.parentId === null)
  if (roots.length === 0) return positions

  const nodeH = (id: string) => (sizeMap.get(id)?.h ?? NODE_H)
  const nodeW = (id: string) => (sizeMap.get(id)?.w ?? NODE_W)

  // Step 1: post-order to calculate subtree height
  const subtreeSize = new Map<string, number>()

  function calcSize(nodeId: string): number {
    const children = childrenMap.get(nodeId) || []
    const selfSlot = nodeH(nodeId) + V_GAP
    if (children.length === 0) {
      subtreeSize.set(nodeId, selfSlot)
      return selfSlot
    }
    const size = children.reduce((s, c) => s + calcSize(c.id), 0)
    subtreeSize.set(nodeId, Math.max(size, selfSlot))
    return subtreeSize.get(nodeId)!
  }

  for (const root of roots) calcSize(root.id)

  // Step 2: pre-order to assign positions
  let maxEndX = 0
  let maxEndY = 0

  function assignPos(nodeId: string, depth: number, top: number) {
    const x = START_X + depth * (NODE_W + H_GAP)
    const children = childrenMap.get(nodeId) || []
    const size = subtreeSize.get(nodeId) || (nodeH(nodeId) + V_GAP)
    const h = nodeH(nodeId)
    const w = nodeW(nodeId)
    const y = top + (size - h) / 2
    positions.set(nodeId, { x, y, w, h })

    maxEndX = Math.max(maxEndX, x + w)
    maxEndY = Math.max(maxEndY, y + h)

    let childTop = top
    for (const child of children) {
      const childSize = subtreeSize.get(child.id) || (nodeH(child.id) + V_GAP)
      assignPos(child.id, depth + 1, childTop)
      childTop += childSize
    }
  }

  let totalTop = START_Y
  for (const root of roots) {
    const size = subtreeSize.get(root.id) || (nodeH(root.id) + V_GAP)
    assignPos(root.id, 0, totalTop)
    totalTop += size + V_GAP
  }

  return positions
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function getDepth(panel: Panel, panelMap: Map<string, Panel>): number {
  let depth = 0
  let pid: string | null = panel.parentId
  while (pid) {
    const p = panelMap.get(pid)
    if (!p) break
    depth++
    pid = p.parentId
  }
  return depth
}
