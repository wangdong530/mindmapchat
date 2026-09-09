import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Routes, Route, Navigate } from 'react-router-dom'

import MindmapChatPage from './pages/MindmapChat'
import LoginPage, { isAuthenticated } from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import UserQuestionsPage from './pages/UserQuestionsPage'
import PersonalitySplitPage from './pages/PersonalitySplit'
import AppErrorBoundary from './components/AppErrorBoundary'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          borderRadius: 6,
        },
      }}
    >
      <AppErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<RequireAuth><MindmapChatPage /></RequireAuth>} />
          <Route path="/mindmap" element={<Navigate to="/" replace />} />
          <Route path="/user-questions" element={<RequireAuth><UserQuestionsPage /></RequireAuth>} />
          <Route path="/personality-split" element={<RequireAuth><PersonalitySplitPage /></RequireAuth>} />
        </Routes>
      </AppErrorBoundary>
    </ConfigProvider>
  )
}
