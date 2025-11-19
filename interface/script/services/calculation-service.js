
import { memoize } from '../utils/memoize.js'
import { performanceMonitor } from '../utils/performance.js'

class CalculationService {
  constructor() {
    this.cache = new Map()
  }

  calculateMargin(buyPrice, sellPrice, quantity) {
    const cacheKey = `margin_${buyPrice}_${sellPrice}_${quantity}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    performanceMonitor.start('calculateMargin')

    const buyTotal = buyPrice * quantity
    const sellTotal = sellPrice * quantity
    const margin = sellTotal - buyTotal
    const marginPercent = buyTotal > 0 ? (margin / buyTotal * 100) : 0

    const result = {
      buyTotal,
      sellTotal,
      margin,
      marginPercent,
      isPositive: margin >= 0
    }

    this.cache.set(cacheKey, result)
    performanceMonitor.end('calculateMargin')

    return result
  }

  calculateTotals(items) {
    performanceMonitor.start('calculateTotals')

    let totalBuy = 0
    let totalSell = 0

    items.forEach(item => {
      const calc = this.calculateMargin(item.buyPrice, item.sellPrice, item.quantity)
      totalBuy += calc.buyTotal
      totalSell += calc.sellTotal
    })

    const totalMargin = totalSell - totalBuy
    const totalMarginPercent = totalBuy > 0 ? (totalMargin / totalBuy * 100) : 0

    const result = {
      totalBuy,
      totalSell,
      totalMargin,
      totalMarginPercent,
      isPositive: totalMargin >= 0,
      itemCount: items.length
    }

    performanceMonitor.end('calculateTotals')

    return result
  }

  clearCache() {
    this.cache.clear()
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

export const calculationService = new CalculationService()
