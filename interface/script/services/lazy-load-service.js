
import { logger } from '../utils/logger.js'
import { performanceMonitor } from '../utils/performance.js'

class LazyLoadService {
  constructor() {
    this.loadedCategories = new Set()
    this.loadingPromises = new Map()
  }

  async loadCategory(categoryKey, loadFunction) {

    if (this.loadedCategories.has(categoryKey)) {
      return Promise.resolve()
    }

    if (this.loadingPromises.has(categoryKey)) {
      return this.loadingPromises.get(categoryKey)
    }

    performanceMonitor.start(`loadCategory_${categoryKey}`)

    const loadPromise = (async () => {
      try {
        await loadFunction()
        this.loadedCategories.add(categoryKey)
        logger.info(`Category loaded: ${categoryKey}`)
        performanceMonitor.end(`loadCategory_${categoryKey}`)
      } catch (error) {
        logger.error(`Failed to load category: ${categoryKey}`, error)
        performanceMonitor.end(`loadCategory_${categoryKey}`)
        throw error
      } finally {
        this.loadingPromises.delete(categoryKey)
      }
    })()

    this.loadingPromises.set(categoryKey, loadPromise)
    return loadPromise
  }

  isLoaded(categoryKey) {
    return this.loadedCategories.has(categoryKey)
  }

  async preloadCategories(categoryKeys, loadFunction) {
    const promises = categoryKeys.map(key => 
      this.loadCategory(key, () => loadFunction(key))
    )
    await Promise.all(promises)
  }

  clear() {
    this.loadedCategories.clear()
    this.loadingPromises.clear()
  }
}

export const lazyLoadService = new LazyLoadService()
