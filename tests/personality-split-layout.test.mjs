import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transform } from 'esbuild'

const sourceUrl = new URL('../src/utils/personalityBubbleLayout.ts', import.meta.url)
const source = await fs.readFile(sourceUrl, 'utf8')
const { code: compiled } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' })
const layoutModule = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const { createPersonalityBubbleLayout } = layoutModule

function assertSafeLayout(layout, { stageWidth, stageHeight, brainWidth = 620, brainHeight = 360, brainBottom = 0 }) {
  const positions = Object.values(layout)
  const brainTop = stageHeight - brainHeight - brainBottom
  const brainRect = {
    left: (stageWidth - Math.min(brainWidth, stageWidth - 40)) / 2 - 50,
    top: brainTop - 50,
    right: (stageWidth + Math.min(brainWidth, stageWidth - 40)) / 2 + 50,
    bottom: stageHeight - brainBottom + 50,
  }
  for (const position of positions) {
    const radius = position.diameter / 2
    const centerX = position.left + radius
    const centerY = position.top + radius
    assert.ok(position.left >= 24, '球体不能越过舞台左边界')
    assert.ok(position.left + position.diameter <= stageWidth - 24, '球体不能越过舞台右边界')
    assert.ok(position.top >= 24, '球体不能越过舞台上边界')
    assert.ok(position.top + position.diameter <= stageHeight - 24, '球体不能越过舞台下边界')
    const closestX = Math.max(brainRect.left, Math.min(brainRect.right, centerX))
    const closestY = Math.max(brainRect.top, Math.min(brainRect.bottom, centerY))
    assert.ok(Math.hypot(centerX - closestX, centerY - closestY) >= radius, '球体与大脑至少间隔 50px')
  }
  for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
      const left = positions[leftIndex]
      const right = positions[rightIndex]
      const leftCenter = [left.left + left.diameter / 2, left.top + left.diameter / 2]
      const rightCenter = [right.left + right.diameter / 2, right.top + right.diameter / 2]
      const distance = Math.hypot(leftCenter[0] - rightCenter[0], leftCenter[1] - rightCenter[1])
      assert.ok(distance >= left.diameter / 2 + right.diameter / 2 + 24, '球体之间至少间隔 24px')
    }
  }
}

for (let count = 2; count <= 6; count += 1) {
  test(`${count} 个人格在桌面舞台中不重叠且远离大脑`, () => {
    const personaIds = Array.from({ length: count }, (_, index) => `persona-${index}`)
    const options = { stageWidth: 1200, stageHeight: 760, brainWidth: 620, brainHeight: 360, seed: `desktop-${count}` }
    const layout = createPersonalityBubbleLayout(personaIds, options)
    assert.equal(Object.keys(layout).length, count)
    assertSafeLayout(layout, options)
  })
}

test('6 个人格在窄屏桌面中仍保持安全距离', () => {
  const personaIds = Array.from({ length: 6 }, (_, index) => `persona-${index}`)
  const options = { stageWidth: 650, stageHeight: 650, brainWidth: 600, brainHeight: 330, seed: 'narrow-desktop' }
  assertSafeLayout(createPersonalityBubbleLayout(personaIds, options), options)
})

test('大视口优先使用放大后的球体目标尺寸', () => {
  const expectations = new Map([[2, 220], [3, 210], [4, 195], [5, 180], [6, 180]])
  for (const [count, expectedDiameter] of expectations) {
    const personaIds = Array.from({ length: count }, (_, index) => `large-${count}-${index}`)
    const options = { stageWidth: 1400, stageHeight: 800, brainWidth: 620, brainHeight: 360, seed: `large-${count}` }
    const layout = createPersonalityBubbleLayout(personaIds, options)
    assert.equal(Object.values(layout)[0].diameter, expectedDiameter)
    assertSafeLayout(layout, options)
  }
})

test('较矮页面内所有球体仍保持在当前舞台高度内', () => {
  const personaIds = Array.from({ length: 6 }, (_, index) => `short-${index}`)
  const options = { stageWidth: 1200, stageHeight: 560, brainWidth: 620, brainHeight: 320, seed: 'short-viewport' }
  assertSafeLayout(createPersonalityBubbleLayout(personaIds, options), options)
})

test('6 个人格形成不规则二维分布而不是固定水平网格', () => {
  const personaIds = Array.from({ length: 6 }, (_, index) => `persona-${index}`)
  const options = { stageWidth: 1200, stageHeight: 760, brainWidth: 620, brainHeight: 360, seed: 'organic-layout' }
  const layout = createPersonalityBubbleLayout(personaIds, options)
  const verticalBands = new Set(Object.values(layout).map(position => Math.round((position.top + position.diameter / 2) / 12)))
  assert.ok(verticalBands.size >= 4, '六个节点不应退化为整齐的两条水平线')
  assertSafeLayout(layout, options)
})

test('同一轮布局稳定，重新开始后产生新的随机分布', () => {
  const personaIds = ['a', 'b', 'c', 'd', 'e', 'f']
  const options = { stageWidth: 1200, stageHeight: 760, brainWidth: 620, brainHeight: 360, seed: 'round-one' }
  const first = createPersonalityBubbleLayout(personaIds, options)
  const repeated = createPersonalityBubbleLayout(personaIds, options)
  const nextRound = createPersonalityBubbleLayout(personaIds, { ...options, seed: 'round-two' })
  assert.deepEqual(repeated, first)
  assert.notDeepEqual(nextRound, first)
})
