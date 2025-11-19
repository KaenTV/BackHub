
class Logger {
  constructor() {
    this.logs = []
    this.maxLogs = 1000
    this.enabled = true
  }

  error(message, error = null, context = {}, showNotification = false) {
    const logEntry = {
      level: 'error',
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : null,
      context,
      timestamp: new Date().toISOString()
    }

    this.logs.push(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }



    if (showNotification && window.app && window.app.showNotification) {
      window.app.showNotification(message, 'error')
    }
  }

  warn(message, context = {}) {
    const logEntry = {
      level: 'warn',
      message,
      context,
      timestamp: new Date().toISOString()
    }

    this.logs.push(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }

  }

  info(message, context = {}) {
    const logEntry = {
      level: 'info',
      message,
      context,
      timestamp: new Date().toISOString()
    }

    this.logs.push(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }

  }

  getLogs() {
    return this.logs
  }

  clear() {
    this.logs = []
  }

  exportLogs() {
    return JSON.stringify(this.logs, null, 2)
  }
}

export const logger = new Logger()
