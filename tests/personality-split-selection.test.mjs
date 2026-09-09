import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transform } from 'esbuild'

const source = await fs.readFile(new URL('../src/utils/personalitySelection.ts', import.meta.url), 'utf8')
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' })
const { pickRandomPersonaIds } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('随机选择最多返回 6 个不重复的人格', () => {
  const sourceIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a']
  const selected = pickRandomPersonaIds(sourceIds, 6, () => 0.37)
  assert.equal(selected.length, 6)
  assert.equal(new Set(selected).size, 6)
  assert.ok(selected.every(id => sourceIds.includes(id)))
})

test('人格不足 6 个时全部返回且不修改原数组', () => {
  const sourceIds = ['a', 'b', 'c']
  const snapshot = [...sourceIds]
  const selected = pickRandomPersonaIds(sourceIds, 6, () => 0.75)
  assert.deepEqual(new Set(selected), new Set(sourceIds))
  assert.deepEqual(sourceIds, snapshot)
})
