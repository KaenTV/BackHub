
import { notificationService } from '../services/notification-service.js'
import { logger } from '../utils/logger.js'

class DragDropManager {
  constructor() {
    this.draggedElement = null
    this.dropZones = new Set()
    this.init()
  }

  init() {

    this.makeItemsDraggable()

    this.setupFileDrop()
  }

  makeItemsDraggable() {

    document.addEventListener('dragstart', (e) => {
      if (e.target.closest('tr') && (e.target.closest('.drug-table') || e.target.closest('.items-table'))) {
        const row = e.target.closest('tr')
        row.classList.add('dragging')
        this.draggedElement = row
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/html', row.outerHTML)
      }
    })

    document.addEventListener('dragend', (e) => {
      if (this.draggedElement) {
        this.draggedElement.classList.remove('dragging')
        this.draggedElement = null
      }
    })

    document.addEventListener('dragover', (e) => {
      if (this.draggedElement) {
        e.preventDefault()
        const afterElement = this.getDragAfterElement(e.target.closest('tbody'), e.clientY)
        const tbody = e.target.closest('tbody')
        if (tbody && afterElement == null) {
          tbody.appendChild(this.draggedElement)
        } else if (afterElement) {
          tbody.insertBefore(this.draggedElement, afterElement)
        }
      }
    })

    document.addEventListener('drop', (e) => {
      e.preventDefault()
      if (this.draggedElement) {
        this.draggedElement.classList.remove('dragging')
        this.draggedElement = null
        notificationService.info('Ordre des items modifié')
      }
    })
  }

  getDragAfterElement(container, y) {
    if (!container) return null

    const draggableElements = [...container.querySelectorAll('tr:not(.dragging)')]

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect()
      const offset = y - box.top - box.height / 2

      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child }
      } else {
        return closest
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element
  }

  setupFileDrop() {
    const dropZone = document.body

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.add('drag-over')
    })

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('drag-over')
    })

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('drag-over')

      // File drop désactivé (système de backup retiré)
    })
  }
}

export const dragDropManager = new DragDropManager()
