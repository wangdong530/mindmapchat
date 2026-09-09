import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: '#f8fafc', color: '#1f2937',
      }}>
        <section style={{
          width: '100%', maxWidth: 480, padding: 24, borderRadius: 12,
          background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 30px rgba(15,23,42,0.08)',
        }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>页面出现异常</h1>
          <p style={{ margin: '0 0 18px', color: '#6b7280', lineHeight: 1.6 }}>
            当前页面未能正常显示。你可以重新加载页面恢复，未发送的输入内容可能需要重新填写。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0, borderRadius: 8, padding: '9px 16px', cursor: 'pointer',
              background: '#6366f1', color: '#fff', fontSize: 14,
            }}
          >
            重新加载
          </button>
        </section>
      </main>
    )
  }
}
