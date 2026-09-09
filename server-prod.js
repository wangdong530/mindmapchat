import express from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { fileURLToPath } from 'url'
import { createChatHandler, callLLM, retryAsync, limitVisibleText, buildPersonaMessages } from './chat-proxy.js'
import pool, {
  createUser, findUserByUsername, updateUserNickname, getAllUsers, getUserConversationsWithQuestions,
  getConversations, createConversation, getOrCreateRoleConversation, updateConversation, deleteConversation,
  getConversationMeta,
  getPanels, createPanel, updatePanelSummary,
  getMessages, createMessage, updateMessageContent,
  getUserConfig, saveUserConfig,
  getGlobalConfig, saveGlobalConfig,
  insertLog, getLogs,
  getRoleTemplates, getAllRoleTemplates, createRoleTemplate, updateRoleTemplate, deleteRoleTemplate,
  ADMIN_USERNAMES, grantAdminByUsername,
} from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// JWT 密钥必须由环境变量提供，缺失则拒绝启动，避免使用不安全的默认值。
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('[FATAL] 缺少环境变量 JWT_SECRET，请先配置后启动。')
  process.exit(1)
}
const TOKEN_EXPIRY = '7d'

const app = express()
app.use(express.json({ limit: '10mb' }))

// ===================== 上传目录 =====================
const UPLOAD_DIR = path.join(__dirname, 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// 静态文件服务：图片上传访问
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }))

// ===================== JWT 中间件 =====================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' })
  }
  try {
    const token = authHeader.slice(7)
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }
}

// 管理员权限中间件：仅 is_admin=true 的用户（MINDMAPCHAT_ADMIN_USERNAME 白名单）可通过
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '无权限：仅管理员可配置模型与密钥' })
  }
  next()
}

// ===================== 操作日志辅助函数 =====================

/**
 * 记录后端操作日志到数据库
 * @param {Object} req - Express request 对象
 * @param {string} action - 操作名称
 * @param {string} category - 操作分类
 * @param {Object|string|null} detail - 详情
 */
function opLog(req, action, category, detail) {
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null
  insertLog({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action,
    category,
    detail: detailStr,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers?.['user-agent'] || null,
  }).catch(() => {}) // 日志写入失败不影响主流程
}

// 不依赖 JWT 中间件的日志（用于登录/注册等未认证操作）
function opLogAnon(req, action, category, detail) {
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null
  insertLog({
    userId: null,
    username: req.body?.username ?? null,
    action,
    category,
    detail: detailStr,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers?.['user-agent'] || null,
  }).catch(() => {})
}

// ===================== 认证接口 =====================

// 注册
app.post('/api/register', async (req, res, next) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    if (password.length < 4) {
      return res.status(400).json({ error: '密码至少4位' })
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(username)) {
      return res.status(400).json({ error: '用户名2-20位，支持字母数字下划线和中文' })
    }

    const existing = await findUserByUsername(username)
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await createUser(username, passwordHash)
    // 若用户名命中管理员白名单（MINDMAPCHAT_ADMIN_USERNAME），注册后立即授予管理员权限
    const isAdmin = ADMIN_USERNAMES.includes(username)
    if (isAdmin) await grantAdminByUsername(username)

    const token = jwt.sign({ id: user.id, username: user.username, isAdmin }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })
    res.json({ token, user: { id: user.id, username: user.username, nickname: user.nickname, isAdmin } })
    opLogAnon(req, 'login', 'auth', { username: user.username, userId: user.id })
    opLogAnon(req, 'register', 'auth', { username: user.username, userId: user.id })
  } catch (err) {
    next(err)
  }
})

// 登录
app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }

    const user = await findUserByUsername(username)
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }

    const token = jwt.sign({ id: user.id, username: user.username, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })
    res.json({ token, user: { id: user.id, username: user.username, nickname: user.nickname, isAdmin: !!user.is_admin } })
    opLogAnon(req, 'login', 'auth', { username: user.username, userId: user.id })
    opLogAnon(req, 'login', 'auth', { username: user.username, userId: user.id })
  } catch (err) {
    next(err)
  }
})

// 更新用户昵称
app.put('/api/me/nickname', authMiddleware, async (req, res, next) => {
  try {
    const { nickname } = req.body
    if (nickname !== undefined && (typeof nickname !== 'string' || nickname.length > 50)) {
      return res.status(400).json({ error: '昵称最多50个字符' })
    }
    await updateUserNickname(req.user.id, nickname || null)
    res.json({ ok: true, nickname })
    opLog(req, 'update_nickname', 'settings', { nickname: nickname || null })
  } catch (err) {
    next(err)
  }
})

// 获取当前用户信息
app.get('/api/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await findUserByUsername(req.user.username)
    if (!user) return res.status(404).json({ error: '用户不存在' })
    res.json({ id: user.id, username: user.username, nickname: user.nickname, isAdmin: !!user.is_admin })
  } catch (err) {
    next(err)
  }
})

// ===================== 管理展示接口 =====================

// 获取所有注册用户（仅管理员）
app.get('/api/admin/users', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const users = await getAllUsers()
    res.json(users)
    opLog(req, 'view_users', 'admin', {})
  } catch (err) {
    next(err)
  }
})

// 获取指定用户的会话及提问（仅管理员）
app.get('/api/admin/users/:userId/questions', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const data = await getUserConversationsWithQuestions(parseInt(req.params.userId))
    res.json(data)
    opLog(req, 'view_user_questions', 'admin', { targetUserId: parseInt(req.params.userId) })
  } catch (err) {
    next(err)
  }
})

// ===================== 会话接口 =====================

// 获取会话列表
app.get('/api/conversations', authMiddleware, async (req, res, next) => {
  try {
    const convs = await getConversations(req.user.id)
    res.json(convs)
  } catch (err) {
    next(err)
  }
})

// 创建会话（保存面板一起）
app.post('/api/conversations', authMiddleware, async (req, res, next) => {
  try {
    const { id, title, panels, group, pinned } = req.body
    if (!id || !title) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    await createConversation(id, req.user.id, title, req.body.background, group, pinned)

    // 保存所有面板
    if (panels && Array.isArray(panels)) {
      for (const p of panels) {
        await createPanel(p.id, id, p.parentId, p.title, p.sourceMessageId, p.sourceSuggestionIndex)
        // 保存面板内的消息
        if (p.messages && Array.isArray(p.messages)) {
          for (const m of p.messages) {
            await createMessage(m.id, p.id, m.role, m.content, m.parentMessageId, m.suggestions, m.reasoning, m.images)
          }
        }
      }
    }

    res.json({ ok: true })
    opLog(req, 'create_conversation', 'conversation', { convId: id, title, group, pinned })
  } catch (err) {
    next(err)
  }
})

// 更新会话标题
app.put('/api/conversations/:id', authMiddleware, async (req, res, next) => {
  try {
    const { title, background, convSystem, convTemperature, convThinking, convReasoning, group, greeting, pinned } = req.body
    await updateConversation(req.params.id, {
      title,
      background,
      convSystem,
      convTemperature,
      convThinking,
      convReasoning,
      convGroup: group,
      greeting,
      pinned,
    })
    res.json({ ok: true })
    opLog(req, 'update_conversation', 'conversation', { convId: req.params.id, title })
  } catch (err) {
    next(err)
  }
})

// 删除会话
app.delete('/api/conversations/:id', authMiddleware, async (req, res, next) => {
  try {
    const deletedConvId = req.params.id
    await deleteConversation(deletedConvId)
    res.json({ ok: true })
    opLog(req, 'delete_conversation', 'conversation', { convId: deletedConvId })
  } catch (err) {
    next(err)
  }
})

// 加载整个会话（含面板和消息 + 同步版本号）
app.get('/api/conversations/:id/full', authMiddleware, async (req, res, next) => {
  try {
    const panels = await getPanels(req.params.id)
    const panelsWithMessages = await Promise.all(
      panels.map(async (p) => {
        const messages = await getMessages(p.id)
        return { ...p, messages }
      }),
    )
    const meta = await getConversationMeta(req.params.id)
    res.json({
      panels: panelsWithMessages,
      dataVersion: meta?.dataVersion ?? 0,
      title: meta?.title ?? '',
      background: meta?.background ?? null,
      convSystem: meta?.convSystem ?? null,
      convTemperature: meta?.convTemperature ?? null,
      convThinking: meta?.convThinking ?? null,
      convReasoning: meta?.convReasoning ?? null,
      updatedAt: meta?.updated_at ?? null,
      lockOwner: meta?.lockOwner ?? null,
      lockLabel: meta?.lockLabel ?? null,
      lockExpiresAt: meta?.lockExpiresAt ?? null,
      greeting: meta?.greeting ?? null,
      roleTemplateId: meta?.roleTemplateId ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// 保存面板（创建或更新）
app.post('/api/panels', authMiddleware, async (req, res, next) => {
  try {
    const { id, conversationId, parentId, title, sourceMessageId, sourceSuggestionIndex, type } = req.body
    await createPanel(id, conversationId, parentId, title, sourceMessageId, sourceSuggestionIndex, type)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// 总结单个容器节点：前端组装待总结文本（自身消息 + 已总结子分支摘要），
// 后台调用大模型生成摘要并落库到 panels.summary
app.post('/api/panels/:id/summarize', authMiddleware, async (req, res, next) => {
  try {
    const panelId = req.params.id
    const { text, msgCount, provider, apiKey, region, workspaceId, baseUrl, model, temperature } = req.body
    if (!text || !text.trim()) {
      return res.status(400).json({ error: '缺少待总结内容' })
    }
    // 复用服务端全局配置（管理员配置），与正常对话的配置回退链路一致
    const globalConfig = await getGlobalConfig().catch(() => null)
    const SUMMARY_PROMPT = '你是一个对话总结助手。请将下面的对话分支内容总结为简洁、结构化的要点，保留关键事实、决策、结论、待办事项与未解决的问题。使用中文，篇幅不超过原文的三分之一，不要编造信息。'
    const summary = await callLLM(
      [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: text },
      ],
      { provider, apiKey, region, workspaceId, baseUrl, model, temperature },
      globalConfig,
      { defaultProvider: 'aliyun', defaultRegion: 'bj', defaultWorkspaceId: process.env.ALIYUN_WORKSPACE_ID || '', defaultModel: 'qwen3.7-max' },
    )
    const finalCount = msgCount != null ? parseInt(msgCount, 10) : 0
    await updatePanelSummary(panelId, summary, finalCount)
    res.json({ ok: true, summary, msgCount: finalCount })
    opLog(req, 'summarize_panel', 'chat', { panelId, inputLength: text.length, outputLength: (summary || '').length })
  } catch (err) {
    console.error('[summarize] 总结失败:', err && err.message ? err.message : err)
    res.status(500).json({ error: '总结失败: ' + (err && err.message ? err.message : '未知错误') })
  }
})

// 保存消息
app.post('/api/messages', authMiddleware, async (req, res, next) => {
  try {
    const { id, panelId, role, content, parentMessageId, suggestions, reasoning, images } = req.body
    await createMessage(id, panelId, role, content, parentMessageId, suggestions, reasoning, images)
    res.json({ ok: true })
    opLog(req, 'create_message', 'chat', { messageId: id, panelId, role, contentLength: content?.length ?? 0, hasImages: !!(images && images.length) })
  } catch (err) {
    next(err)
  }
})

// 更新消息（流式输出完成后更新 AI 回复内容）
app.put('/api/messages/:id', authMiddleware, async (req, res, next) => {
  try {
    const { panelId, content, suggestions, reasoning, images } = req.body
    await updateMessageContent(parseInt(req.params.id), panelId, content, suggestions, reasoning, images)
    res.json({ ok: true })
    opLog(req, 'update_message', 'chat', { messageId: parseInt(req.params.id), panelId, contentLength: content?.length ?? 0 })
  } catch (err) {
    next(err)
  }
})

// 批量保存会话（全量同步面板和消息）
app.post('/api/conversations/:id/sync', authMiddleware, async (req, res, next) => {
  let client
  try {
    client = await pool.connect()
    const convId = req.params.id
    const { title, panels } = req.body
    await client.query('BEGIN')

    if (title) {
      await client.query('UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2', [title, convId])
    }

    if (panels && Array.isArray(panels)) {
      await client.query('DELETE FROM messages WHERE panel_id IN (SELECT id FROM panels WHERE conversation_id = $1)', [convId])
      await client.query('DELETE FROM panels WHERE conversation_id = $1', [convId])

      for (const p of panels) {
        await client.query(
          `INSERT INTO panels (id, conversation_id, parent_id, title, type, source_message_id, source_suggestion_index, summary, summary_msg_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            p.id, convId, p.parentId || null, p.title, p.type || 'container',
            p.sourceMessageId || null, p.sourceSuggestionIndex ?? 0,
            p.summary || null, p.summaryMsgCount ?? 0,
          ],
        )
        if (p.messages && Array.isArray(p.messages)) {
          for (const m of p.messages) {
            await client.query(
              `INSERT INTO messages (id, panel_id, role, content, parent_message_id, suggestions, reasoning, images)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                m.id, p.id, m.role, m.content, m.parentMessageId || null,
                m.suggestions ? JSON.stringify(m.suggestions) : null,
                m.reasoning || null,
                m.images && m.images.length ? JSON.stringify(m.images) : null,
              ],
            )
          }
        }
      }
    }

    const { rows } = await client.query(
      'UPDATE conversations SET data_version = data_version + 1, updated_at = NOW() WHERE id = $1 RETURNING data_version AS "dataVersion"',
      [convId],
    )
    const dataVersion = rows[0]?.dataVersion ?? 0
    await client.query('COMMIT')
    res.json({ ok: true, dataVersion })
    opLog(req, 'sync_conversation', 'conversation', { convId, title, panelCount: panels?.length ?? 0 })
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client?.release()
  }
})

// ===================== 用户配置接口 =====================

app.get('/api/config', authMiddleware, async (req, res, next) => {
  try {
    const config = await getUserConfig(req.user.id)
    res.json(config || {})
  } catch (err) {
    next(err)
  }
})

app.put('/api/config', authMiddleware, async (req, res, next) => {
  try {
    await saveUserConfig(req.user.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ===================== 全局配置接口（权限系统） =====================

// 任意登录用户可读全局配置（用于前端展示/使用）
// 开源安全：非管理员不返回 apiKey / workspaceId 明文。
// 聊天请求回传空 apiKey 时，chat-proxy 会自动回退到服务端全局配置，功能不受影响。
app.get('/api/config/global', authMiddleware, async (req, res, next) => {
  try {
    const config = await getGlobalConfig()
    if (!config) return res.json({})
    if (!req.user.isAdmin) {
      const safe = { ...config, apiKey: '', workspaceId: '', hasGlobalKey: !!config.apiKey }
      return res.json(safe)
    }
    res.json(config)
  } catch (err) {
    next(err)
  }
})

// 仅管理员可写入全局配置，写入后对所有用户立即生效
app.put('/api/config/global', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const saved = await saveGlobalConfig(req.body, req.user.id)
    res.json({ ok: true, config: saved })
    opLog(req, 'update_global_config', 'model_config', { provider: saved.provider, model: saved.model })
  } catch (err) {
    next(err)
  }
})

// ===================== 角色模板接口（首页默认角色） =====================

// 获取启用的角色模板（所有用户可读）
app.get('/api/role-templates', authMiddleware, async (req, res, next) => {
  try {
    const templates = await getRoleTemplates()
    res.json(templates)
  } catch (err) {
    next(err)
  }
})

// 获取全部角色模板（仅管理员，含未启用的）
app.get('/api/role-templates/all', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const templates = await getAllRoleTemplates()
    res.json(templates)
  } catch (err) {
    next(err)
  }
})

// 创建角色模板（仅管理员）
app.post('/api/role-templates', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { id, name, title, background, convSystem, convTemperature, convThinking, convReasoning, group, greeting, sortOrder, isEnabled } = req.body
    if (!id || !name) {
      return res.status(400).json({ error: '缺少必要参数' })
    }
    await createRoleTemplate({
      id, name, title: title || name, background,
      convSystem, convTemperature, convThinking, convReasoning,
      convGroup: group, greeting, sortOrder, isEnabled,
      createdBy: req.user.id,
    })
    res.json({ ok: true, id, name })
    opLog(req, 'create_role_template', 'admin', { templateId: id, name })
  } catch (err) {
    next(err)
  }
})

// 更新角色模板（仅管理员）
app.put('/api/role-templates/:id', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { name, title, background, convSystem, convTemperature, convThinking, convReasoning, group, greeting, sortOrder, isEnabled } = req.body
    await updateRoleTemplate(req.params.id, {
      name, title, background,
      convSystem, convTemperature, convThinking, convReasoning,
      convGroup: group, greeting, sortOrder, isEnabled,
    })
    res.json({ ok: true })
    opLog(req, 'update_role_template', 'admin', { templateId: req.params.id, name })
  } catch (err) {
    next(err)
  }
})

// 删除角色模板（仅管理员）
app.delete('/api/role-templates/:id', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    await deleteRoleTemplate(req.params.id)
    res.json({ ok: true })
    opLog(req, 'delete_role_template', 'admin', { templateId: req.params.id })
  } catch (err) {
    next(err)
  }
})

const PERSONALITY_SPLIT_TIMEOUT_MS = 45_000
const PERSONALITY_ATTEMPT_TIMEOUT_MS = 12_000
const PERSONALITY_MAX_RETRIES = 2
const PERSONALITY_RETRY_BASE_DELAY_MS = 700
const PERSONALITY_RETRY_JITTER_MS = 500

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return false
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  return true
}

function validatePersonalitySplitInput(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const templateIds = Array.isArray(body?.templateIds)
    ? [...new Set(body.templateIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))]
    : []
  const promptLength = Array.from(prompt).length
  if (!prompt || promptLength > 500) return { error: '问题长度需为 1—500 个字符' }
  if (templateIds.length !== 1) return { error: '每个人格请求只能包含 1 个角色' }
  return { prompt, templateIds }
}

function validatePersonalitySummaryInput(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const promptLength = Array.from(prompt).length
  const viewpoints = Array.isArray(body?.viewpoints)
    ? body.viewpoints.map(item => ({
      id: typeof item?.id === 'string' ? item.id.trim() : '',
      answer: typeof item?.answer === 'string' ? limitVisibleText(item.answer, 80) : '',
    })).filter(item => item.id && item.answer)
    : []
  const uniqueIds = new Set(viewpoints.map(item => item.id))

  if (!prompt || promptLength > 500) return { error: '问题长度需为 1—500 个字符' }
  if (viewpoints.length < 2 || viewpoints.length > 6 || uniqueIds.size !== viewpoints.length) {
    return { error: '总结需要 2—6 个不重复的人格观点' }
  }
  return { prompt, viewpoints }
}

function classifyPersonaFailure(error) {
  const status = Number.isInteger(error?.status) ? error.status : null
  const code = typeof error?.code === 'string' ? error.code : (error?.name || 'UNKNOWN_ERROR')
  if (status === 429) return { errorType: 'rate_limited', upstreamStatus: status, fallback: '当前请求较多，这个人格暂时无法回答。' }
  if (status === 401 || status === 403 || code === 'CONFIG_MISSING') {
    return { errorType: 'model_auth_error', upstreamStatus: status, fallback: '模型配置暂时不可用，这个人格未能回答。' }
  }
  if (code === 'UPSTREAM_TIMEOUT' || error?.name === 'TimeoutError') {
    return { errorType: 'timeout', upstreamStatus: status, fallback: '这个人格思考超时，请先参考其他观点。' }
  }
  if (status && status >= 500) return { errorType: 'upstream_unavailable', upstreamStatus: status, fallback: '模型服务暂时繁忙，这个人格未能回答。' }
  if (code === 'EMPTY_RESPONSE') return { errorType: 'empty_response', upstreamStatus: status, fallback: '这个人格没有形成有效观点，请先参考其他回答。' }
  if (code === 'UPSTREAM_NETWORK') return { errorType: 'network_error', upstreamStatus: status, fallback: '网络暂时不稳定，这个人格未能回答。' }
  return { errorType: String(code).toLowerCase(), upstreamStatus: status, fallback: '这个人格暂时无法生成观点，请先参考其他回答。' }
}

async function requestPersonaAnswer(template, prompt, globalConfig, signal, onAttemptFailure) {
  return retryAsync(async () => {
    const attemptController = new AbortController()
    const handleParentAbort = () => attemptController.abort(signal.reason || new Error('客户端已取消'))
    if (signal.aborted) handleParentAbort()
    else signal.addEventListener('abort', handleParentAbort, { once: true })
    const attemptTimeout = setTimeout(() => {
      const timeoutError = new Error('人格单次响应超时')
      timeoutError.code = 'UPSTREAM_TIMEOUT'
      attemptController.abort(timeoutError)
    }, PERSONALITY_ATTEMPT_TIMEOUT_MS)
    const attemptStartedAt = Date.now()
    try {
      const answer = await callLLM(
        buildPersonaMessages(template, prompt),
        { temperature: template.convTemperature },
        globalConfig,
        { maxTokens: 120, signal: attemptController.signal },
      )
      const limited = limitVisibleText(answer, 80)
      if (!limited) {
        const emptyError = new Error('模型返回了空内容')
        emptyError.code = 'EMPTY_RESPONSE'
        throw emptyError
      }
      return limited
    } catch (error) {
      if (error && typeof error === 'object') error.attemptDurationMs = Date.now() - attemptStartedAt
      throw error
    } finally {
      clearTimeout(attemptTimeout)
      signal.removeEventListener('abort', handleParentAbort)
    }
  }, {
    maxRetries: PERSONALITY_MAX_RETRIES,
    baseDelayMs: PERSONALITY_RETRY_BASE_DELAY_MS,
    jitterMs: PERSONALITY_RETRY_JITTER_MS,
    signal,
    onFailure: onAttemptFailure,
  })
}

// 人格分裂体验：只做无状态模型调用，不创建会话、面板或消息记录。
app.post('/api/personality-split', authMiddleware, async (req, res, next) => {
  const validated = validatePersonalitySplitInput(req.body)
  if (validated.error) return res.status(400).json({ error: validated.error })

  try {
    const { prompt, templateIds } = validated
    const templates = await getRoleTemplates()
    const templateMap = new Map(templates.map(template => [template.id, template]))
    const selectedTemplates = templateIds.map(id => templateMap.get(id)).filter(Boolean)
    if (selectedTemplates.length !== templateIds.length) {
      return res.status(400).json({ error: '部分人格不存在或已停用，请刷新后重试' })
    }

    const globalConfig = await getGlobalConfig()
    const controller = new AbortController()
    const startedAt = Date.now()
    let closed = false
    let completed = false
    const timeout = setTimeout(() => {
      const timeoutError = new Error('人格响应超时')
      timeoutError.code = 'UPSTREAM_TIMEOUT'
      controller.abort(timeoutError)
    }, PERSONALITY_SPLIT_TIMEOUT_MS)

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    writeSse(res, 'session', { personaCount: 1, maxAttempts: PERSONALITY_MAX_RETRIES + 1 })

    res.on('close', () => {
      closed = true
      if (!completed) controller.abort(new Error('客户端已断开'))
    })

    const template = selectedTemplates[0]
    let successCount = 0
    writeSse(res, 'persona-start', { id: template.id, name: template.name })
    try {
      const answer = await requestPersonaAnswer(template, prompt, globalConfig, controller.signal, ({ attempt, error, willRetry }) => {
        const failure = classifyPersonaFailure(error)
        opLog(req, 'personality_split_attempt_failed', 'chat', {
          templateId: template.id,
          attempt,
          maxAttempts: PERSONALITY_MAX_RETRIES + 1,
          willRetry,
          errorType: failure.errorType,
          upstreamStatus: failure.upstreamStatus,
          durationMs: Number.isFinite(error?.attemptDurationMs) ? error.attemptDurationMs : null,
        })
      })
      writeSse(res, 'persona-result', { id: template.id, name: template.name, answer })
      successCount = 1
    } catch (error) {
      const failure = classifyPersonaFailure(error)
      if (!closed) writeSse(res, 'persona-error', { id: template.id, name: template.name, error: failure.fallback })
    }

    completed = true
    clearTimeout(timeout)
    const durationMs = Date.now() - startedAt
    if (!closed) {
      writeSse(res, 'complete', { successCount, totalCount: 1, durationMs })
      res.end()
    }
    opLog(req, 'personality_split', 'chat', {
      personaCount: 1,
      successCount,
      durationMs,
      cancelled: controller.signal.aborted,
    })
  } catch (err) {
    if (res.headersSent) {
      writeSse(res, 'fatal-error', { error: '人格分裂体验启动失败，请稍后重试' })
      return res.end()
    }
    next(err)
  }
})

app.post('/api/personality-split/summary', authMiddleware, async (req, res, next) => {
  const validated = validatePersonalitySummaryInput(req.body)
  if (validated.error) return res.status(400).json({ error: validated.error })

  const controller = new AbortController()
  const startedAt = Date.now()
  let completed = false
  const timeout = setTimeout(() => controller.abort(new Error('综合总结超时')), PERSONALITY_SPLIT_TIMEOUT_MS)
  res.on('close', () => {
    if (!completed) controller.abort(new Error('客户端已断开'))
  })

  try {
    const { prompt, viewpoints } = validated
    const templates = await getRoleTemplates()
    const templateMap = new Map(templates.map(template => [template.id, template]))
    if (viewpoints.some(item => !templateMap.has(item.id))) {
      return res.status(400).json({ error: '部分人格不存在或已停用，请刷新后重试' })
    }
    const globalConfig = await getGlobalConfig()
    const viewpointText = viewpoints
      .map(item => `${templateMap.get(item.id).name}：${item.answer}`)
      .join('\n')
    const summary = await callLLM([
      { role: 'system', content: '你是主持人。请综合多个人格的回答，提炼一致点与分歧，输出不超过200个可见字符的纯文本结论，不要使用Markdown。' },
      { role: 'user', content: `用户问题：${prompt}\n人格观点：\n${viewpointText}` },
    ], { temperature: 0.2 }, globalConfig, { maxTokens: 280, signal: controller.signal })
    completed = true
    const content = limitVisibleText(summary, 200)
    res.json({ content })
    opLog(req, 'personality_split_summary', 'chat', {
      personaCount: viewpoints.length,
      outputLength: Array.from(content).length,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.destroyed && !res.headersSent) res.status(504).json({ error: '综合结论生成超时，请稍后重试' })
      return
    }
    next(error)
  } finally {
    completed = true
    clearTimeout(timeout)
  }
})

// 基于角色模板获取或创建唯一会话（同一用户 + 同一角色模板只有一个）
app.post('/api/conversations/from-role-template', authMiddleware, async (req, res, next) => {
  try {
    const { templateId } = req.body
    if (!templateId) {
      return res.status(400).json({ error: '缺少角色模板 ID' })
    }

    const templates = await getAllRoleTemplates()
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) {
      return res.status(404).json({ error: '角色模板不存在' })
    }

    const requestedConvId = req.body.convId || crypto.randomUUID()
    const requestedPanelId = req.body.panelId || crypto.randomUUID()
    const result = await getOrCreateRoleConversation({
      conversationId: requestedConvId,
      panelId: requestedPanelId,
      userId: req.user.id,
      template: tpl,
    })

    res.json({
      ok: true,
      created: result.created,
      adopted: result.adopted,
      convId: result.convId,
      panelId: result.panelId || null,
      template: {
        title: tpl.name,
        background: tpl.background || null,
        convSystem: tpl.convSystem || null,
        convTemperature: tpl.convTemperature ?? null,
        convThinking: tpl.convThinking ?? null,
        convReasoning: tpl.convReasoning || null,
        group: tpl.convGroup || null,
        greeting: tpl.greeting || null,
      },
    })
    opLog(
      req,
      result.created ? 'create_conversation_from_role_template' : 'open_conversation_from_role_template',
      'conversation',
      { convId: result.convId, templateId, templateName: tpl.name, adopted: result.adopted },
    )
  } catch (err) {
    next(err)
  }
})

// ===================== Chat 代理 =====================

// ===================== 图片上传 =====================

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

app.post('/api/upload', authMiddleware, async (req, res, next) => {
  try {
    const { image } = req.body // base64 data URL: data:image/png;base64,...
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: '缺少图片数据' })
    }

    const match = image.match(/^data:(image\/\w+);base64,(.+)$/)
    if (!match) {
      return res.status(400).json({ error: '图片格式不正确，需要 base64 data URL' })
    }

    const mimeType = match[1]
    const base64Data = match[2]

    if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: '不支持的图片格式，仅支持 jpg/png/gif/webp' })
    }

    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > MAX_IMAGE_SIZE) {
      return res.status(400).json({ error: '图片大小不能超过 5MB' })
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1]
    const filename = `${crypto.randomUUID()}.${ext}`
    const filePath = path.join(UPLOAD_DIR, filename)
    await fs.promises.writeFile(filePath, buffer)

    const BASE_URL = process.env.BASE_URL || ''
    const url = `${BASE_URL}/uploads/${filename}`
    res.json({ url })
    opLog(req, 'upload_image', 'multimodal', { filename, size: buffer.length })
  } catch (err) {
    next(err)
  }
})

const chat = createChatHandler({
  configProvider: getGlobalConfig,
  defaultProvider: 'aliyun',
  defaultRegion: 'bj',
  defaultWorkspaceId: process.env.ALIYUN_WORKSPACE_ID || '',
  defaultModel: 'qwen3.7-max',
})

app.post('/api/chat', authMiddleware, (req, res, next) => {
  // 记录 AI 请求日志
  opLog(req, 'chat_request', 'chat', { provider: req.body?.provider, model: req.body?.model })
  chat(req, res).catch(next)
})

// ===================== 操作日志查询接口（管理员） =====================

app.get('/api/admin/logs', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { userId, action, category, limit, offset } = req.query
    const { logs, total } = await getLogs({
      userId: userId ? parseInt(userId) : undefined,
      action: action || undefined,
      category: category || undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    })
    res.json({ logs, total })
  } catch (err) {
    next(err)
  }
})

// ===================== 静态文件 =====================

const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))

// 思维导图页面（/mindmap）由 React SPA 路由处理，见 App.tsx

// SPA 回退
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'))
})

// 全局错误处理
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message, err.stack)
  res.status(500).json({ error: err.message || 'Internal Server Error' })
})

const PORT = 11113

// 启动前先测试数据库连接
async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('[DB] PostgreSQL connected')
    // 旧库兼容：确保 conversations 表存在 background 列
    try {
      await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS background VARCHAR(512)')
    } catch (e) {
      console.error('[DB] add column background failed:', e.message)
    }
    // 旧库兼容：确保 users 表存在 nickname 列（注册/登录/昵称接口均读取）
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(50) DEFAULT \'\'')
    } catch (e) {
      console.error('[DB] add column nickname failed:', e.message)
    }
  } catch (err) {
    console.error('[DB] Connection failed:', err.message)
    console.error('[DB] Will continue without database - some features may not work')
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MindmapChat running on http://0.0.0.0:${PORT}`)
  })
}

start()
