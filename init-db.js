import pg from 'pg'
import { ensureProfileSchema } from './profile-db.js'

const { Pool } = pg

// 数据库连接参数与模型凭据一律从环境变量读取，不硬编码到源码中。
const DB = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'pg',
  password: process.env.PG_PASSWORD || '',
}
const DEFAULT_API_KEY = process.env.DASHSCOPE_API_KEY || ''
const DEFAULT_WORKSPACE_ID = process.env.ALIYUN_WORKSPACE_ID || ''

// 连接到 postgres 数据库来创建 thinkchat 数据库
const adminPool = new Pool({
  ...DB,
  database: 'postgres',
})

async function init() {
  // 1. 创建 thinkchat 数据库
  try {
    await adminPool.query(`CREATE DATABASE thinkchat`)
    console.log('[OK] thinkchat 数据库创建成功')
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log('thinkchat 数据库已存在')
    } else {
      throw e
    }
  }
  await adminPool.end()

  // 2. 连接到 thinkchat 数据库，建表
  const dbPool = new Pool({
    ...DB,
    database: process.env.PG_DATABASE || 'thinkchat',
  })

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      nickname VARCHAR(50) DEFAULT '',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[OK] users')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS user_configs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) DEFAULT 'aliyun',
      api_key TEXT DEFAULT '',
      region VARCHAR(20) DEFAULT 'bj',
      workspace_id VARCHAR(100) DEFAULT '',
      base_url TEXT DEFAULT '',
      model VARCHAR(100) DEFAULT 'deepseek-v4-flash',
      system TEXT DEFAULT '',
      temperature DOUBLE PRECISION DEFAULT 0.8,
      stream BOOLEAN DEFAULT true,
      enable_search BOOLEAN DEFAULT false,
      enable_thinking BOOLEAN DEFAULT true,
      reasoning_effort VARCHAR(20) DEFAULT 'high',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[OK] user_configs')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(50) PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_template_id VARCHAR(50),
      title VARCHAR(255) DEFAULT '新对话',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[OK] conversations')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS panels (
      id VARCHAR(50) PRIMARY KEY,
      conversation_id VARCHAR(50) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      parent_id VARCHAR(50),
      title VARCHAR(255) DEFAULT '',
      type VARCHAR(20) NOT NULL DEFAULT 'container',
      source_message_id INTEGER,
      source_suggestion_index INTEGER DEFAULT 0,
      summary TEXT,
      summary_msg_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )
  `)
  console.log('[OK] panels')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER NOT NULL,
      panel_id VARCHAR(50) NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT DEFAULT '',
      suggestions TEXT,
      reasoning TEXT,
      images TEXT,
      parent_message_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (id, panel_id)
    )
  `)
  console.log('[OK] messages')

  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id)`)
  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_panels_conv ON panels(conversation_id)`)
  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_msgs_panel ON messages(panel_id)`)
  console.log('[OK] indexes')

  // 全局配置表（权限系统：管理员统一配置，全局生效）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS global_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider VARCHAR(20) DEFAULT 'aliyun',
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
  `)
  // 初始化唯一行 id=1（仅首次）
  await dbPool.query(
    `INSERT INTO global_config (id, provider, api_key, region, workspace_id, base_url, model)
     VALUES (1, 'aliyun', $1, 'bj', $2, '', 'qwen3.7-max')
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_API_KEY, DEFAULT_WORKSPACE_ID],
  )
  console.log('[OK] global_config')

  // 操作日志表
  await dbPool.query(`
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
  `)
  console.log('[OK] operation_logs')
  await dbPool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_user ON operation_logs(user_id)')
  await dbPool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_action ON operation_logs(action)')
  await dbPool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_category ON operation_logs(category)')
  await dbPool.query('CREATE INDEX IF NOT EXISTS idx_oplogs_created ON operation_logs(created_at DESC)')
  console.log('[OK] operation_logs indexes')

  // 角色模板表（首页默认角色，由管理员配置）
  await dbPool.query(`
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
  `)
  console.log('[OK] role_templates')

  await dbPool.query(`
    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS role_template_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS greeting TEXT DEFAULT ''
  `)
  await dbPool.query(`
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
  `)
  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_user_role_template
      ON conversations(user_id, role_template_id)
      WHERE role_template_id IS NOT NULL
  `)
  console.log('[OK] role template conversation uniqueness')

  // 管理员白名单提升：MINDMAPCHAT_ADMIN_USERNAME（逗号分隔多个用户名），未配置则跳过
  const adminNames = (process.env.MINDMAPCHAT_ADMIN_USERNAME || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (adminNames.length) {
    await dbPool.query('UPDATE users SET is_admin = true WHERE username = ANY($1)', [adminNames])
    console.log(`[OK] 管理员白名单生效: ${adminNames.join(', ')}`)
  } else {
    console.log('[SKIP] 未配置 MINDMAPCHAT_ADMIN_USERNAME，不提升任何管理员')
  }

  // 人物画像：画像采集开关列、分类树与提问样本表、种子（幂等）
  await ensureProfileSchema(dbPool)
  console.log('[OK] profile feature tables & taxonomy seeds')

  // 验证
  const { rows: allTables } = await dbPool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  )
  console.log('\nthinkchat 数据库表:', allTables.map(r => r.tablename).join(', '))

  await dbPool.end()
  console.log('\n数据库初始化完成！')
}

init().catch(e => {
  console.error('失败:', e.message)
  process.exit(1)
})
