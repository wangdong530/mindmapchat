/**
 * 人物画像：提问采集与异步兴趣分类
 *  - enqueueQuestionCapture 由 /api/chat、/api/personality-split 在提问时 fire-and-forget 调用
 *  - 内部串行队列处理；先校验账户级/会话级开关，再调用模型做 2-4 级兴趣归类
 *  - 绝不保存提问原文，只落库截断片段 + 分类路径 + 关键词
 */
import pool, { getGlobalConfig } from './db.js'
import { callLLM, retryAsync, limitVisibleText, normalizeVisibleText } from './chat-proxy.js'
import * as profileDb from './profile-db.js'

const SNIPPET_MAX = 60 // 入库片段长度
const CLASSIFY_INPUT_MAX = 400 // 送模型文本长度
const MAX_KEYWORDS = 5
const KEYWORD_MAX_LEN = 24

/**
 * 入队一次提问归类（调用方无需 await，内部串行执行并吞掉错误）
 * @param {{userId:number, conversationId?:string, source:'chat'|'personality', text:string}} job
 */
export function enqueueQuestionCapture({ userId, conversationId, source, text }) {
  const raw = String(text || '').trim()
  if (!userId || !raw) return
  enqueueJob({
    userId,
    conversationId: conversationId || null,
    source: source === 'personality' ? 'personality' : 'chat',
    text: raw,
  })
}

let tail = Promise.resolve()
function enqueueJob(job) {
  tail = tail.then(() => runJob(job)).catch((err) => {
    console.warn('[profile-classifier] job failed:', err?.message)
  })
}

async function runJob(job) {
  // 1) 账户级总开关
  const userEnabled = await profileDb.getUserProfileEnabled(pool, job.userId).catch(() => null)
  if (!userEnabled) return
  // 2) 会话级开关（会话被删除 -> 视为关闭不采）
  if (job.conversationId) {
    const convEnabled = await profileDb.getConversationProfileEnabled(pool, job.conversationId).catch(() => null)
    if (convEnabled !== true) return
  }
  // 3) 纯图片等无文字提问不归类
  const text = normalizeVisibleText(job.text)
  if (!text) return

  const snippet = limitVisibleText(job.text, SNIPPET_MAX)
  // 4) 数据库去重：同一用户 90 秒内相似提问只采一次（覆盖“重新生成/同问句重发”）
  const dup = await pool.query(
    `SELECT 1 FROM query_classifications
     WHERE user_id = $1 AND snippet = $2 AND created_at > NOW() - INTERVAL '90 seconds'
     LIMIT 1`,
    [job.userId, snippet],
  ).catch(() => ({ rows: [] }))
  if (dup.rows.length) return

  const input = Array.from(text).length > CLASSIFY_INPUT_MAX
    ? Array.from(text).slice(0, CLASSIFY_INPUT_MAX).join('')
    : text

  const tree = await profileDb.getTaxonomyTree(pool, { includeDisabled: false }).catch(() => [])
  if (!tree.length) {
    await profileDb.insertClassification(pool, {
      userId: job.userId, conversationId: job.conversationId, source: job.source,
      snippet, path: [], keywords: [], matched: false, status: 'failed',
    })
    return
  }

  const categoryText = profileDb.taxonomyToPrompt(tree)
  const result = await classifyWithModel(input, categoryText, tree).catch(() => null)
  if (!result) {
    // 模型归类彻底失败也保留样本（不丢样本，但标记 failed 不参与分布/关键词统计）
    await profileDb.insertClassification(pool, {
      userId: job.userId, conversationId: job.conversationId, source: job.source,
      snippet, path: [], keywords: [], matched: false, status: 'failed',
    })
    return
  }

  await profileDb.insertClassification(pool, {
    userId: job.userId, conversationId: job.conversationId, source: job.source,
    snippet, path: result.path, keywords: result.keywords, matched: result.matched, status: 'ok',
  })
}

async function classifyWithModel(input, categoryText, tree) {
  const globalConfig = await getGlobalConfig().catch(() => null)
  const messages = [
    {
      role: 'system',
      content: `你是用户兴趣归类器。根据用户的一句提问判断其感兴趣的话题，只能从下方给定的分类树中选择。
【分类树】（行首空格数 = 层级，名字后[code]为唯一标识）
${categoryText}
要求：
1. 若提问能归入分类树，选出从一级到最细层级的一条路径，输出一级节点的 code 到叶子 code。
2. 最多保留 5 个提问中出现的关键话题词（关键词本身，不是分类名）。
3. 若与树中任何分类都不相符，path 输出空数组 []，但保留关键词。
4. 只输出一个 JSON 对象，不要输出任何其它文字或代码块标记。
格式示例：{"path":["finance","finance-invest","finance-invest-stock"],"keywords":["A股","定投"]}
无法归类的示例：{"path":[],"keywords":["量子纠缠","冷知识"]}`,
    },
    { role: 'user', content: `用户提问：${input}` },
  ]
  const raw = await retryAsync(() => callLLM(messages, { temperature: 0 }, globalConfig, { maxTokens: 240 }), {
    maxRetries: 2,
    baseDelayMs: 1200,
    jitterMs: 400,
  })
  const parsed = parseClassifyOutput(raw)
  if (!parsed) return null
  const path = buildValidPath(tree, parsed.requestedPath)
  return { path: path || [], keywords: parsed.keywords, matched: !!path }
}

// 提取模型输出中的 JSON 对象（容忍首尾叙述/代码块残留）
function extractJsonObject(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function parseClassifyOutput(raw) {
  const obj = extractJsonObject(String(raw || ''))
  if (!obj) return null
  const requestedPath = Array.isArray(obj.path) ? obj.path.map(String).filter(Boolean) : []
  const keywords = (Array.isArray(obj.keywords) ? obj.keywords : [])
    .map(String)
    .map((k) => Array.from(k).slice(0, KEYWORD_MAX_LEN).join(''))
    .map((k) => k.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, MAX_KEYWORDS)

  // 只透传 keywords，path 校验交给 buildValidPath（需要分类树上下文）
  return { requestedPath, keywords }
}

/**
 * 校验 model 返回的 code 链，映射成 [{code,name}]（取一级到指定叶子）。
 * @param {Array} tree - getTaxonomyTree 结果
 * @param {Array<string>} codes
 */
export function buildValidPath(tree, codes) {
  if (!Array.isArray(tree) || !Array.isArray(codes) || codes.length === 0) return null
  const byCode = new Map()
  const walk = (nodes) => {
    for (const n of nodes) {
      byCode.set(n.code, n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(tree)
  if (!byCode.has(codes[0])) return null
  const path = []
  let parentCode = null
  for (const code of codes) {
    const node = byCode.get(code)
    if (!node) break
    if (node.parentCode && node.parentCode !== parentCode) break // 链断裂即截断
    path.push({ code: node.code, name: node.name })
    parentCode = node.code
  }
  return path.length ? path : null
}
