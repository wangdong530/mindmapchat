// 追问解析与兜底生成工具
// 解析 AI 回复中的【追问】块（兼容多种列表格式），并在缺失时兜底补生成。

export interface ParsedSuggestion {
  displayContent: string
  suggestions?: string[]
}

export interface SuggestionConfig {
  provider?: string
  apiKey?: string
  region?: string
  workspaceId?: string
  baseUrl?: string
  model?: string
  temperature?: number
  reasoningEffort?: string
}

/**
 * 从 AI 完整回复中解析【追问】块。
 * - 标记支持前后空白/星号/冒号，如 【追问】 / **【追问】** / 【追问】：
 * - 列表项支持 1. / 1、 / 1) / - / * / [1] 等多种前缀
 * - 兼容【追问】与首条追问同行（无换行）的情况
 */
export function parseSuggestions(aiContent: string): ParsedSuggestion {
  const markerRegex = /【\s*追问\s*】/
  const mm = markerRegex.exec(aiContent)
  if (!mm) return { displayContent: aiContent }

  const displayContent = aiContent.slice(0, mm.index).trimEnd()
  let block = aiContent
    .slice(mm.index + mm[0].length)
    .replace(/^[\s：:、，,-]*/, '')

  // 优先按换行拆分；若整段在一行，则按列表项边界拆分
  const raw = block.includes('\n')
    ? block.split('\n')
    : block.split(/(?=\s*(?:\d+[.、)]|[-*]|\[\d+\])\s*)/)

  const suggestions = raw
    .map((l) => {
      const m = l.match(/^\s*(?:\d+[.、)]\s*|[-*]\s*|\[\d+\]\s*)\s*(.*?)\s*$/)
      // 仅接受匹配列表前缀的行，避免把正文/裸文本误当作追问
      return m ? m[1].trim() : ''
    })
    .filter((t) => t.length > 0)
    .slice(0, 5)

  return { displayContent, suggestions: suggestions.length ? suggestions : undefined }
}

const FOLLOWUP_SYSTEM_PROMPT =
  '基于下面的对话内容，根据AI回复的内容，生成针对该内容 1-5 条后续追问。注意：追问要站在用户的角度。' +
  '严格按以下格式输出（标记与追问之间换行，每行一条）：\n' +
  '【追问】\n1. 追问问题一\n2. 追问问题二\n3. 追问问题三\n4. 追问问题四\n5. 追问问题五'

/**
 * 兜底：当主回复未解析到追问时，用一次轻量（非流式、关闭思考/搜索）请求补生成。
 * @param contextMessages 完整对话上下文（user/assistant 交替），不含 system
 */
export async function fetchFollowUpSuggestions(
  contextMessages: { role: string; content: string }[],
  config: SuggestionConfig,
  headers: Record<string, string>,
): Promise<string[] | undefined> {
  const payloadMessages = [
    { role: 'system', content: FOLLOWUP_SYSTEM_PROMPT },
    ...contextMessages.filter((m) => m.role !== 'system'),
  ]
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: payloadMessages,
        stream: false,
        provider: config.provider,
        apiKey: config.apiKey,
        region: config.region,
        workspaceId: config.workspaceId,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: config.temperature,
        enableSearch: false,
        enableThinking: false,
        reasoningEffort: config.reasoningEffort,
      }),
    })
    if (!response.ok) return undefined
    const data = await response.json()
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.delta?.content ||
      data?.output?.text ||
      data?.content ||
      ''
    return parseSuggestions(text).suggestions
  } catch {
    return undefined
  }
}
