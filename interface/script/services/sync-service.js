
import { storageService } from './storage-service.js'
import { logger } from '../utils/logger.js'
import { notificationService } from './notification-service.js'

class SyncService {
  constructor() {
    this.syncInterval = null
    this.syncIntervalMs = 2 * 1000 
    this.lastSync = {}
    this.isSyncing = false
    this.syncEnabled = true
  }

  start() {
    if (!this.syncEnabled) return

    this.syncInterval = setInterval(() => {
      this.checkForChanges().catch(err => logger.error('Check for changes failed', err))
    }, this.syncIntervalMs)

    logger.info('Sync service started')
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
      logger.info('Sync service stopped')
    }
  }

  async checkForChanges() {
    if (this.isSyncing) return

    const keys = ['backhub-history', 'backhub-users', 'backhub-price-overrides']
    let hasChanges = false

    for (const key of keys) {
      const data = await storageService.load(key)
      const dataHash = this.hashData(data)

      if (this.lastSync[key] !== dataHash) {
        hasChanges = true
        this.lastSync[key] = dataHash
      }
    }

    if (hasChanges) {
      await this.sync()
    }
  }

  async sync() {
    if (this.isSyncing) return

    this.isSyncing = true

    try {
      const timestamp = new Date().toISOString()
      await storageService.save('backhub-last-sync', timestamp)
      logger.info('Data synchronized', { timestamp })
    } catch (error) {
      logger.error('Sync failed', error)
    } finally {
      this.isSyncing = false
    }
  }

  hashData(data) {
    const str = JSON.stringify(data)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash
    }
    return hash.toString()
  }

  async getLastSync() {
    return await storageService.load('backhub-last-sync', null)
  }

  setEnabled(enabled) {
    this.syncEnabled = enabled
    if (enabled) {
      this.start()
    } else {
      this.stop()
    }
  }
}

export const syncService = new SyncService()
