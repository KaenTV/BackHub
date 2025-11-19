
class MemoCache {
  constructor(maxSize = 1000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.hits = 0
    this.misses = 0
  }

  get(key) {
    const value = this.cache.get(key)
    if (value !== undefined) {
      this.hits++
      return value
    }
    this.misses++
    return undefined
  }

  set(key, value) {

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  clear() {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  getStats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%'
    }
  }
}

export const memoCache = new MemoCache()

export function memoize(fn, keyGenerator = null) {
  return function(...args) {
    const key = keyGenerator
      ? keyGenerator(...args)
      : JSON.stringify(args)

    const cached = memoCache.get(key)
    if (cached !== undefined) {
      return cached
    }

    const result = fn.apply(this, args)
    memoCache.set(key, result)
    return result
  }
}
