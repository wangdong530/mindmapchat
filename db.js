import pg from 'pg'

const { Pool } = pg

// 数据库连接参数一律从环境变量读取，不硬编码到源码中。
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'pg',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'thinkchat',
  max: 10,
  idleTimeoutMillis: 30000,
})

export default pool

// 迁移：确保 panels 表存在 type 字段（容器/消息节点区分），幂等
pool.query(
  "ALTER TABLE panels ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'container'",
).then(() => {
  // 修正历史数据：仅含一条 user 消息的 panel 应为消息节点（message）
  return pool.query(`
    UPDATE panels p SET type = 'message'
    FROM (
      SELECT m.panel_id, COUNT(*) AS cnt, MODE() WITHIN GROUP (ORDER BY m.role) AS only_role
      FROM messages m GROUP BY m.panel_id
    ) sub
    WHERE sub.panel_id = p.id AND sub.cnt = 1 AND sub.only_role = 'user' AND p.type <> 'message'
  `)
}).catch((e) => console.warn('[migration] panels.type 迁移跳过:', e.message))

// 迁移：panels 表增加 summary 字段（容器节点对话总结），幂等
pool.query(
  'ALTER TABLE panels ADD COLUMN IF NOT EXISTS summary TEXT',
).catch((e) => console.warn('[migration] panels.summary 迁移跳过:', e.message))

// 迁移：panels 表增加 summary_msg_count 字段（已纳入总结的消息条数，用于"摘要+追加新消息"），幂等
pool.query(
  'ALTER TABLE panels ADD COLUMN IF NOT EXISTS summary_msg_count INTEGER NOT NULL DEFAULT 0',
).catch((e) => console.warn('[migration] panels.summary_msg_count 迁移跳过:', e.message))

// 迁移：补全 messages.parent_message_id，使消息堆栈链连续（幂等，仅补全为 NULL 的）
// assistant 指向前一条 user 消息；user 指向前一条 assistant 消息（同面板内按 sort_order）
pool.query(`
  UPDATE messages m SET parent_message_id = (
    SELECT m2.id FROM messages m2
    WHERE m2.panel_id = m.panel_id AND m2.role = 'user'
      AND (m2.sort_order, m2.id) < (m.sort_order, m.id)
    ORDER BY m2.sort_order DESC, m2.id DESC LIMIT 1
  )
  WHERE m.role = 'assistant' AND m.parent_message_id IS NULL
`).then(() => pool.query(`
  UPDATE messages m SET parent_message_id = (
    SELECT m2.id FROM messages m2
    WHERE m2.panel_id = m.panel_id AND m2.role = 'assistant'
      AND (m2.sort_order, m2.id) < (m.sort_order, m.id)
    ORDER BY m2.sort_order DESC, m2.id DESC LIMIT 1
  )
  WHERE m.role = 'user' AND m.parent_message_id IS NULL
`)).catch((e) => console.warn('[migration] messages.parent_message_id 迁移跳过:', e.message))

// 迁移：确保 conversations 表存在 data_version 字段（用于多页面同步检测），幂等
pool.query(
  'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS data_version BIGINT NOT NULL DEFAULT 0',
).catch((e) => console.warn('[migration] conversations.data_version 迁移跳过:', e.message))

// 迁移：确保 conversations 表存在编辑锁字段（多页面互斥编辑），幂等
pool.query(
  'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lock_owner VARCHAR(128) NULL',
).catch((e) => console.warn('[migration] conversations.lock_owner 迁移跳过:', e.message))
pool.query(
  'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lock_label VARCHAR(64) NULL',
).catch((e) => console.warn('[migration] conversations.lock_label 迁移跳过:', e.message))
pool.query(
  'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMP NULL',
).catch((e) => console.warn('[migration] conversations.lock_expires_at 迁移跳过:', e.message))

// 迁移：确保 conversations 表存在会话级模型配置字段（背景提示词/温度/思考模式），幂等
pool.query(`
  ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS conv_system TEXT,
    ADD COLUMN IF NOT EXISTS conv_temperature REAL,
    ADD COLUMN IF NOT EXISTS conv_thinking BOOLEAN,
    ADD COLUMN IF NOT EXISTS conv_reasoning VARCHAR(20)
`).catch((e) => console.warn('[migration] conversations.conv_* 迁移跳过:', e.message))

// 迁移：conversations 表增加分组与置顶字段，幂等
pool.query(`
  ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS conv_group VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false
`).catch((e) => console.warn('[migration] conversations.group/pinned 迁移跳过:', e.message))

// ===================== 权限系统迁移 =====================

// 管理员白名单：由环境变量 MINDMAPCHAT_ADMIN_USERNAME 指定（逗号分隔多个用户名）。
// 开源后禁止硬编码默认管理员：未配置白名单时不提升任何用户，避免任意注册同名账号即被提权。
export const ADMIN_USERNAMES = (process.env.MINDMAPCHAT_ADMIN_USERNAME || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// 将白名单中已存在的用户提升为管理员（幂等），供服务启动迁移与 init-db 调用
export async function grantConfiguredAdmins() {
  if (!ADMIN_USERNAMES.length) return 0
  const { rowCount } = await pool.query(
    'UPDATE users SET is_admin = true WHERE username = ANY($1)',
    [ADMIN_USERNAMES],
  )
  return rowCount
}

// 将指定用户名设为/取消管理员（供注册等场景即时授权）
export async function grantAdminByUsername(username, isAdmin = true) {
  if (!username) return 0
  const { rowCount } = await pool.query(
    'UPDATE users SET is_admin = $2 WHERE username = $1',
    [username, isAdmin],
  )
  return rowCount
}

// 迁移：users 表增加 is_admin 字段（权限系统），幂等
pool.query(
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false',
).then(() => grantConfiguredAdmins()).catch((e) => console.warn('[migration] users.is_admin 迁移跳过:', e.message))

// 迁移：全局配置表（管理员统一配置，全局生效），幂等
pool.query(`
  CREATE TABLE IF NOT EXISTS global_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    api_key TEXT DEFAULT '',
    region VARCHAR(20) DEFAULT 'bj',
    workspace_id VARCHAR(100) DEFAULT '',
    base_url TEXT DEFAULT '',
    model VARCHAR(100) DEFAULT 'deepseek-v4-flash',
    system TEXT DEFAULT '',
    temperature DOUBLE PRECISION DEFAULT 0.3,
    stream BOOLEAN DEFAULT true,
    enable_search BOOLEAN DEFAULT false,
    enable_thinking BOOLEAN DEFAULT false,
    reasoning_effort VARCHAR(20) DEFAULT 'high',
    updated_by INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).then(() => {
  // 确保存在唯一行 id=1，使用环境变量配置初始化（仅首次）
  return pool.query(
    `INSERT INTO global_config (id, api_key, region, workspace_id, base_url, model)
     VALUES (1, $1, 'bj', $2, '', 'qwen3.7-max')
     ON CONFLICT (id) DO NOTHING`,
    [process.env.DASHSCOPE_API_KEY || '', process.env.ALIYUN_WORKSPACE_ID || ''],
  )
}).catch((e) => console.warn('[migration] global_config 迁移跳过:', e.message))

// 迁移：global_config 增加 provider 字段（多服务商：aliyun / tencent），幂等
pool.query(
  "ALTER TABLE global_config ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'aliyun'",
).catch((e) => console.warn('[migration] global_config.provider 迁移跳过:', e.message))

// 迁移：user_configs 增加 provider 字段（多服务商），幂等
pool.query(
  "ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'aliyun'",
).catch((e) => console.warn('[migration] user_configs.provider 迁移跳过:', e.message))

// 迁移：messages 表增加 reasoning 字段（思考过程，腾讯混元 reasoning_content），幂等
pool.query(
  'ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning TEXT',
).catch((e) => console.warn('[migration] messages.reasoning 迁移跳过:', e.message))

// 迁移：messages 表增加 images 字段（多模态图片 URL JSON 数组），幂等
pool.query(
  'ALTER TABLE messages ADD COLUMN IF NOT EXISTS images TEXT',
).catch((e) => console.warn('[migration] messages.images 迁移跳过:', e.message))

// 迁移：role_templates 角色模板表与“每个用户每个角色仅一个会话”的关联，幂等
let roleConversationSchemaError = null
const roleConversationSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS role_templates (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    title VARCHAR(255) DEFAULT '新对话',
    background VARCHAR(512) DEFAULT '',
    conv_system TEXT DEFAULT '',
    conv_temperature DOUBLE PRECISION DEFAULT 0.3,
    conv_thinking BOOLEAN DEFAULT false,
    conv_reasoning VARCHAR(20) DEFAULT 'high',
    conv_group VARCHAR(100) DEFAULT '',
    greeting TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_enabled BOOLEAN DEFAULT true,
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).then(() => pool.query(
  'ALTER TABLE role_templates ADD COLUMN IF NOT EXISTS greeting TEXT DEFAULT \'\'',
)).then(() => pool.query(`
  ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS greeting TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS role_template_id VARCHAR(50) NULL
`)).then(() => pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_role_template'
    ) THEN
      ALTER TABLE conversations
        ADD CONSTRAINT fk_conversations_role_template
        FOREIGN KEY (role_template_id) REFERENCES role_templates(id) ON DELETE SET NULL;
    END IF;
  END $$
`)).then(() => pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_user_role_template
    ON conversations(user_id, role_template_id)
    WHERE role_template_id IS NOT NULL
`)).catch((e) => {
  roleConversationSchemaError = e
  console.warn('[migration] 角色会话唯一关联迁移跳过:', e.message)
})

async function ensureRoleConversationSchema() {
  await roleConversationSchemaReady
  if (roleConversationSchemaError) {
    throw new Error(`角色会话数据结构不可用: ${roleConversationSchemaError.message}`)
  }
}

// ===================== Users =====================

export async function createUser(username, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
    [username, passwordHash],
  )
  // 同时创建默认配置
  await pool.query(
    'INSERT INTO user_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [rows[0].id],
  )
  return rows[0]
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username, nickname, password_hash, is_admin, created_at FROM users WHERE username = $1',
    [username],
  )
  return rows[0] || null
}

export async function getAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, nickname, created_at FROM users ORDER BY id',
  )
  return rows
}

export async function getUserConversationsWithQuestions(userId) {
  const { rows: convs } = await pool.query(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  )
  const result = await Promise.all(
    convs.map(async (conv) => {
      const { rows: msgs } = await pool.query(
        `SELECT id, role, content, parent_message_id AS "parentMessageId", sort_order AS "sortOrder", created_at
         FROM messages 
         WHERE panel_id IN (SELECT id FROM panels WHERE conversation_id = $1)
         ORDER BY sort_order, id`,
        [conv.id],
      )
      return { ...conv, questions: msgs }
    }),
  )
  return result
}

export async function updateUserNickname(userId, nickname) {
  await pool.query(
    'UPDATE users SET nickname = $1 WHERE id = $2',
    [nickname, userId],
  )
}

// ===================== Conversations =====================

export async function getConversations(userId) {
  await ensureRoleConversationSchema()
  const { rows } = await pool.query(
    `SELECT id, title, background, data_version AS "dataVersion",
            conv_system AS "convSystem", conv_temperature AS "convTemperature",
            conv_thinking AS "convThinking", conv_reasoning AS "convReasoning",
            conv_group AS "convGroup", is_pinned AS "pinned",
            greeting, role_template_id AS "roleTemplateId",
            lock_owner AS "lockOwner", lock_label AS "lockLabel", lock_expires_at AS "lockExpiresAt"
     FROM conversations WHERE user_id = $1 ORDER BY is_pinned DESC, updated_at DESC`,
    [userId],
  )
  return rows
}

// 读取会话元数据（含多页面同步版本号）
export async function getConversationMeta(conversationId) {
  await ensureRoleConversationSchema()
  const { rows } = await pool.query(
    `SELECT id, title, background, data_version AS "dataVersion", updated_at,
            conv_system AS "convSystem", conv_temperature AS "convTemperature",
            conv_thinking AS "convThinking", conv_reasoning AS "convReasoning",
            greeting, role_template_id AS "roleTemplateId",
            lock_owner AS "lockOwner", lock_label AS "lockLabel", lock_expires_at AS "lockExpiresAt"
     FROM conversations WHERE id = $1`,
    [conversationId],
  )
  return rows[0] || null
}

export async function createConversation(id, userId, title, background, convGroup = null, pinned = false) {
  await pool.query(
    'INSERT INTO conversations (id, user_id, title, background, conv_group, is_pinned) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, userId, title, background ?? null, convGroup ?? null, pinned],
  )
}

// 同一用户点击同一角色模板时，事务内复用已有会话；唯一索引兜底多页面/多设备并发。
// 历史会话没有 role_template_id 时，仅认领标题、背景和系统提示词都精确匹配的最佳候选，避免误关联普通会话。
export async function getOrCreateRoleConversation({ conversationId, panelId, userId, template }) {
  await ensureRoleConversationSchema()

  const client = await pool.connect()
  const title = template.name
  const legacyTitle = template.title || template.name
  try {
    await client.query('BEGIN')

    const { rows: existingRows } = await client.query(
      `SELECT id FROM conversations
       WHERE user_id = $1 AND role_template_id = $2
       LIMIT 1 FOR UPDATE`,
      [userId, template.id],
    )
    if (existingRows[0]) {
      await client.query(
        'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
        [title, existingRows[0].id],
      )
      await client.query(
        `UPDATE panels SET title = $1
         WHERE conversation_id = $2 AND parent_id IS NULL AND type = 'container'`,
        [title, existingRows[0].id],
      )
      await client.query('COMMIT')
      return { convId: existingRows[0].id, created: false, adopted: false }
    }

    const { rows: adoptedRows } = await client.query(
      `WITH candidate AS (
         SELECT c.id
         FROM conversations c
         WHERE c.user_id = $1
           AND c.role_template_id IS NULL
           AND c.title IN ($2, $6)
           AND COALESCE(c.background, '') = COALESCE($3::text, '')
           AND COALESCE(c.conv_system, '') = COALESCE($4::text, '')
         ORDER BY (
           SELECT COUNT(*)
           FROM panels p
           JOIN messages m ON m.panel_id = p.id
           WHERE p.conversation_id = c.id
         ) DESC, c.updated_at DESC
         LIMIT 1
         FOR UPDATE
       )
       UPDATE conversations c
       SET role_template_id = $5, title = $2, updated_at = NOW()
       FROM candidate
       WHERE c.id = candidate.id
       RETURNING c.id`,
      [userId, title, template.background ?? null, template.convSystem ?? null, template.id, legacyTitle],
    )
    if (adoptedRows[0]) {
      await client.query(
        `UPDATE panels SET title = $1
         WHERE conversation_id = $2 AND parent_id IS NULL AND type = 'container'`,
        [title, adoptedRows[0].id],
      )
      await client.query('COMMIT')
      return { convId: adoptedRows[0].id, created: false, adopted: true }
    }

    const { rows: insertedRows } = await client.query(
      `INSERT INTO conversations (
         id, user_id, title, background, conv_system, conv_temperature,
         conv_thinking, conv_reasoning, conv_group, greeting, role_template_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id, role_template_id) WHERE role_template_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        conversationId, userId, title, template.background ?? null,
        template.convSystem ?? null, template.convTemperature ?? null,
        template.convThinking ?? null, template.convReasoning ?? null,
        template.convGroup ?? null, template.greeting ?? '', template.id,
      ],
    )

    if (insertedRows[0]) {
      await client.query(
        `INSERT INTO panels (id, conversation_id, parent_id, title, type, source_suggestion_index)
         VALUES ($1, $2, NULL, $3, 'container', 0)`,
        [panelId, conversationId, title],
      )
      await client.query('COMMIT')
      return { convId: conversationId, panelId, created: true, adopted: false }
    }

    const { rows: concurrentRows } = await client.query(
      `SELECT id FROM conversations
       WHERE user_id = $1 AND role_template_id = $2
       LIMIT 1`,
      [userId, template.id],
    )
    if (!concurrentRows[0]) {
      throw new Error('角色会话并发创建后未找到唯一会话')
    }
    await client.query('COMMIT')
    return { convId: concurrentRows[0].id, created: false, adopted: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    // 两个请求可能同时认领历史候选；唯一约束失败时回读已获胜的会话，保持接口幂等。
    if (error?.code === '23505') {
      const { rows } = await client.query(
        `SELECT id FROM conversations
         WHERE user_id = $1 AND role_template_id = $2
         LIMIT 1`,
        [userId, template.id],
      )
      if (rows[0]) {
        return { convId: rows[0].id, created: false, adopted: false }
      }
    }
    throw error
  } finally {
    client.release()
  }
}

export async function updateConversation(id, { title, background, convSystem, convTemperature, convThinking, convReasoning, convGroup, greeting, pinned } = {}) {
  const fields = []
  const values = []
  let idx = 1
  if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title) }
  if (background !== undefined) { fields.push(`background = $${idx++}`); values.push(background) }
  if (convSystem !== undefined) { fields.push(`conv_system = $${idx++}`); values.push(convSystem ?? null) }
  if (convTemperature !== undefined) { fields.push(`conv_temperature = $${idx++}`); values.push(convTemperature ?? null) }
  if (convThinking !== undefined) { fields.push(`conv_thinking = $${idx++}`); values.push(convThinking ?? null) }
  if (convReasoning !== undefined) { fields.push(`conv_reasoning = $${idx++}`); values.push(convReasoning ?? null) }
  if (convGroup !== undefined) { fields.push(`conv_group = $${idx++}`); values.push(convGroup ?? null) }
  if (greeting !== undefined) { fields.push(`greeting = $${idx++}`); values.push(greeting ?? '') }
  if (pinned !== undefined) { fields.push(`is_pinned = $${idx++}`); values.push(pinned) }
  if (fields.length === 0) return
  values.push(id)
  await pool.query(
    `UPDATE conversations SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    values,
  )
}

export async function deleteConversation(id) {
  // 先删 messages，再删 panels，最后删 conversation
  await pool.query(
    'DELETE FROM messages WHERE panel_id IN (SELECT id FROM panels WHERE conversation_id = $1)',
    [id],
  )
  await pool.query('DELETE FROM panels WHERE conversation_id = $1', [id])
  await pool.query('DELETE FROM conversations WHERE id = $1', [id])
}

// ===================== Panels =====================

export async function getPanels(conversationId) {
  const { rows } = await pool.query(
    'SELECT id, conversation_id, parent_id, title, type, source_message_id, source_suggestion_index, sort_order, summary, summary_msg_count FROM panels WHERE conversation_id = $1 ORDER BY sort_order',
    [conversationId],
  )
  // 把 NULL 的 parent_id 转成 null (pg 返回的是 string 'null' 还是 JS null? 实际上是 JS null)
  return rows
}

export async function createPanel(id, conversationId, parentId, title, sourceMessageId, sourceSuggestionIndex, type = 'container') {
  await pool.query(
    'INSERT INTO panels (id, conversation_id, parent_id, title, type, source_message_id, source_suggestion_index) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, conversationId, parentId || null, title, type || 'container', sourceMessageId || null, sourceSuggestionIndex ?? 0],
  )
}

// 保存容器节点的对话总结，以及已纳入总结的消息条数
export async function updatePanelSummary(panelId, summary, msgCount) {
  await pool.query(
    'UPDATE panels SET summary = $1, summary_msg_count = $2 WHERE id = $3',
    [summary || null, msgCount ?? 0, panelId],
  )
}

// ===================== Messages =====================

export async function getMessages(panelId) {
  const { rows } = await pool.query(
    'SELECT id, panel_id, role, content, suggestions, parent_message_id, sort_order, created_at, reasoning, images FROM messages WHERE panel_id = $1 ORDER BY sort_order, id',
    [panelId],
  )
  return rows.map((r) => ({
    ...r,
    suggestions: r.suggestions ? JSON.parse(r.suggestions) : undefined,
    reasoning: r.reasoning || undefined,
    images: r.images ? JSON.parse(r.images) : undefined,
  }))
}

export async function createMessage(id, panelId, role, content, parentMessageId, suggestions, reasoning, images) {
  await pool.query(
    'INSERT INTO messages (id, panel_id, role, content, parent_message_id, suggestions, reasoning, images) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id, panel_id) DO UPDATE SET content = $4, suggestions = $6, reasoning = $7, images = $8',
    [id, panelId, role, content, parentMessageId || null, suggestions ? JSON.stringify(suggestions) : null, reasoning || null, images && images.length ? JSON.stringify(images) : null],
  )
}

export async function updateMessageContent(id, panelId, content, suggestions, reasoning, images) {
  await pool.query(
    'UPDATE messages SET content = $1, suggestions = $2, reasoning = $3, images = $4 WHERE id = $5 AND panel_id = $6',
    [content, suggestions ? JSON.stringify(suggestions) : null, reasoning || null, images && images.length ? JSON.stringify(images) : null, id, panelId],
  )
}

// ===================== User Configs =====================

export async function getUserConfig(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM user_configs WHERE user_id = $1',
    [userId],
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    provider: r.provider || 'aliyun',
    apiKey: r.api_key || '',
    region: r.region || 'bj',
    workspaceId: r.workspace_id || '',
    baseUrl: r.base_url || '',
    model: r.model || 'deepseek-v4-flash',
    system: r.system || '',
    temperature: r.temperature ?? 0.3,
    stream: r.stream ?? true,
    enableSearch: r.enable_search ?? false,
    enableThinking: r.enable_thinking ?? false,
    reasoningEffort: r.reasoning_effort || 'high',
  }
}

export async function saveUserConfig(userId, config) {
  await pool.query(
    `INSERT INTO user_configs (user_id, provider, api_key, region, workspace_id, base_url, model, system, temperature, stream, enable_search, enable_thinking, reasoning_effort, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       provider=$2, api_key=$3, region=$4, workspace_id=$5, base_url=$6, model=$7, system=$8,
       temperature=$9, stream=$10, enable_search=$11, enable_thinking=$12, reasoning_effort=$13, updated_at=NOW()`,
    [
      userId,
      config.provider || 'aliyun',
      config.apiKey || '',
      config.region || 'bj',
      config.workspaceId || '',
      config.baseUrl || '',
      config.model || 'deepseek-v4-flash',
      config.system || '',
      config.temperature ?? 0.3,
      config.stream ?? true,
      config.enableSearch ?? false,
      config.enableThinking ?? false,
      config.reasoningEffort || 'high',
    ],
  )
}

// ===================== Global Config（管理员全局配置，全局生效） =====================

let globalConfigCache = null
let globalConfigCacheTime = 0
const GLOBAL_CONFIG_TTL = 5000 // 5 秒内复用缓存，避免每次请求都查库

function normalizeGlobalConfig(r) {
  return {
    provider: r.provider || 'aliyun',
    apiKey: r.api_key || '',
    region: r.region || 'bj',
    workspaceId: r.workspace_id || '',
    baseUrl: r.base_url || '',
    model: r.model || 'deepseek-v4-flash',
    system: r.system || '',
    temperature: r.temperature ?? 0.3,
    stream: r.stream ?? true,
    enableSearch: r.enable_search ?? false,
    enableThinking: r.enable_thinking ?? false,
    reasoningEffort: r.reasoning_effort || 'high',
  }
}

// 读取全局配置（带缓存）。任意登录用户可读。
export async function getGlobalConfig() {
  const now = Date.now()
  if (globalConfigCache && now - globalConfigCacheTime < GLOBAL_CONFIG_TTL) {
    return globalConfigCache
  }
  const { rows } = await pool.query('SELECT * FROM global_config WHERE id = 1')
  const cfg = rows[0] ? normalizeGlobalConfig(rows[0]) : null
  globalConfigCache = cfg
  globalConfigCacheTime = now
  return cfg
}

// 保存全局配置（仅管理员可调用）。updatedBy 为管理员用户 id。
export async function saveGlobalConfig(config, updatedBy) {
  const normalized = {
    provider: config.provider || 'aliyun',
    apiKey: config.apiKey || '',
    region: config.region || 'bj',
    workspaceId: config.workspaceId || '',
    baseUrl: config.baseUrl || '',
    model: config.model || 'deepseek-v4-flash',
    system: config.system || '',
    temperature: config.temperature ?? 0.3,
    stream: config.stream ?? true,
    enableSearch: config.enableSearch ?? false,
    enableThinking: config.enableThinking ?? false,
    reasoningEffort: config.reasoningEffort || 'high',
  }
  await pool.query(
    `INSERT INTO global_config (id, provider, api_key, region, workspace_id, base_url, model, system, temperature, stream, enable_search, enable_thinking, reasoning_effort, updated_by, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (id) DO UPDATE SET
       provider=$1, api_key=$2, region=$3, workspace_id=$4, base_url=$5, model=$6, system=$7,
       temperature=$8, stream=$9, enable_search=$10, enable_thinking=$11, reasoning_effort=$12, updated_by=$13, updated_at=NOW()`,
    [
      normalized.provider,
      normalized.apiKey,
      normalized.region,
      normalized.workspaceId,
      normalized.baseUrl,
      normalized.model,
      normalized.system,
      normalized.temperature,
      normalized.stream,
      normalized.enableSearch,
      normalized.enableThinking,
      normalized.reasoningEffort,
      updatedBy ?? null,
    ],
  )
  // 刷新缓存，使配置立即全局生效
  globalConfigCache = normalized
  globalConfigCacheTime = Date.now()
  return normalized
}

// ===================== Operation Logs =====================

// 迁移：确保 operation_logs 表存在，幂等
pool.query(`
  CREATE TABLE IF NOT EXISTS operation_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    username VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    detail TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch((e) => console.warn('[migration] operation_logs 迁移跳过:', e.message))

// 创建索引
pool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_user ON operation_logs(user_id)').catch(() => {})
pool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_action ON operation_logs(action)').catch(() => {})
pool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_category ON operation_logs(category)').catch(() => {})
pool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_created ON operation_logs(created_at DESC)').catch(() => {})

/**
 * 插入一条操作日志
 * @param {Object} log
 * @param {number|null} log.userId - 用户 ID
 * @param {string} log.username - 用户名
 * @param {string} log.action - 操作名称
 * @param {string} log.category - 操作分类
 * @param {string|null} log.detail - 详情（JSON 字符串）
 * @param {string|null} log.ipAddress - IP 地址
 * @param {string|null} log.userAgent - User-Agent
 */
export async function insertLog({ userId, username, action, category, detail, ipAddress, userAgent }) {
  try {
    await pool.query(
      `INSERT INTO operation_logs (user_id, username, action, category, detail, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId ?? null, username ?? null, action, category, detail ?? null, ipAddress ?? null, userAgent ?? null],
    )
  } catch (e) {
    // 日志写入失败不影响主流程
    console.warn('[OperationLog] 写入失败:', e.message)
  }
}

/**
 * 查询操作日志（分页）
 * @param {Object} filters
 * @param {number|null} filters.userId - 按用户筛选
 * @param {string|null} filters.action - 按操作筛选
 * @param {string|null} filters.category - 按分类筛选
 * @param {number} filters.limit - 每页条数
 * @param {number} filters.offset - 偏移量
 */
export async function getLogs({ userId, action, category, limit = 50, offset = 0 } = {}) {
  const conditions = []
  const values = []
  let idx = 1

  if (userId) {
    conditions.push(`user_id = $${idx++}`)
    values.push(userId)
  }
  if (action) {
    conditions.push(`action = $${idx++}`)
    values.push(action)
  }
  if (category) {
    conditions.push(`category = $${idx++}`)
    values.push(category)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(limit, offset)

  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", username, action, category, detail, ip_address AS "ipAddress", user_agent AS "userAgent", created_at AS "createdAt"
     FROM operation_logs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    values,
  )

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total FROM operation_logs ${where}`,
    conditions.length > 0 ? values.slice(0, -2) : [],
  )

  return { logs: rows, total: parseInt(countRows[0]?.total || '0', 10) }
}

// ===================== Role Templates =====================

// 获取所有已启用的角色模板（所有用户可读）
export async function getRoleTemplates() {
  const { rows } = await pool.query(
    `SELECT id, name, title, background, conv_system AS "convSystem",
            conv_temperature AS "convTemperature", conv_thinking AS "convThinking",
            conv_reasoning AS "convReasoning", conv_group AS "convGroup",
            greeting,
            sort_order AS "sortOrder", is_enabled AS "isEnabled",
            created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM role_templates WHERE is_enabled = true ORDER BY sort_order, created_at`
  )
  return rows
}

// 获取所有角色模板（管理员用，含未启用的）
export async function getAllRoleTemplates() {
  const { rows } = await pool.query(
    `SELECT id, name, title, background, conv_system AS "convSystem",
            conv_temperature AS "convTemperature", conv_thinking AS "convThinking",
            conv_reasoning AS "convReasoning", conv_group AS "convGroup",
            greeting,
            sort_order AS "sortOrder", is_enabled AS "isEnabled",
            created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM role_templates ORDER BY sort_order, created_at`
  )
  return rows
}

export async function createRoleTemplate({ id, name, title, background, convSystem, convTemperature, convThinking, convReasoning, convGroup, greeting, sortOrder, isEnabled, createdBy }) {
  await pool.query(
    `INSERT INTO role_templates (id, name, title, background, conv_system, conv_temperature, conv_thinking, conv_reasoning, conv_group, greeting, sort_order, is_enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, name, title || '新对话', background || null, convSystem || null, convTemperature ?? 0.3, convThinking ?? false, convReasoning || 'high', convGroup || null, greeting || '', sortOrder ?? 0, isEnabled ?? true, createdBy ?? null]
  )
  return { id, name }
}

export async function updateRoleTemplate(id, { name, title, background, convSystem, convTemperature, convThinking, convReasoning, convGroup, greeting, sortOrder, isEnabled } = {}) {
  const fields = []
  const values = []
  let idx = 1
  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name) }
  if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title) }
  if (background !== undefined) { fields.push(`background = $${idx++}`); values.push(background) }
  if (convSystem !== undefined) { fields.push(`conv_system = $${idx++}`); values.push(convSystem ?? null) }
  if (convTemperature !== undefined) { fields.push(`conv_temperature = $${idx++}`); values.push(convTemperature ?? 0.3) }
  if (convThinking !== undefined) { fields.push(`conv_thinking = $${idx++}`); values.push(convThinking ?? false) }
  if (convReasoning !== undefined) { fields.push(`conv_reasoning = $${idx++}`); values.push(convReasoning ?? null) }
  if (convGroup !== undefined) { fields.push(`conv_group = $${idx++}`); values.push(convGroup ?? null) }
  if (greeting !== undefined) { fields.push(`greeting = $${idx++}`); values.push(greeting ?? '') }
  if (sortOrder !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(sortOrder) }
  if (isEnabled !== undefined) { fields.push(`is_enabled = $${idx++}`); values.push(isEnabled) }
  if (fields.length === 0) return
  values.push(id)
  await pool.query(
    `UPDATE role_templates SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    values,
  )
}

export async function deleteRoleTemplate(id) {
  await pool.query('DELETE FROM role_templates WHERE id = $1', [id])
}
