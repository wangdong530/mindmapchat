import { useState, useEffect } from 'react'
import { Drawer, Button, Input, Select, Space, Flex, Typography, message, Switch } from 'antd'
import type { SelectProps } from 'antd'
import { useStore } from '../store/useStore'
import { getUser, updateLocalUser } from '../pages/LoginPage'
import { logSettings } from '../utils/logger'

const { Text, Title } = Typography
const { TextArea } = Input

const emojis = [
  '👤', '🧑‍💻', '👨‍💻', '👩‍💻', '🦸', '🧙', '🎨', '🚀', '💡', '🔮',
  '🛡️', '🎯', '🧠', '👑', '🌟', '🔥',
]

const colors = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316',
]

const modelOptions: SelectProps['options'] = [
  { value: 'GPT-4o', label: 'GPT-4o' },
  { value: 'GPT-4 Turbo', label: 'GPT-4 Turbo' },
  { value: 'Claude 3.5 Sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'Gemini 2.5 Pro', label: 'Gemini 2.5 Pro' },
  { value: 'DeepSeek-V3', label: 'DeepSeek-V3' },
  { value: 'Qwen-Max', label: 'Qwen-Max' },
]

export default function SettingsPanel() {
  const { userSettings, setUserSettings, settingsOpen, closeSettings, autoSync, setAutoSync, syncInterval, setSyncInterval } = useStore()
  const user = getUser()
  const [nickname, setNickname] = useState(user?.nickname || user?.username || '')
  const [saving, setSaving] = useState(false)
  const [profileEnabled, setProfileEnabled] = useState<boolean>(true)

  useEffect(() => {
    if (settingsOpen) {
      const u = getUser()
      setNickname(u?.nickname || u?.username || '')
      // 读取账户级画像采集开关
      fetch('/api/me', { headers: { Authorization: `Bearer ${localStorage.getItem('thinkchat_token') || ''}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data) setProfileEnabled(data.profileEnabled !== false) })
        .catch(() => { /* 保持默认开启 */ })
    }
  }, [settingsOpen])

  const handleToggleProfile = async (enabled: boolean) => {
    const token = localStorage.getItem('thinkchat_token')
    if (!token) return
    const prev = profileEnabled
    setProfileEnabled(enabled)
    try {
      const res = await fetch('/api/me/profile-enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        setProfileEnabled(prev)
        const data = await res.json().catch(() => null)
        message.error(data?.error || '操作失败')
        return
      }
      message.success(enabled ? '已开启人物画像采集' : '已暂停人物画像采集')
      logSettings('update_profile_enabled', { enabled })
    } catch {
      setProfileEnabled(prev)
      message.error('网络错误')
    }
  }

  const handleSaveNickname = async () => {
    const token = localStorage.getItem('thinkchat_token')
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/me/nickname', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nickname: nickname.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json()
        message.error(data.error || '保存失败')
        setSaving(false)
        return
      }
      updateLocalUser({ nickname: nickname.trim() || undefined })
      message.success('昵称已更新')
      logSettings('update_nickname', { nickname: nickname.trim() || '' })
      closeSettings()
    } catch {
      message.error('网络错误')
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={<Title level={5} style={{ margin: 0, fontSize: 15 }}>个人信息设置</Title>}
      placement="right"
      width="min(380px, calc(100vw - 16px))"
      open={settingsOpen}
      onClose={closeSettings}
      styles={{
        body: { padding: '20px 24px' },
        footer: { padding: '12px 24px' },
      }}
      footer={
        <Flex gap={12}>
          <Button
            block
            onClick={() =>
              setUserSettings({
                avatar: '👤',
                name: '我',
                role: '',
                color: '#6366f1',
                bio: '',
                model: 'GPT-4o',
              })
            }
          >
            恢复默认
          </Button>
          <Button type="primary" block loading={saving} onClick={handleSaveNickname}>
            保存
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={20}>
        {/* 昵称（同步到数据库） */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            昵称
          </Text>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="你的昵称"
            maxLength={50}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            用户名：{user?.username || ''}（不可修改）
          </Text>
        </Flex>

        {/* 人物画像采集（账户级总开关） */}
        <Flex vertical gap={8} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px' }}>
          <Flex align="center" justify="space-between" gap={8}>
            <Text style={{ fontSize: 13, fontWeight: 600 }}>人物画像采集</Text>
            <Switch checked={profileEnabled} onChange={handleToggleProfile} />
          </Flex>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
            开启后，你的每次提问会被 AI 归类成「人物画像」（侧边栏菜单）。只保存截断片段与分类结果，不保存提问原文。关闭后不再采集新提问，历史画像保留。
          </Text>
        </Flex>

        {/* Avatar */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            选择头像
          </Text>
          <Flex wrap="wrap" gap={8}>
            {emojis.map((e) => (
              <div
                key={e}
                onClick={() => { setUserSettings({ avatar: e }); logSettings('change_avatar', { avatar: e }) }}
                style={{
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all .15s',
                  background: userSettings.avatar === e ? '#eef2ff' : '#f8fafc',
                  border: userSettings.avatar === e ? '2px solid #818cf8' : '1px solid transparent',
                }}
              >
                {e}
              </div>
            ))}
          </Flex>
        </Flex>

        {/* Name */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            姓名
          </Text>
          <Input
            value={userSettings.name}
            onChange={(e) => setUserSettings({ name: e.target.value })}
            placeholder="你的姓名"
          />
        </Flex>

        {/* Role */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            角色
          </Text>
          <Input
            value={userSettings.role}
            onChange={(e) => setUserSettings({ role: e.target.value })}
            placeholder="如：产品经理"
          />
        </Flex>

        {/* Theme Color */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            主题色
          </Text>
          <Flex gap={8}>
            {colors.map((c) => (
              <div
                key={c}
                onClick={() => setUserSettings({ color: c })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  backgroundColor: c,
                  cursor: 'pointer',
                  transition: 'all .15s',
                  border: userSettings.color === c ? '2px solid #334155' : '2px solid transparent',
                  boxShadow: userSettings.color === c ? '0 2px 6px rgba(0,0,0,.15)' : 'none',
                }}
              />
            ))}
          </Flex>
        </Flex>

        {/* Bio */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            简介
          </Text>
          <TextArea
            value={userSettings.bio}
            onChange={(e) => setUserSettings({ bio: e.target.value })}
            placeholder="介绍一下自己..."
            rows={3}
          />
        </Flex>

        {/* Default Model */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            默认模型
          </Text>
          <Select
            value={userSettings.model}
            onChange={(val: string) => setUserSettings({ model: val })}
            options={modelOptions}
          />
        </Flex>

        {/* 数据同步（多页面） */}
        <Flex vertical gap={8}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            数据同步（多页面）
          </Text>
          <Flex align="center" justify="space-between">
            <Text style={{ fontSize: 13 }}>自动同步数据库</Text>
            <Switch checked={autoSync} onChange={setAutoSync} />
          </Flex>
          <Flex align="center" justify="space-between" gap={8}>
            <Text style={{ fontSize: 13 }}>同步间隔</Text>
            <Select
              value={syncInterval}
              onChange={setSyncInterval}
              disabled={!autoSync}
              style={{ width: 120 }}
              options={[
                { value: 3000, label: '3 秒' },
                { value: 5000, label: '5 秒' },
                { value: 8000, label: '8 秒' },
                { value: 15000, label: '15 秒' },
                { value: 30000, label: '30 秒' },
              ]}
            />
          </Flex>
        </Flex>
      </Flex>
    </Drawer>
  )
}
