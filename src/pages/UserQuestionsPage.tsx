import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken, getUser } from './LoginPage'
import { Input, Spin, Empty, Tooltip, Result, Button } from 'antd'
import { SearchOutlined, UserOutlined, ClockCircleOutlined, MessageOutlined, QuestionCircleOutlined, LeftOutlined } from '@ant-design/icons'
import { useResponsive } from '../hooks/useResponsive'
import { logAdmin } from '../utils/logger'

interface User {
  id: number
  username: string
  nickname: string | null
  created_at: string
}

interface Question {
  id: number
  role: string
  content: string
  created_at: string
  parentMessageId?: number | null
  sortOrder?: number
}

interface ConvWithQuestions {
  id: string
  title: string
  created_at: string
  updated_at: string
  questions: Question[]
}

const STACK_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]

function hashColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return STACK_COLORS[Math.abs(hash) % STACK_COLORS.length]
}

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function truncate(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

export default function UserQuestionsPage() {
  const navigate = useNavigate()
  const currentUser = getUser()
  const { isMobile } = useResponsive()
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [convs, setConvs] = useState<ConvWithQuestions[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingConvs, setLoadingConvs] = useState(false)
  const [search, setSearch] = useState('')

  // 加载用户列表
  useEffect(() => {
    const token = getToken()
    fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setUsers(data)
        setLoadingUsers(false)
      })
      .catch(() => setLoadingUsers(false))
  }, [])

  // 选择用户后加载会话+提问
  useEffect(() => {
    if (!selectedUserId) return
    setLoadingConvs(true)
    logAdmin('view_user_questions', { targetUserId: selectedUserId })
    const token = getToken()
    fetch(`/api/admin/users/${selectedUserId}/questions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setConvs(data)
        setLoadingConvs(false)
      })
      .catch(() => setLoadingConvs(false))
  }, [selectedUserId])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.nickname && u.nickname.toLowerCase().includes(q)),
    )
  }, [users, search])

  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId), [users, selectedUserId])

  const allowed = !!currentUser?.isAdmin

  if (!allowed) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc' }}>
        <Result
          status="403"
          title="无权限访问"
          subTitle="仅管理员可查看此页面"
          extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', background: '#f8fafc' }}>
      {/* ===== 左侧用户列表（移动端：全屏列表 / 顶部水平滚动） ===== */}
      {(!isMobile || !selectedUserId) && (
        <div style={{
          width: isMobile ? '100%' : 280,
          minWidth: isMobile ? undefined : 280,
          maxHeight: isMobile ? (selectedUserId ? 80 : '100%') : undefined,
          background: '#fff',
          borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
          borderBottom: isMobile ? '1px solid #e5e7eb' : 'none',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
        {/* 标题 */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1f2937' }}>注册用户</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
            共 {users.length} 人
          </p>
        </div>

        {/* 搜索框 */}
        <div style={{ padding: '8px 12px' }}>
          <Input
            size="small"
            placeholder="搜索用户..."
            prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ borderRadius: 8 }}
            allowClear
          />
        </div>

        {/* 用户列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {loadingUsers ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="small" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <Empty description="没有匹配的用户" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            filteredUsers.map((user) => {
              const isSelected = selectedUserId === user.id
              return (
                <div
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    marginBottom: 2,
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: isSelected ? '#eef2ff' : 'transparent',
                    border: isSelected ? '1px solid #c7d2fe' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f9fafb'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  {/* 头像 */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: `linear-gradient(135deg, ${hashColor(String(user.id))}, ${hashColor(user.username)})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {(user.nickname || user.username)[0].toUpperCase()}
                    </span>
                  </div>

                  {/* 用户名+时间 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', lineHeight: 1.3 }}>
                      {user.nickname || user.username}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <UserOutlined style={{ fontSize: 10 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.username}
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#6366f1', flexShrink: 0,
                    }} />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
      )}

      {/* ===== 右侧堆栈展示区 ===== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 24 }}>
        {/* 移动端返回按钮 */}
        {isMobile && selectedUser && (
          <div style={{ marginBottom: 12 }}>
            <Button type="text" icon={<LeftOutlined />} onClick={() => setSelectedUserId(null)}
              style={{ padding: '4px 8px', fontSize: 13, color: '#6366f1' }}>
              返回用户列表
            </Button>
          </div>
        )}
        {!selectedUser ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', color: '#9ca3af',
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: 'linear-gradient(135deg, #e0e7ff, #ede9fe)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <UserOutlined style={{ fontSize: 36, color: '#818cf8' }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>请从左侧选择一个用户</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>查看其会话和提问历史</div>
          </div>
        ) : loadingConvs ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
            <Spin size="default" />
          </div>
        ) : convs.length === 0 ? (
          <Empty
            description={`${selectedUser.nickname || selectedUser.username} 还没有创建任何对话`}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 80 }}
          />
        ) : (
          <div>
            {/* 用户信息头部 */}
            <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: `linear-gradient(135deg, ${hashColor(String(selectedUser.id))}, ${hashColor(selectedUser.username)})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
                  {(selectedUser.nickname || selectedUser.username)[0].toUpperCase()}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>
                  {selectedUser.nickname || selectedUser.username}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span>@{selectedUser.username}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MessageOutlined style={{ fontSize: 11 }} />
                    {convs.length} 个对话
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <QuestionCircleOutlined style={{ fontSize: 11 }} />
                    {convs.reduce((acc, c) => acc + c.questions.length, 0)} 次提问
                  </span>
                </div>
              </div>
            </div>

            {/* 会话堆栈 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {convs.map((conv, ci) => (
                <StackCard key={conv.id} conv={conv} index={ci} total={convs.length} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 单张堆栈卡片：含会话头部和内部问题子堆栈 */
function StackCard({
  conv,
  index,
  total,
}: {
  conv: ConvWithQuestions
  index: number
  total: number
}) {
  const color = STACK_COLORS[index % STACK_COLORS.length]

  // 按消息堆栈结构（parentMessageId 树）组织提问：前序 DFS 得到严格顺序，
  // 并按从根到该提问经历的「提问轮次」计算缩进层级
  const userItems = useMemo(() => {
    const all = conv.questions as Question[]
    const msgMap = new Map(all.map((m) => [m.id, m]))
    // 子节点映射：parentMessageId -> 子消息
    const childrenMap = new Map<number | null, Question[]>()
    for (const m of all) {
      const key = m.parentMessageId ?? null
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(m)
    }
    const sortByOrder = (a: Question, b: Question) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id
    for (const arr of childrenMap.values()) arr.sort(sortByOrder)

    // 计算某条 user 提问的层级（从根 user 起经历的提问轮次 - 1）
    const levelOf = (q: Question): number => {
      let level = 0
      let cur: Question | undefined = q
      const seen = new Set<number>()
      while (cur && cur.parentMessageId != null) {
        if (seen.has(cur.id)) break
        seen.add(cur.id)
        const parent = msgMap.get(cur.parentMessageId)
        if (!parent) break
        if (parent.role === 'user') level += 1
        cur = parent
      }
      return level
    }

    // 前序 DFS 收集 user 提问（严格遵循堆栈/树结构顺序）
    const items: { q: Question; level: number }[] = []
    const visited = new Set<number>()
    const dfs = (m: Question) => {
      if (visited.has(m.id)) return
      visited.add(m.id)
      if (m.role === 'user') items.push({ q: m, level: levelOf(m) })
      for (const child of childrenMap.get(m.id) ?? []) dfs(child)
    }
    const roots = (childrenMap.get(null) ?? []).slice().sort(sortByOrder)
    for (const r of roots) dfs(r)
    return items
  }, [conv.questions])

  return (
    <div style={{
      position: 'relative',
    }}>
      {/* 底层卡片偏移阴影 - 堆栈效果 */}
      {Array.from({ length: Math.min(3, userItems.length + 1) }).map((_, i) => (
        <div
          key={`shadow-${i}`}
          style={{
            position: 'absolute',
            top: (i + 1) * 4,
            left: (i + 1) * 3,
            right: -(i + 1) * 3,
            bottom: -(i + 1) * 2,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #e5e7eb',
            opacity: 0.4 - i * 0.1,
            zIndex: -i,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* 主卡片 */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {/* 会话标题栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: userItems.length > 0 ? '1px solid #f3f4f6' : 'none',
        }}>
          {/* 左侧彩色条 */}
          <div style={{
            width: 4,
            height: 32,
            borderRadius: 2,
            background: color,
            flexShrink: 0,
          }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={conv.title}>
              <div style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#1f2937',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {conv.title}
              </div>
            </Tooltip>
            <div style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <ClockCircleOutlined style={{ fontSize: 10 }} />
              {formatTime(conv.updated_at || conv.created_at)}
              <span style={{ margin: '0 4px', color: '#d1d5db' }}>|</span>
              <span>{userItems.length} 次提问</span>
            </div>
          </div>

          {/* 会话编号 */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            background: `${color}10`,
            padding: '2px 8px',
            borderRadius: 6,
            flexShrink: 0,
          }}>
            #{total - index}
          </div>
        </div>

        {/* 问题子堆栈（严格按消息堆栈结构排列） */}
        {userItems.length > 0 && (
          <div style={{ padding: '10px 16px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <QuestionCircleOutlined style={{ fontSize: 10 }} />
              提问历史
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {userItems.map(({ q, level }, qi) => (
                <div
                  key={q.id}
                  style={{
                    position: 'relative',
                  }}
                >
                  {/* 问题子卡片 */}
                  <div style={{
                    position: 'relative',
                    background: '#fafbfc',
                    border: '1px solid #f3f4f6',
                    borderRadius: 8,
                    padding: '8px 12px',
                    marginLeft: level * 16,
                  }}>
                    {/* 左侧缺口指示 */}
                    <div style={{
                      position: 'absolute',
                      left: -6, top: 7,
                      width: 9, height: 9,
                      borderRadius: 2,
                      background: '#f3f4f6',
                      transform: 'rotate(45deg)',
                    }} />

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                    }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color,
                        background: `${color}12`,
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}>
                        Q{qi + 1}
                      </span>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>
                        {formatTime(q.created_at)}
                      </span>
                    </div>

                    <div style={{
                      fontSize: 12,
                      color: '#4b5563',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}>
                      {truncate(q.content, 200)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
