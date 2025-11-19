
import { storageService } from './storage-service.js'
import { logger } from '../utils/logger.js'
import { notificationService } from './notification-service.js'

class BackupService {
  constructor() {
    this.backupInterval = null
    this.backupIntervalMs = 5 * 60 * 1000 
    this.maxBackups = 10
    this.backupPrefix = 'backhub_backup_'
    this.init()
  }

  init() {

    this.startAutoBackup()

    window.addEventListener('beforeunload', () => {
      this.createBackup().catch(() => {}) // Ignore errors on unload
    })
  }

  async createBackup(silent = false) {
    try {
      const timestamp = new Date().toISOString()
      const backupId = `backup_${Date.now()}`

      const [history, users, priceOverrides, settings] = await Promise.all([
        storageService.load('backhub-history', []),
        storageService.load('backhub-users', []),
        storageService.load('backhub-price-overrides', {}),
        storageService.load('backhub-settings', {})
      ])

      const data = {
        history,
        users,
        priceOverrides,
        settings,
        timestamp,
        version: '1.0.0'
      }

      const backupKey = `${this.backupPrefix}${backupId}`
      await storageService.save(backupKey, data)

      const backups = await this.getBackupList()
      backups.push({
        id: backupId,
        timestamp,
        size: JSON.stringify(data).length
      })

      if (backups.length > this.maxBackups) {
        const oldest = backups.shift()
        storageService.remove(`${this.backupPrefix}${oldest.id}`)
      }

      await storageService.save('backhub-backups', backups)

      if (!silent) {
        notificationService.success('Sauvegarde automatique créée', 2000)
      }

      logger.info('Backup created', { backupId, timestamp })
      return { id: backupId, timestamp, size: data.size }
    } catch (error) {
      logger.error('Failed to create backup', error)
      if (!silent) {
        notificationService.error('Échec de la sauvegarde')
      }
      throw error
    }
  }

  async restoreBackup(backupId) {
    try {
      const backupKey = `${this.backupPrefix}backup_${backupId}`
      const data = await storageService.load(backupKey)

      if (!data) {
        throw new Error('Backup not found')
      }

      await Promise.all([
        storageService.save('backhub-history', data.history || []),
        storageService.save('backhub-users', data.users || []),
        storageService.save('backhub-price-overrides', data.priceOverrides || {}),
        storageService.save('backhub-settings', data.settings || {})
      ])

      notificationService.success('Sauvegarde restaurée avec succès')
      logger.info('Backup restored', { backupId })

      setTimeout(() => {
        window.location.reload()
      }, 1000)

      return true
    } catch (error) {
      logger.error('Failed to restore backup', error)
      notificationService.error('Échec de la restauration')
      return false
    }
  }

  async getBackupList() {
    return await storageService.load('backhub-backups', [])
  }

  async deleteBackup(backupId) {
    try {
      const backupKey = `${this.backupPrefix}backup_${backupId}`
      storageService.remove(backupKey)

      const backups = await this.getBackupList()
      const filtered = backups.filter(b => b.id !== backupId)
      await storageService.save('backhub-backups', filtered)

      notificationService.success('Sauvegarde supprimée')
      logger.info('Backup deleted', { backupId })
    } catch (error) {
      logger.error('Failed to delete backup', error)
      notificationService.error('Échec de la suppression')
    }
  }

  async exportBackup(backupId) {
    try {
      const backupKey = `${this.backupPrefix}backup_${backupId}`
      const data = await storageService.load(backupKey)

      if (!data) {
        throw new Error('Backup not found')
      }

      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backhub_backup_${backupId}.json`
      a.click()
      URL.revokeObjectURL(url)

      notificationService.success('Sauvegarde exportée')
      logger.info('Backup exported', { backupId })
    } catch (error) {
      logger.error('Failed to export backup', error)
      notificationService.error('Échec de l\'export')
    }
  }

  async importBackup(file) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!data.timestamp || !data.version) {
        throw new Error('Invalid backup file')
      }

      const backupId = `imported_${Date.now()}`
      const backupKey = `${this.backupPrefix}${backupId}`
      await storageService.save(backupKey, data)

      const backups = await this.getBackupList()
      backups.push({
        id: backupId,
        timestamp: data.timestamp,
        size: text.length,
        imported: true
      })
      await storageService.save('backhub-backups', backups)

      notificationService.success('Sauvegarde importée avec succès')
      logger.info('Backup imported', { backupId })

      return backupId
    } catch (error) {
      logger.error('Failed to import backup', error)
      notificationService.error('Échec de l\'import: ' + error.message)
      throw error
    }
  }

  startAutoBackup() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval)
    }

    this.backupInterval = setInterval(() => {
      this.createBackup(true).catch(err => logger.error('Auto-backup failed', err))
    }, this.backupIntervalMs)

    logger.info('Auto-backup started', { interval: this.backupIntervalMs })
  }

  stopAutoBackup() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval)
      this.backupInterval = null
      logger.info('Auto-backup stopped')
    }
  }
}

export const backupService = new BackupService()
