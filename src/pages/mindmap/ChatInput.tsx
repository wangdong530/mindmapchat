import { forwardRef, useCallback, useRef, useState } from 'react'
import { Input, message } from 'antd'
import { getToken } from '../LoginPage'

export interface ChatInputProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onSummarize?: () => void
  loading: boolean
  selectedModel: string
  onModelChange: (v: string) => void
  disabled?: boolean
  images?: string[]
  onImagesChange?: (images: string[]) => void
  isMobile?: boolean
  onFocus?: () => void
  maxImages?: number
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput({
  value, onChange, onSend, onSummarize, loading, selectedModel, onModelChange, disabled,
  images, onImagesChange, maxImages = 5, isMobile = false, onFocus,
}, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // 合并外部 ref 与内部 ref，便于读取 textarea 实际高度
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
  }, [ref])

  // 输入框高度（仅允许从顶部拖拽调整，替代右下角原生 resize 手柄）
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined)
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null)
  const startTopResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const h = taRef.current?.offsetHeight ?? 60
    resizeStartRef.current = { y: e.clientY, h }
    const onMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return
      const delta = resizeStartRef.current.y - ev.clientY // 向上拖拽 → 高度增大
      setInputHeight(Math.max(44, Math.min(400, resizeStartRef.current.h + delta)))
    }
    const onUp = () => {
      resizeStartRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
  }, [])

  // 上传图片到服务器
  const uploadImage = useCallback(async (file: File) => {
    if (uploading) return
    if (!file.type.startsWith('image/')) { message.warning('仅支持图片文件'); return }
    if (file.size > 5 * 1024 * 1024) { message.warning('图片大小不能超过 5MB'); return }
    const currentImages = images ?? []
    if (currentImages.length >= maxImages) { message.warning(`最多上传 ${maxImages} 张图片`); return }

    setUploading(true)
    try {
      const reader = new FileReader()
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const token = getToken()
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: base64 }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.error || '上传失败')
      }
      const { url } = await r.json()
      onImagesChange?.([...currentImages, url])
    } catch (err) {
      message.error('图片上传失败: ' + (err instanceof Error ? err.message : '未知错误'))
    } finally {
      setUploading(false)
    }
  }, [images, maxImages, uploading, onImagesChange])

  // 粘贴图片
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) uploadImage(file)
        break
      }
    }
  }, [uploadImage])

  // 拖入图片
  const [dragOver, setDragOver] = useState(false)
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (files.length) uploadImage(files[0])
  }, [uploadImage])

  // 点击选择图片
  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadImage(file)
    e.target.value = ''
  }, [uploadImage])

  const currentImages = images ?? []

  // TODO: 图片功能暂时屏蔽，待底层大模型支持多模态后再开启
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _currentImages = images ?? []

  return (
    <>
      {/* 图片预览 - 暂时屏蔽 */}
      {/* {currentImages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {currentImages.map((url, idx) => (
            <div key={idx} style={{ position: 'relative', width: 56, height: 56, borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span
                onClick={() => onImagesChange?.(currentImages.filter((_, i) => i !== idx))}
                style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '0 6px 0 6px', fontSize: 10 }}>
                <DeleteOutlined />
              </span>
            </div>
          ))}
        </div>
      )} */}
      <div style={{ position: 'relative', borderRadius: 8, transition: 'border 0.15s' }}>
        {/* 顶部拖拽条：仅允许从上方调整高度（无右下角原生 resize 手柄） */}
        <div
          onMouseDown={startTopResize}
          title="拖拽调整高度"
          style={{ height: 8, cursor: 'row-resize', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <span style={{ width: 36, height: 3, borderRadius: 2, background: '#d1d5db' }} />
        </div>
        <Input.TextArea
          ref={setTaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          onFocus={onFocus}
          placeholder="发消息..."
          autoSize={false}
          rows={isMobile ? 1 : 2}
          bordered={false}
          disabled={loading || disabled}
          style={{
            fontSize: 16, resize: 'none', padding: 0, marginBottom: isMobile ? 2 : 6,
            ...(inputHeight !== undefined ? { height: inputHeight } : {}),
          }}
        />
      </div>
    </>
  )
})

export default ChatInput
