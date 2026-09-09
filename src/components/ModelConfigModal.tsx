import { useState, useEffect, useCallback } from 'react'
import { Modal, Input, Select, Button, Switch, Divider, message } from 'antd'
import { SaveOutlined, SettingOutlined } from '@ant-design/icons'
import { logModelConfig } from '../utils/logger'

export type Provider = 'aliyun' | 'tencent'

const PROVIDER_OPTIONS = [
  { label: '阿里云百炼', value: 'aliyun' },
  { label: '腾讯混元 (TokenHub)', value: 'tencent' },
]

const TENCENT_REGIONS = [
  { label: '广州 gz', value: 'gz' },
  { label: '新加坡 sg', value: 'sg' },
]

const TENCENT_DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1/chat/completions'
// 密钥一律不在源码中提供默认值，请用户自行填写（配置会持久化到服务端）。
const TENCENT_DEFAULT_API_KEY = ''
const TENCENT_DEFAULT_MODEL = 'hy3'
const ALIYUN_DEFAULT_API_KEY = ''
const ALIYUN_DEFAULT_WORKSPACE_ID = ''

// 按服务商分组的模型列表（基于 TokenHub 平台 / 阿里云百炼支持的模型）
const PROVIDER_MODELS: Record<Provider, { label: string; options: { label: string; value: string }[] }[]> = {
  tencent: [
    {
      label: '混元 (Hunyuan)',
      options: [
        { label: 'Hy3 [腾讯]', value: 'hy3' },
        { label: 'Hy3 preview [腾讯]', value: 'hy3-preview' },
        { label: 'Hy-MT2-Pro [腾讯]', value: 'hy-mt2-pro' },
        { label: 'Hy-MT2-Plus [腾讯]', value: 'hy-mt2-plus' },
        { label: 'Hy-MT2-Lite [腾讯]', value: 'hy-mt2-lite' },
        { label: 'Hy-Role-Latest [腾讯]', value: 'hunyuan-role-latest' },
        { label: 'Hy-Role [腾讯]', value: 'hy-role' },
      ],
    },
    {
      label: 'DeepSeek',
      options: [
        { label: 'DeepSeek-V4-Pro-202606 [腾讯]', value: 'deepseek-v4-pro-202606' },
        { label: 'DeepSeek-V4-Pro [腾讯]', value: 'deepseek-v4-pro' },
        { label: 'DeepSeek-V4-Flash-202605 [腾讯]', value: 'deepseek-v4-flash-202605' },
        { label: 'DeepSeek-V4-Flash [腾讯]', value: 'deepseek-v4-flash' },
        { label: 'DeepSeek-V3.2 [腾讯]', value: 'deepseek-v3.2' },
      ],
    },
    {
      label: 'GLM (智谱)',
      options: [
        { label: 'GLM-5.2 [腾讯]', value: 'glm-5.2' },
        { label: 'GLM-5.1 [腾讯]', value: 'glm-5.1' },
        { label: 'GLM-5V-Turbo (视觉) [腾讯]', value: 'glm-5v-turbo' },
        { label: 'GLM-5-Turbo [腾讯]', value: 'glm-5-turbo' },
        { label: 'GLM-5 [腾讯]', value: 'glm-5' },
      ],
    },
    {
      label: 'Kimi',
      options: [
        { label: 'Kimi K3 [腾讯]', value: 'kimi-k3' },
        { label: 'Kimi K2.7 Code HighSpeed [腾讯]', value: 'kimi-k2.7-code-highspeed' },
        { label: 'Kimi K2.7 Code [腾讯]', value: 'kimi-k2.7-code' },
        { label: 'Kimi K2.6 [腾讯]', value: 'kimi-k2.6' },
        { label: 'Kimi K2.5 [腾讯]', value: 'kimi-k2.5' },
      ],
    },
    {
      label: 'MiniMax',
      options: [
        { label: 'MiniMax-M3 [腾讯]', value: 'minimax-m3' },
        { label: 'MiniMax-M2.7 [腾讯]', value: 'minimax-m2.7' },
        { label: 'MiniMax-M2.5 [腾讯]', value: 'minimax-m2.5' },
      ],
    },
    {
      label: 'Qwen (通义千问)',
      options: [
        { label: 'Qwen3.5-Flash [腾讯]', value: 'qwen3.5-flash' },
        { label: 'Qwen3.5-Plus [腾讯]', value: 'qwen3.5-plus' },
        { label: 'Qwen-VL-Plus (视觉) [腾讯]', value: 'qwen-vl-plus' },
        { label: 'Qwen-VL-Max (视觉) [腾讯]', value: 'qwen-vl-max' },
      ],
    },
  ],
  aliyun: [
    {
      label: 'Qwen (通义千问)',
      options: [
        { label: 'Qwen3.7-Max [阿里]', value: 'qwen3.7-max' },
        { label: 'Qwen3.7-Max-2026-05-20 [阿里]', value: 'qwen3.7-max-2026-05-20' },
        { label: 'Qwen3.7-Max-Preview [阿里]', value: 'qwen3.7-max-preview' },
        { label: 'Qwen3.7-Plus [阿里]', value: 'qwen3.7-plus' },
        { label: 'Qwen3.7-Plus-2026-05-26 [阿里]', value: 'qwen3.7-plus-2026-05-26' },
        { label: 'Qwen3.6-27B [阿里]', value: 'qwen3.6-27b' },
        { label: 'Qwen3.5-Plus-2026-04-20 [阿里]', value: 'qwen3.5-plus-2026-04-20' },
        { label: 'Qwen3.5-OCR [阿里]', value: 'qwen3.5-ocr' },
        { label: 'Qwen3.7-Max-2026-05-17 (旧版) [阿里]', value: 'qwen3.7-max-2026-05-17' },
        { label: 'Qwen-VL-Plus (视觉) [阿里]', value: 'qwen-vl-plus' },
        { label: 'Qwen-VL-Max (视觉) [阿里]', value: 'qwen-vl-max' },
      ],
    },
    {
      label: 'DeepSeek',
      options: [
        { label: 'DeepSeek-V4-Pro [阿里]', value: 'deepseek-v4-pro' },
      ],
    },
    {
      label: 'GLM (智谱)',
      options: [
        { label: 'GLM-5.2 [阿里]', value: 'glm-5.2' },
      ],
    },
    {
      label: 'Kimi',
      options: [
        { label: 'Kimi K2.7 Code [阿里]', value: 'kimi-k2.7-code' },
        { label: 'Kimi K2.6 [阿里]', value: 'kimi-k2.6' },
      ],
    },
  ],
}

export interface ModelConfig {
  provider: Provider
  apiKey: string
  region: string
  workspaceId: string
  baseUrl: string
  model: string
  system: string
  temperature: number
  stream: boolean
  enableSearch: boolean
  enableThinking: boolean
  reasoningEffort: 'high' | 'max' | 'low'
}

const DEFAULT_CONFIG: ModelConfig = {
  provider: 'aliyun',
  apiKey: ALIYUN_DEFAULT_API_KEY,
  region: 'bj',
  workspaceId: ALIYUN_DEFAULT_WORKSPACE_ID,
  baseUrl: '',
  model: 'qwen3.7-max',
  system: '',
  temperature: 0.3,
  stream: true,
  enableSearch: false,
  enableThinking: false,
  reasoningEffort: 'high',
}

const STORAGE_KEY = 'thinkchat-model-config'

export function loadConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

interface ModelConfigModalProps {
  visible: boolean
  onClose: () => void
  onSave: (cfg: ModelConfig) => void
  initialConfig?: ModelConfig
  // 是否为管理员。非管理员时弹窗只读，不可保存
  isAdmin?: boolean
}

export function ModelConfigModal({ visible, onClose, onSave, initialConfig, isAdmin = false }: ModelConfigModalProps) {
  const [cfg, setCfg] = useState<ModelConfig>(initialConfig ?? loadConfig())

  useEffect(() => {
    if (visible) setCfg(initialConfig ?? loadConfig())
  }, [visible, initialConfig])

  const update = useCallback(<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }))
  }, [])

  // 切换服务商时，自动套用该服务商的合理默认值（apiKey、baseUrl、region、model、workspaceId）
  const handleProviderChange = useCallback((p: Provider) => {
    logModelConfig('switch_provider', { from: cfg?.provider, to: p })
    if (p === 'tencent') {
      setCfg((prev) => ({
        ...prev,
        provider: 'tencent',
        apiKey: TENCENT_DEFAULT_API_KEY,
        region: prev.region === 'gz' || prev.region === 'sg' ? prev.region : 'gz',
        baseUrl: TENCENT_DEFAULT_BASE_URL,
        model: TENCENT_DEFAULT_MODEL,
        workspaceId: '',
        enableSearch: false,
      }))
    } else {
      setCfg((prev) => ({
        ...prev,
        provider: 'aliyun',
        apiKey: ALIYUN_DEFAULT_API_KEY,
        region: 'bj',
        baseUrl: '',
        model: 'qwen3.7-max',
        workspaceId: ALIYUN_DEFAULT_WORKSPACE_ID,
      }))
    }
  }, [])

  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    if (!isAdmin || saving) return
    // 写入本地，保证刷新后 loadConfig 能读到最新值
    try {
      localStorage.setItem('thinkchat-model-config', JSON.stringify(cfg))
    } catch { /* ignore */ }
    // 管理员写入全局配置，对所有用户立即生效
    const token = localStorage.getItem('thinkchat_token')
    if (token) {
      setSaving(true)
      logModelConfig('save_config', { provider: cfg.provider, model: cfg.model, stream: cfg.stream })
      try {
        const r = await fetch('/api/config/global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(cfg),
        })
        if (r.ok) {
          message.success('模型配置已保存并生效')
        } else {
          let errMsg = ''
          try { const body = await r.json(); errMsg = body.error || '' } catch { /* */ }
          if (r.status === 401) {
            message.error('登录已过期，请重新登录')
          } else {
            message.warning('已本地保存，但写入服务端失败' + (errMsg ? '：' + errMsg : '（' + r.status + '）'))
          }
        }
      } catch {
        message.warning('已本地保存，但写入服务端失败（网络错误）')
      } finally {
        setSaving(false)
      }
    } else {
      message.success('模型配置已本地保存')
    }
    onSave(cfg)
    onClose()
  }, [cfg, isAdmin, onSave, onClose, saving])

  const disabled = !isAdmin
  const isTencent = cfg.provider === 'tencent'

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="min(720px, calc(100vw - 32px))"
      centered
      bodyStyle={{ padding: 'clamp(12px, 3vw, 24px) clamp(12px, 3vw, 28px)' }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingOutlined style={{ color: '#6366f1' }} />
          <span style={{ fontWeight: 600, fontSize: 16 }}>
            模型配置 {isAdmin ? '（全局 · 仅管理员可改）' : '（只读 · 由管理员统一设置）'}
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 服务商选择 */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ width: 220 }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>服务商 Provider</div>
            <Select
              value={cfg.provider}
              onChange={handleProviderChange}
              options={PROVIDER_OPTIONS}
              style={{ width: '100%' }}
              disabled={disabled}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>API Key</div>
            <Input.Password
              value={cfg.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder="sk-..."
              disabled={disabled}
            />
          </div>
        </div>

        {/* 连接配置（region / workspaceId / baseUrl / model） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ width: 160 }}>
              <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
                {isTencent ? '地域 Region' : 'Region'}
              </div>
              {isTencent ? (
                <Select
                  value={cfg.region}
                  onChange={(v) => update('region', v)}
                  options={TENCENT_REGIONS}
                  style={{ width: '100%' }}
                  disabled={disabled}
                />
              ) : (
                <Input value={cfg.region} onChange={(e) => update('region', e.target.value)} placeholder="bj" disabled={disabled} />
              )}
            </div>
            {!isTencent && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>Workspace ID</div>
                <Input value={cfg.workspaceId} onChange={(e) => update('workspaceId', e.target.value)} placeholder="ws-..." disabled={disabled} />
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
              Base URL（可选，留空使用 {isTencent ? '腾讯默认地址' : 'region 默认地址'}）
            </div>
            <Input value={cfg.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} placeholder="https://..." disabled={disabled} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>模型 Model</div>
            <Select
              value={cfg.model}
              onChange={(v) => update('model', v)}
              style={{ width: '100%' }}
              disabled={disabled}
              showSearch
              optionFilterProp="label"
              placeholder={isTencent ? '选择模型，如 hy3' : '选择模型，如 qwen3.7-max-...'}
              options={PROVIDER_MODELS[cfg.provider].flatMap((group) =>
                group.options.map((opt) => ({ ...opt, __group: group.label }))
              )}
              optionRender={(option) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{option.data.label}</span>
                  <span style={{ color: '#9ca3af', fontSize: 12, fontFamily: 'monospace' }}>{option.data.value}</span>
                </div>
              )}
            />
          </div>
        </div>

        <Divider style={{ margin: 0 }} />

        {/* 系统提示 + 温度 */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
              系统提示 System Prompt
            </div>
            <Input.TextArea
              value={cfg.system}
              onChange={(e) => update('system', e.target.value)}
              placeholder="可选，例如：你是一个 helpful assistant"
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={disabled}
            />
          </div>
          <div style={{ width: 120 }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
              温度 Temperature
            </div>
            <Input
              type="number"
              min={0}
              max={1.9}
              step={0.1}
              value={cfg.temperature}
              onChange={(e) => update('temperature', parseFloat(e.target.value))}
              disabled={disabled}
            />
          </div>
        </div>

        {/* 开关行 */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={cfg.stream}
              onChange={(v) => update('stream', v)}
              size="small"
              disabled={disabled}
            />
            <span style={{ fontSize: 13, color: '#374151' }}>流式输出 (SSE)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={cfg.enableSearch}
              onChange={(v) => update('enableSearch', v)}
              size="small"
              disabled={disabled}
            />
            <span style={{ fontSize: 13, color: '#374151' }}>联网搜索 (enable_search)</span>
          </div>
        </div>

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={disabled} loading={saving}>
            保存配置
          </Button>
        </div>
      </div>
    </Modal>
  )
}
