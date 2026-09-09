import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { buildPersonaMessages, limitVisibleText, normalizeVisibleText, retryAsync } from '../chat-proxy.js'

const serverSource = await fs.readFile(new URL('../server-prod.js', import.meta.url), 'utf8')

test('人格回答清除思考、Markdown 和多余空白', () => {
  const result = normalizeVisibleText('<think>内部推理</think>\n## 回答\n**我在**，  有什么事？')
  assert.equal(result, '回答 我在， 有什么事？')
})

test('人格回答始终不超过 80 个 Unicode 字符', () => {
  const result = limitVisibleText('这是一个很长的回答'.repeat(30), 80)
  assert.ok(Array.from(result).length <= 80)
  assert.ok(result.endsWith('…'))
})

test('截断时优先保留完整句子', () => {
  const firstSentence = '甲'.repeat(48) + '。'
  const result = limitVisibleText(firstSentence + '乙'.repeat(80), 80)
  assert.equal(result, firstSentence)
})

test('综合结论可使用同一限制器控制在 200 字内', () => {
  const result = limitVisibleText('综合观点'.repeat(80), 200)
  assert.ok(Array.from(result).length <= 200)
})

test('人格提示包含角色身份、模板设定和字数规则', () => {
  const messages = buildPersonaMessages({ name: '务实老王', title: '直接的产品经理', convSystem: '优先考虑落地成本。' }, '在吗？')
  assert.equal(messages.length, 2)
  assert.match(messages[0].content, /务实老王/)
  assert.match(messages[0].content, /优先考虑落地成本/)
  assert.match(messages[0].content, /1—3 个短句/)
  assert.match(messages[0].content, /30—60/)
  assert.match(messages[0].content, /最多不超过 80/)
  assert.match(messages[0].content, /不要寒暄、自我介绍、复述问题或铺垫/)
  assert.equal(messages[1].content, '在吗？')
})

test('生产服务的单人格接口仅接受一个角色并单独提供总结接口', () => {
  assert.match(serverSource, /const PERSONALITY_SPLIT_TIMEOUT_MS = 45_000/)
  assert.match(serverSource, /if \(templateIds\.length !== 1\)/)
  assert.match(serverSource, /app\.post\('\/api\/personality-split\/summary'/)
  assert.match(serverSource, /总结需要 2—6 个不重复的人格观点/)
  assert.match(serverSource, /opLog\(req, 'personality_split_summary'/)
  assert.doesNotMatch(serverSource, /createRateLimitedQueue|schedulePersonalityLlm/)
})

test('人格模型失败后内部重试两次并在成功时返回结果', async () => {
  const failures = []
  let attempts = 0
  const result = await retryAsync(async () => {
    attempts += 1
    if (attempts < 3) throw Object.assign(new Error('临时失败'), { status: 429 })
    return '成功观点'
  }, {
    maxRetries: 2,
    baseDelayMs: 0,
    jitterMs: 0,
    onFailure: failure => failures.push(failure),
  })

  assert.equal(result, '成功观点')
  assert.equal(attempts, 3)
  assert.deepEqual(failures.map(item => [item.attempt, item.willRetry]), [[1, true], [2, true]])
})

test('人格模型连续三次失败后停止并保留每次失败记录', async () => {
  const failures = []
  let attempts = 0
  await assert.rejects(retryAsync(async () => {
    attempts += 1
    throw new Error('持续失败')
  }, {
    maxRetries: 2,
    baseDelayMs: 0,
    jitterMs: 0,
    onFailure: failure => failures.push(failure),
  }), /持续失败/)

  assert.equal(attempts, 3)
  assert.deepEqual(failures.map(item => [item.attempt, item.willRetry]), [[1, true], [2, true], [3, false]])
})

test('客户端取消后立即停止人格内部重试', async () => {
  const controller = new AbortController()
  let attempts = 0
  await assert.rejects(retryAsync(async () => {
    attempts += 1
    controller.abort()
    throw new Error('本次请求已取消')
  }, {
    maxRetries: 2,
    baseDelayMs: 0,
    jitterMs: 0,
    signal: controller.signal,
  }), /本次请求已取消/)
  assert.equal(attempts, 1)
})

test('生产服务记录每次异常并在重试耗尽后返回分类兜底', () => {
  assert.match(serverSource, /const PERSONALITY_MAX_RETRIES = 2/)
  assert.match(serverSource, /const PERSONALITY_ATTEMPT_TIMEOUT_MS = 12_000/)
  assert.match(serverSource, /personality_split_attempt_failed/)
  assert.match(serverSource, /attempt,[\s\S]*maxAttempts:[\s\S]*willRetry,[\s\S]*errorType:[\s\S]*upstreamStatus:/)
  assert.match(serverSource, /status === 429[\s\S]*当前请求较多/)
  assert.match(serverSource, /PERSONALITY_RETRY_BASE_DELAY_MS/)
  assert.match(serverSource, /PERSONALITY_RETRY_JITTER_MS/)
  assert.match(serverSource, /timeoutError\.code = 'UPSTREAM_TIMEOUT'/)
  assert.doesNotMatch(serverSource, /这个人格暂时走神了|personality_split_retry/)
})
