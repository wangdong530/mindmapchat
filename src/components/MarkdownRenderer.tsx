import { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { Button } from 'antd'
import 'highlight.js/styles/github.css'

interface MarkdownRendererProps {
  content: string
  /** 消息是否已输出完成。流式输出中为 false（此时 html 围栏块按代码块展示），完成后为 true（渲染真实 HTML 效果） */
  done?: boolean
}

/** 判断内容是否包含 HTML 标签 */
function containsHtml(raw: string): boolean {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(raw)
}

/** 判断内容是否含有 ```html 围栏代码块 */
function hasHtmlFence(raw: string): boolean {
  return /```(?:html|HTML)\s*\n[\s\S]*?```/.test(raw)
}

/** 将内容按 ```html 围栏块切分为 md / html 片段 */
function splitHtmlFences(raw: string): Array<{ type: 'md' | 'html'; text: string }> {
  const parts: Array<{ type: 'md' | 'html'; text: string }> = []
  const fence = /```(?:html|HTML)\s*\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(raw)) !== null) {
    if (m.index > last) parts.push({ type: 'md', text: raw.slice(last, m.index) })
    parts.push({ type: 'html', text: m[1].trim() })
    last = m.index + m[0].length
  }
  if (last < raw.length) parts.push({ type: 'md', text: raw.slice(last) })
  return parts
}

/** 预处理 Markdown 内容：归一化换行、去除多余空行 */
function preprocessMarkdown(raw: string): string {
  return raw
    .replace(/[ \t]+$/gm, '')      // 去掉行尾空格/制表符
    .replace(/\n{3,}/g, '\n\n')    // 3 个以上空行 → 1 个空行
    .replace(/\n{2}/g, '\n')       // 双空行 → 单换行（干掉段落分隔）
    .replace(/^\n+|\n+$/g, '')     // 去掉首尾空行
}

// Markdown 渲染配置
const mdComponents = {
  // 跳过空段落
  p({ children, ...props }: any) {
    if (!children) return null
    const text = typeof children === 'string' ? children : String(children)
    if (text.trim() === '' || text === '\n' || text === '\\n') return null
    return <p {...props}>{children}</p>
  },
  // 代码块渲染
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !className
    if (isInline) {
      return <code className="md-inline-code" {...props}>{children}</code>
    }
    return <code className={className} {...props}>{children}</code>
  },
  // 链接在新窗口打开
  a({ children, href, ...props }: any) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  },
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content, done = true }: MarkdownRendererProps) {
  const processed = useMemo(() => preprocessMarkdown(content), [content])
  const htmlFenced = useMemo(() => hasHtmlFence(processed), [processed])
  const htmlDetected = useMemo(() => containsHtml(processed), [processed])
  // 含 HTML 时，提供「渲染预览 / 源码」切换（默认直接渲染真实 HTML 效果）
  const [showSource, setShowSource] = useState(false)

  // 源码视图：展示原始 HTML / Markdown 文本
  const sourceView = (
    <div className="markdown-content">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" onClick={() => setShowSource(false)}>渲染预览</Button>
      </div>
      <pre style={{
        background: '#f6f8fa', border: '1px solid #e5e7eb', borderRadius: 8,
        padding: 12, overflow: 'auto', fontSize: 13, lineHeight: 1.5, margin: 0,
      }}>
        <code>{processed}</code>
      </pre>
    </div>
  )

  // 已完成 + 含 ```html 围栏块：拆块渲染，HTML 块呈现真实浏览器效果
  if (done && htmlFenced) {
    if (showSource) return sourceView
    const parts = splitHtmlFences(processed)
    return (
      <div className="markdown-content" style={{ position: 'relative' }}>
        <Button
          size="small"
          style={{ position: 'absolute', top: 0, right: 0, zIndex: 2, background: 'rgba(255,255,255,0.85)' }}
          onClick={() => setShowSource(true)}
        >
          源码
        </Button>
        {parts.map((p, i) =>
          p.type === 'html' ? (
            <div
              key={i}
              className="html-render-block"
              style={{ margin: '8px 0' }}
              dangerouslySetInnerHTML={{ __html: p.text }}
            />
          ) : (
            <ReactMarkdown
              key={i}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeHighlight]}
              components={mdComponents}
            >
              {p.text}
            </ReactMarkdown>
          )
        )}
      </div>
    )
  }

  if (htmlDetected) {
    if (showSource) return sourceView
    // 含内联 HTML（非围栏）：直接渲染真实效果，右上角提供「源码」切换（无 HTML 标记）
    return (
      <div className="markdown-content" style={{ position: 'relative' }}>
        <Button
          size="small"
          style={{ position: 'absolute', top: 0, right: 0, zIndex: 2, background: 'rgba(255,255,255,0.85)' }}
          onClick={() => setShowSource(true)}
        >
          源码
        </Button>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={mdComponents}
        >
          {processed}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={mdComponents}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownRenderer
