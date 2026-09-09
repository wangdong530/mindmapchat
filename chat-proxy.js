/**
 * 多服务商 Chat API 代理核心模块（OpenAI 兼容）
 * 支持：
 *   - aliyun  : 阿里云百炼 (DashScope) compatible-mode，按 region + workspaceId 拼 endpoint
 *   - tencent : 腾讯混元 TokenHub，固定 endpoint，无需 workspaceId
 * 兼容：原生 http / Express / Koa(配 bodyparser) / Fastify / Next.js API Route
 * 依赖：Node 18+（使用全局 fetch 与 ReadableStream）
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// —— 阿里云百炼 各地域兼容模式 chat/completions 地址 ——
const ALIYUN_REGION_URLS = {
  cn: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  sg: 'https://{ws}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  us: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions',
  bj: 'https://{ws}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  hk: 'https://{ws}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  de: 'https://{ws}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  jp: 'https://{ws}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
}

// —— 腾讯混元 TokenHub 各地域 endpoint ——
const TENCENT_ENDPOINTS = {
  gz: 'https://tokenhub.tencentmaas.com/v1/chat/completions', // 广州主站
  gzBak: 'https://tokenhub.tencentmaas.cn/v1/chat/completions', // 广州备用域名
  sg: 'https://tokenhub-intl.tencentmaas.com/v1/chat/completions', // 新加坡（国际站）
}

// —— 服务商注册表 ——
const PROVIDERS = {
  aliyun: {
    label: '阿里云百炼',
    defaultRegion: 'bj',
    defaultModel: 'qwen3.7-max',
    // 思考参数放在 extra_body 中
    thinkingMode: 'extra_body',
    supportsSearch: true,
  },
  tencent: {
    label: '腾讯混元 TokenHub',
    defaultRegion: 'gz',
    defaultModel: 'hy3',
    // 思考参数放在顶层（thinking:{type:'enabled'}）+ 顶层 reasoning_effort
    thinkingMode: 'top',
    supportsSearch: false,
  },
}

// —— 默认连接配置 ——
// 敏感凭据一律从环境变量读取，不再硬编码到源码中。
const DEFAULTS = {
  provider: 'aliyun',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  region: 'bj',
  workspaceId: process.env.ALIYUN_WORKSPACE_ID || '',
  model: 'qwen3.7-max',
  baseUrl: '',
  system: '',
  temperature: 0.3,
  stream: true,
  enableSearch: false,
  enableThinking: false,
  reasoningEffort: 'high',
}

// 腾讯混元 TokenHub 默认 Key（环境变量注入）
const TENCENT_DEFAULT_API_KEY = process.env.TENCENT_TOKENHUB_API_KEY || ''

// 读取请求体
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length) {
      return resolve(req.body)
    }
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// 计算最终 endpoint
function buildEndpoint(provider, baseUrl, region, workspaceId) {
  if (baseUrl && /^https?:\/\//i.test(String(baseUrl).trim())) {
    return String(baseUrl).trim()
  }
  if (provider === 'tencent') {
    const ep = TENCENT_ENDPOINTS[region] || TENCENT_ENDPOINTS.gz
    return ep
  }
  // 默认 / aliyun
  const tpl = ALIYUN_REGION_URLS[region]
  if (!tpl) throw new Error('不支持的 region: ' + region + '，可选: ' + Object.keys(ALIYUN_REGION_URLS).join(', '))
  if (tpl.includes('{ws}')) {
    if (!workspaceId) throw new Error('当前 region 需要 workspaceId（业务空间 ID）')
    return tpl.replace('{ws}', String(workspaceId).trim())
  }
  return tpl
}

function sendError(res, code, msg) {
  if (res.headersSent) { res.end(); return }
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: msg }))
}

/**
 * 将消息中的 images（服务器图片路径数组）转为 base64 并嵌入 content 数组
 * 兼容 OpenAI Vision 格式：content 数组 [{type:'text', text:'...'}, {type:'image_url', image_url:{url:'data:...'}}]
 * @param {Array} chatMessages - 消息数组
 * @returns {Array} 处理后的消息数组
 */
async function embedImagesInMessages(chatMessages) {
  const UPLOAD_DIR = path.join(__dirname, 'uploads')
  const result = []
  for (const msg of chatMessages) {
    const images = msg.images
    if (!images || !Array.isArray(images) || images.length === 0 || msg.role !== 'user') {
      // 无图片或非用户消息：content 保持原样
      result.push(msg)
      continue
    }

    // 构建 vision content 数组
    const contentParts = []
    // 文字部分
    if (msg.content && msg.content.trim()) {
      contentParts.push({ type: 'text', text: msg.content })
    }
    // 图片部分：读取本地文件转 base64
    for (const imgUrl of images) {
      try {
        // imgUrl 格式：/uploads/xxx.png 或 http://host:port/uploads/xxx.png
        const filename = imgUrl.replace(/^.*\/uploads\//, '')
        const filePath = path.join(UPLOAD_DIR, filename)
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath)
          const ext = path.extname(filename).toLowerCase()
          const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
          const mime = mimeMap[ext] || 'image/png'
          const base64 = buf.toString('base64')
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${base64}` },
          })
        } else {
          console.warn('[Multimodal] 图片文件不存在:', filePath)
        }
      } catch (e) {
        console.warn('[Multimodal] 图片读取失败:', e.message)
      }
    }
    // 如果至少有一张图片被成功嵌入，使用数组格式；否则回退原始内容
    const hasImage = contentParts.some(p => p.type === 'image_url')
    result.push({
      ...msg,
      content: hasImage ? contentParts : msg.content,
    })
    // 移除非标准的 images 字段，避免污染 payload
    delete result[result.length - 1].images
  }
  return result
}

/**
 * 创建 Chat 代理 handler
 */
function createChatHandler(opts = {}) {
  return async function chatHandler(req, res) {
    let parsed
    try {
      parsed = await readBody(req)
    } catch {
      return sendError(res, 400, '请求体不是合法 JSON')
    }

    // 解析基准配置：优先采用客户端（前端已保存的模型配置）传入的值，其次服务端全局配置（管理员统一配置），最后 opts 默认值。
    // 这样在页面上保存模型配置后能立即生效，而不必强依赖数据库写入成功。
    let base = null
    if (typeof opts.configProvider === 'function') {
      try { base = await opts.configProvider() } catch (e) { console.error('[configProvider]', e.message) }
    }

    // 服务商：客户端 > 全局配置 > 默认值
    const provider = parsed.provider || base?.provider || opts.defaultProvider || 'aliyun'
    const providerCfg = PROVIDERS[provider] || PROVIDERS.aliyun

    // 各供应商有自己的默认 key，避免混用
    const fallbackApiKey = provider === 'aliyun'
      ? (opts.defaultApiKey || DEFAULTS.apiKey)
      : (opts.defaultApiKey || TENCENT_DEFAULT_API_KEY)

    const cfg = {
      provider,
      apiKey: parsed.apiKey || base?.apiKey || fallbackApiKey,
      region: parsed.region || base?.region || opts.defaultRegion || providerCfg.defaultRegion,
      workspaceId: parsed.workspaceId || base?.workspaceId || opts.defaultWorkspaceId || DEFAULTS.workspaceId,
      model: parsed.model || base?.model || opts.defaultModel || providerCfg.defaultModel,
      baseUrl: parsed.baseUrl || base?.baseUrl || DEFAULTS.baseUrl,
      // system 提示由客户端在 messages 中携带（已包含全局 system + 建议提示），此处保留原行为
      system: parsed.system !== undefined ? parsed.system : DEFAULTS.system,
      // 行为参数：客户端可覆盖（如建议兜底需要 stream:false），缺省时回退到全局配置（管理员设定的默认值）
      temperature: parsed.temperature !== undefined ? parsed.temperature : (base?.temperature !== undefined ? base.temperature : DEFAULTS.temperature),
      stream: parsed.stream !== undefined ? parsed.stream : (base?.stream !== undefined ? base.stream : DEFAULTS.stream),
      enableSearch: parsed.enableSearch !== undefined ? parsed.enableSearch : (base?.enableSearch !== undefined ? base.enableSearch : DEFAULTS.enableSearch),
      enableThinking: false,
      reasoningEffort: '',
    }

    if (!cfg.apiKey) {
      return sendError(res, 400, provider === 'tencent'
        ? '缺少 apiKey（腾讯混元 TokenHub 需在模型配置中填写专属 API Key）'
        : '缺少 apiKey')
    }

    let endpoint
    try {
      endpoint = buildEndpoint(cfg.provider, cfg.baseUrl, cfg.region, cfg.workspaceId)
    } catch (e) {
      return sendError(res, 400, e.message)
    }

    // 组装消息：system 插到最前
    let chatMessages = Array.isArray(parsed.messages) ? parsed.messages.slice() : []
    if (cfg.system && cfg.system.trim()) {
      if (chatMessages[0] && chatMessages[0].role === 'system') chatMessages[0].content = cfg.system
      else chatMessages.unshift({ role: 'system', content: cfg.system })
    }

    // 多模态：将用户消息中的 images 路径转为 base64 嵌入 content
    try {
      chatMessages = await embedImagesInMessages(chatMessages)
    } catch (e) {
      console.warn('[Multimodal] embedImagesInMessages 错误:', e.message)
    }

    // 组装 payload
    const payload = { model: cfg.model, messages: chatMessages, stream: !!cfg.stream }
    if (typeof cfg.temperature === 'number' && !Number.isNaN(cfg.temperature)) payload.temperature = cfg.temperature

    // —— 思考 / 搜索参数：按服务商映射 ——
    if (providerCfg.thinkingMode === 'extra_body') {
      // 阿里云：思考与搜索都走 extra_body
      const extra = {}
      if (cfg.enableSearch) extra.enable_search = true
      if (cfg.enableThinking && (cfg.reasoningEffort === 'high' || cfg.reasoningEffort === 'max')) {
        extra.enable_thinking = true
        extra.reasoning_effort = cfg.reasoningEffort
      }
      if (Object.keys(extra).length) payload.extra_body = extra
    } else {
      // 腾讯混元：thinking 顶层 + reasoning_effort 顶层；无 enable_search
      if (cfg.enableThinking && (cfg.reasoningEffort === 'high' || cfg.reasoningEffort === 'low')) {
        payload.thinking = { type: 'enabled' }
        payload.reasoning_effort = cfg.reasoningEffort
      }
      // 流式时请求 usage，便于前端展示 token 用量
      if (cfg.stream) payload.stream_options = { include_usage: true }
    }

    // ====== 请求日志 ======
    console.log('\n========== [Chat Request Log] ==========')
    console.log('Provider:', provider)
    console.log('Endpoint:', endpoint)
    console.log('Model:', payload.model, '| Stream:', payload.stream)
    if (payload.temperature !== undefined) console.log('Temperature:', payload.temperature)
    if (payload.thinking) console.log('thinking:', JSON.stringify(payload.thinking))
    if (payload.reasoning_effort) console.log('reasoning_effort:', payload.reasoning_effort)
    if (payload.extra_body) console.log('extra_body:', JSON.stringify(payload.extra_body))
    console.log('messages:', JSON.stringify(chatMessages, null, 2))
    console.log('=======================================\n')

    try {
      const up = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      res.statusCode = up.status
      res.setHeader('Content-Type', up.headers.get('content-type') || 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      if (up.body) {
        const reader = up.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.length) {
            res.write(Buffer.from(value))
          }
        }
      }
      res.end()
    } catch (e) {
      console.error('[Proxy Error]', e && e.message ? e.message : e)
      sendError(res, 502, '上游请求失败（网络不可达或地址错误）: ' + (e && e.message ? e.message : e))
    }
  }
}

/**
 * 非流式调用大模型，返回完整文本（供后台总结等场景使用）
 * @param {{role:string, content:string}[]} messages
 * @param {object} cfg - {provider, apiKey, region, workspaceId, baseUrl, model, temperature}
 * @returns {Promise<string>}
 */
async function callLLM(messages, cfg = {}, globalConfig = null, opts = {}) {
  // 配置解析与 createChatHandler 完全一致：客户端 > 服务端全局配置(管理员) > 默认值
  const provider = cfg.provider || globalConfig?.provider || opts.defaultProvider || DEFAULTS.provider
  const providerCfg = PROVIDERS[provider] || PROVIDERS.aliyun
  const fallbackApiKey = provider === 'aliyun'
    ? (opts.defaultApiKey || DEFAULTS.apiKey)
    : (opts.defaultApiKey || TENCENT_DEFAULT_API_KEY)
  const apiKey = cfg.apiKey || globalConfig?.apiKey || fallbackApiKey
  const region = cfg.region || globalConfig?.region || opts.defaultRegion || providerCfg.defaultRegion
  const workspaceId = cfg.workspaceId || globalConfig?.workspaceId || opts.defaultWorkspaceId || DEFAULTS.workspaceId
  const model = cfg.model || globalConfig?.model || opts.defaultModel || providerCfg.defaultModel
  const baseUrl = cfg.baseUrl || globalConfig?.baseUrl || DEFAULTS.baseUrl
  if (!apiKey) throw createLlmError('缺少 apiKey', { code: 'CONFIG_MISSING' })
  const endpoint = buildEndpoint(provider, baseUrl, region, workspaceId)
  const chatMessages = Array.isArray(messages) ? messages.slice() : []
  if (chatMessages.length === 0) throw createLlmError('空消息，无法调用模型', { code: 'INVALID_INPUT' })
  const payload = { model, messages: chatMessages, stream: false }
  if (typeof cfg.temperature === 'number' && !Number.isNaN(cfg.temperature)) payload.temperature = cfg.temperature
  if (Number.isInteger(opts.maxTokens) && opts.maxTokens > 0) payload.max_tokens = opts.maxTokens
  let up
  try {
    up = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: opts.signal,
    })
  } catch (error) {
    if (opts.signal?.aborted) throw opts.signal.reason || error
    throw createLlmError('上游网络请求失败', { code: 'UPSTREAM_NETWORK', cause: error })
  }
  if (!up.ok) {
    throw createLlmError('上游请求失败(' + up.status + ')', { code: 'UPSTREAM_HTTP', status: up.status })
  }
  try {
    const data = await up.json()
    return data?.choices?.[0]?.message?.content ?? ''
  } catch (error) {
    throw createLlmError('上游返回内容无法解析', { code: 'UPSTREAM_INVALID_RESPONSE', cause: error })
  }
}

function createLlmError(message, { code = 'LLM_REQUEST_FAILED', status = null, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  if (Number.isInteger(status)) error.status = status
  return error
}

function waitForRetry(delayMs, signal) {
  if (delayMs <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(signal.reason || createLlmError('操作已取消', { code: 'ABORTED' }))
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer)
      reject(signal.reason || createLlmError('操作已取消', { code: 'ABORTED' }))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function retryAsync(task, {
  maxRetries = 2,
  baseDelayMs = 700,
  jitterMs = 500,
  signal,
  onFailure,
  random = Math.random,
} = {}) {
  const retryCount = Number.isInteger(maxRetries) ? Math.max(0, maxRetries) : 2
  for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
    if (signal?.aborted) throw signal.reason || createLlmError('操作已取消', { code: 'ABORTED' })
    try {
      return await task(attempt)
    } catch (error) {
      const willRetry = attempt <= retryCount && !signal?.aborted
      await onFailure?.({ attempt, error, willRetry })
      if (!willRetry) throw error
      const backoffMs = Math.max(0, baseDelayMs) * (2 ** (attempt - 1))
      const randomDelayMs = Math.floor(Math.max(0, jitterMs) * Math.max(0, Math.min(1, random())))
      await waitForRetry(backoffMs + randomDelayMs, signal)
    }
  }
  throw createLlmError('重试流程异常结束', { code: 'RETRY_EXHAUSTED' })
}

function normalizeVisibleText(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z0-9_-]*\s*/gi, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}(?:[-*+]\s+|#{1,6}\s+)/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function limitVisibleText(text, maxChars = 100) {
  const normalized = normalizeVisibleText(text)
  const chars = Array.from(normalized)
  if (chars.length <= maxChars) return normalized
  if (maxChars <= 1) return chars.slice(0, maxChars).join('')

  const candidate = chars.slice(0, maxChars)
  const punctuation = new Set(['。', '！', '？', '!', '?', '；', ';'])
  let sentenceEnd = -1
  for (let index = candidate.length - 1; index >= Math.floor(maxChars * 0.55); index -= 1) {
    if (punctuation.has(candidate[index])) {
      sentenceEnd = index
      break
    }
  }
  if (sentenceEnd >= 0) return candidate.slice(0, sentenceEnd + 1).join('')
  return chars.slice(0, maxChars - 1).join('') + '…'
}

function buildPersonaMessages(template, prompt) {
  const personaName = template?.name || '这个角色'
  const personaDescription = template?.title || ''
  const personaSystem = template?.convSystem || ''
  return [
    {
      role: 'system',
      content: [
        personaSystem,
        `你现在必须以“${personaName}”的身份独立回答。`,
        personaDescription ? `角色描述：${personaDescription}` : '',
        '回答要求：用 1—3 个短句直接给出结论，只保留最核心观点；建议 30—60 个可见字符，最多不超过 80 个可见字符。不要寒暄、自我介绍、复述问题或铺垫，不要使用 Markdown；观点要鲜明并符合角色。',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: String(prompt ?? '').trim() },
  ]
}

export {
  createChatHandler, callLLM, retryAsync, normalizeVisibleText, limitVisibleText, buildPersonaMessages, DEFAULTS,
}
