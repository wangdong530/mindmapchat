/**
 * 人物画像：HTTP API 路由
 *   - GET  /api/profile/overview       聚合画像（本人；管理员可通过 ?userId= 查看他人）
 *   - GET  /api/profile/queries        下钻某分类的相关提问（只含截断片段）
 *   - POST /api/profile/narrative      生成/刷新兴趣自画像文案（LLM）
 *   - PUT  /api/me/profile-enabled     账户级采集总开关
 *   - GET  /api/profile/taxonomy       分类树（仅管理员，维护用）
 *   - POST /api/profile/taxonomy       新建分类（仅管理员）
 *   - PUT  /api/profile/taxonomy/:code 修改分类（仅管理员）
 *   - DELETE /api/profile/taxonomy/:code 删除叶子分类（仅管理员）
 */
import pool, { getGlobalConfig } from './db.js'
import * as profileDb from './profile-db.js'
import { callLLM, limitVisibleText } from './chat-proxy.js'

const MIN_NARRATIVE_SAMPLES = 30 // 攒够多少条才生成自画像文案
const COLD_START_SAMPLES = 8 // 低于该条数视作冷启动（页面引导）

export function registerProfileRoutes(app, { authMiddleware, requireAdmin, opLog }) {
  // ===================== 账户级采集总开关 =====================
  app.put('/api/me/profile-enabled', authMiddleware, async (req, res, next) => {
    try {
      const enabled = !!req.body?.enabled
      await profileDb.setUserProfileEnabled(pool, req.user.id, enabled)
      res.json({ ok: true, profileEnabled: enabled })
      opLog(req, 'update_profile_enabled', 'profile', { enabled })
    } catch (err) { next(err) }
  })

  // ===================== 画像总览 =====================
  app.get('/api/profile/overview', authMiddleware, async (req, res, next) => {
    try {
      const targetId = resolveTargetId(req, req.query.userId)
      if (targetId.error) return res.status(403).json({ error: targetId.error })
      const userId = targetId.id

      const user = await pool.query('SELECT id, username, nickname FROM users WHERE id = $1', [userId]).then(r => r.rows[0])
      if (!user) return res.status(404).json({ error: '用户不存在' })
      const rows = await profileDb.loadSamples(pool, { userId })
      const overview = analyzeRows(rows, userId)

      const profileEnabled = await profileDb.getUserProfileEnabled(pool, userId)
      const narrative = await profileDb.getNarrative(pool, userId)
      const narrativeStale = !!(narrative && narrative.sampleCount !== overview.meta.ok)

      const [keywords, potentialTopics] = await Promise.all([
        profileDb.keywordTop(pool, { userId, onlyMatched: null, limit: 50 }).catch(() => []),
        profileDb.keywordTop(pool, { userId, onlyMatched: false, limit: 20 }).catch(() => []),
      ])

      res.json({
        ok: true,
        target: user,
        profileEnabled,
        coldStart: overview.meta.ok < COLD_START_SAMPLES,
        narrativeMinSamples: MIN_NARRATIVE_SAMPLES,
        meta: overview.meta,
        dist: overview.dist,
        trend30: overview.trend30,
        keywords,
        potentialTopics,
        narrative: narrative && !narrativeStale ? narrative : null,
        narrativeStale,
      })
    } catch (err) { next(err) }
  })

  // ===================== 生成/刷新自画像 =====================
  app.post('/api/profile/narrative', authMiddleware, async (req, res, next) => {
    try {
      const targetId = resolveTargetId(req, req.body?.userId)
      if (targetId.error) return res.status(403).json({ error: targetId.error })
      const userId = targetId.id

      const rows = await profileDb.loadSamples(pool, { userId })
      const overview = analyzeRows(rows, userId)
      if (overview.meta.ok < MIN_NARRATIVE_SAMPLES) {
        return res.status(400).json({ error: `样本不足，至少需要 ${MIN_NARRATIVE_SAMPLES} 条已归类提问才能生成画像（当前 ${overview.meta.ok} 条）` })
      }

      const globalConfig = await getGlobalConfig().catch(() => null)
      const content = await callLLM(buildNarrativeMessages(overview), { temperature: 0.6 }, globalConfig, { maxTokens: 420 })
        .catch(() => null)
      if (!content) return res.status(500).json({ error: '画像生成失败，请确认模型配置后重试' })

      const finalText = limitVisibleText(content, 360)
      await profileDb.upsertNarrative(pool, userId, finalText, overview.meta.ok)
      res.json({ ok: true, content: finalText, sampleCount: overview.meta.ok })
      opLog(req, 'generate_profile_narrative', 'profile', { userId, sampleCount: overview.meta.ok })
    } catch (err) { next(err) }
  })

  // ===================== 分类下钻 =====================
  app.get('/api/profile/queries', authMiddleware, async (req, res, next) => {
    try {
      const targetId = resolveTargetId(req, req.query.userId)
      if (targetId.error) return res.status(403).json({ error: targetId.error })
      const userId = targetId.id

      const codes = String(req.query.codes || '').split(',').map(s => s.trim()).filter(Boolean)
      const limit = Math.min(parseInt(req.query.limit) || 50, 100)
      const offset = Math.max(parseInt(req.query.offset) || 0, 0)
      const [items, total] = await Promise.all([
        profileDb.listQueryClassifications(pool, { userId, codes, limit, offset }),
        profileDb.countQueryClassifications(pool, { userId, codes }),
      ])
      res.json({ ok: true, items, total, hasMore: offset + items.length < total })
    } catch (err) { next(err) }
  })

  // ===================== 分类树管理（管理员） =====================
  app.get('/api/profile/taxonomy', authMiddleware, requireAdmin, async (req, res, next) => {
    try {
      const includeDisabled = req.query.all === '1'
      const tree = await profileDb.getTaxonomyTree(pool, { includeDisabled })
      res.json({ ok: true, tree })
      opLog(req, 'view_profile_taxonomy', 'profile', {})
    } catch (err) { next(err) }
  })

  app.post('/api/profile/taxonomy', authMiddleware, requireAdmin, async (req, res, next) => {
    try {
      const { code, name, parentCode, sortOrder } = req.body || {}
      await profileDb.createTaxonomyNode(pool, { code, name, parentCode: parentCode || null, sortOrder })
      res.json({ ok: true })
      opLog(req, 'create_profile_taxonomy', 'profile', { code, name, parentCode: parentCode || null })
    } catch (err) {
      if (err && err.message && /存在|父分类|最多|不能为空/.test(err.message)) {
        return res.status(400).json({ error: err.message })
      }
      next(err)
    }
  })

  app.put('/api/profile/taxonomy/:code', authMiddleware, requireAdmin, async (req, res, next) => {
    try {
      const { name, sortOrder, isEnabled } = req.body || {}
      await profileDb.updateTaxonomyNode(pool, req.params.code, { name, sortOrder, isEnabled })
      res.json({ ok: true })
      opLog(req, 'update_profile_taxonomy', 'profile', { code: req.params.code })
    } catch (err) { next(err) }
  })

  app.delete('/api/profile/taxonomy/:code', authMiddleware, requireAdmin, async (req, res, next) => {
    try {
      await profileDb.deleteTaxonomyNode(pool, req.params.code)
      res.json({ ok: true })
      opLog(req, 'delete_profile_taxonomy', 'profile', { code: req.params.code })
    } catch (err) {
      if (err && err.message && /子分类/.test(err.message)) return res.status(400).json({ error: err.message })
      next(err)
    }
  })
}

// 解析目标用户：非本人只能管理员查看
function resolveTargetId(req, queryUserId) {
  if (!queryUserId) return { id: req.user.id }
  const targetId = parseInt(queryUserId)
  if (!targetId) return { error: '参数错误' }
  if (targetId !== req.user.id && !req.user.isAdmin) return { error: '无权限查看他人画像' }
  return { id: targetId }
}

// ===================== 分析聚合（内存，单用户量级可接受） =====================
function analyzeRows(rows, userId) {
  const okRows = rows.filter(r => r.status === 'ok')
  const failed = rows.length - okRows.length
  const dates = rows.map(r => r.createdAt).filter(Boolean)
  const meta = {
    total: rows.length,
    ok: okRows.length,
    failed,
    firstAt: dates.length ? new Date(Math.min(...dates.map(d => +new Date(d)))) : null,
    lastAt: dates.length ? new Date(Math.max(...dates.map(d => +new Date(d)))) : null,
  }

  const now = Date.now()
  const DAY = 86400000

  // 每个窗口返回：一级分布（含“其他”）+ 二级 Top 明细
  const computeWindow = (days) => {
    const inRows = days
      ? okRows.filter(r => r.createdAt && now - +new Date(r.createdAt) <= days * DAY)
      : okRows

    const level1Map = new Map() // key: `${code}\u0000${name}` -> count
    const level2List = []
    const level2Meta = new Map()
    for (const r of inRows) {
      const code = r.path?.[0]?.code || (r.matched ? '__unknown__' : '__other__')
      const name = r.path?.[0]?.name || (r.matched ? '未归类' : '其他')
      const key = code + '\u0000' + name
      level1Map.set(key, (level1Map.get(key) || 0) + 1)

      const l2 = r.path?.[1]
      if (l2) {
        const l2key = `${code}/${l2.code}\u0000${l2.name}`
        if (!level2Meta.has(l2key)) level2Meta.set(l2key, { name: l2.name, l1: name, code: l2.code, count: 0 })
        level2Meta.get(l2key).count++
      }
    }

    const segments = Array.from(level1Map.entries())
      .map(([key, count]) => {
        const idx = key.indexOf('\u0000')
        return { code: key.slice(0, idx), name: key.slice(idx + 1), count }
      })
      .sort((a, b) => b.count - a.count)

    const level2 = Array.from(level2Meta.values()).sort((a, b) => b.count - a.count).slice(0, 8)
    return { segments, level2 }
  }

  const all = computeWindow(null)
  const d7 = computeWindow(7)
  const d30 = computeWindow(30)

  // 近30天逐日一级占比（用于趋势折线/热力）
  const trend30 = []
  const byDate = new Map()
  for (const r of okRows) {
    if (!r.createdAt || now - +new Date(r.createdAt) > 30 * DAY) continue
    const d = new Date(r.createdAt)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const name = r.path?.[0]?.name || (r.matched ? '未归类' : '其他')
    if (!byDate.has(dateKey)) byDate.set(dateKey, {})
    const m = byDate.get(dateKey)
    m[name] = (m[name] || 0) + 1
  }
  const ordered = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  for (const [date, counts] of ordered) {
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    trend30.push({ date, total, counts })
  }

  return { meta, dist: { all, d7, d30 }, trend30 }
}

// 自画像文案的模型输入
function buildNarrativeMessages(overview) {
  const top = overview.dist.all.segments.slice(0, 6)
  const lines = top.map((s, i) => `${i + 1}. ${s.name}（占比 ${Math.round((s.count / Math.max(overview.meta.ok, 1)) * 100)}%，${s.count} 次）`)
  const level2 = overview.dist.all.level2.slice(0, 8).map(s => s.name).join('、')
  return [
    {
      role: 'system',
      content: '你是温和有趣的兴趣分析师。根据用户的提问兴趣统计数据，用第二人称“你”写一段 80—180 个可见字符的中文自画像，突出最显著的兴趣特征、稳定的偏好与一两个值得展开的潜在方向。语气自然像朋友聊天，不要贴标签、不要逐条罗列数据、不要使用 Markdown。',
    },
    {
      role: 'user',
      content: `兴趣分布（按占比排序）：\n${lines.join('\n')}\n高频细分话题：${level2 || '（暂无）'}\n请据此输出自画像。`,
    },
  ]
}
