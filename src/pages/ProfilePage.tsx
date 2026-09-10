import { useState, useEffect, type ReactNode, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Select, Spin, Empty, message, Drawer, Modal, Radio, Tooltip, Switch, Input, Popconfirm,
} from 'antd'
import {
  ArrowLeftOutlined, IdcardOutlined, ReloadOutlined, PlusOutlined, EditOutlined,
  DeleteOutlined, HistoryOutlined, FundOutlined, FileTextOutlined, TagOutlined, CrownOutlined,
} from '@ant-design/icons'
import { getUser } from './LoginPage'
import { authHeaders, apiGet } from './mindmap/utils'
import { useResponsive } from '../hooks/useResponsive'
import { logAdmin } from '../utils/logger'

const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b']
const colorFor = (i: number) => PALETTE[i % PALETTE.length]

// ===================== 类型 =====================
interface DistSeg { code: string; name: string; count: number }
interface L2Item { name: string; l1: string; code: string; count: number }
interface WindowDist { segments: DistSeg[]; level2: L2Item[] }
interface TrendDay { date: string; total: number; counts: Record<string, number> }
interface Narrative { content: string; sampleCount: number }
interface UserInfo { id: number; username: string; nickname: string | null }
interface AdminUser { id: number; username: string; nickname: string | null }

interface OverviewResp {
  ok: boolean
  target: UserInfo
  profileEnabled: boolean
  coldStart: boolean
  narrativeMinSamples: number
  meta: { total: number; ok: number; failed: number; firstAt: string | null; lastAt: string | null }
  dist: { all: WindowDist; d7: WindowDist; d30: WindowDist }
  trend30: TrendDay[]
  keywords: { keyword: string; count: number }[]
  potentialTopics: { keyword: string; count: number }[]
  narrative: Narrative | null
  narrativeStale: boolean
}

interface DrillItem {
  id: number
  conversationId: string | null
  source: string
  snippet: string
  path: { code: string; name: string }[]
  keywords: string[]
  matched: boolean
  createdAt: string
}

interface DrillResp { ok: boolean; items: DrillItem[]; total: number; hasMore: boolean }

interface TreeNode { code: string; name: string; level: number; parentCode: string | null; sortOrder: number; isEnabled: boolean; children?: TreeNode[] }
interface TreeResp { ok: boolean; tree: TreeNode[] }

const fmtTime = (s?: string | null) => {
  if (!s) return ''
  return new Date(s).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function chunk(date: string) {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { isMobile } = useResponsive()
  const me = getUser()
  const isAdmin = !!me?.isAdmin

  const [users, setUsers] = useState<AdminUser[]>([])
  const [targetUserId, setTargetUserId] = useState<number | null>(null)
  const [data, setData] = useState<OverviewResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [distPeriod, setDistPeriod] = useState<'all' | 'd7' | 'd30'>('all')
  const [trendRange, setTrendRange] = useState<7 | 30>(7)
  const [genNarrativeLoading, setGenNarrativeLoading] = useState(false)
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillCode, setDrillCode] = useState('')
  const [drillName, setDrillName] = useState('')
  const [txOpen, setTxOpen] = useState(false)

  // 当前展示对象 = selected || 自己
  const targetId = targetUserId ?? me?.id ?? null

  // 管理员加载用户列表
  useEffect(() => {
    if (!isAdmin) return
    apiGet('/api/admin/users')
      .then((u: AdminUser[]) => setUsers(Array.isArray(u) ? u : []))
      .catch(() => message.error('加载用户列表失败'))
  }, [isAdmin])

  // 拉取画像总览
  const loadOverview = (userId: number) => {
    setLoading(true)
    setError('')
    apiGet(`/api/profile/overview${userId !== me?.id ? `?userId=${userId}` : ''}`)
      .then((r: OverviewResp) => {
        setData(r)
        if (isAdmin && userId !== me?.id) logAdmin('view_profile', { targetUserId: userId })
      })
      .catch((e: Error) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (targetId) loadOverview(targetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  const self = !!targetId && targetId === me?.id
  const overview = data

  // 账户级开关（仅自己）
  const toggleProfileEnabled = async (v: boolean) => {
    try {
      const res = await fetch('/api/me/profile-enabled', {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ enabled: v }),
      })
      if (!res.ok) throw new Error('操作失败')
      setData((d) => (d ? { ...d, profileEnabled: v } : d))
      message.success(v ? '已开启画像采集' : '已暂停画像采集')
    } catch {
      message.error('操作失败')
    }
  }

  // 生成/刷新自画像
  const generateNarrative = async () => {
    if (!overview) return
    setGenNarrativeLoading(true)
    try {
      const res = await fetch('/api/profile/narrative', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(self ? {} : { userId: targetId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => null)
        throw new Error(e?.error || '生成失败')
      }
      const j = await res.json()
      setData((d) => (d ? { ...d, narrative: { content: j.content, sampleCount: j.sampleCount }, narrativeStale: false } : d))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setGenNarrativeLoading(false)
    }
  }

  // 打开下钻抽屉
  const openDrill = (code: string, name: string) => {
    setDrillCode(code)
    setDrillName(name)
    setDrillOpen(true)
  }

  const targetUser = (targetUserId ? users.find(u => u.id === targetUserId) : null) || me

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>
      {/* ===== 顶栏 ===== */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: '#fff',
        borderBottom: '1px solid #e5e7eb', padding: '0 20px', height: 56,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}
          style={{ color: '#6366f1', fontSize: 15 }}>返回</Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontSize: 15,
          }}>
            <IdcardOutlined />
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, color: '#1f2937', whiteSpace: 'nowrap' }}>人物画像</span>
          {isAdmin && !self && targetUser && (
            <span style={{ fontSize: 12, color: '#f59e0b', background: '#fef3c7', padding: '2px 8px', borderRadius: 6 }}>
              <CrownOutlined /> 管理员视角：{targetUser.nickname || targetUser.username}
            </span>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <Select
            showSearch
            size="small"
            style={{ width: isMobile ? 150 : 220 }}
            placeholder="切换用户"
            optionFilterProp="label"
            value={targetId ?? undefined}
            onChange={(v) => setTargetUserId(v)}
            options={users.map(u => ({ value: u.id, label: `${u.nickname || u.username}（@${u.username}）` }))}
          />
        )}
        {isAdmin && (
          <Button size="small" icon={<EditOutlined />} onClick={() => setTxOpen(true)}>分类树管理</Button>
        )}
      </div>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? 12 : 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spin size="large" /></div>
        ) : error ? (
          <Empty description={error} style={{ paddingTop: 80 }} />
        ) : !overview ? (
          <Empty description="暂无可展示的画像" style={{ paddingTop: 80 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 头部信息条 */}
            <InfoStrip overview={overview} self={self} toggleProfile={toggleProfileEnabled} />

            {/* 自画像 + 采样概况 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <Card title="兴趣自画像" icon={<FileTextOutlined />} style={{ flex: '1 1 340px' }}>
                {overview.narrative ? (
                  <>
                    <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
                      {overview.narrative.content}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      基于 {overview.narrative.sampleCount} 条已归类提问生成
                      <Button size="small" type="link" style={{ padding: 0 }} icon={<ReloadOutlined />}
                        loading={genNarrativeLoading} onClick={generateNarrative}>重新生成</Button>
                    </div>
                  </>
                ) : overview.meta.ok < overview.narrativeMinSamples ? (
                  <div style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontWeight: 500 }}>
                      <HistoryOutlined /> 还需更多提问才能生成自画像
                    </div>
                    <div style={{ marginTop: 8 }}>
                      已归类 {overview.meta.ok} 条，攒够 <b style={{ color: '#6366f1' }}>{overview.narrativeMinSamples}</b> 条即可为你生成一段「你的兴趣自画像」。多聊几轮真实感兴趣的话题吧。
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 10 }}>已可生成自画像文案</div>
                    <Button type="primary" icon={<FileTextOutlined />} loading={genNarrativeLoading} onClick={generateNarrative}>
                      生成我的兴趣自画像
                    </Button>
                  </>
                )}
              </Card>

              <Card title="采样概况" icon={<FundOutlined />} style={{ flex: '1 1 240px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Stat label="总提问" value={overview.meta.total} />
                  <Stat label="已归类" value={overview.meta.ok} accent="#6366f1" />
                  <Stat label="未能归类" value={overview.meta.failed} muted />
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 12, lineHeight: 1.7 }}>
                  {overview.meta.firstAt && overview.meta.lastAt
                    ? `统计范围：${fmtTime(overview.meta.firstAt).split(' ')[0]} 至 ${fmtTime(overview.meta.lastAt).split(' ')[0]}`
                    : '暂无统计样本'}
                </div>
              </Card>
            </div>

            {/* 兴趣分布 */}
            <Card
              title="兴趣分布"
              icon={<FundOutlined />}
              extra={
                <Radio.Group size="small" value={distPeriod} onChange={(e) => setDistPeriod(e.target.value)}
                  options={[
                    { label: '近7天', value: 'd7' },
                    { label: '近30天', value: 'd30' },
                    { label: '全部', value: 'all' },
                  ]}
                />
              }
            >
              {overview.meta.ok === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有任何提问记录" />
              ) : (
                <DistView win={overview.dist[distPeriod]} total={overview.meta.ok} onPick={openDrill} />
              )}
            </Card>

            {/* 时间趋势 */}
            <Card
              title="兴趣时间趋势"
              icon={<HistoryOutlined />}
              extra={
                <Radio.Group size="small" value={trendRange} onChange={(e) => setTrendRange(e.target.value)}
                  options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }]}
                />
              }
            >
              <TrendView days={overview.trend30.slice(-trendRange)} />
            </Card>

            {/* 关键词云 / 潜在话题 */}
            {(overview.keywords.length > 0 || overview.potentialTopics.length > 0) && (
              <Card title="关键词云与潜在话题" icon={<TagOutlined />}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
                  从你提问中提炼的高频词；「潜在话题」来自尚未归入分类树的内容
                </div>
                {overview.keywords.length > 0 && (
                  <WordCloud words={overview.keywords} />
                )}
                {overview.potentialTopics.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f97316', margin: '14px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CrownOutlined style={{ fontSize: 12 }} /> 潜在话题（树外）
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {overview.potentialTopics.map((w) => (
                        <span key={w.keyword} style={{
                          fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a',
                          padding: '3px 10px', borderRadius: 999,
                        }}>
                          {w.keyword}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ===== 下钻抽屉 ===== */}
      {overview && (
        <DrillDrawer open={drillOpen} onClose={() => setDrillOpen(false)}
          codes={drillCode ? [drillCode] : []} title={drillName}
          targetUserId={self ? undefined : (targetId ?? undefined)} />
      )}

      {/* ===== 分类树管理 ===== */}
      <TaxonomyManager open={txOpen} onClose={() => setTxOpen(false)} />
    </div>
  )
}

// ===================== 小组件 =====================
function Card({ title, icon, extra, style, children }: {
  title: string; icon?: ReactNode; extra?: ReactNode; style?: CSSProperties; children: ReactNode
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: '16px 18px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: '#6366f1', fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{title}</span>
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, accent, muted }: { label: string; value: number; accent?: string; muted?: boolean }) {
  return (
    <div style={{
      flex: 1, minWidth: 80, textAlign: 'center', padding: '10px 6px', borderRadius: 10,
      background: muted ? '#f9fafb' : '#f5f3ff', border: `1px solid ${muted ? '#e5e7eb' : '#e0e7ff'}`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || (muted ? '#9ca3af' : '#1f2937') }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function InfoStrip({ overview, self, toggleProfile }: {
  overview: OverviewResp; self: boolean; toggleProfile: (v: boolean) => void
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 20, fontWeight: 600,
      }}>
        {(overview.target.nickname || overview.target.username).slice(0, 1).toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
          {overview.target.nickname || overview.target.username}
          {!overview.profileEnabled && (
            <span style={{ fontSize: 11, fontWeight: 500, color: '#ef4444', background: '#fef2f2', padding: '2px 8px', borderRadius: 6 }}>
              已暂停采集
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>@{overview.target.username} · 累计提问 {overview.meta.total} 次</div>
      </div>
      <div style={{ flex: 1 }} />
      {overview.coldStart && overview.meta.ok > 0 && (
        <div style={{ fontSize: 12, color: '#6366f1', background: '#eef2ff', padding: '5px 10px', borderRadius: 8 }}>
          画像采集中，再聊一些会让画像更准确
        </div>
      )}
      {overview.meta.failed > 0 && (
        <Tooltip title="部分提问因模型暂时不可用未能完成兴趣归类，不影响后续采集">
          <span style={{ fontSize: 11, color: '#9ca3af', background: '#f9fafb', padding: '4px 8px', borderRadius: 6 }}>
            {overview.meta.failed} 条未归类
          </span>
        </Tooltip>
      )}
      {self && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>采集</span>
          <Switch size="small" checked={overview.profileEnabled} onChange={toggleProfile} />
        </div>
      )}
    </div>
  )
}

function DistView({ win, total, onPick }: {
  win: WindowDist; total: number; onPick: (code: string, name: string) => void
}) {
  const segs = win.segments
  if (segs.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时间段暂无已归类样本" />

  // 环形图 conic-gradient
  let acc = 0
  const stops: string[] = []
  segs.forEach((s, i) => {
    const pct = (s.count / total) * 100
    const from = acc
    const to = acc + pct
    stops.push(`${colorFor(i)} ${from}% ${to}%`)
    acc = to
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 环形 + 中心 */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 168, height: 168, borderRadius: '50%', background: `conic-gradient(${stops.join(',')})`, flexShrink: 0 }}>
            <div style={{
              position: 'absolute', inset: 30, borderRadius: '50%', background: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1f2937' }}>{total}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>总样本</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            {/* 一级图例 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {segs.map((s, i) => (
                <div key={s.code || i} onClick={() => s.code && onPick(s.code, s.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 8,
                    cursor: s.code ? 'pointer' : 'default',
                  }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(i), flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{s.count}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', width: 44, textAlign: 'right' }}>
                    {Math.round((s.count / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 二级 Top */}
      {win.level2.length > 0 && (
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>细分话题 TOP</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {win.level2.map((l2, i) => (
              <span key={l2.code + i}
                onClick={() => l2.code && onPick(l2.code, l2.name)}
                style={{
                  fontSize: 12, color: '#4b5563', background: '#f9fafb', border: '1px solid #e5e7eb',
                  padding: '4px 10px', borderRadius: 999, cursor: l2.code ? 'pointer' : 'default',
                }}>
                {l2.name} · {l2.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TrendView({ days }: { days: TrendDay[] }) {
  if (days.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时间段暂无样本" />
  const maxTotal = Math.max(...days.map(d => d.total), 1)
  const BAR_MAX = 150
  // 出现过的分类名
  const cats: string[] = []
  for (const d of days) for (const name of Object.keys(d.counts)) {
    if (!cats.includes(name)) cats.push(name)
  }
  const catColor = (name: string) => colorFor(cats.indexOf(name))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {cats.map((name) => (
          <span key={name} style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(name) }} />{name}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, minWidth: days.length * 26 }}>
          {days.map((d) => {
            const entries = Object.entries(d.counts)
            const colH = Math.max(8, (d.total / maxTotal) * BAR_MAX)
            return (
              <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 20 }}>
                <Tooltip title={`${d.date}：${d.total} 条`}>
                  <div style={{
                    width: '100%', height: colH, borderRadius: '4px 4px 0 0', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  }}>
                    {entries.map(([name, count]) => (
                      <div key={name} title={`${name} ${count}`}
                        style={{ width: '100%', flexGrow: count, background: catColor(name), minHeight: 2 }} />
                    ))}
                  </div>
                </Tooltip>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, writingMode: 'vertical-lr' as const, transform: 'rotate(180deg)', maxHeight: 46, overflow: 'hidden' }}>
                  {d.total > 0 ? chunk(d.date) : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WordCloud({ words }: { words: { keyword: string; count: number }[] }) {
  const max = Math.max(...words.map(w => w.count), 1)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {words.map((w) => {
        const ratio = w.count / max
        const size = 12 + Math.round(ratio * 8)
        const color = ratio > 0.7 ? '#6366f1' : ratio > 0.4 ? '#8b5cf6' : '#6b7280'
        return (
          <Tooltip key={w.keyword} title={`出现 ${w.count} 次`}>
            <span style={{
              fontSize: size, color, fontWeight: ratio > 0.55 ? 600 : 400,
              background: ratio > 0.55 ? '#eef2ff' : '#f3f4f6',
              padding: '2px 10px', borderRadius: 999, cursor: 'default',
            }}>
              {w.keyword}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ===================== 下钻抽屉 =====================
function DrillDrawer({ open, onClose, codes, title, targetUserId }: {
  open: boolean; onClose: () => void; codes: string[]; title: string; targetUserId?: number
}) {
  const [items, setItems] = useState<DrillItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)

  const load = async (reset = false) => {
    const off = reset ? 0 : offset
    setLoading(true)
    try {
      const qs = new URLSearchParams({ codes: codes.join(','), limit: '50', offset: String(off) })
      if (targetUserId) qs.set('userId', String(targetUserId))
      const r = (await apiGet(`/api/profile/queries?${qs}`)) as DrillResp
      setItems(reset ? r.items : (prev) => [...prev, ...r.items])
      setTotal(r.total)
      setOffset(off + r.items.length)
    } catch { message.error('加载失败') } finally { setLoading(false) }
  }

  useEffect(() => {
    if (open) {
      setItems([]); setOffset(0)
      load(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, codes.join(',')])

  return (
    <Drawer title={`「${title}」相关提问 ${total} 条`} open={open} onClose={onClose}
      width="min(560px, 100vw)">
      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 60 }}><Spin /></div>
      ) : items.length === 0 ? (
        <Empty description="暂无相关提问" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{ background: '#fafbfc', border: '1px solid #f3f4f6', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', padding: '1px 6px', borderRadius: 4 }}>
                  {it.source === 'personality' ? '人格体验' : '对话'}
                </span>
                {it.path.map((p) => (
                  <span key={p.code} style={{ fontSize: 10, color: '#6366f1', background: '#eef2ff', padding: '1px 6px', borderRadius: 4 }}>
                    {p.name}
                  </span>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: '#9ca3af' }}>{fmtTime(it.createdAt)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6, wordBreak: 'break-word' }}>
                {it.snippet || '（无文字内容的图片提问）'}
              </div>
              {it.keywords.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {it.keywords.map((k) => (
                    <span key={k} style={{ fontSize: 10, color: '#9ca3af' }}>#{k}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {offset < total && (
            <div style={{ textAlign: 'center', padding: 8 }}>
              <Button loading={loading} onClick={() => load(false)}>加载更多（{offset}/{total}）</Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

// ===================== 分类树管理（管理员） =====================
function TaxonomyManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; node: TreeNode | null } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = (await apiGet('/api/profile/taxonomy?all=1')) as TreeResp
      setTree(r.tree || [])
    } catch { message.error('加载分类树失败') } finally { setLoading(false) }
  }

  useEffect(() => {
    if (open) { setTree(null); load() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutate = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      const e = await res.json().catch(() => null)
      throw new Error(e?.error || '操作失败')
    }
  }

  const saveNode = async (payload: { code?: string; name: string; parentCode: string | null; sortOrder?: number }) => {
    try {
      if (editing?.mode === 'add') {
        await mutate('POST', '/api/profile/taxonomy', payload)
      } else if (editing?.node) {
        await mutate('PUT', `/api/profile/taxonomy/${editing.node.code}`, { name: payload.name, sortOrder: payload.sortOrder })
      }
      message.success('已保存')
      setEditing(null)
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (node: TreeNode) => {
    try {
      await mutate('PUT', `/api/profile/taxonomy/${node.code}`, { isEnabled: !node.isEnabled })
      await load()
    } catch { message.error('操作失败') }
  }

  const removeNode = async (node: TreeNode) => {
    try {
      await mutate('DELETE', `/api/profile/taxonomy/${node.code}`)
      message.success('已删除')
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const flatten = (nodes: TreeNode[], depth = 0, out: { n: TreeNode; depth: number }[] = []): { n: TreeNode; depth: number }[] => {
    for (const n of nodes) {
      out.push({ n, depth })
      if (n.children?.length) flatten(n.children, depth + 1, out)
    }
    return out
  }
  const rows = tree ? flatten(tree) : []

  return (
    <Modal title="兴趣分类树管理" open={open} onCancel={onClose} footer={null} width="min(720px, 100vw)">
      <div style={{ marginBottom: 12, fontSize: 12, color: '#9ca3af', lineHeight: 1.7 }}>
        分类会随升级自动补齐默认节点；停用后新提问不再归入该节点，历史样本保留。删除仅允许叶子节点。
      </div>
      <div style={{ marginBottom: 10, textAlign: 'right' }}>
        <Button size="small" type="primary" ghost icon={<PlusOutlined />}
          onClick={() => setEditing({ mode: 'add', node: null })}>新增一级分类</Button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" />
      ) : (
        <div style={{ maxHeight: '56vh', overflowY: 'auto' }}>
          {rows.map(({ n, depth }, idx) => (
            <div key={n.code} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 4px', borderRadius: 6,
              background: idx % 2 ? 'transparent' : '#fafbfc', marginLeft: depth * 16,
            }}>
              <span style={{ fontSize: 12, color: depth === 0 ? '#1f2937' : '#4b5563', fontWeight: depth === 0 ? 600 : 400, flex: 1, minWidth: 0 }}>
                {depth > 0 && <span style={{ color: '#d1d5db' }}>└ </span>}{n.name}
                <span style={{ color: '#cbd5e1', marginLeft: 6, fontSize: 11 }}>{n.code}</span>
                {!n.isEnabled && <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 6 }}>[停用]</span>}
              </span>
              <Button size="small" type="text" icon={<PlusOutlined />} title="添加子分类"
                onClick={() => setEditing({ mode: 'add', node: n })} />
              <Button size="small" type="text" icon={<EditOutlined />} title="改名/排序"
                onClick={() => setEditing({ mode: 'edit', node: n })} />
              <Button size="small" type="text" style={{ color: n.isEnabled ? '#9ca3af' : '#22c55e' }}
                onClick={() => toggleEnabled(n)}>{n.isEnabled ? '停用' : '启用'}</Button>
              <Popconfirm title={`删除「${n.name}」？`} description="历史样本将保留但不再纳入该分类" onConfirm={() => removeNode(n)}
                disabled={!!(n.children && n.children.length)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!!(n.children && n.children.length)} title={n.children?.length ? '请先删除子分类' : '删除'} />
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <NodeEditorModal
          mode={editing.mode}
          parent={editing.node}
          onCancel={() => setEditing(null)}
          onSave={saveNode}
        />
      )}
    </Modal>
  )
}

function NodeEditorModal({ mode, parent, onCancel, onSave }: {
  mode: 'add' | 'edit'
  parent: TreeNode | null
  onCancel: () => void
  onSave: (payload: { code?: string; name: string; parentCode: string | null; sortOrder?: number }) => void
}) {
  const [name, setName] = useState(mode === 'edit' ? parent?.name || '' : '')
  const [code, setCode] = useState('')
  const [sortOrder, setSortOrder] = useState(mode === 'edit' ? parent?.sortOrder || 0 : 0)
  const isAdd = mode === 'add'

  return (
    <Modal
      title={isAdd ? (parent ? `在「${parent.name}」下添加子分类` : '新增一级分类') : `编辑「${parent?.name}」`}
      open
      onCancel={onCancel}
      onOk={() => onSave(isAdd ? { code, name, parentCode: parent?.code || null, sortOrder } : { name, parentCode: parent?.code || null, sortOrder })}
      okText="保存" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() || (isAdd && !/^[a-z0-9][a-z0-9-]{1,62}$/i.test(code.trim())) }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>名称</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="分类显示名" maxLength={32} />
        </div>
        {isAdd && (
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>
              唯一标识 code（字母/数字/中划线，创建后不可改，用于历史归类）
            </div>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：my-hobby" maxLength={64} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>排序（越小越靠前）</div>
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
        </div>
      </div>
    </Modal>
  )
}
