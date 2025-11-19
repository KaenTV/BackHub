const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron/main')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const https = require('node:https')
const { URL } = require('node:url')

let mainWindow
let overlayWindow = null
let tray = null
let fetchHtmlView = null // BrowserView réutilisable pour fetch-html (attaché à mainWindow)
let fetchHtmlInProgress = false // Flag pour éviter les appels simultanés
let fetchHtmlQueue = [] // File d'attente pour les requêtes fetch-html

// Configuration de l'auto-update
autoUpdater.setAutoDownload(false) // Ne pas télécharger automatiquement, demander à l'utilisateur
autoUpdater.autoInstallOnAppQuit = true // Installer automatiquement au redémarrage

// Événements de mise à jour
autoUpdater.on('checking-for-update', () => {
  console.log('Vérification des mises à jour...')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'checking', message: 'Vérification des mises à jour...' })
  }
})

autoUpdater.on('update-available', (info) => {
  console.log('Mise à jour disponible:', info.version)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  }
  showNotification('Mise à jour disponible', `Version ${info.version} disponible. Cliquez pour télécharger.`)
})

autoUpdater.on('update-not-available', (info) => {
  console.log('Aucune mise à jour disponible')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'up-to-date', message: 'Vous utilisez la dernière version' })
  }
})

autoUpdater.on('error', (err) => {
  console.error('Erreur lors de la vérification des mises à jour:', err)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'error', message: 'Erreur lors de la vérification des mises à jour' })
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
  }
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('Mise à jour téléchargée:', info.version)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  }
  showNotification('Mise à jour téléchargée', 'La mise à jour sera installée au redémarrage de l\'application.')
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
  // Utiliser les notifications natives d'Electron
  if (process.platform === 'win32' || process.platform === 'darwin') {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: title,
        body: body,
        silent: false
      })
      
      notification.show()
      
      // Gérer le clic sur la notification pour ouvrir/focus la fenêtre
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
      // Fallback : envoyer au renderer si les notifications natives ne sont pas supportées
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
      devTools: process.env.NODE_ENV === 'development', // Seulement en développement
      sandbox: true, // Activer le sandbox pour la sécurité
      partition: 'persist:main', // Réutiliser la même partition pour éviter les processus supplémentaires
      backgroundThrottling: true, // Activer le throttling pour économiser les ressources
      v8CacheOptions: 'code', // Optimiser le cache V8
      enableWebSQL: false, // Désactiver WebSQL (non utilisé)
      enableRemoteModule: false, // Désactiver le module remote (déprécié)
      webSecurity: true // Activer la sécurité web
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'interface', 'home.html'))

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    } else {
      // Si on quitte vraiment, détruire toutes les fenêtres
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy()
      }
      // Nettoyer le BrowserView attaché à mainWindow
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
      // Fermer toutes les fenêtres avant de fermer la principale
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy()
      }
      // Nettoyer le BrowserView attaché à mainWindow
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
      // Envoyer un message au renderer pour ouvrir la section feedback
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

  // IPC handlers pour les mises à jour
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
  // Réutiliser la fenêtre existante si elle n'est pas détruite
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
    // Options pour overlay système (comme Discord)
    type: process.platform === 'win32' ? 'toolbar' : undefined, // Windows: permet l'overlay sur plein écran
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false,
        backgroundThrottling: false, // Empêcher la mise en veille de l'overlay
        sandbox: true, // Activer le sandbox pour la sécurité
        partition: 'persist:overlay', // Partition séparée pour l'overlay
        v8CacheOptions: 'code', // Optimiser le cache V8
        enableWebSQL: false, // Désactiver WebSQL
        enableRemoteModule: false, // Désactiver le module remote
        webSecurity: true // Activer la sécurité web
      }
  })
  
  overlayWindow.loadFile(path.join(__dirname, '..', 'interface', 'overlay.html'))
  
  // Configuration pour overlay système
  if (process.platform === 'win32') {
    // Windows: utiliser setIgnoreMouseEvents pour que les clics passent à travers
    // sauf sur les éléments interactifs (géré dans le CSS avec pointer-events)
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    
    // Niveau de priorité élevé pour s'afficher au-dessus de tout
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  } else if (process.platform === 'darwin') {
    // macOS
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    // Linux
    overlayWindow.setVisibleOnAllWorkspaces(true)
  }
  
  // Positionner en haut à droite
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  overlayWindow.setPosition(width - 470, 20)
  
  // Masquer par défaut
  overlayWindow.hide()
  
  // Empêcher la fermeture accidentelle
  overlayWindow.on('close', (event) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      event.preventDefault()
      overlayWindow.hide()
    }
  })
  
  // Réactiver les événements souris quand la fenêtre est visible
  overlayWindow.on('show', () => {
    if (process.platform === 'win32' && overlayWindow && !overlayWindow.isDestroyed()) {
      // Réactiver les événements souris pour permettre l'interaction
      overlayWindow.setIgnoreMouseEvents(false)
    }
  })
  
  overlayWindow.on('hide', () => {
    if (process.platform === 'win32' && overlayWindow && !overlayWindow.isDestroyed()) {
      // Désactiver les événements souris quand caché
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })
  
  // Nettoyer quand la fenêtre est détruite
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  
  return overlayWindow
}

function showOverlayNotification(title, message) {
  // S'assurer que la fenêtre overlay existe et n'est pas détruite
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow()
  }
  
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // S'assurer que la fenêtre est au premier plan avec la priorité la plus élevée
    if (process.platform === 'win32') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      // Réactiver les événements souris pour permettre l'interaction
      overlayWindow.setIgnoreMouseEvents(false)
    }
    
    overlayWindow.webContents.send('show-overlay-notification', { title, message, type: 'vote' })
    overlayWindow.show()
    
    // Forcer la fenêtre au premier plan
    overlayWindow.focus()
    overlayWindow.moveTop()
    
    // Masquer après 8 secondes
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide()
        // Réactiver ignoreMouseEvents quand caché
        if (process.platform === 'win32') {
          overlayWindow.setIgnoreMouseEvents(true, { forward: true })
        }
      }
    }, 8000)
  }
}

function showFeedbackOverlayNotification({ feedbackType, username, title, description }) {
  // S'assurer que la fenêtre overlay existe et n'est pas détruite
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow()
  }
  
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Ajuster la taille de la fenêtre pour la notification feedback
    overlayWindow.setSize(450, 240)
    
    // S'assurer que la fenêtre est au premier plan avec la priorité la plus élevée
    if (process.platform === 'win32') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      // Réactiver les événements souris pour permettre l'interaction
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
    
    // Forcer la fenêtre au premier plan
    overlayWindow.focus()
    overlayWindow.moveTop()
    
    // Masquer après 10 secondes
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide()
        // Réactiver ignoreMouseEvents quand caché
        if (process.platform === 'win32') {
          overlayWindow.setIgnoreMouseEvents(true, { forward: true })
        }
        // Remettre la taille par défaut
        overlayWindow.setSize(450, 120)
      }
    }, 10000)
  }
}

// Fonction pour créer/réutiliser le BrowserView pour fetch-html
// Utilise mainWindow au lieu de créer une fenêtre séparée pour réduire les processus
function getFetchHtmlView() {
  // S'assurer que mainWindow existe
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }
  
  // Créer le BrowserView seulement s'il n'existe pas ou s'il est détruit
  if (!fetchHtmlView || fetchHtmlView.webContents.isDestroyed()) {
    fetchHtmlView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: true, // Activer le throttling pour économiser les ressources
        sandbox: true, // Activer le sandbox pour la sécurité
        partition: 'persist:fetch', // Partition dédiée pour le fetch
        v8CacheOptions: 'code', // Optimiser le cache V8
        enableWebSQL: false, // Désactiver WebSQL
        enableRemoteModule: false, // Désactiver le module remote
        webSecurity: true // Activer la sécurité web
      }
    })
    // Attacher le BrowserView à la fenêtre principale (hors écran)
    mainWindow.setBrowserView(fetchHtmlView)
    // Positionner le BrowserView hors de la vue (0x0 avec taille minimale)
    fetchHtmlView.setBounds({ x: -10000, y: -10000, width: 1, height: 1 })
  }
  
  return fetchHtmlView
}

// Handler pour récupérer le HTML d'une URL avec exécution JavaScript
// Utilise un BrowserView réutilisable pour éviter de créer trop de processus
ipcMain.handle('fetch-html', async (event, url) => {
  // Valider l'URL pour la sécurité
  const allowedDomains = ['top-serveurs.net']
  
  try {
    const urlObj = new URL(url)
    
    // Vérifier que le domaine est autorisé
    if (!allowedDomains.includes(urlObj.hostname)) {
      throw new Error(`Domain ${urlObj.hostname} is not allowed`)
    }
    
    // Vérifier que c'est bien HTTPS
    if (urlObj.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed')
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid URL format')
    }
    throw error
  }
  
  // Utiliser une file d'attente pour gérer les requêtes simultanées
  return new Promise((resolve, reject) => {
    // Ajouter la requête à la file d'attente
    fetchHtmlQueue.push({ url, resolve, reject })
    
    // Traiter la file d'attente
    processFetchHtmlQueue()
  })
})

// Fonction pour traiter la file d'attente des requêtes fetch-html
function processFetchHtmlQueue() {
  // Si une requête est déjà en cours ou la file est vide, ne rien faire
  if (fetchHtmlInProgress || fetchHtmlQueue.length === 0) {
    return
  }
  
  // Récupérer la première requête de la file
  const { url, resolve, reject } = fetchHtmlQueue.shift()
  fetchHtmlInProgress = true
  
  try {
    // Réutiliser ou créer le BrowserView
    const hiddenView = getFetchHtmlView()
    
    // Nettoyer les anciens listeners pour éviter les fuites mémoire
    hiddenView.webContents.removeAllListeners('did-finish-load')
    hiddenView.webContents.removeAllListeners('did-fail-load')
    
    let timeoutId
    let resolved = false

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      fetchHtmlInProgress = false
      // Traiter la prochaine requête dans la file
      if (fetchHtmlQueue.length > 0) {
        setTimeout(() => processFetchHtmlQueue(), 100)
      }
    }

    // Timeout de 15 secondes
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error('Timeout: Page took too long to load'))
      }
    }, 15000)

    // Attendre que la page soit complètement chargée et que le JavaScript s'exécute
    const finishHandler = () => {
      // Attendre plus longtemps pour que le JavaScript s'exécute complètement
      // (notamment pour le countdown et les données de stats qui peuvent être chargées dynamiquement)
      setTimeout(() => {
        if (resolved) return
        
        // Exécuter du JavaScript dans la page pour extraire les données du cooldown, votes et classement
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
            // Si le résultat n'est pas du JSON valide
            cleanup()
            reject(new Error('Invalid JSON response from page'))
          }
        }).catch((error) => {
          if (resolved) return
          resolved = true
          cleanup()
          reject(error)
        })
      }, 3000) // Attendre 3 secondes pour que le JavaScript s'exécute complètement (stats, votes, classement)
    }
    
    hiddenView.webContents.once('did-finish-load', finishHandler)

    const failHandler = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (resolved) return
      
      // Ignorer les erreurs sur les frames secondaires (iframes, etc.)
      if (!isMainFrame) {
        return
      }
      
      // ERR_ABORTED (-3) peut être causé par une annulation normale, ne pas le traiter comme une erreur fatale
      // ERR_BLOCKED_BY_CLIENT (-21) peut aussi être ignoré dans certains cas
      if (errorCode === -3 || errorCode === -21) {
        // Attendre un peu pour voir si la page se charge quand même
        setTimeout(() => {
          if (!resolved && hiddenView && !hiddenView.webContents.isDestroyed()) {
            // Vérifier si la page est quand même chargée
            try {
              hiddenView.webContents.executeJavaScript('document.readyState').then((readyState) => {
                if (readyState === 'complete' && !resolved) {
                  // La page est chargée malgré l'erreur, continuer normalement
                  return
                }
              }).catch(() => {
                // Si on ne peut pas vérifier, considérer comme une erreur
                if (!resolved) {
                  resolved = true
                  cleanup()
                  reject(new Error(`Failed to load page: ${errorDescription || 'Unknown error'} (${errorCode})`))
                }
              })
            } catch (e) {
              // Erreur lors de la vérification
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

    // Vérifier que l'URL est valide avant de charger
    if (!url || typeof url !== 'string' || url.trim() === '') {
      cleanup()
      reject(new Error('Invalid URL provided'))
      return
    }
    
    // Charger l'URL
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
    // Traiter la prochaine requête dans la file
    if (fetchHtmlQueue.length > 0) {
      setTimeout(() => processFetchHtmlQueue(), 100)
    }
  }
}

app.on('ready', () => {
  createWindow()
  createTray()
  createOverlayWindow() // Créer l'overlay au démarrage

  // Vérifier les mises à jour au démarrage (attendre 5 secondes pour que la fenêtre soit prête)
  setTimeout(() => {
    if (process.env.NODE_ENV === 'production') {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('Erreur lors de la vérification initiale des mises à jour:', err)
      })
    }
  }, 5000)

  // Vérifier les mises à jour toutes les 4 heures
  setInterval(() => {
    if (process.env.NODE_ENV === 'production') {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('Erreur lors de la vérification périodique des mises à jour:', err)
      })
    }
  }, 4 * 60 * 60 * 1000) // 4 heures

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
    // Forcer la fermeture de toutes les fenêtres, y compris l'overlay
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy()
    }
    // Nettoyer le BrowserView attaché à mainWindow
    if (mainWindow && fetchHtmlView && !fetchHtmlView.webContents.isDestroyed()) {
      mainWindow.removeBrowserView(fetchHtmlView)
      fetchHtmlView.webContents.destroy()
    }
    
    // Attendre un peu pour que les fenêtres se ferment
    setTimeout(() => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    }, 100)
})

app.on('before-quit', (event) => {
    app.isQuitting = true
    
    // Forcer la fermeture de toutes les fenêtres
    const allWindows = BrowserWindow.getAllWindows()
    allWindows.forEach(window => {
      if (window && !window.isDestroyed()) {
        try {
          window.removeAllListeners()
          window.destroy()
        } catch (e) {
          // Ignorer les erreurs
        }
      }
    })
    
    // Nettoyer le BrowserView de fetch-html pour éviter les fuites mémoire
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
        // Ignorer les erreurs de nettoyage
      }
      fetchHtmlView = null
    }
    
    // Nettoyer l'overlay
    if (overlayWindow) {
      try {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.removeAllListeners()
          overlayWindow.destroy()
        }
      } catch (e) {
        // Ignorer les erreurs
      }
      overlayWindow = null
    }
    
    // Nettoyer la fenêtre principale
    if (mainWindow) {
      try {
        if (!mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners()
          mainWindow.destroy()
        }
      } catch (e) {
        // Ignorer les erreurs
      }
      mainWindow = null
    }
})

app.on('will-quit', (event) => {
    // S'assurer que tout est bien nettoyé avant de quitter
    fetchHtmlView = null
    overlayWindow = null
    mainWindow = null
})