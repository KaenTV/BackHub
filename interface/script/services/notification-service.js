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

    this.container = document.createElement('div')
    this.container.id = 'notification-container'
    this.container.className = 'notification-container'
    document.body.appendChild(this.container)
  }

  show(message, type = 'info', duration = 3000) {
    const notification = {
      id: Date.now() + Math.random(),
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

    logger.info(`Notification: ${message}`, { type })
  }

  render(notification) {
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

    requestAnimationFrame(() => {
      element.classList.add('show')
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
}

export const notificationService = new NotificationService()
