const api = window.mindmapDesktop
const serverUrl = document.querySelector('#server-url')
const errorMessage = document.querySelector('#error-message')
const retryMessage = document.querySelector('#retry-message')
const retryButton = document.querySelector('#retry-button')
const settingsButton = document.querySelector('#settings-button')

async function initialize() {
  const state = await api.getState()
  serverUrl.textContent = state.serverUrl
  errorMessage.textContent = state.error || '服务器没有响应'
}

retryButton.addEventListener('click', async () => {
  retryButton.disabled = true
  retryMessage.textContent = '正在重新连接…'
  const result = await api.retry()
  if (!result.ok) {
    retryMessage.textContent = result.error || '仍然无法连接，请稍后再试。'
    retryMessage.classList.add('error')
    retryButton.disabled = false
  }
})

settingsButton.addEventListener('click', () => api.openSettings())

void initialize()
