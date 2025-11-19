
import { logger } from '../utils/logger.js'

class StorageService {
  constructor() {
    this.useSQLite = false
    this.init()
  }

  async init() {
    if (window.electronAPI?.dbQuery) {
      try {
        const result = await window.electronAPI.dbQuery('SELECT 1 as test')
        if (result) {
          this.useSQLite = true
          logger.info('Storage service initialized with SQLite')
          return
        }
      } catch (error) {
        logger.warn('SQLite not available, falling back to localStorage', error)
      }
    }
    this.useSQLite = false
    logger.info('Storage service initialized with localStorage')
  }

  async save(key, data) {
    const jsonData = JSON.stringify(data)
    try {
      if (this.useSQLite && window.electronAPI?.dbExec && key === 'backhub-history') {
        await window.electronAPI.dbExec(
          'INSERT OR REPLACE INTO history (id, date, user, items, totalBuy, totalSell, margin) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [data.id || Date.now().toString(), data.date, data.user, jsonData, data.totalBuy, data.totalSell, data.margin]
        )
        return
      }
      localStorage.setItem(key, jsonData)
    } catch (error) {
      logger.error(`Failed to save data for key: ${key}`, error)
      localStorage.setItem(key, jsonData)
    }
  }

  async load(key, defaultValue = null) {
    try {
      if (this.useSQLite && window.electronAPI?.dbQuery && key === 'backhub-history') {
        const results = await window.electronAPI.dbQuery('SELECT * FROM history ORDER BY date DESC')
        if (results?.length > 0) {
          return results.map(row => ({
            id: row.id,
            date: row.date,
            user: row.user,
            items: JSON.parse(row.items),
            totalBuy: row.totalBuy,
            totalSell: row.totalSell,
            margin: row.margin
          }))
        }
        return defaultValue
      }
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : defaultValue
    } catch (error) {
      logger.error(`Failed to load data for key: ${key}`, error)
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : defaultValue
    }
  }

  remove(key) {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      logger.error(`Failed to remove data for key: ${key}`, error)
    }
  }

  clear() {
    try {
      localStorage.clear()
    } catch (error) {
      logger.error('Failed to clear storage', error)
    }
  }
}

export const storageService = new StorageService()
