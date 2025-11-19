const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron/main')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const https = require('node:https')
const { URL } = require('node:url')

let mainWindow
let overlayWindow = null
let tray = null
let fetchHtmlView = null
let fetchHtmlInProgress = false
let fetchHtmlQueue = []


autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.allowPrerelease = true

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'KaenTV',
  repo: 'BackHub',
  private: false
})

autoUpdater.channel = 'latest'

autoUpdater.on('checking-for-update', () => {
  console.log('Vérification des mises à jour...')
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('Envoi de la notification de vérification...')
    mainWindow.webContents.send('update-status', { status: 'checking', message: 'Vérification des mises à jour...' })
    mainWindow.webContents.send('app-notification', { 
      message: 'Recherche de nouvelles versions disponibles...', 
      type: 'info', 
      duration: 0,
      id: 'update-checking'
    })
    console.log('Notification envoyée au renderer')
  } else {
    console.warn('MainWindow non disponible pour envoyer la notification')
  }
})

autoUpdater.on('update-available', (info) => {
  console.log('Mise à jour disponible:', info.version)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'available', message: 'Mise à jour disponible' })
    mainWindow.webContents.send('remove-notification', { id: 'update-checking' })
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
    mainWindow.webContents.send('update-available-notification', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  }
})

autoUpdater.on('update-not-available', (info) => {
  console.log('Aucune mise à jour disponible')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'up-to-date', message: 'Vous utilisez la dernière version' })
    mainWindow.webContents.send('remove-notification', { id: 'update-checking' })
    mainWindow.webContents.send('app-notification', { message: 'Vous utilisez déjà la dernière version disponible', type: 'info', duration: 3000 })
  }
})

autoUpdater.on('error', (err) => {
  console.error('Erreur lors de la vérification des mises à jour:', err)
  console.error('Détails de l\'erreur:', {
    message: err.message,
    stack: err.stack,
    code: err.code
  })
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'error', message: 'Erreur lors de la vérification des mises à jour' })
    mainWindow.webContents.send('remove-notification', { id: 'update-checking' })
    const errorMessage = err.message || err.toString() || 'Erreur inconnue'
    mainWindow.webContents.send('app-notification', { 
      message: `Erreur lors de la vérification des mises à jour: ${errorMessage}`, 
      type: 'error', 
      duration: 5000 
    })
  }
})

autoUpdater.on('download-progress', (progressObj) => {
  const message = `Téléchargement: ${Math.round(progressObj.percent)}%`
  console.log(message)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total
    })
    mainWindow.webContents.send('app-notification', {
      message: `Téléchargement en cours: ${Math.round(progressObj.percent)}%`,
      type: 'info',
      duration: 0
    })
  }
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('Mise à jour téléchargée:', info.version)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate
    })
    mainWindow.webContents.send('app-notification', { message: `Mise à jour ${info.version} téléchargée. Elle sera installée au redémarrage.`, type: 'success' })
  }
})

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  let trayIcon

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
  } catch (error) {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir BackHub',
      click: () => mainWindow?.show()
    },
    {
      label: 'Masquer',
      click: () => mainWindow?.hide()
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('BackHub - Calculateur de Marge')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

function showNotification(title, body) {

  if (process.platform === 'win32' || process.platform === 'darwin') {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: title,
        body: body,
        silent: false
      })

      notification.show()


      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      })
    } else {

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-notification', { title, body })
      }
    }
  }
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      sandbox: true,
      partition: 'persist:main',
      backgroundThrottling: true,
      v8CacheOptions: 'code',
      enableWebSQL: false,
      enableRemoteModule: false,
      webSecurity: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'interface', 'home.html'))
  
  // Ouvrir les DevTools automatiquement pour le débogage
  mainWindow.webContents.openDevTools()


  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'j') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault()
      return
    }

    if (input.control && input.key.toLowerCase() === 'u') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'k') {
      event.preventDefault()
      return
    }

    if (input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      return
    }

    if (input.control && input.key.toLowerCase() === 'shift+r') {
      event.preventDefault()
      return
    }
  })

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools()
  })

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    } else {

      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy()
      }

      if (fetchHtmlView && !fetchHtmlView.webContents.isDestroyed()) {
        mainWindow.removeBrowserView(fetchHtmlView)
        fetchHtmlView.webContents.destroy()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    if (mainWindow) {
      app.isQuitting = true

      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy()
      }

      if (fetchHtmlView && !fetchHtmlView.webContents.isDestroyed()) {
        mainWindow.removeBrowserView(fetchHtmlView)
        fetchHtmlView.webContents.destroy()
      }
      mainWindow.close()
    }
  })

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow?.isMaximized() ?? false
  })

  ipcMain.handle('db-query', () => null)
  ipcMain.handle('db-exec', () => false)

  ipcMain.handle('show-notification', (event, { title, body }) => {
    showNotification(title, body)
  })

  ipcMain.handle('show-overlay-notification', (event, { title, message, type, feedbackType, username, feedbackTitle, feedbackDescription }) => {
    if (type === 'feedback') {
      showFeedbackOverlayNotification({ feedbackType, username, title: feedbackTitle, description: feedbackDescription })
    } else {
      showOverlayNotification(title, message)
    }
  })

  ipcMain.handle('open-feedback-section', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()

      mainWindow.webContents.send('open-feedback-section')
    }
  })

  ipcMain.handle('hide-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide()
      if (process.platform === 'win32') {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true })
      }
    }
  })


  ipcMain.handle('check-for-updates', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      console.error('Erreur lors de la vérification des mises à jour:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      console.error('Erreur lors du téléchargement de la mise à jour:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('install-update', async () => {
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })
}

function createOverlayWindow() {

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  overlayWindow = new BrowserWindow({
    width: 450,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,

    type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true,
        backgroundThrottling: false,
        sandbox: true,
        partition: 'persist:overlay',
        v8CacheOptions: 'code',
        enableWebSQL: false,
        enableRemoteModule: false,
        webSecurity: true
      }
  })

  overlayWindow.loadFile(path.join(__dirname, '..', 'interface', 'overlay.html'))


  overlayWindow.webContents.on('context-menu', (event) => {
    event.preventDefault()
  })

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'j') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault()
      return
    }

    if (input.control && input.key.toLowerCase() === 'u') {
      event.preventDefault()
      return
    }

    if (input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      return
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      return
    }
  })

  overlayWindow.webContents.on('devtools-opened', () => {
    overlayWindow.webContents.closeDevTools()
  })


  if (process.platform === 'win32') {


    overlayWindow.setIgnoreMouseEvents(true, { forward: true })


    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  } else if (process.platform === 'darwin') {

    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {

    overlayWindow.setVisibleOnAllWorkspaces(true)
  }


  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  overlayWindow.setPosition(width - 470, 20)


  overlayWindow.hide()


  overlayWindow.on('close', (event) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      event.preventDefault()
      overlayWindow.hide()
    }
  })


  overlayWindow.on('show', () => {
    if (process.platform === 'win32' && overlayWindow && !overlayWindow.isDestroyed()) {

      overlayWindow.setIgnoreMouseEvents(false)
    }
  })

  overlayWindow.on('hide', () => {
    if (process.platform === 'win32' && overlayWindow && !overlayWindow.isDestroyed()) {

      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })


  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  return overlayWindow
}

function showOverlayNotification(title, message) {

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow()
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {

    if (process.platform === 'win32') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)

      overlayWindow.setIgnoreMouseEvents(false)
    }

    overlayWindow.webContents.send('show-overlay-notification', { title, message, type: 'vote' })
    overlayWindow.show()


    overlayWindow.focus()
    overlayWindow.moveTop()


    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide()

        if (process.platform === 'win32') {
          overlayWindow.setIgnoreMouseEvents(true, { forward: true })
        }
      }
    }, 8000)
  }
}

function showFeedbackOverlayNotification({ feedbackType, username, title, description }) {

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow()
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {

    overlayWindow.setSize(450, 240)


    if (process.platform === 'win32') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)

      overlayWindow.setIgnoreMouseEvents(false)
    }

    overlayWindow.webContents.send('show-overlay-notification', {
      type: 'feedback',
      feedbackType,
      username,
      title,
      description
    })
    overlayWindow.show()


    overlayWindow.focus()
    overlayWindow.moveTop()


    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide()

        if (process.platform === 'win32') {
          overlayWindow.setIgnoreMouseEvents(true, { forward: true })
        }

        overlayWindow.setSize(450, 120)
      }
    }, 10000)
  }
}



function getFetchHtmlView() {

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }


  if (!fetchHtmlView || fetchHtmlView.webContents.isDestroyed()) {
    fetchHtmlView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true,
        backgroundThrottling: true,
        sandbox: true,
        partition: 'persist:fetch',
        v8CacheOptions: 'code',
        enableWebSQL: false,
        enableRemoteModule: false,
        webSecurity: true
      }
    })

    mainWindow.setBrowserView(fetchHtmlView)

    fetchHtmlView.setBounds({ x: -10000, y: -10000, width: 1, height: 1 })


    fetchHtmlView.webContents.on('context-menu', (event) => {
      event.preventDefault()
    })

    fetchHtmlView.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' ||
          (input.control && input.shift && input.key.toLowerCase() === 'i') ||
          (input.control && input.shift && input.key.toLowerCase() === 'j') ||
          (input.control && input.shift && input.key.toLowerCase() === 'c') ||
          (input.control && input.key.toLowerCase() === 'u') ||
          (input.control && input.key.toLowerCase() === 'r') ||
          (input.control && input.shift && input.key.toLowerCase() === 'r')) {
        event.preventDefault()
      }
    })

    fetchHtmlView.webContents.on('devtools-opened', () => {
      fetchHtmlView.webContents.closeDevTools()
    })
  }

  return fetchHtmlView
}



ipcMain.handle('fetch-html', async (event, url) => {

  const allowedDomains = ['top-serveurs.net']

  try {
    const urlObj = new URL(url)


    if (!allowedDomains.includes(urlObj.hostname)) {
      throw new Error(`Domain ${urlObj.hostname} is not allowed`)
    }


    if (urlObj.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed')
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid URL format')
    }
    throw error
  }


  return new Promise((resolve, reject) => {

    fetchHtmlQueue.push({ url, resolve, reject })


    processFetchHtmlQueue()
  })
})


function processFetchHtmlQueue() {

  if (fetchHtmlInProgress || fetchHtmlQueue.length === 0) {
    return
  }


  const { url, resolve, reject } = fetchHtmlQueue.shift()
  fetchHtmlInProgress = true

  try {

    const hiddenView = getFetchHtmlView()


    hiddenView.webContents.removeAllListeners('did-finish-load')
    hiddenView.webContents.removeAllListeners('did-fail-load')

    let timeoutId
    let resolved = false

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      fetchHtmlInProgress = false

      if (fetchHtmlQueue.length > 0) {
        setTimeout(() => processFetchHtmlQueue(), 100)
      }
    }


    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error('Timeout: Page took too long to load'))
      }
    }, 15000)


    const finishHandler = () => {


      setTimeout(() => {
        if (resolved) return


        hiddenView.webContents.executeJavaScript(`
          (function() {
            const result = { success: true };

            // Extraire le cooldown
            const countdown = document.getElementById('digitalCountdown');
            if (!countdown) {
              result.available = true;
              result.remainingMs = 0;
            } else {
              const hoursSpan = countdown.querySelector('span[data-unit="hours"]');
              const minutesSpan = countdown.querySelector('span[data-unit="minutes"]');
              const secondsSpan = countdown.querySelector('span[data-unit="seconds"]');

              if (hoursSpan && minutesSpan && secondsSpan) {
                const hours = parseInt(hoursSpan.textContent.trim()) || 0;
                const minutes = parseInt(minutesSpan.textContent.trim()) || 0;
                const seconds = parseInt(secondsSpan.textContent.trim()) || 0;

                if (hours === 0 && minutes === 0 && seconds === 0) {
                  result.available = true;
                  result.remainingMs = 0;
                } else {
                  result.available = false;
                  result.remainingMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
                  result.remainingTime = { hours, minutes, seconds };
                }
              } else {
                const countdownText = countdown.textContent.trim();
                if (countdownText === '' || countdownText === '00:00:00') {
                  result.available = true;
                  result.remainingMs = 0;
                } else {
                  result.available = false;
                  result.remainingMs = 3600000;
                }
              }
            }

            // Extraire les votes du mois - méthode complète et exhaustive
            let voteCount = null;

            // Méthode 1: Chercher dans tous les éléments qui contiennent "vote" et "mois"
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const text = (el.textContent || el.innerText || '').trim();
              const lowerText = text.toLowerCase();

              // Chercher spécifiquement "X votes ce mois" ou variations
              if (lowerText.includes('vote') && (lowerText.includes('mois') || lowerText.includes('month'))) {
                // Patterns pour extraire le nombre
                const patterns = [
                  /([\\d,]+)[\\s]*votes?[\\s]*(?:ce[\\s]+mois|mois)/i,
                  /(?:ce[\\s]+mois|mois)[\\s:]*([\\d,]+)[\\s]*votes?/i,
                  /votes?[\\s]*(?:ce[\\s]+mois|mois)[\\s:]*([\\d,]+)/i,
                  /([\\d,]+)[\\s]*votes?/i
                ];

                for (const pattern of patterns) {
                  const match = text.match(pattern);
                  if (match && match[1]) {
                    const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                    if (num > 0 && num < 1000000) {
                      voteCount = num;
                      break;
                    }
                  }
                }
                if (voteCount) break;
              }
            }

            // Méthode 2: Analyser le texte complet de la page avec des patterns très larges
            if (!voteCount) {
              const bodyText = document.body.innerText || document.body.textContent || '';
              // Patterns très larges pour trouver les votes
              const votePatterns = [
                /([\\d,]+)[\\s]*votes?[\\s]*(?:ce[\\s]+mois|mois|ce[\\s]+mois[\\s]+ci)/i,
                /(?:ce[\\s]+mois|mois|ce[\\s]+mois[\\s]+ci)[\\s:]*([\\d,]+)[\\s]*votes?/i,
                /votes?[\\s]*(?:ce[\\s]+mois|mois|ce[\\s]+mois[\\s]+ci)[\\s:]*([\\d,]+)/i,
                /([\\d,]+)[\\s]*votes?[\\s]*(?:en[\\s]+)?(?:ce[\\s]+mois|mois)/i,
                /(?:votes?[\\s]+du[\\s]+mois|votes?[\\s]+mois)[\\s:]*([\\d,]+)/i,
                /([\\d,]+)[\\s]*votes?[\\s]*(?:du[\\s]+mois|mois)/i
              ];

              for (const pattern of votePatterns) {
                const matches = bodyText.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
                for (const match of matches) {
                  if (match && match[1]) {
                    const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                    if (num > 0 && num < 1000000) {
                      voteCount = num;
                      break;
                    }
                  }
                }
                if (voteCount) break;
              }
            }

            // Méthode 3: Chercher dans les tableaux/listes avec contexte
            if (!voteCount) {
              const tables = document.querySelectorAll('table, .table, ul, ol, dl, .list, .stats-list');
              for (const table of tables) {
                const rows = table.querySelectorAll('tr, li, dt, dd, .stat-item, .info-item, .item, div[class*="stat"], div[class*="info"]');
                for (const row of rows) {
                  const text = (row.textContent || row.innerText || '').trim();
                  const lowerText = text.toLowerCase();

                  if (lowerText.includes('vote') && (lowerText.includes('mois') || lowerText.includes('month'))) {
                    const match = text.match(/([\\d,]+)/);
                    if (match) {
                      const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                      if (num > 0 && num < 1000000) {
                        voteCount = num;
                        break;
                      }
                    }
                  }
                }
                if (voteCount) break;
              }
            }

            // Méthode 4: Chercher dans les éléments avec des attributs data ou des classes/id spécifiques
            if (!voteCount) {
              const dataElements = document.querySelectorAll('[data-votes], [data-vote-count], [data-votes-month], [class*="vote"], [id*="vote"], [class*="stat"], [id*="stat"]');
              for (const el of dataElements) {
                // D'abord essayer les attributs data
                const dataValue = el.getAttribute('data-votes') || el.getAttribute('data-vote-count') || el.getAttribute('data-votes-month');
                if (dataValue) {
                  const num = parseInt(dataValue.replace(/[,\\s]/g, ''));
                  if (num > 0 && num < 1000000) {
                    voteCount = num;
                    break;
                  }
                }
                // Sinon chercher dans le texte si le contexte est bon
                const text = (el.textContent || el.innerText || '').trim();
                const lowerText = text.toLowerCase();
                if (lowerText.includes('vote') && (lowerText.includes('mois') || lowerText.includes('month'))) {
                  const match = text.match(/([\\d,]+)/);
                  if (match) {
                    const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                    if (num > 0 && num < 1000000) {
                      voteCount = num;
                      break;
                    }
                  }
                }
              }
            }

            result.voteCount = voteCount;

            // Extraire le classement - méthode complète et exhaustive
            let ranking = null;

            // Méthode 1: Chercher dans tous les éléments qui contiennent "classement", "rank" ou "position"
            for (const el of allElements) {
              const text = (el.textContent || el.innerText || '').trim();
              const lowerText = text.toLowerCase();

              // Chercher spécifiquement le classement
              if (lowerText.includes('classement') || lowerText.includes('rank') || lowerText.includes('position') || lowerText.includes('top serveur')) {
                // Patterns pour extraire le nombre
                const patterns = [
                  /#([\\d]+)/,
                  /classement[\\s:]*#?([\\d]+)/i,
                  /rank[\\s:]*#?([\\d]+)/i,
                  /position[\\s:]*#?([\\d]+)/i,
                  /([\\d]+)[\\s]*(?:sur[\\s]+)?top[\\s]+serveurs?/i,
                  /top[\\s]+([\\d]+)/i
                ];

                for (const pattern of patterns) {
                  const match = text.match(pattern);
                  if (match && match[1]) {
                    const num = parseInt(match[1]);
                    if (num > 0 && num < 10000) {
                      ranking = num;
                      break;
                    }
                  }
                }
                if (ranking) break;
              }
            }

            // Méthode 2: Analyser le texte complet de la page
            if (!ranking) {
              const bodyText = document.body.innerText || document.body.textContent || '';
              // Patterns très larges pour trouver le classement
              const rankPatterns = [
                /classement[\\s:]*#?([\\d]+)/i,
                /rank[\\s:]*#?([\\d]+)/i,
                /position[\\s:]*#?([\\d]+)/i,
                /#([\\d]+)[\\s]*(?:classement|rank|position|sur[\\s]+top)/i,
                /(?:classement|rank|position)[\\s]+#?([\\d]+)/i,
                /top[\\s]+([\\d]+)/i,
                /([\\d]+)[\\s]+(?:sur[\\s]+)?top[\\s]+serveurs?/i,
                /([\\d]+)[\\s]+ème[\\s]+(?:place|position)/i
              ];

              for (const pattern of rankPatterns) {
                const matches = bodyText.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
                for (const match of matches) {
                  if (match && match[1]) {
                    const num = parseInt(match[1]);
                    if (num > 0 && num < 10000) {
                      ranking = num;
                      break;
                    }
                  }
                }
                if (ranking) break;
              }
            }

            // Méthode 3: Chercher dans les tableaux/listes avec contexte
            if (!ranking) {
              const tables = document.querySelectorAll('table, .table, ul, ol, dl, .list');
              for (const table of tables) {
                const rows = table.querySelectorAll('tr, li, dt, dd, .item, .stat-item, div[class*="rank"], div[class*="position"]');
                for (const row of rows) {
                  const text = (row.textContent || row.innerText || '').trim();
                  const lowerText = text.toLowerCase();

                  if (lowerText.includes('classement') || lowerText.includes('rank') || lowerText.includes('position') || lowerText.includes('top')) {
                    const match = text.match(/#?([\\d]+)/);
                    if (match) {
                      const num = parseInt(match[1]);
                      if (num > 0 && num < 10000) {
                        ranking = num;
                        break;
                      }
                    }
                  }
                }
                if (ranking) break;
              }
            }

            // Méthode 4: Chercher dans les badges, tags ou éléments de statut
            if (!ranking) {
              const badges = document.querySelectorAll('.badge, .tag, .label, [class*="badge"], [class*="tag"], .medal, .trophy, [class*="rank"], [id*="rank"]');
              for (const badge of badges) {
                const text = badge.textContent.trim();
                const match = text.match(/#?([\\d]+)/);
                if (match) {
                  const num = parseInt(match[1]);
                  if (num > 0 && num < 10000) {
                    ranking = num;
                    break;
                  }
                }
              }
            }

            // Méthode 5: Chercher dans les attributs data
            if (!ranking) {
              const dataElements = document.querySelectorAll('[data-rank], [data-position], [data-ranking], [class*="rank"], [id*="rank"]');
              for (const el of dataElements) {
                const dataValue = el.getAttribute('data-rank') || el.getAttribute('data-position') || el.getAttribute('data-ranking');
                if (dataValue) {
                  const num = parseInt(dataValue);
                  if (num > 0 && num < 10000) {
                    ranking = num;
                    break;
                  }
                }
              }
            }

            result.ranking = ranking;

            // Si on n'a pas trouvé les données, essayer une approche plus agressive
            // en analysant le HTML source et tous les éléments
            if (!voteCount || !ranking) {
              // Récupérer le HTML source complet
              const htmlSource = document.documentElement.outerHTML || document.documentElement.innerHTML || '';

              // Chercher dans le HTML source avec des patterns très larges
              if (!voteCount) {
                // Patterns pour trouver les votes dans le HTML
                const htmlVotePatterns = [
                  /(?:votes?[\\s]+ce[\\s]+mois|ce[\\s]+mois[\\s]+votes?)[^>]*>([^<]*<[^>]*>)*([\\d,]+)/i,
                  /<[^>]*(?:vote|votes)[^>]*>([^<]*<[^>]*>)*([\\d,]+)/i,
                  /([\\d,]+)[^<]*(?:votes?[\\s]+ce[\\s]+mois|ce[\\s]+mois[\\s]+votes?)/i,
                  /mois[^>]*>([^<]*<[^>]*>)*([\\d,]+)[^<]*votes?/i
                ];

                for (const pattern of htmlVotePatterns) {
                  const match = htmlSource.match(pattern);
                  if (match) {
                    // Extraire le nombre de la correspondance
                    const numMatch = (match[0] || '').match(/([\\d,]+)/);
                    if (numMatch) {
                      const num = parseInt(numMatch[1].replace(/[,\\s]/g, ''));
                      if (num > 0 && num < 1000000) {
                        voteCount = num;
                        break;
                      }
                    }
                  }
                }
              }

              if (!ranking) {
                // Patterns pour trouver le classement dans le HTML
                const htmlRankPatterns = [
                  /(?:classement|rank|position)[^>]*>([^<]*<[^>]*>)*#?([\\d]+)/i,
                  /#([\\d]+)[^<]*(?:classement|rank|position)/i,
                  /<[^>]*(?:rank|ranking|position)[^>]*>([^<]*<[^>]*>)*#?([\\d]+)/i
                ];

                for (const pattern of htmlRankPatterns) {
                  const match = htmlSource.match(pattern);
                  if (match) {
                    // Extraire le nombre de la correspondance
                    const numMatch = (match[0] || '').match(/#?([\\d]+)/);
                    if (numMatch) {
                      const num = parseInt(numMatch[1]);
                      if (num > 0 && num < 10000) {
                        ranking = num;
                        break;
                      }
                    }
                  }
                }
              }

              // Si toujours pas trouvé, parcourir tous les éléments textuels
              if (!voteCount || !ranking) {
                const textNodes = [];
                const walker = document.createTreeWalker(
                  document.body,
                  NodeFilter.SHOW_TEXT,
                  null,
                  false
                );

                let node;
                while (node = walker.nextNode()) {
                  const text = node.textContent.trim();
                  if (text && text.length > 0 && text.length < 100) {
                    textNodes.push({ text, parent: node.parentElement });
                  }
                }

                // Chercher dans les nœuds texte
                for (const { text, parent } of textNodes) {
                  const parentText = (parent?.textContent || '').toLowerCase();

                  // Chercher les votes
                  if (!voteCount) {
                    if ((text.match(/^[\\d,]+$/) && parentText.includes('vote') && parentText.includes('mois')) ||
                        text.match(/([\\d,]+)[\\s]*votes?[\\s]*(?:ce[\\s]+mois|mois)/i) ||
                        text.match(/(?:ce[\\s]+mois|mois)[\\s:]*([\\d,]+)[\\s]*votes?/i)) {
                      const numMatch = text.match(/([\\d,]+)/);
                      if (numMatch) {
                        const num = parseInt(numMatch[1].replace(/[,\\s]/g, ''));
                        if (num > 0 && num < 1000000) {
                          voteCount = num;
                        }
                      }
                    }
                  }

                  // Chercher le classement
                  if (!ranking) {
                    if (text.match(/^#?[\\d]+$/) && (parentText.includes('classement') || parentText.includes('rank'))) {
                      const numMatch = text.match(/#?([\\d]+)/);
                      if (numMatch) {
                        const num = parseInt(numMatch[1]);
                        if (num > 0 && num < 10000) {
                          ranking = num;
                        }
                      }
                    } else if (text.match(/classement[\\s:]*#?[\\d]+/i) || text.match(/rank[\\s:]*#?[\\d]+/i)) {
                      const numMatch = text.match(/#?([\\d]+)/);
                      if (numMatch) {
                        const num = parseInt(numMatch[1]);
                        if (num > 0 && num < 10000) {
                          ranking = num;
                        }
                      }
                    }
                  }

                  if (voteCount && ranking) break;
                }
              }

              // Mettre à jour les résultats si on a trouvé quelque chose
              if (voteCount) result.voteCount = voteCount;
              if (ranking) result.ranking = ranking;
            }

            // Méthode supplémentaire: Chercher dans les scripts JavaScript de la page
            // Top Serveurs pourrait charger les données via JavaScript
            if (!voteCount || !ranking) {
              const scripts = document.querySelectorAll('script');
              for (const script of scripts) {
                const scriptContent = script.textContent || script.innerHTML || '';

                // Chercher les votes dans les scripts (format JSON ou variables)
                if (!voteCount && scriptContent) {
                  const scriptVotePatterns = [
                    /(?:votes?|voteCount|votesCount)[\\s:=]+([\\d,]+)/i,
                    /"votes?":\\s*([\\d,]+)/i,
                    /'votes?':\\s*([\\d,]+)/i,
                    /votes?[\\s]*=[\\s]*([\\d,]+)/i
                  ];

                  for (const pattern of scriptVotePatterns) {
                    const match = scriptContent.match(pattern);
                    if (match && match[1]) {
                      const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                      if (num > 0 && num < 1000000) {
                        voteCount = num;
                        break;
                      }
                    }
                  }
                }

                // Chercher le classement dans les scripts
                if (!ranking && scriptContent) {
                  const scriptRankPatterns = [
                    /(?:rank|ranking|position)[\\s:=]+([\\d]+)/i,
                    /"rank":\\s*([\\d]+)/i,
                    /'rank':\\s*([\\d]+)/i,
                    /rank[\\s]*=[\\s]*([\\d]+)/i,
                    /position[\\s]*=[\\s]*([\\d]+)/i
                  ];

                  for (const pattern of scriptRankPatterns) {
                    const match = scriptContent.match(pattern);
                    if (match && match[1]) {
                      const num = parseInt(match[1]);
                      if (num > 0 && num < 10000) {
                        ranking = num;
                        break;
                      }
                    }
                  }
                }

                if (voteCount && ranking) break;
              }

              // Mettre à jour les résultats si on a trouvé quelque chose dans les scripts
              if (voteCount) result.voteCount = voteCount;
              if (ranking) result.ranking = ranking;
            }

            // Méthode finale: Si toujours rien, chercher tous les nombres et filtrer par contexte
            if (!voteCount || !ranking) {
              // Récupérer tous les éléments avec du texte
              const allTextElements = [];
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
              );

              let node;
              while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (text && text.length > 0) {
                  const parent = node.parentElement;
                  if (parent) {
                    allTextElements.push({
                      text,
                      parentText: (parent.textContent || '').toLowerCase(),
                      parentTag: parent.tagName,
                      parentClass: parent.className || '',
                      parentId: parent.id || ''
                    });
                  }
                }
              }

              // Chercher les votes dans tous les éléments texte
              if (!voteCount) {
                for (const { text, parentText } of allTextElements) {
                  // Si le texte contient un nombre et le contexte parle de votes/mois
                  if (text.match(/[\\d,]+/) && (parentText.includes('vote') || parentText.includes('mois') || parentText.includes('month'))) {
                    const match = text.match(/([\\d,]+)/);
                    if (match) {
                      const num = parseInt(match[1].replace(/[,\\s]/g, ''));
                      if (num > 0 && num < 1000000 && num !== 589) { // Exclure la valeur par défaut
                        voteCount = num;
                        break;
                      }
                    }
                  }
                }
              }

              // Chercher le classement dans tous les éléments texte
              if (!ranking) {
                for (const { text, parentText } of allTextElements) {
                  // Si le texte contient un nombre et le contexte parle de classement/rank
                  if (text.match(/[\\d]+/) && (parentText.includes('classement') || parentText.includes('rank') || parentText.includes('position') || parentText.includes('top'))) {
                    const match = text.match(/#?([\\d]+)/);
                    if (match) {
                      const num = parseInt(match[1]);
                      if (num > 0 && num < 10000 && num !== 18) { // Exclure la valeur par défaut
                        ranking = num;
                        break;
                      }
                    }
                  }
                }
              }

              // Mettre à jour les résultats si on a trouvé quelque chose
              if (voteCount) result.voteCount = voteCount;
              if (ranking) result.ranking = ranking;
            }

            // Ajouter des informations de débogage pour comprendre ce qui est extrait
            result.extractionInfo = {
              voteCountFound: voteCount !== null,
              rankingFound: ranking !== null,
              voteCountValue: voteCount,
              rankingValue: ranking,
              pageTitle: document.title || '',
              bodyTextSample: (document.body.innerText || document.body.textContent || '').substring(0, 1000),
              url: window.location.href || ''
            };

            return JSON.stringify(result);
          })();
        `).then((result) => {
          if (resolved) return

          resolved = true
          cleanup()

          try {
            const data = JSON.parse(result)
            resolve(data)
          } catch (e) {

            cleanup()
            reject(new Error('Invalid JSON response from page'))
          }
        }).catch((error) => {
          if (resolved) return
          resolved = true
          cleanup()
          reject(error)
        })
      }, 3000)
    }

    hiddenView.webContents.once('did-finish-load', finishHandler)

    const failHandler = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (resolved) return


      if (!isMainFrame) {
        return
      }



      if (errorCode === -3 || errorCode === -21) {

        setTimeout(() => {
          if (!resolved && hiddenView && !hiddenView.webContents.isDestroyed()) {

            try {
              hiddenView.webContents.executeJavaScript('document.readyState').then((readyState) => {
                if (readyState === 'complete' && !resolved) {

                  return
                }
              }).catch(() => {

                if (!resolved) {
                  resolved = true
                  cleanup()
                  reject(new Error(`Failed to load page: ${errorDescription || 'Unknown error'} (${errorCode})`))
                }
              })
            } catch (e) {

              if (!resolved) {
                resolved = true
                cleanup()
                reject(new Error(`Failed to load page: ${errorDescription || 'Unknown error'} (${errorCode})`))
              }
            }
          }
        }, 1000)
        return
      }

      resolved = true
      cleanup()
      reject(new Error(`Failed to load page: ${errorDescription || 'Unknown error'} (${errorCode})`))
    }

    hiddenView.webContents.once('did-fail-load', failHandler)


    if (!url || typeof url !== 'string' || url.trim() === '') {
      cleanup()
      reject(new Error('Invalid URL provided'))
      return
    }


    try {
      hiddenView.webContents.loadURL(url).catch((error) => {
        if (!resolved) {
          resolved = true
          cleanup()
          reject(new Error(`Failed to load URL: ${error.message}`))
        }
      })
    } catch (error) {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error(`Failed to load URL: ${error.message}`))
      }
    }
  } catch (error) {
    fetchHtmlInProgress = false
    reject(error)

    if (fetchHtmlQueue.length > 0) {
      setTimeout(() => processFetchHtmlQueue(), 100)
    }
  }
}

app.on('ready', () => {

  Menu.setApplicationMenu(null)

  createWindow()
  createTray()
  createOverlayWindow()


  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      console.log('Vérification des mises à jour au démarrage...')
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('Envoi de la notification de vérification...')
        mainWindow.webContents.send('app-notification', { 
          message: 'Recherche de nouvelles versions disponibles...', 
          type: 'info', 
          duration: 0,
          id: 'update-checking'
        })
        console.log('Notification envoyée, démarrage de la vérification GitHub...')
        autoUpdater.checkForUpdates().catch(err => {
          console.error('Erreur lors de la vérification initiale des mises à jour:', err)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('remove-notification', { id: 'update-checking' })
            mainWindow.webContents.send('app-notification', { 
              message: `Erreur lors de la vérification: ${err.message || 'Erreur inconnue'}`, 
              type: 'error', 
              duration: 5000 
            })
          }
        })
      }
    }, 5000)
  })


  setInterval(() => {
    if (process.env.NODE_ENV === 'production') {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('Erreur lors de la vérification périodique des mises à jour:', err)
      })
    }
  }, 4 * 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy()
    }

    if (mainWindow && fetchHtmlView && !fetchHtmlView.webContents.isDestroyed()) {
      mainWindow.removeBrowserView(fetchHtmlView)
      fetchHtmlView.webContents.destroy()
    }


    setTimeout(() => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    }, 100)
})

app.on('before-quit', (event) => {
    app.isQuitting = true


    const allWindows = BrowserWindow.getAllWindows()
    allWindows.forEach(window => {
      if (window && !window.isDestroyed()) {
        try {
          window.removeAllListeners()
          window.destroy()
        } catch (e) {

        }
      }
    })


    if (fetchHtmlView) {
      try {
        if (!fetchHtmlView.webContents.isDestroyed()) {
          fetchHtmlView.webContents.removeAllListeners()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeBrowserView(fetchHtmlView)
          }
          fetchHtmlView.webContents.destroy()
        }
      } catch (e) {

      }
      fetchHtmlView = null
    }


    if (overlayWindow) {
      try {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.removeAllListeners()
          overlayWindow.destroy()
        }
      } catch (e) {

      }
      overlayWindow = null
    }


    if (mainWindow) {
      try {
        if (!mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners()
          mainWindow.destroy()
        }
      } catch (e) {

      }
      mainWindow = null
    }
})

app.on('will-quit', (event) => {

    fetchHtmlView = null
    overlayWindow = null
    mainWindow = null
})