import { notificationService } from './notification-service.js'
import { logger } from '../utils/logger.js'
import { formatPrice } from '../utils/format.js'

class MarginAlertService {
  constructor() {
    this.enabled = true
    this.alertThreshold = 0
    this.lastAlertedMargin = null
  }

  checkMargin(margin, totalBuy, totalSell) {
    if (!this.enabled) return

    if (margin < this.alertThreshold) {

      if (this.lastAlertedMargin === null || Math.abs(this.lastAlertedMargin - margin) > 1000) {
        this.alertNegativeMargin(margin, totalBuy, totalSell)
        this.lastAlertedMargin = margin
      }
    } else {
      this.lastAlertedMargin = null
    }
  }

  alertNegativeMargin(margin, totalBuy, totalSell) {
    const message = `⚠️ Attention: Marge négative de ${formatPrice(Math.abs(margin))}`

    notificationService.warning(message, 6000)
    logger.warn('Negative margin detected', { margin, totalBuy, totalSell })

    if (window.electronAPI?.showNotification) {
      window.electronAPI.showNotification('Marge négative', message)
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  setThreshold(threshold) {
    this.alertThreshold = threshold
  }
}

export const marginAlertService = new MarginAlertService()
