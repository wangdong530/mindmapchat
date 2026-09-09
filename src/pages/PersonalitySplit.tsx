import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, Button, Empty, Input, Spin, Tag, message } from 'antd'
import {
  ArrowLeftOutlined,
  BulbOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  MenuOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  ShareAltOutlined,
} from '@ant-design/icons'
import { getToken } from './LoginPage'
import { useResponsive } from '../hooks/useResponsive'
import { createPersonalityBubbleLayout, type PersonalityBubblePosition } from '../utils/personalityBubbleLayout'
import { pickRandomPersonaIds } from '../utils/personalitySelection'
import './PersonalitySplit.css'

interface RoleTemplate {
  id: string
  name: string
  title?: string | null
  background?: string | null
  convSystem?: string | null
  convTemperature?: number | null
  convGroup?: string | null
}

type ResultStatus = 'thinking' | 'success' | 'error'

interface PersonaResult {
  id: string
  name: string
  status: ResultStatus
  answer?: string
  error?: string
  order: number
}

interface PersonaMeta {
  type: string
  personality: string
}

interface SsePayload {
  id?: string
  name?: string
  answer?: string
  error?: string
  content?: string
}

const MAX_PERSONAS = 6
const DEFAULT_PERSONAS = 4

const personalityRules: Array<[string, RegExp]> = [
  ['理性', /理性|逻辑|严谨|专业|分析/],
  ['感性', /感性|温柔|共情|治愈|浪漫/],
  ['幽默', /幽默|搞笑|段子|乐观|有趣/],
  ['犀利', /毒舌|犀利|直接|批判|挑剔/],
  ['务实', /务实|实在|执行|现实|效率/],
]

function classifyPersona(template: RoleTemplate): PersonaMeta {
  const source = `${template.name} ${template.title || ''} ${template.convGroup || ''}`
  const personality = personalityRules.find(([, pattern]) => pattern.test(source))?.[0] || '鲜明'
  const type = template.convGroup?.trim() || (
    /产品|经理|运营|销售|顾问/.test(source) ? '职场' :
    /程序|技术|工程|开发|科学/.test(source) ? '技术' :
    /医生|律师|教师|老师|心理/.test(source) ? '专业' :
    /家长|学生|朋友|恋人/.test(source) ? '关系' : '人物'
  )
  return { type, personality }
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function consumeSse(
  response: Response,
  onEvent: (event: string, payload: SsePayload) => void,
) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '请求失败，请稍后重试')
  }
  if (!response.body) throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      let payload: SsePayload
      try {
        payload = JSON.parse(dataLines.join('\n'))
      } catch {
        // 忽略单个损坏事件，后续人格结果仍可继续显示。
        continue
      }
      onEvent(event, payload)
    }
    if (done) break
  }
}

export default function PersonalitySplitPage() {
  const navigate = useNavigate()
  const { isMobile } = useResponsive()
  const [templates, setTemplates] = useState<RoleTemplate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'complete'>('idle')
  const [results, setResults] = useState<Record<string, PersonaResult>>({})
  const [summary, setSummary] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [bubbleLayout, setBubbleLayout] = useState<Record<string, PersonalityBubblePosition>>({})
  const controllerRef = useRef<AbortController | null>(null)
  const resultOrderRef = useRef(0)
  const layoutRoundRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const brainRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/role-templates', { headers: authHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '人格加载失败')
        return response.json()
      })
      .then((data: RoleTemplate[]) => {
        const available = Array.isArray(data) ? data : []
        setTemplates(available)
        setSelectedIds(available.slice(0, DEFAULT_PERSONAS).map(item => item.id))
      })
      .catch(error => {
        if (error.name !== 'AbortError') message.error(error.message || '人格加载失败')
      })
      .finally(() => setLoadingTemplates(false))
    return () => controller.abort()
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const templateWithMeta = useMemo(
    () => templates.map(template => ({ template, meta: classifyPersona(template) })),
    [templates],
  )
  const filteredTemplates = useMemo(() => templateWithMeta.filter(({ template }) => {
    const keyword = search.trim().toLowerCase()
    return !keyword || `${template.name} ${template.title || ''}`.toLowerCase().includes(keyword)
  }), [templateWithMeta, search])

  const orderedResults = useMemo(
    () => Object.values(results).sort((a, b) => a.order - b.order),
    [results],
  )
  const successfulResults = orderedResults.filter(result => result.status === 'success')
  const completedCount = orderedResults.filter(result => result.status !== 'thinking').length

  const togglePersona = (id: string) => {
    if (phase !== 'idle') return
    setSelectedIds(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      if (current.length >= MAX_PERSONAS) {
        message.warning(`最多选择 ${MAX_PERSONAS} 个人格`)
        return current
      }
      return [...current, id]
    })
  }

  const clearExperience = (nextSelectedIds: string[]) => {
    controllerRef.current?.abort()
    controllerRef.current = null
    resultOrderRef.current = 0
    layoutRoundRef.current = 0
    setSearch('')
    setPrompt('')
    setResults({})
    setSummary('')
    setSummaryError('')
    setBubbleLayout({})
    setSelectedIds(nextSelectedIds)
    setPhase('idle')
    setSidebarOpen(false)
  }

  const randomizePersonas = () => {
    const randomizedIds = pickRandomPersonaIds(templates.map(template => template.id), MAX_PERSONAS)
    if (randomizedIds.length < 2) {
      message.warning('至少需要 2 个可用人格')
      return
    }
    clearExperience(randomizedIds)
    message.success(`已随机选择 ${randomizedIds.length} 个人格`)
  }

  const applyEvent = (event: string, data: SsePayload) => {
    if (event === 'persona-start' && data.id && data.name) {
      setResults(current => ({
        ...current,
        [data.id as string]: {
          id: data.id as string,
          name: data.name as string,
          status: 'thinking',
          order: current[data.id as string]?.order ?? resultOrderRef.current++,
        },
      }))
    }
    if (event === 'persona-result' && data.id && data.name && data.answer) {
      setResults(current => ({
        ...current,
        [data.id as string]: {
          id: data.id as string,
          name: data.name as string,
          status: 'success',
          answer: data.answer,
          order: current[data.id as string]?.order ?? resultOrderRef.current++,
        },
      }))
    }
    if (event === 'persona-error' && data.id && data.name) {
      setResults(current => ({
        ...current,
        [data.id as string]: {
          id: data.id as string,
          name: data.name as string,
          status: 'error',
          error: data.error || '这个人格暂时无法生成观点，请先参考其他回答。',
          order: current[data.id as string]?.order ?? resultOrderRef.current++,
        },
      }))
    }
    if (event === 'summary') setSummary(data.content || '')
    if (event === 'summary-error') setSummaryError(data.error || '综合结论生成失败')
    if (event === 'fatal-error') throw new Error(data.error || '体验启动失败')
  }

  const requestPersona = async (id: string, controller: AbortController) => {
    const template = templates.find(item => item.id === id)
    if (!template) throw new Error('人格不存在或已停用')
    let successfulResult: PersonaResult | null = null
    const response = await fetch('/api/personality-split', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.trim(), templateIds: [id] }),
      signal: controller.signal,
    })
    await consumeSse(response, (event, data) => {
      applyEvent(event, data)
      if (event === 'persona-result' && data.id && data.name && data.answer) {
        successfulResult = {
          id: data.id,
          name: data.name,
          status: 'success',
          answer: data.answer,
          order: 0,
        }
      }
    })
    return successfulResult
  }

  const requestSummary = async (question: string, viewpoints: PersonaResult[], controller: AbortController) => {
    const response = await fetch('/api/personality-split/summary', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: question,
        viewpoints: viewpoints.map(result => ({ id: result.id, answer: result.answer })),
      }),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '综合结论生成失败')
    return typeof data.content === 'string' ? data.content : ''
  }

  const startExperience = async () => {
    const question = prompt.trim()
    if (!question) return message.warning('先在大脑里放一个问题')
    if (Array.from(question).length > 500) return message.warning('问题不能超过 500 个字符')
    if (selectedIds.length < 2) return message.warning('至少选择 2 个人格')

    const controller = new AbortController()
    const requestedIds = [...selectedIds]
    controllerRef.current = controller
    resultOrderRef.current = 0
    const stageWidth = stageRef.current?.clientWidth || 1100
    const stageHeight = stageRef.current?.clientHeight || 650
    const brainWidth = brainRef.current?.clientWidth || 620
    const brainHeight = brainRef.current?.clientHeight || 360
    const layoutSeed = `${Date.now()}:${layoutRoundRef.current++}`
    setBubbleLayout(createPersonalityBubbleLayout(requestedIds, {
      stageWidth,
      stageHeight,
      brainWidth,
      brainHeight,
      brainBottom: 0,
      seed: layoutSeed,
    }))
    setResults({})
    setSummary('')
    setSummaryError('')
    setPhase('thinking')
    setSidebarOpen(false)
    try {
      const settled = await Promise.allSettled(requestedIds.map(id => requestPersona(id, controller)))
      if (controller.signal.aborted) return
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') return
        const template = templates.find(item => item.id === requestedIds[index])
        if (!template) return
        setResults(current => ({
          ...current,
          [template.id]: {
            id: template.id,
            name: template.name,
            status: 'error',
            error: (outcome.reason as Error)?.message || '这个人格暂时无法生成观点，请先参考其他回答。',
            order: current[template.id]?.order ?? resultOrderRef.current++,
          },
        }))
      })
      const successful = settled.flatMap(outcome => (
        outcome.status === 'fulfilled' && outcome.value ? [outcome.value] : []
      ))
      if (successful.length >= 2) {
        try {
          setSummary(await requestSummary(question, successful, controller))
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            setSummaryError((error as Error).message || '观点已返回，综合结论暂时生成失败')
          }
        }
      } else {
        setSummaryError('有效人格观点不足，暂时无法生成综合结论')
      }
      setPhase('complete')
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        message.error((error as Error).message || '人格分裂体验失败')
        setPhase('complete')
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  const resetExperience = () => clearExperience(templates.slice(0, DEFAULT_PERSONAS).map(item => item.id))

  const resultText = () => [
    `问题：${prompt.trim()}`,
    ...successfulResults.map(result => `${result.name}：${result.answer}`),
    summary ? `综合结论：${summary}` : '',
  ].filter(Boolean).join('\n\n')

  const handleCopy = async () => {
    try {
      await copyText(resultText())
      message.success('结果已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const handleShare = async () => {
    const text = resultText()
    if (navigator.share) {
      try {
        await navigator.share({ title: 'MindmapChat 人格分裂', text })
        return
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      }
    }
    await handleCopy()
  }

  const sidebar = (
    <aside className={`ps-sidebar ${isMobile && sidebarOpen ? 'ps-sidebar-open' : ''}`}>
      <div className="ps-sidebar-top">
        <div className="ps-brand" onClick={() => navigate('/')}>
          <Avatar size={34} icon={<RobotOutlined />} className="ps-brand-avatar" />
          <div><strong>MindmapChat</strong><span>多重视角实验室</span></div>
        </div>
        {isMobile && (
          <Button
            type="text"
            className="ps-sidebar-close"
            icon={<CloseOutlined />}
            aria-label="关闭人格选择"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} block>返回对话</Button>
      <Button type="primary" icon={<BulbOutlined />} block className="ps-active-menu">人格分裂</Button>
      <div className="ps-experience-controls">
        <div className="ps-experience-note"><Tag color="purple">一次性体验</Tag><span>离开页面即清空</span></div>
        <Button
          className="ps-random-personas"
          onClick={randomizePersonas}
          disabled={loadingTemplates || templates.length < 2}
          block
        >
          随机选择 6 个
        </Button>
        {phase !== 'idle' && <Button className="ps-reset-experience" icon={<ReloadOutlined />} onClick={resetExperience} block>重新玩一次</Button>}
      </div>

      <div className="ps-sidebar-heading">
        <div><strong>选择人格</strong><span>{selectedIds.length}/{MAX_PERSONAS}</span></div>
        <small>选择 2—6 个角色，一次性听取不同观点</small>
      </div>
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索角色"
        value={search}
        onChange={event => setSearch(event.target.value)}
        allowClear
        disabled={phase !== 'idle'}
      />
      <div className="ps-persona-list">
        {loadingTemplates ? <Spin className="ps-sidebar-spin" /> : filteredTemplates.length ? filteredTemplates.map(({ template, meta }) => {
          const selected = selectedIds.includes(template.id)
          return (
            <button
              type="button"
              key={template.id}
              className={`ps-persona-card ${selected ? 'selected' : ''}`}
              onClick={() => togglePersona(template.id)}
              disabled={phase !== 'idle'}
            >
              <span className="ps-persona-avatar">{template.name.slice(0, 1)}</span>
              <span className="ps-persona-copy"><strong>{template.name}</strong><small>{template.title || `${meta.personality} · ${meta.type}`}</small></span>
              <span className="ps-check">{selected && <CheckOutlined />}</span>
            </button>
          )
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配人格" />}
      </div>
    </aside>
  )

  return (
    <div className="ps-page">
      {sidebar}
      {isMobile && sidebarOpen && <div className="ps-sidebar-mask" onClick={() => setSidebarOpen(false)} />}
      {isMobile && !sidebarOpen && (
        <Button type="text" className="ps-mobile-persona-trigger" icon={<MenuOutlined />} onClick={() => setSidebarOpen(true)}>
          人格 {selectedIds.length}/{MAX_PERSONAS}
        </Button>
      )}
      <main className="ps-main">
        <section className="ps-hero">
          <div className="ps-title"><span>PERSONALITY SPLIT</span><h1>脑内议会</h1><p>把一个问题交给不同人格，看观点从脑海中蹦出来。</p></div>
          <div ref={stageRef} className={`ps-stage ${phase === 'thinking' ? 'is-thinking' : ''} ${orderedResults.length ? 'has-results' : ''}`}>
            {orderedResults.length > 0 && <div className="ps-mobile-result-heading">左右滑动，听听每个人格怎么说</div>}
            <div className="ps-results" aria-live="polite">
              {orderedResults.map((result, index) => {
                const position = bubbleLayout[result.id]
                const bubbleStyle = {
                  '--bubble-left': `${position?.left ?? 0}px`,
                  '--bubble-top': `${position?.top ?? 0}px`,
                  '--bubble-size': `${position?.diameter ?? 160}px`,
                  '--bubble-start-x': `${position?.startX ?? 0}px`,
                  '--bubble-start-y': `${position?.startY ?? 260}px`,
                  '--bubble-delay': `${index * 80}ms`,
                } as CSSProperties
                return (
                  <article key={result.id} className={`ps-result-bubble ${result.status}`} style={bubbleStyle}>
                    <div className="ps-bubble-glow" />
                    <strong>{result.name}</strong>
                    {result.status === 'thinking' ? <><Spin size="small" /><span>正在形成观点…</span></> : null}
                    {result.status === 'success' ? <p>{result.answer}</p> : null}
                    {result.status === 'error' ? <p>{result.error}</p> : null}
                  </article>
                )
              })}
            </div>

            <div className="ps-brain-wrap">
              <div className="ps-brain-pulse" />
              <div ref={brainRef} className="ps-brain">
                <i className="ps-brain-line line-one" /><i className="ps-brain-line line-two" /><i className="ps-brain-line line-three" />
                <div className="ps-brain-face" aria-hidden="true">
                  <span className="ps-eye ps-eye-left"><i /></span>
                  <span className="ps-eye ps-eye-right"><i /></span>
                </div>
                <span className="ps-cheek ps-cheek-left" aria-hidden="true" />
                <span className="ps-cheek ps-cheek-right" aria-hidden="true" />
                <div className={`ps-input-shell ${phase === 'complete' ? 'has-summary' : ''}`}>
                  {phase === 'complete' ? (
                    <div className="ps-mouth-summary" role="status" aria-live="polite">
                      <span className="ps-mouth-summary-title">脑内总结</span>
                      <div className="ps-mouth-summary-row ps-mouth-summary-question">
                        <strong>问题</strong>
                        <p>{prompt.trim()}</p>
                      </div>
                      <div className="ps-mouth-summary-row ps-mouth-summary-result">
                        <strong>结果</strong>
                        <p>{summary || summaryError || (successfulResults.length ? '人格观点已全部呈现。' : '本轮人格暂时都走神了，请重新玩一次。')}</p>
                      </div>
                    </div>
                  ) : (
                    <Input.TextArea
                      value={prompt}
                      onChange={event => setPrompt(event.target.value)}
                      onPressEnter={event => {
                        if (!event.shiftKey) { event.preventDefault(); void startExperience() }
                      }}
                      placeholder="问脑内的他们一个问题，例如：在吗？"
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      maxLength={500}
                      disabled={phase !== 'idle'}
                      showCount={phase === 'idle'}
                    />
                  )}
                </div>
                <div className="ps-mouth-actions">
                  {phase === 'complete' ? (
                    <>
                      <Button size="small" shape="circle" title="复制全部" aria-label="复制全部" icon={<CopyOutlined />} onClick={handleCopy} disabled={!successfulResults.length} />
                      <Button size="small" shape="circle" title="分享结果" aria-label="分享结果" icon={<ShareAltOutlined />} onClick={handleShare} disabled={!successfulResults.length} />
                    </>
                  ) : (
                    <Button
                      type="primary"
                      shape="circle"
                      size="large"
                      title="发送问题"
                      aria-label="发送问题"
                      icon={phase === 'thinking' ? <Spin size="small" /> : <SendOutlined />}
                      onClick={startExperience}
                      disabled={phase !== 'idle' || !prompt.trim() || selectedIds.length < 2}
                    />
                  )}
                </div>
                <div className="ps-brain-status">
                  {phase === 'idle' ? `已选择 ${selectedIds.length} 个人格` : phase === 'thinking' ? `${completedCount}/${selectedIds.length} 个观点已出现` : '本轮脑内议会结束'}
                </div>
              </div>
            </div>
          </div>

        </section>
      </main>
    </div>
  )
}
