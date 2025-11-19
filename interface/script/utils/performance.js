
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map()
    this.enabled = true
  }

  start(name) {
    if (!this.enabled) return
    this.metrics.set(name, { start: performance.now() })
  }

  end(name) {
    if (!this.enabled) return 0
    const metric = this.metrics.get(name)
    if (!metric) return 0

    const duration = performance.now() - metric.start
    metric.duration = duration
    metric.end = performance.now()

    return duration
  }

  getMetrics() {
    return this.metrics
  }

  clear() {
    this.metrics.clear()
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }
}

export const performanceMonitor = new PerformanceMonitor()

export function monitorPerformance(func, name) {
  return function(...args) {
    performanceMonitor.start(name)
    try {
      const result = func.apply(this, args)
      if (result instanceof Promise) {
        return result.finally(() => performanceMonitor.end(name))
      }
      performanceMonitor.end(name)
      return result
    } catch (error) {
      performanceMonitor.end(name)
      throw error
    }
  }
}
