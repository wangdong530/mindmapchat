export function pickRandomPersonaIds(
  personaIds: string[],
  limit = 6,
  random: () => number = Math.random,
) {
  const shuffled = [...new Set(personaIds.filter(Boolean))]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = random()
    const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0
    const swapIndex = Math.floor(normalized * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled.slice(0, Math.min(Math.max(0, Math.floor(limit)), shuffled.length))
}
