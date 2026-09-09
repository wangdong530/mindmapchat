import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { logAuth } from '../utils/logger'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) {
      message.warning('请输入用户名和密码')
      return
    }
    if (password.length < 4) {
      message.warning('密码至少4位')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error || '注册失败')
        setLoading(false)
        return
      }
      // 注册成功，存 token 并跳转
      localStorage.setItem('thinkchat_token', data.token)
      localStorage.setItem('thinkchat_user', JSON.stringify(data.user))
      message.success('注册成功')
      logAuth('register_success', { username: data.user.username, userId: data.user.id })
      navigate('/', { replace: true })
    } catch {
      message.error('网络错误，请重试')
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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>注册 MindmapChat</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>创建你的 AI 对话树账号</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: '#9ca3af' }} />}
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
            placeholder="密码（至少4位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
          />
        </div>

        <Button
          type="primary"
          size="large"
          block
          loading={loading}
          onClick={handleRegister}
          style={{ height: 42, borderRadius: 8, fontSize: 15, fontWeight: 500 }}
        >
          注 册
        </Button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>已有账号？</span>
          <Link to="/login" style={{ fontSize: 13, color: '#6366f1', marginLeft: 4 }}>立即登录</Link>
        </div>
      </div>
    </div>
  )
}
