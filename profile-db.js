/**
 * 人物画像：数据访问层
 *   - 分类树（profile_taxonomy，管理员维护）
 *   - 用户提问分类样本（query_classifications：不存原文，只存截断片段/路径/关键词）
 *   - 自画像文案缓存（profile_narratives）
 * ensureProfileSchema(db) 供 init-db 与 server-prod 共用，建表/加列/种子全部幂等。
 */

// ===================== 兴趣分类树种子 =====================
// code 全局唯一且不可修改（历史样本按 code 归类）；改名只允许改 name。
// level: 1 根分类、2 二级、3 三级；叶子层级即单条提问可归到的最细路径。
const PROFILE_TAXONOMY_SEED = [
  { code: 'tech', name: '科技数码', level: 1, children: [
    { code: 'tech-ai', name: '人工智能', level: 2, children: [
      { code: 'tech-ai-ml', name: '机器学习算法', level: 3 },
      { code: 'tech-ai-llm', name: '大模型应用', level: 3 },
      { code: 'tech-ai-gen', name: 'AI绘画与视频', level: 3 },
    ] },
    { code: 'tech-prog', name: '编程开发', level: 2, children: [
      { code: 'tech-prog-web', name: '前端开发', level: 3 },
      { code: 'tech-prog-mobile', name: '移动应用', level: 3 },
      { code: 'tech-prog-backend', name: '后端与架构', level: 3 },
      { code: 'tech-prog-alg', name: '算法与数据结构', level: 3 },
    ] },
    { code: 'tech-digi', name: '数码与硬件', level: 2 },
    { code: 'tech-sec', name: '网络安全', level: 2 },
  ] },
  { code: 'career', name: '职业发展', level: 1, children: [
    { code: 'career-jobseek', name: '求职与面试', level: 2 },
    { code: 'career-product', name: '产品与项目管理', level: 2 },
    { code: 'career-mgmt', name: '团队与职场关系', level: 2 },
    { code: 'career-startup', name: '创业与副业', level: 2 },
    { code: 'career-office', name: '办公技能与效率', level: 2 },
  ] },
  { code: 'finance', name: '财经商业', level: 1, children: [
    { code: 'finance-invest', name: '投资理财', level: 2, children: [
      { code: 'finance-invest-stock', name: '股票基金', level: 3 },
      { code: 'finance-invest-house', name: '房产投资', level: 3 },
      { code: 'finance-invest-fintech', name: '数字金融', level: 3 },
    ] },
    { code: 'finance-econ', name: '经济与商业趋势', level: 2 },
  ] },
  { code: 'life', name: '生活日常', level: 1, children: [
    { code: 'life-food', name: '美食与烹饪', level: 2 },
    { code: 'life-home', name: '家居与收纳', level: 2 },
    { code: 'life-pets', name: '宠物', level: 2 },
    { code: 'life-shopping', name: '购物消费', level: 2 },
  ] },
  { code: 'entertain', name: '娱乐休闲', level: 1, children: [
    { code: 'entertain-game', name: '游戏', level: 2 },
    { code: 'entertain-movie', name: '影视', level: 2, children: [
      { code: 'entertain-movie-drama', name: '剧集综艺', level: 3 },
    ] },
    { code: 'entertain-music', name: '音乐', level: 2 },
    { code: 'entertain-anime', name: '动漫与二次元', level: 2 },
  ] },
  { code: 'relation', name: '情感人际', level: 1, children: [
    { code: 'relation-emotion', name: '情绪与情感', level: 2 },
    { code: 'relation-friend', name: '朋友与人际', level: 2 },
    { code: 'relation-family', name: '家庭关系', level: 2 },
    { code: 'relation-love', name: '恋爱与脱单', level: 2 },
  ] },
  { code: 'study', name: '学习教育', level: 1, children: [
    { code: 'study-exam', name: '考试升学', level: 2 },
    { code: 'study-lang', name: '语言学习', level: 2 },
    { code: 'study-skill', name: '技能与自学', level: 2 },
  ] },
  { code: 'travel', name: '旅行出游', level: 1, children: [
    { code: 'travel-plan', name: '攻略与路线规划', level: 2 },
    { code: 'travel-spot', name: '目的地与景点', level: 2 },
    { code: 'travel-abroad', name: '出境游', level: 2 },
  ] },
  { code: 'health', name: '健康医疗', level: 1, children: [
    { code: 'health-body', name: '身体不适与疾病', level: 2 },
    { code: 'health-mental', name: '心理与情绪健康', level: 2 },
    { code: 'health-diet', name: '营养与饮食', level: 2 },
    { code: 'health-med', name: '就医与用药', level: 2 },
  ] },
  { code: 'sports', name: '运动健身', level: 1, children: [
    { code: 'sports-ball', name: '球类运动', level: 2 },
    { code: 'sports-outdoor', name: '户外与登山', level: 2 },
    { code: 'sports-fitness', name: '健身塑形', level: 2 },
  ] },
  { code: 'culture', name: '文化兴趣', level: 1, children: [
    { code: 'culture-history', name: '历史', level: 2 },
    { code: 'culture-literature', name: '文学阅读', level: 2 },
    { code: 'culture-philosophy', name: '哲学思考', level: 2 },
    { code: 'culture-art', name: '艺术与展览', level: 2 },
  ] },
  { code: 'create', name: '创作手工', level: 1, children: [
    { code: 'create-writing', name: '写作', level: 2 },
    { code: 'create-photo', name: '摄影', level: 2 },
    { code: 'create-design', name: '设计与绘画', level: 2 },
    { code: 'create-diy', name: '手工DIY', level: 2 },
  ] },
  { code: 'society', name: '社会观察', level: 1, children: [
    { code: 'society-hot', name: '时事热点', level: 2 },
    { code: 'society-law', name: '法律与权益', level: 2 },
    { code: 'society-policy', name: '政策解读', level: 2 },
  ] },
]

// 展平种子树：{code,name,level,parentCode}，递归时带上直接父级
function flattenTaxonomySeed(nodes, out = [], parentCode = null) {
  for (const n of nodes) {
    out.push({ code: n.code, name: n.name, level: n.level, parentCode })
    if (n.children && n.children.length) flattenTaxonomySeed(n.children, out, n.code)
  }
  return out
}

export function taxonomySeedRows() {
  return flattenTaxonomySeed(PROFILE_TAXONOMY_SEED)
}

// ===================== Schema 迁移（幂等） =====================
export async function ensureProfileSchema(db) {
  // 1) 账户级画像采集总开关（默认开）
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_enabled BOOLEAN NOT NULL DEFAULT true")
  // 2) 会话级画像采集开关（默认开）
  await db.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile_enabled BOOLEAN NOT NULL DEFAULT true")

  // 3) 兴趣分类树
  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_taxonomy (
      code VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      parent_code VARCHAR(64) REFERENCES profile_taxonomy(code) ON DELETE CASCADE,
      level INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await db.query('CREATE INDEX IF NOT EXISTS idx_taxonomy_parent ON profile_taxonomy(parent_code)')

  // 4) 提问分类样本（不存原文）
  await db.query(`
    CREATE TABLE IF NOT EXISTS query_classifications (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id VARCHAR(50),
      source VARCHAR(20) NOT NULL DEFAULT 'chat',
      snippet VARCHAR(100) NOT NULL DEFAULT '',
      path JSONB NOT NULL DEFAULT '[]',
      keywords JSONB NOT NULL DEFAULT '[]',
      matched BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(20) NOT NULL DEFAULT 'ok',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await db.query('CREATE INDEX IF NOT EXISTS idx_qc_user_time ON query_classifications(user_id, created_at)')
  await db.query('CREATE INDEX IF NOT EXISTS idx_qc_user_matched ON query_classifications(user_id, matched)')

  // 5) 自画像文案缓存
  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_narratives (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      sample_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // 6) 分类树种子（幂等：父级先于子级插入以满足自引用外键；已存在/管理员改名的节点不覆盖）
  const seed = taxonomySeedRows()
  for (let i = 0; i < seed.length; i++) {
    const n = seed[i]
    await db.query(
      `INSERT INTO profile_taxonomy (code, name, parent_code, level, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [n.code, n.name, n.parentCode, n.level, i],
    )
  }
}

// ===================== 开关 =====================
export async function getUserProfileEnabled(db, userId) {
  const { rows } = await db.query('SELECT profile_enabled AS enabled FROM users WHERE id = $1', [userId])
  return rows[0] ? rows[0].enabled : false
}

export async function setUserProfileEnabled(db, userId, enabled) {
  await db.query('UPDATE users SET profile_enabled = $1 WHERE id = $2', [!!enabled, userId])
}

export async function getConversationProfileEnabled(db, conversationId) {
  const { rows } = await db.query('SELECT profile_enabled AS enabled FROM conversations WHERE id = $1', [conversationId])
  return rows[0] ? rows[0].enabled : null
}

export async function setConversationProfileEnabled(db, conversationId, enabled) {
  await db.query('UPDATE conversations SET profile_enabled = $1 WHERE id = $2', [!!enabled, conversationId])
}

// ===================== 分类样本 =====================
export async function insertClassification(db, { userId, conversationId, source, snippet, path, keywords, matched, status }) {
  await db.query(
    `INSERT INTO query_classifications (user_id, conversation_id, source, snippet, path, keywords, matched, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      userId,
      conversationId || null,
      source || 'chat',
      snippet || '',
      JSON.stringify(path || []),
      JSON.stringify(keywords || []),
      !!matched,
      status || 'ok',
    ],
  )
}

// 拉取某用户全量样本（id/时间/路径/是否命中/状态；不含关键词，关键词单独 SQL 统计）
export async function loadSamples(db, { userId, sinceDays = null } = {}) {
  const params = [userId]
  let where = 'user_id = $1'
  if (sinceDays) {
    params.push(sinceDays)
    where += ' AND created_at >= NOW() - ($2::int * INTERVAL \'1 day\')'
  }
  const { rows } = await db.query(
    `SELECT id, source, path, matched, status, created_at AS "createdAt"
     FROM query_classifications WHERE ${where} ORDER BY created_at ASC`,
    params,
  )
  return rows
}

export async function loadSamplesSince(db, { userId, fromDate } = {}) {
  const { rows } = await db.query(
    `SELECT id, source, path, matched, status, created_at AS "createdAt"
     FROM query_classifications
     WHERE user_id = $1 AND created_at >= $2
     ORDER BY created_at ASC`,
    [userId, fromDate],
  )
  return rows
}

// 关键词 Top：优先汇总匹配样本；matched=false 的 ok 样本用作“潜在话题”
export async function keywordTop(db, { userId, sinceDays = null, onlyMatched = null, limit = 40 } = {}) {
  const params = [userId]
  let where = 'user_id = $1 AND status = \'ok\''
  if (sinceDays) {
    params.push(sinceDays)
    where += ' AND created_at >= NOW() - ($2::int * INTERVAL \'1 day\')'
  }
  if (onlyMatched === true) where += ' AND matched = true'
  else if (onlyMatched === false) where += ' AND matched = false'
  params.push(limit)
  const { rows } = await db.query(
    `SELECT el AS keyword, COUNT(*)::int AS count
     FROM query_classifications, jsonb_array_elements_text(keywords) AS el
     WHERE ${where}
     GROUP BY el ORDER BY count DESC, keyword LIMIT $${params.length}`,
    params,
  )
  return rows.map(r => ({ keyword: r.keyword, count: r.count }))
}

// 下钻某分类（含其后代）：按 path 中是否含指定 code 过滤
export async function listQueryClassifications(db, { userId, codes = [], source = null, limit = 50, offset = 0 } = {}) {
  const params = [userId]
  const conditions = ['user_id = $1 AND status = \'ok\'']
  if (codes && codes.length) {
    params.push(codes)
    conditions.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(path) el WHERE el->>'code' = ANY($${params.length})
    )`)
  }
  if (source) {
    params.push(source)
    conditions.push(`source = $${params.length}`)
  }
  params.push(limit, offset)
  const { rows } = await db.query(
    `SELECT id, conversation_id AS "conversationId", source, snippet, path, keywords, matched,
            created_at AS "createdAt"
     FROM query_classifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows.map(r => ({
    ...r,
    path: r.path || [],
    keywords: r.keywords || [],
  }))
}

export async function countQueryClassifications(db, { userId, codes = [], source = null } = {}) {
  const params = [userId]
  const conditions = ['user_id = $1 AND status = \'ok\'']
  if (codes && codes.length) {
    params.push(codes)
    conditions.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(path) el WHERE el->>'code' = ANY($${params.length})
    )`)
  }
  if (source) {
    params.push(source)
    conditions.push(`source = $${params.length}`)
  }
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM query_classifications WHERE ${conditions.join(' AND ')}`,
    params,
  )
  return rows[0]?.total || 0
}

// ===================== 自画像文案缓存 =====================
export async function getNarrative(db, userId) {
  const { rows } = await db.query(
    `SELECT content, sample_count AS "sampleCount", updated_at AS "updatedAt"
     FROM profile_narratives WHERE user_id = $1`,
    [userId],
  )
  return rows[0] || null
}

export async function upsertNarrative(db, userId, content, sampleCount) {
  await db.query(
    `INSERT INTO profile_narratives (user_id, content, sample_count, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (user_id) DO UPDATE SET content = $2, sample_count = $3, updated_at = NOW()`,
    [userId, content, sampleCount],
  )
}

// ===================== 分类树管理（管理员） =====================
export async function getTaxonomyRows(db, { includeDisabled = false } = {}) {
  const { rows } = await db.query(
    `SELECT code, name, parent_code AS "parentCode", level, sort_order AS "sortOrder",
            is_enabled AS "isEnabled", created_at AS "createdAt"
     FROM profile_taxonomy
     ${includeDisabled ? '' : 'WHERE is_enabled = true'}
     ORDER BY level ASC, sort_order ASC, code ASC`,
  )
  return rows
}

// 组装嵌套树。停用父级时整棵子树都不参与归类提示词（不把其启用的子级提升成顶级）。
// 管理界面（includeDisabled=true）则展示全量（含停用节点）。
export async function getTaxonomyTree(db, { includeDisabled = false } = {}) {
  // 内部总是取全量，便于“停用父级时剪掉整棵子树”
  const rows = await getTaxonomyRows(db, { includeDisabled: true })
  const nodeMap = new Map(rows.map(r => [r.code, { ...r, children: [] }]))
  const roots = []
  for (const r of rows) {
    const node = nodeMap.get(r.code)
    if (r.parentCode && nodeMap.has(r.parentCode)) nodeMap.get(r.parentCode).children.push(node)
    else roots.push(node)
  }
  const sort = (arr) => arr.sort((a, b) => (a.sortOrder - b.sortOrder) || a.code.localeCompare(b.code))
  const sortAll = (nodes) => {
    sort(nodes)
    for (const n of nodes) sortAll(n.children)
  }
  sortAll(roots)

  const pruneDisabled = (nodes) => {
    const kept = []
    for (const n of nodes) {
      if (!n.isEnabled) continue // 停用节点：整棵子树不再参与
      n.children = pruneDisabled(n.children)
      kept.push(n)
    }
    return kept
  }
  return includeDisabled ? roots : pruneDisabled(roots)
}

// 生成分类提示词文本：每行 "  "*level + name + [code]，方便 LLM 直接输出 code
export function taxonomyToPrompt(tree, depth = 0, lines = []) {
  for (const n of tree) {
    lines.push('  '.repeat(depth) + `${n.name} [${n.code}]`)
    if (n.children && n.children.length) taxonomyToPrompt(n.children, depth + 1, lines)
  }
  return lines.join('\n')
}

export async function createTaxonomyNode(db, { code, name, parentCode = null, sortOrder = 0 }) {
  const codeRe = /^[a-z0-9][a-z0-9-]{1,62}$/i
  if (!codeRe.test(code)) throw new Error('code 只能由字母/数字/中划线组成')
  if (!name || !name.trim()) throw new Error('name 不能为空')
  let level = 1
  if (parentCode) {
    const { rows } = await db.query('SELECT level FROM profile_taxonomy WHERE code = $1', [parentCode])
    if (!rows.length) throw new Error('父分类不存在')
    level = rows[0].level + 1
    if (level > 4) throw new Error('分类最多支持 4 级')
  }
  try {
    await db.query(
      `INSERT INTO profile_taxonomy (code, name, parent_code, level, sort_order, is_enabled)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [code.trim(), name.trim(), parentCode || null, level, Number(sortOrder) || 0],
    )
  } catch (e) {
    if (e.code === '23505') throw new Error('code 已存在')
    throw e
  }
  return level
}

export async function updateTaxonomyNode(db, code, { name, sortOrder, isEnabled }) {
  const fields = []
  const params = []
  if (name !== undefined) { params.push(name.trim()); fields.push(`name = $${params.length}`) }
  if (sortOrder !== undefined) { params.push(Number(sortOrder) || 0); fields.push(`sort_order = $${params.length}`) }
  if (isEnabled !== undefined) { params.push(!!isEnabled); fields.push(`is_enabled = $${params.length}`) }
  if (!fields.length) return
  params.push(code)
  await db.query(`UPDATE profile_taxonomy SET ${fields.join(', ')}, updated_at = NOW() WHERE code = $${params.length}`, params)
}

// 仅允许删除叶子节点，且提示用户历史样本保留（不再按旧 code 归类到树）
export async function deleteTaxonomyNode(db, code) {
  const { rows } = await db.query('SELECT code FROM profile_taxonomy WHERE parent_code = $1 LIMIT 1', [code])
  if (rows.length) throw new Error('该分类下还有子分类，请先删除子分类')
  await db.query('DELETE FROM profile_taxonomy WHERE code = $1', [code])
}
