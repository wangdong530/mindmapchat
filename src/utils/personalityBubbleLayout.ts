export interface PersonalityBubblePosition {
  left: number
  top: number
  diameter: number
  startX: number
  startY: number
}

export interface PersonalityBubbleLayoutOptions {
  stageWidth: number
  stageHeight: number
  seed: string
  brainWidth?: number
  brainHeight?: number
  brainBottom?: number
  minGap?: number
  brainGap?: number
  edgeGap?: number
}

interface Point {
  x: number
  y: number
}

const BASE_DIAMETERS: Record<number, number> = {
  2: 220,
  3: 210,
  4: 195,
  5: 180,
  6: 180,
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: string) {
  let state = hashSeed(seed) || 1
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pointDistance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function isOutsideBrain(
  point: Point,
  radius: number,
  brainRect: { left: number; top: number; right: number; bottom: number },
  brainGap: number,
) {
  const expandedLeft = brainRect.left - brainGap
  const expandedTop = brainRect.top - brainGap
  const expandedRight = brainRect.right + brainGap
  const expandedBottom = brainRect.bottom + brainGap
  const closestX = clamp(point.x, expandedLeft, expandedRight)
  const closestY = clamp(point.y, expandedTop, expandedBottom)
  return Math.hypot(point.x - closestX, point.y - closestY) >= radius
}

function fallbackPoints(
  count: number,
  stageWidth: number,
  radius: number,
  edgeGap: number,
  brainTop: number,
  brainGap: number,
): Point[] {
  const minX = edgeGap + radius
  const maxX = stageWidth - edgeGap - radius
  const topY = edgeGap + radius
  const bottomY = brainTop - brainGap - radius
  const row = (rowCount: number, y: number, inset = 0) => Array.from({ length: rowCount }, (_, index) => ({
    x: rowCount === 1
      ? stageWidth / 2
      : minX + inset + index * ((maxX - minX - inset * 2) / (rowCount - 1)),
    y,
  }))

  if (count <= 3) {
    const points = row(count, topY + (bottomY - topY) * 0.48)
    return points.map((point, index) => ({ ...point, y: point.y + (index % 2 ? 12 : -8) }))
  }
  const topCount = Math.ceil(count / 2)
  const bottomCount = count - topCount
  return [...row(topCount, topY), ...row(bottomCount, bottomY, bottomCount === 2 ? (maxX - minX) * 0.2 : 0)]
}

function generateRandomPoints(
  count: number,
  random: () => number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  minimumDistance: number,
  radius: number,
  brainRect: { left: number; top: number; right: number; bottom: number },
  brainGap: number,
) {
  const placed: Point[] = []
  for (let index = 0; index < count; index += 1) {
    const candidates: Array<{ point: Point; score: number }> = []
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const point = {
        x: bounds.minX + random() * (bounds.maxX - bounds.minX),
        y: bounds.minY + random() * (bounds.maxY - bounds.minY),
      }
      if (!isOutsideBrain(point, radius, brainRect, brainGap)) continue
      const nearest = placed.length
        ? Math.min(...placed.map(other => pointDistance(point, other)))
        : minimumDistance * 2
      if (nearest < minimumDistance) continue

      // 优先松散分布，同时保留随机扰动，避免每轮退化成整齐网格。
      const upperBias = (bounds.maxY - point.y) * 0.035
      const score = nearest + upperBias + random() * 28
      candidates.push({ point, score })
    }
    if (!candidates.length) return null
    candidates.sort((left, right) => right.score - left.score)
    const choicePool = candidates.slice(0, Math.min(7, candidates.length))
    placed.push(choicePool[Math.floor(random() * choicePool.length)].point)
  }
  return placed
}

export function createPersonalityBubbleLayout(
  personaIds: string[],
  options: PersonalityBubbleLayoutOptions,
): Record<string, PersonalityBubblePosition> {
  const ids = [...new Set(personaIds)]
  if (ids.length < 2 || ids.length > 6) throw new Error('人格球布局仅支持 2—6 个角色')

  const brainBottom = options.brainBottom ?? 0
  const minGap = options.minGap ?? 24
  const brainGap = options.brainGap ?? 50
  const edgeGap = options.edgeGap ?? 24
  const stageWidth = Math.max(1, options.stageWidth)
  const stageHeight = Math.max(1, options.stageHeight)
  const brainWidth = Math.max(80, Math.min(options.brainWidth ?? 620, stageWidth - edgeGap * 2))
  const brainHeight = Math.max(80, Math.min(options.brainHeight ?? 360, stageHeight - edgeGap * 2))
  const columns = ids.length >= 5 ? 3 : ids.length === 4 ? 2 : ids.length
  const rows = ids.length > 3 ? 2 : 1
  const baseDiameter = BASE_DIAMETERS[ids.length]
  const maxByWidth = Math.floor((stageWidth - edgeGap * 2 - minGap * (columns - 1)) / columns)
  const brainTop = stageHeight - brainHeight - brainBottom
  const brainRect = {
    left: (stageWidth - brainWidth) / 2,
    top: brainTop,
    right: (stageWidth + brainWidth) / 2,
    bottom: stageHeight - brainBottom,
  }
  const brainOrigin = { x: stageWidth / 2, y: brainTop + Math.min(82, brainHeight * 0.27) }
  const buildLayout = (points: Point[], diameter: number) => {
    const radius = diameter / 2
    return Object.fromEntries(ids.map((id, index) => {
      const point = points[index]
      return [id, {
        left: point.x - radius,
        top: point.y - radius,
        diameter,
        startX: brainOrigin.x - point.x,
        startY: brainOrigin.y - point.y,
      }]
    }))
  }

  // 从目标大尺寸开始尝试，优先利用大脑左右两侧；只有空间确实不足时才逐级缩小。
  const desiredDiameter = Math.max(72, Math.min(baseDiameter, maxByWidth))
  for (let diameter = desiredDiameter; diameter >= 72; diameter -= 6) {
    const radius = diameter / 2
    const bounds = {
      minX: edgeGap + radius,
      maxX: stageWidth - edgeGap - radius,
      minY: edgeGap + radius,
      maxY: stageHeight - edgeGap - radius,
    }
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) continue
    const random = seededRandom(`${options.seed}:${ids.slice().sort().join('|')}:${stageWidth}:${stageHeight}:${diameter}`)
    const points = generateRandomPoints(ids.length, random, bounds, diameter + minGap, radius, brainRect, brainGap)
    if (points) return buildLayout(points, diameter)
  }

  const aboveBrainHeight = Math.max(0, brainTop - brainGap - edgeGap)
  const maxByAboveBrain = rows === 2
    ? Math.floor((aboveBrainHeight - minGap) / 2)
    : aboveBrainHeight
  const fallbackDiameter = Math.max(48, Math.min(desiredDiameter, maxByAboveBrain))
  const fallback = fallbackPoints(ids.length, stageWidth, fallbackDiameter / 2, edgeGap, brainTop, brainGap)
  return buildLayout(fallback, fallbackDiameter)
}
