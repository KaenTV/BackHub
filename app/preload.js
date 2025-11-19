const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  showOverlayNotification: (title, message, type, feedbackType, username, feedbackTitle, feedbackDescription) => ipcRenderer.invoke('show-overlay-notification', { title, message, type, feedbackType, username, feedbackTitle, feedbackDescription }),
  onOverlayShow: (callback) => {
    ipcRenderer.on('show-overlay-notification', (event, data) => {
      callback(data)
    })
  },
  openFeedbackSection: () => ipcRenderer.invoke('open-feedback-section'),
  onOpenFeedbackSection: (callback) => {
    ipcRenderer.on('open-feedback-section', () => {
      callback()
    })
  },
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  dbExec: (sql, params) => ipcRenderer.invoke('db-exec', sql, params),
  fetchHtml: (url) => ipcRenderer.invoke('fetch-html', url),
  
  // APIs de mise à jour
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Écouter les événements de mise à jour
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data))
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data))
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, data) => callback(data))
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, data) => callback(data))
  },
  
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
