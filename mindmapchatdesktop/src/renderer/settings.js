const api = window.mindmapDesktop
const form = document.querySelector('#settings-form')
const input = document.querySelector('#server-url')
const message = document.querySelector('#message')
const saveButton = document.querySelector('#save-button')
const resetButton = document.querySelector('#reset-button')
const cancelButton = document.querySelector('#cancel-button')
const version = document.querySelector('#version')

let defaultServerUrl = ''

function setMessage(text, isError = false) {
  message.textContent = text
  message.classList.toggle('error', isError)
}

async function initialize() {
  const state = await api.getState()
  input.value = state.serverUrl
  defaultServerUrl = state.defaultServerUrl
  version.textContent = `MindmapChat Desktop v${state.version}`
  input.focus()
  input.select()
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  saveButton.disabled = true
  setMessage('正在连接…')
  const result = await api.applySettings(input.value)
  if (!result.ok) {
    setMessage(result.error || '保存失败', true)
    saveButton.disabled = false
  }
})

resetButton.addEventListener('click', () => {
  input.value = defaultServerUrl
  setMessage('已恢复默认地址，点击“保存并连接”后生效。')
  input.focus()
})

cancelButton.addEventListener('click', () => api.closeSettings())

void initialize().catch((error) => setMessage(error.message, true))
