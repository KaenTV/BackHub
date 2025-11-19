import { logger } from '../utils/logger.js'
import { escapeHtml } from '../utils/format.js'

class NotificationService {
  constructor() {
    this.container = null
    this.notifications = []
    this.maxNotifications = 5
    this.init()
  }

  init() {
    if (!document.body) {
      console.warn('document.body non disponible, attente du DOM...')
      setTimeout(() => this.init(), 100)
      return
    }

    this.container = document.createElement('div')
    this.container.id = 'notification-container'
    this.container.className = 'notification-container'
    document.body.appendChild(this.container)
    console.log('NotificationService initialisé, container créé:', this.container)
  }

  show(message, type = 'info', duration = 3000, customId = null) {
    console.log('NotificationService.show appelé:', { message, type, duration, customId })
    
    if (!this.container) {
      console.warn('Container non initialisé, réinitialisation...')
      this.init()
    }

    if (!this.container) {
      console.error('Impossible de créer le container de notifications')
      return
    }

    if (customId) {
      const existing = this.notifications.find(n => n.customId === customId)
      if (existing) {
        this.remove(existing.id)
      }
    }

    const notification = {
      id: Date.now() + Math.random(),
      customId: customId,
      message,
      type,
      duration,
      timestamp: new Date()
    }

    this.notifications.push(notification)
    this.render(notification)

    if (duration > 0) {
      setTimeout(() => {
        this.remove(notification.id)
      }, duration)
    }

    if (this.notifications.length > this.maxNotifications) {
      const oldest = this.notifications.shift()
      this.remove(oldest.id)
    }

    logger.info(`Notification: ${message}`, { type, customId })
    return notification.id
  }

  removeById(customId) {
    const notification = this.notifications.find(n => n.customId === customId)
    if (notification) {
      this.remove(notification.id)
      return true
    }
    return false
  }

  render(notification) {
    console.log('Rendu de la notification:', notification)
    
    if (!this.container) {
      console.error('Container non disponible pour le rendu')
      return
    }

    const element = document.createElement('div')
    element.className = `notification notification-${notification.type}`
    element.dataset.id = notification.id

    const icon = this.getIcon(notification.type)
    element.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-message">${escapeHtml(notification.message)}</div>
      </div>
      <button class="notification-close" onclick="this.closest('.notification').remove()">×</button>
    `

    this.container.appendChild(element)
    console.log('Élément de notification ajouté au DOM:', element)

    requestAnimationFrame(() => {
      element.classList.add('show')
      console.log('Classe "show" ajoutée à la notification')
    })
  }

  remove(id) {
    const element = this.container.querySelector(`[data-id="${id}"]`)
    if (element) {
      element.classList.add('hide')
      setTimeout(() => {
        element.remove()
      }, 300)
    }
    this.notifications = this.notifications.filter(n => n.id !== id)
  }

  getIcon(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    }
    return icons[type] || icons.info
  }


  success(message, duration = 3000) {
    this.show(message, 'success', duration)
  }

  error(message, duration = 5000) {
    this.show(message, 'error', duration)
  }

  warning(message, duration = 4000) {
    this.show(message, 'warning', duration)
  }

  info(message, duration = 3000) {
    this.show(message, 'info', duration)
  }

  clear() {
    this.notifications.forEach(n => this.remove(n.id))
  }

  showWithActions(message, type = 'info', actions = [], duration = 0) {
    if (!this.container) {
      this.init()
    }

    if (!this.container) {
      console.error('Impossible de créer le container de notifications')
      return null
    }

    const notification = {
      id: Date.now() + Math.random(),
      message,
      type,
      duration: 0,
      actions,
      timestamp: new Date()
    }

    this.notifications.push(notification)
    const element = this.renderWithActions(notification)

    if (this.notifications.length > this.maxNotifications) {
      const oldest = this.notifications.shift()
      this.remove(oldest.id)
    }

    logger.info(`Notification avec actions: ${message}`, { type, actions: actions.length })
    return notification.id
  }

  renderWithActions(notification) {
    if (!this.container) {
      console.error('Container non disponible pour le rendu')
      return null
    }

    const element = document.createElement('div')
    element.className = `notification notification-${notification.type} notification-with-actions`
    element.dataset.id = notification.id

    const icon = this.getIcon(notification.type)
    const actionsHtml = notification.actions.map((action, index) => 
      `<button class="notification-action notification-action-${action.type || 'default'}" data-action-id="${index}">${escapeHtml(action.label)}</button>`
    ).join('')

    element.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-message">${escapeHtml(notification.message)}</div>
        <div class="notification-actions">${actionsHtml}</div>
      </div>
      <button class="notification-close" onclick="this.closest('.notification').remove()">×</button>
    `

    this.container.appendChild(element)

    notification.actions.forEach((action, index) => {
      const button = element.querySelector(`[data-action-id="${index}"]`)
      if (button && action.callback) {
        button.addEventListener('click', () => {
          action.callback()
          this.remove(notification.id)
        })
      }
    })

    requestAnimationFrame(() => {
      element.classList.add('show')
    })

    return element
  }
}

export const notificationService = new NotificationService()
