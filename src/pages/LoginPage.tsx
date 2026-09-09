import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { logAuth } from '../utils/logger'

const TOKEN_KEY = 'thinkchat_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser(): { id: number; username: string; nickname?: string; isAdmin?: boolean } | null {
  try {
    const raw = localStorage.getItem('thinkchat_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function updateLocalUser(updates: Partial<{ username: string; nickname: string }>) {
  try {
    const raw = localStorage.getItem('thinkchat_user')
    if (!raw) return
    const user = JSON.parse(raw)
    const updated = { ...user, ...updates }
    localStorage.setItem('thinkchat_user', JSON.stringify(updated))
  } catch { /* ignore */ }
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('thinkchat_user')
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // 如果已登录，直接跳首页
  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/', { replace: true })
    }
  }, [navigate])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setErrorMsg('请输入用户名和密码')
      return
    }
    setErrorMsg('')
    setLoading(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || '登录失败，请检查用户名和密码')
        setLoading(false)
        return
      }
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem('thinkchat_user', JSON.stringify(data.user))
      message.success('登录成功')
      logAuth('login_success', { username: data.user.username, userId: data.user.id })
      navigate('/', { replace: true })
    } catch {
      setErrorMsg('网络错误，请重试')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        margin: '0 16px',
        padding: 'clamp(24px, 5vw, 40px) clamp(16px, 4vw, 32px)',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <span style={{ color: '#fff', fontSize: 24, fontWeight: 700 }}>MC</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>MindmapChat</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>把对话变成思维导图，让每一次追问都有迹可循</p>
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            color: '#dc2626', fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            {errorMsg}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: '#9ca3af' }} />}
            placeholder="用户名"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setErrorMsg('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            status={errorMsg ? 'error' : undefined}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
            placeholder="密码"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErrorMsg('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            status={errorMsg ? 'error' : undefined}
          />
        </div>

        <Button
          type="primary"
          size="large"
          block
          loading={loading}
          onClick={handleLogin}
          style={{ height: 42, borderRadius: 8, fontSize: 15, fontWeight: 500 }}
        >
          登 录
        </Button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>没有账号？</span>
        </div>
        <Link to="/register">
          <Button
            size="large"
            block
            style={{ height: 42, borderRadius: 8, fontSize: 15, fontWeight: 500, marginTop: 10 }}
          >
            注 册
          </Button>
        </Link>
      </div>
    </div>
  )
}
