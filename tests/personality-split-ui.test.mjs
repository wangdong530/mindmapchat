import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const pageSource = await fs.readFile(new URL('../src/pages/PersonalitySplit.tsx', import.meta.url), 'utf8')
const styleSource = await fs.readFile(new URL('../src/pages/PersonalitySplit.css', import.meta.url), 'utf8')

test('发送、复制和分享按钮位于嘴形输入区域之外', () => {
  const mouthStart = pageSource.indexOf('<div className={`ps-input-shell')
  const actionsStart = pageSource.indexOf('<div className="ps-mouth-actions">', mouthStart)
  const statusStart = pageSource.indexOf('<div className="ps-brain-status">', actionsStart)

  assert.ok(mouthStart >= 0, '应保留嘴形输入区域')
  assert.ok(actionsStart > mouthStart, '操作按钮应位于嘴形输入区域之后')
  assert.ok(statusStart > actionsStart, '操作按钮应位于脑内状态之前')

  const mouthMarkup = pageSource.slice(mouthStart, actionsStart)
  assert.doesNotMatch(mouthMarkup, /<(?:Button|button)\b/, '嘴形输入区域内部不应再放置按钮')
  assert.match(pageSource.slice(actionsStart, statusStart), /aria-label="发送问题"/)
  assert.match(pageSource.slice(actionsStart, statusStart), /aria-label="复制全部"/)
})

test('嘴形输入区域使用透明背景以延续大脑底色', () => {
  const inputShellRule = styleSource.match(/\.ps-input-shell \{[^}]+\}/)?.[0] ?? ''
  const textareaRules = styleSource.match(/\.ps-input-shell \.ant-input-textarea-affix-wrapper,[\s\S]+?text-align: center; \}/)?.[0] ?? ''
  assert.match(inputShellRule, /background:\s*transparent;/)
  assert.doesNotMatch(inputShellRule, /backdrop-filter:/)
  assert.match(textareaRules, /\.ant-input-textarea-affix-wrapper/)
  assert.match(textareaRules, /textarea\.ant-input:focus/)
  assert.ok((textareaRules.match(/background:\s*transparent !important;/g) || []).length >= 2)
  assert.ok((textareaRules.match(/border:\s*0 !important;/g) || []).length >= 2)
})

test('完成态脑内总结同时显示发送的问题和最终结果', () => {
  const summaryStart = pageSource.indexOf('<div className="ps-mouth-summary"')
  const actionsStart = pageSource.indexOf('<div className="ps-mouth-actions">', summaryStart)
  const summaryMarkup = pageSource.slice(summaryStart, actionsStart)
  const summaryStyles = styleSource.slice(styleSource.indexOf('.ps-mouth-summary {'), styleSource.indexOf('.ps-mouth-actions {'))
  assert.match(summaryMarkup, /<strong>问题<\/strong>[\s\S]*\{prompt\.trim\(\)\}/)
  assert.match(summaryMarkup, /<strong>结果<\/strong>[\s\S]*\{summary \|\| summaryError \|\|/)
  assert.match(summaryStyles, /\.ps-mouth-summary-question p \{ height: 100%; max-height: 28px; \}/)
  assert.match(summaryStyles, /\.ps-mouth-summary-result p \{ height: 100%; max-height: 38px; \}/)
  assert.match(summaryStyles, /overflow-y: auto;/)
})

test('长问题和长总结被限制在固定高度的嘴形容器内', () => {
  const inputShellRule = styleSource.match(/\.ps-input-shell \{[^}]+\}/)?.[0] ?? ''
  const summaryStyles = styleSource.slice(styleSource.indexOf('.ps-mouth-summary {'), styleSource.indexOf('.ps-mouth-actions {'))
  const mobileStyles = styleSource.slice(styleSource.indexOf('@media (max-width: 640px)'))

  assert.match(inputShellRule, /--mouth-height: 112px;/)
  assert.match(inputShellRule, /height: var\(--mouth-height\);/)
  assert.match(inputShellRule, /max-height: var\(--mouth-height\);/)
  assert.match(inputShellRule, /overflow: hidden;/)
  assert.match(summaryStyles, /\.ps-mouth-summary \{[^}]*height: 100%;[^}]*max-height: 100%;[^}]*overflow: hidden;/)
  assert.match(summaryStyles, /\.ps-mouth-summary-row \{[^}]*min-height: 0;[^}]*overflow: hidden;/)
  assert.match(summaryStyles, /overflow-x: hidden; overflow-y: auto;/)
  assert.match(mobileStyles, /\.ps-input-shell \{ --mouth-height: 88px;/)
})

test('人格侧栏仅保留搜索，不再渲染类型、地区和性格下拉筛选', () => {
  assert.doesNotMatch(pageSource, /<Select\b/)
  assert.doesNotMatch(pageSource, /(?:type|region|personality)Filter/)
  assert.match(pageSource, /placeholder="搜索角色"/)
})

test('手机版使用全屏人格选择和横向吸附的人格球轨道', () => {
  const mobileStyles = styleSource.slice(styleSource.indexOf('@media (max-width: 640px)'))
  const mobileResultsRule = mobileStyles.match(/\.ps-results \{[^}]+\}/)?.[0] ?? ''
  assert.match(pageSource, /className="ps-sidebar-close"/)
  assert.match(pageSource, /aria-label="关闭人格选择"/)
  assert.match(pageSource, /className="ps-mobile-persona-trigger"/)
  assert.match(pageSource, /className="ps-mobile-result-heading"/)
  assert.match(mobileStyles, /\.ps-sidebar \{[^}]*width: 100%;[^}]*height: 100dvh;/)
  assert.match(mobileStyles, /scroll-snap-type: x mandatory;/)
  assert.match(mobileStyles, /scroll-snap-align: center;/)
  assert.match(mobileStyles, /border-radius: 50%;/)
  assert.match(mobileStyles, /env\(safe-area-inset-bottom\)/)
  assert.match(mobileResultsRule, /display: flex;/)
  assert.doesNotMatch(mobileResultsRule, /grid-template-columns:/)
})

test('体验控件位于左侧菜单且右侧只保留效果区域', () => {
  const sidebarMarkup = pageSource.slice(pageSource.indexOf('<aside className='), pageSource.indexOf('</aside>'))
  const mainMarkup = pageSource.slice(pageSource.indexOf('<main className="ps-main">'), pageSource.indexOf('</main>'))
  const heroRule = styleSource.match(/\.ps-hero \{[^}]+\}/)?.[0] ?? ''
  assert.match(sidebarMarkup, /className="ps-experience-controls"/)
  assert.match(sidebarMarkup, />一次性体验</)
  assert.match(sidebarMarkup, /className="ps-random-personas"/)
  assert.match(sidebarMarkup, />\s*随机选择 6 个\s*</)
  assert.match(sidebarMarkup, /className="ps-reset-experience"/)
  assert.doesNotMatch(mainMarkup, /<header\b/)
  assert.doesNotMatch(mainMarkup, /ps-random-personas|ps-reset-experience/)
  assert.match(heroRule, /height: 100dvh;/)
})

test('随机选择会终止请求并清空所有一次性体验状态', () => {
  const clearStart = pageSource.indexOf('const clearExperience =')
  const randomStart = pageSource.indexOf('const randomizePersonas =', clearStart)
  const applyEventStart = pageSource.indexOf('const applyEvent =', randomStart)
  const clearSource = pageSource.slice(clearStart, randomStart)
  const randomSource = pageSource.slice(randomStart, applyEventStart)
  for (const expected of [
    'controllerRef.current?.abort()', "setSearch('')", "setPrompt('')", 'setResults({})',
    "setSummary('')", "setSummaryError('')", 'setBubbleLayout({})',
    'setSelectedIds(nextSelectedIds)', "setPhase('idle')",
  ]) assert.ok(clearSource.includes(expected), `完整重置应包含 ${expected}`)
  assert.match(randomSource, /clearExperience\(randomizedIds\)/)
  assert.doesNotMatch(randomSource, /phase !== 'idle'/)
})

test('每个人格使用独立请求并发生成，完成后单独请求总结', () => {
  const requestStart = pageSource.indexOf('const requestPersona =')
  const summaryStart = pageSource.indexOf('const requestSummary =', requestStart)
  const experienceStart = pageSource.indexOf('const startExperience =', summaryStart)
  const resetStart = pageSource.indexOf('const resetExperience =', experienceStart)
  const requestSource = pageSource.slice(requestStart, summaryStart)
  const summarySource = pageSource.slice(summaryStart, experienceStart)
  const experienceSource = pageSource.slice(experienceStart, resetStart)

  assert.match(requestSource, /templateIds: \[id\]/)
  assert.match(summarySource, /fetch\('\/api\/personality-split\/summary'/)
  assert.match(experienceSource, /Promise\.allSettled\(requestedIds\.map\(id => requestPersona\(id, controller\)\)\)/)
  assert.match(experienceSource, /requestSummary\(question, successful, controller\)/)
  assert.doesNotMatch(experienceSource, /templateIds: selectedIds/)
})

test('人格失败只显示服务端兜底文案且不提供手动重试', () => {
  assert.doesNotMatch(pageSource, /再唤醒一次|retryPersona|retriedIds|retry:\s*true|这个人格暂时走神了/)
  assert.match(pageSource, /result\.status === 'error' \? <p>\{result\.error\}<\/p>/)
})
