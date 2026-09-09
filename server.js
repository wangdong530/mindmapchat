import express from 'express'
import { createChatHandler } from './chat-proxy.js'
import { getGlobalConfig } from './db.js'

const app = express()
app.use(express.json())

const chat = createChatHandler({
  configProvider: getGlobalConfig,
  defaultProvider: 'aliyun',
  defaultRegion: 'bj',
  defaultWorkspaceId: process.env.ALIYUN_WORKSPACE_ID || '',
  defaultModel: 'qwen3.7-max',
})

app.post('/api/chat', (req, res, next) => {
  chat(req, res).catch(next)
})

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message, err.stack)
  res.statusCode = 500
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }))
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`API proxy server running on http://localhost:${PORT}`)
})
