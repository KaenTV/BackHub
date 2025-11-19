
import { logger } from '../utils/logger.js'

class UndoRedoService {
  constructor(maxHistory = 50) {
    this.history = []
    this.currentIndex = -1
    this.maxHistory = maxHistory
    this.isExecuting = false
  }

  addAction(action) {
    if (this.isExecuting) return

    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1)
    }

    this.history.push(action)
    this.currentIndex++

    if (this.history.length > this.maxHistory) {
      this.history.shift()
      this.currentIndex--
    }

    logger.info('Action added to history', { type: action.type, index: this.currentIndex })
  }

  undo() {
    if (!this.canUndo()) {
      return false
    }

    this.isExecuting = true
    try {
      const action = this.history[this.currentIndex]
      if (action.undo && typeof action.undo === 'function') {
        action.undo()
        this.currentIndex--
        logger.info('Action undone', { type: action.type, index: this.currentIndex })
        return true
      }
    } catch (error) {
      logger.error('Failed to undo action', error)
      return false
    } finally {
      this.isExecuting = false
    }

    return false
  }

  redo() {
    if (!this.canRedo()) {
      return false
    }

    this.isExecuting = true
    try {
      this.currentIndex++
      const action = this.history[this.currentIndex]
      if (action.redo && typeof action.redo === 'function') {
        action.redo()
        logger.info('Action redone', { type: action.type, index: this.currentIndex })
        return true
      }
    } catch (error) {
      logger.error('Failed to redo action', error)
      return false
    } finally {
      this.isExecuting = false
    }

    return false
  }

  canUndo() {
    return this.currentIndex >= 0
  }

  canRedo() {
    return this.currentIndex < this.history.length - 1
  }

  clear() {
    this.history = []
    this.currentIndex = -1
    logger.info('Undo/Redo history cleared')
  }

  getInfo() {
    return {
      total: this.history.length,
      current: this.currentIndex + 1,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    }
  }
}

export const undoRedoService = new UndoRedoService()
