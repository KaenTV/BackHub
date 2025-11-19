
import { debounce, throttle } from './utils/debounce.js'
import { formatPrice, formatDate, escapeHtml } from './utils/format.js'
import { logger } from './utils/logger.js'
import { performanceMonitor } from './utils/performance.js'
import { notificationService } from './services/notification-service.js'
import { storageService } from './services/storage-service.js'
import { syncService } from './services/sync-service.js'
import { undoRedoService } from './services/undo-redo-service.js'
import { calculationService } from './services/calculation-service.js'
import { marginAlertService } from './services/margin-alert-service.js'
import { lazyLoadService } from './services/lazy-load-service.js'
import { tooltipManager } from './components/tooltip.js'
import { dragDropManager } from './components/drag-drop.js'
import { ITEMS_DATA } from './items-data.js'
import { apiService } from './services/api-service.js'
import { mapService } from './services/map-service.js'

class BackHubApp {
  constructor() {
    this.currentUser = null
    this.viewSwitchInProgress = false
    this.selectedItems = new Map() 
    this.history = []
    this.users = []
    this.priceOverrides = {}
    this.itemsCache = null
    this._priceOverridesChanged = false
    this.searchQuery = ''
    this.drugSearchQuery = ''
    this.currentCalcType = 'drogue'
    this.useApi = true
    this.clanMembers = []
    this.currentClan = null
    this.cooldownInterval = null
    this.cooldownCheckInterval = null
    this.voteCooldownInterval = null
    this.voteCooldownDisplayInterval = null
    this.voteStatsInterval = null
    this.voteCooldownWasActive = false
    this.voteStats = { voteCount: null, ranking: null }
    this.lastCooldownUpdate = null
    this.isLoadingVoteStats = false
    this.feedbackCheckInterval = null
    this.lastFeedbackCheck = null

    window.app = this

      this.initServices()
      this.init()
    
    this.initAsync().catch(err => {
      logger.error('Init async failed', err)
    })
  }

  async initAsync() {
    if (this.useApi) {
      try {
        const user = await apiService.tryAutoLogin()
        if (user) {
          await this.loadUserDataFromApi(user.id)
          this.login(user, true)
          return
        }
      } catch (error) {
        // Ne logger que si ce n'est pas une erreur d'auto-login silencieuse
        if (!error.isAutoLogin) {
          logger.error('Auto-login failed', error)
        }
        // Nettoyer complètement le localStorage en cas d'erreur
        localStorage.removeItem('authToken')
        localStorage.removeItem('savedCredentials')
        localStorage.removeItem('savedSession')
        // Continuer normalement si la reconnexion automatique échoue (ne pas afficher d'erreur)
      }
    }
    
    const savedSession = localStorage.getItem('savedSession')
    if (savedSession && this.useApi) {
      try {
        const sessionData = JSON.parse(savedSession)
        const sessionAge = Date.now() - sessionData.timestamp
        const maxAge = 30 * 24 * 60 * 60 * 1000
        
        if (sessionAge < maxAge) {
          const usernameInput = document.getElementById('login-username')
          if (usernameInput) {
            usernameInput.value = sessionData.username
          }
        } else {
          localStorage.removeItem('savedSession')
        }
      } catch (error) {
        logger.error('Error parsing saved session', error)
        localStorage.removeItem('savedSession')
      }
    }
    
    // Charger depuis localStorage en fallback
    if (!this.useApi) {
    this.history = await this.loadHistory()
    this.users = await this.loadUsers()
    this.priceOverrides = await this.loadPriceOverrides()
    }
  }

  initServices() {
    syncService.start()
    dragDropManager.init()
    this.initKeyboardShortcuts()
    
    requestAnimationFrame(() => {
      tooltipManager.initTooltips()
    })
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (undoRedoService.canUndo()) {
          undoRedoService.undo()
          notificationService.info('Action annulée')
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        if (undoRedoService.canRedo()) {
          undoRedoService.redo()
          notificationService.info('Action rétablie')
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        const saveBtn = document.getElementById('save-selection-btn')
        if (saveBtn && !saveBtn.disabled) {
          saveBtn.click()
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const searchInput = document.getElementById('armes-search') || document.getElementById('history-search')
        if (searchInput) {
          searchInput.focus()
        }
      }
    })
  }

  init() {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.key === 'R') || e.key === 'F5') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        return false
      }
    }, true)
    
    window.addEventListener('beforeunload', () => {
      this.stopVoteCooldownCheck()
    })
    
    window.addEventListener('focus', () => {
      const voteView = document.getElementById('vote-view')
      if (voteView && !voteView.classList.contains('hidden')) {
        this.updateVoteCooldown().catch(err => {
          logger.error('Erreur lors du rechargement du cooldown', err)
        })
        this.loadVoteStats().catch(err => {
          logger.error('Erreur lors du rechargement des stats', err)
        })
      }
    })
    
    this.initAuth()
    this.initSidebar()
    this.initCalculator()
    this.initAdmin()
    this.initClan()
    this.initSettings()

    // Vérifier et démarrer la mise à jour du cooldown au démarrage
    this.startCooldownCheck()

    const savedUser = localStorage.getItem('currentUser')
    if (savedUser) {
      const user = this.users.find(u => u.username === savedUser)
      if (user) {
        this.login(user)
      }
    }
    
    this.startGlobalVoteStatsUpdate()
  }
  

  startGlobalVoteStatsUpdate() {
    if (this.voteStatsInterval) {
      clearInterval(this.voteStatsInterval)
      this.voteStatsInterval = null
    }
    
      // Charger immédiatement les stats
    this.loadVoteStats().catch(err => {
      logger.error('Erreur lors du chargement initial des stats de vote', err)
    })
    
    // Mettre à jour les stats toutes les 5 secondes (continue même hors page vote)
    this.voteStatsInterval = setInterval(() => {
      this.loadVoteStats().catch(err => {
        logger.error('Erreur lors de la mise à jour des stats de vote', err)
      })
    }, 5000)
  }

  initAuth() {
    // Formulaire de connexion
    const loginForm = document.getElementById('login-form')
    if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault()
      this.handleLogin()
    })
    }

    // Formulaire d'inscription
    const registerForm = document.getElementById('register-form')
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault()
        this.handleRegister()
      })
    }

    // Gestion des onglets
    const loginTab = document.getElementById('tab-login')
    const registerTab = document.getElementById('tab-register')
    
    if (loginTab) {
      loginTab.addEventListener('click', () => {
        this.switchAuthTab('login')
      })
    }
    
    if (registerTab) {
      registerTab.addEventListener('click', () => {
        this.switchAuthTab('register')
      })
    }

    const logoutBtn = document.getElementById('logout-btn')
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.logout()
      })
    }

    // Initialiser la modal des conditions d'utilisation
    this.initTermsModal()

    if (this.users.length === 0 && !this.useApi) {
      this.createDefaultAdmin()
    }
    
    // Écouter les messages pour ouvrir la section feedback
    if (window.electronAPI && window.electronAPI.onOpenFeedbackSection) {
      window.electronAPI.onOpenFeedbackSection(() => {
        // Ouvrir la vue admin et activer l'onglet feedbacks
        this.switchView('admin')
        setTimeout(() => {
          const feedbacksTab = document.querySelector('.admin-nav-tab[data-tab="feedbacks"]')
          if (feedbacksTab) {
            feedbacksTab.click()
          }
        }, 100)
      })
    }
  }

  /**
   * Initialiser la modal des conditions d'utilisation
   */
  initTermsModal() {
    const termsModal = document.getElementById('terms-modal')
    const termsModalOverlay = document.getElementById('terms-modal-overlay')
    const termsModalClose = document.getElementById('terms-modal-close')
    const termsAcceptBtn = document.getElementById('terms-accept-btn')
    const termsDeclineBtn = document.getElementById('terms-decline-btn')
    const termsLink = document.querySelector('.link-terms')
    const termsDate = document.getElementById('terms-date')

    // Afficher la date actuelle
    if (termsDate) {
      const now = new Date()
      const dateStr = now.toLocaleDateString('fr-FR', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
      termsDate.textContent = dateStr
    }

    // Ouvrir la modal
    const openTermsModal = (e) => {
      if (e) e.preventDefault()
      if (termsModal) {
        termsModal.classList.add('show')
        document.body.style.overflow = 'hidden'
      }
    }

    // Fermer la modal
    const closeTermsModal = () => {
      if (termsModal) {
        termsModal.classList.remove('show')
        document.body.style.overflow = ''
      }
    }

    // Event listeners
    if (termsLink) {
      termsLink.addEventListener('click', openTermsModal)
    }

    if (termsModalOverlay) {
      termsModalOverlay.addEventListener('click', closeTermsModal)
    }

    if (termsModalClose) {
      termsModalClose.addEventListener('click', closeTermsModal)
    }

    if (termsAcceptBtn) {
      termsAcceptBtn.addEventListener('click', () => {
          // Cocher la case d'acceptation des conditions
        const termsCheckbox = document.getElementById('register-terms')
        if (termsCheckbox) {
          termsCheckbox.checked = true
        }
        closeTermsModal()
      })
    }

    if (termsDeclineBtn) {
      termsDeclineBtn.addEventListener('click', () => {
        // Décocher la case d'acceptation des conditions
        const termsCheckbox = document.getElementById('register-terms')
        if (termsCheckbox) {
          termsCheckbox.checked = false
        }
        closeTermsModal()
      })
    }

    // Fermer avec la touche Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && termsModal && termsModal.classList.contains('show')) {
        closeTermsModal()
      }
    })
  }

  /**
   * Basculer entre les onglets connexion/inscription
   */
  switchAuthTab(tab) {
    const loginTab = document.getElementById('tab-login')
    const registerTab = document.getElementById('tab-register')
    const loginForm = document.getElementById('auth-login')
    const registerForm = document.getElementById('auth-register')
    
    if (tab === 'login') {
      loginTab?.classList.add('active')
      registerTab?.classList.remove('active')
      loginForm?.classList.add('active')
      registerForm?.classList.remove('active')
      
      // Focus sur le premier champ
      const usernameInput = document.getElementById('login-username')
      if (usernameInput) {
        setTimeout(() => usernameInput.focus(), 100)
      }
    } else {
      registerTab?.classList.add('active')
      loginTab?.classList.remove('active')
      registerForm?.classList.add('active')
      loginForm?.classList.remove('active')
      
      // Focus sur le premier champ
      const usernameInput = document.getElementById('register-username')
      if (usernameInput) {
        setTimeout(() => usernameInput.focus(), 100)
      }
    }
    
    // Réinitialiser les messages d'erreur
    const errorMessages = document.querySelectorAll('.error-message, .success-message')
    errorMessages.forEach(msg => {
      msg.classList.remove('show')
      msg.textContent = ''
    })
  }

  /**
   * Gérer l'inscription
   */
  async handleRegister() {
    const username = document.getElementById('register-username').value.trim()
    const password = document.getElementById('register-password').value
    const passwordConfirm = document.getElementById('register-password-confirm').value
    const termsAccepted = document.getElementById('register-terms').checked
    const errorDiv = document.getElementById('register-error')
    const successDiv = document.getElementById('register-success')
    const registerBtn = document.querySelector('#register-form button[type="submit"]')
    
    // Réinitialiser les messages
    if (errorDiv) {
      errorDiv.classList.remove('show')
      errorDiv.textContent = ''
    }
    if (successDiv) {
      successDiv.classList.remove('show')
      successDiv.textContent = ''
    }
    
    // Validation
    if (username.length < 3 || username.length > 20) {
      if (errorDiv) {
        errorDiv.textContent = 'Le nom d\'utilisateur doit contenir entre 3 et 20 caractères'
        errorDiv.classList.add('show')
      }
      return
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      if (errorDiv) {
        errorDiv.textContent = 'Le nom d\'utilisateur ne peut contenir que des lettres, chiffres et underscores'
        errorDiv.classList.add('show')
      }
      return
    }
    
    if (password.length < 6) {
      if (errorDiv) {
        errorDiv.textContent = 'Le mot de passe doit contenir au moins 6 caractères'
        errorDiv.classList.add('show')
      }
      return
    }
    
    if (password !== passwordConfirm) {
      if (errorDiv) {
        errorDiv.textContent = 'Les mots de passe ne correspondent pas'
        errorDiv.classList.add('show')
      }
      return
    }
    
    if (!termsAccepted) {
      if (errorDiv) {
        errorDiv.textContent = 'Vous devez accepter les conditions d\'utilisation'
        errorDiv.classList.add('show')
      }
      return
    }
    
    // Désactiver le bouton pendant l'inscription
    if (registerBtn) {
      registerBtn.disabled = true
      const originalText = registerBtn.querySelector('span').textContent
      registerBtn.querySelector('span').textContent = 'Création du compte...'
    }

    try {
      if (this.useApi) {
        // Utiliser l'API
        const user = await apiService.register(username, password, 'user')
        
        if (successDiv) {
          successDiv.textContent = 'Compte créé avec succès ! Redirection...'
          successDiv.classList.add('show')
        }
        
        // Attendre un peu puis basculer vers la connexion
        setTimeout(() => {
          this.switchAuthTab('login')
          // Pré-remplir le nom d'utilisateur
          const loginUsername = document.getElementById('login-username')
          if (loginUsername) {
            loginUsername.value = username
          }
          notificationService.success('Compte créé ! Vous pouvez maintenant vous connecter.')
        }, 1500)
      } else {
        // Mode local (fallback)
        const existingUser = this.users.find(u => u.username === username)
        if (existingUser) {
          if (errorDiv) {
            errorDiv.textContent = 'Ce nom d\'utilisateur existe déjà'
            errorDiv.classList.add('show')
          }
          return
        }
        
        const newUser = {
          id: Date.now().toString(),
          username: username,
          password: password,
          role: 'user',
          createdAt: new Date().toISOString()
        }
        
        this.users.push(newUser)
        await this.saveUsers()
        
        if (successDiv) {
          successDiv.textContent = 'Compte créé avec succès ! Redirection...'
          successDiv.classList.add('show')
        }
        
        setTimeout(() => {
          this.switchAuthTab('login')
          const loginUsername = document.getElementById('login-username')
          if (loginUsername) {
            loginUsername.value = username
          }
        }, 1500)
      }
    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = error.message || 'Erreur lors de la création du compte'
        errorDiv.classList.add('show')
      }
      logger.error('Register error', error)
    } finally {
      if (registerBtn) {
        registerBtn.disabled = false
        registerBtn.querySelector('span').textContent = 'Créer mon compte'
      }
    }
  }

  createDefaultAdmin() {
    const defaultAdmin = {
      id: '1',
      username: 'admin',
      password: 'admin', 
      role: 'admin',
      createdAt: new Date().toISOString()
    }
    this.users.push(defaultAdmin)
    this.saveUsers()
  }

  async handleLogin() {
    const username = document.getElementById('login-username').value.trim()
    const password = document.getElementById('login-password').value
    const rememberMe = document.getElementById('login-remember').checked
    const errorDiv = document.getElementById('login-error')
    const loginBtn = document.querySelector('#login-form button[type="submit"]')
    
    // Désactiver le bouton pendant la connexion
    if (loginBtn) {
      loginBtn.disabled = true
      const btnSpan = loginBtn.querySelector('span')
      if (btnSpan) {
        btnSpan.textContent = 'Connexion...'
      } else {
        loginBtn.textContent = 'Connexion...'
      }
    }

    try {
      if (this.useApi) {
        // Utiliser l'API
        const user = await apiService.login(username, password, rememberMe)
        apiService.setCurrentUser(user)
        if (errorDiv) {
          errorDiv.textContent = ''
          errorDiv.classList.remove('show')
        }
        
        // Charger les données de l'utilisateur depuis l'API
        await this.loadUserDataFromApi(user.id)
        
        this.login(user, rememberMe)
      } else {
        // Mode local (fallback)
        const user = this.users.find(u => u.username === username && u.password === password)
    if (user) {
          if (errorDiv) {
      errorDiv.textContent = ''
            errorDiv.classList.remove('show')
          }
          this.login(user, rememberMe)
    } else {
          if (errorDiv) {
      errorDiv.textContent = 'Nom d\'utilisateur ou mot de passe incorrect'
            errorDiv.classList.add('show')
          }
        }
      }
    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = error.message || 'Erreur de connexion'
        errorDiv.classList.add('show')
      }
      logger.error('Login error', error)
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false
        const btnSpan = loginBtn.querySelector('span')
        if (btnSpan) {
          btnSpan.textContent = 'Se connecter'
        } else {
          loginBtn.textContent = 'Se connecter'
        }
      }
    }
  }

  /**
   * Charger les données de l'utilisateur depuis l'API
   */
  async loadUserDataFromApi(userId) {
    try {
      // Les prix d'achat sont déjà chargés dans login() depuis localStorage
      // On ne les recharge pas ici pour éviter d'écraser les modifications en cours
      // this.priceOverrides est déjà initialisé avec les données de l'utilisateur
      
      // Charger l'historique depuis l'API (base de données)
      let transactions = []
      try {
        transactions = await apiService.getUserHistory(userId, 1000)
        if (!Array.isArray(transactions)) {
          logger.warn('getUserHistory returned non-array, using empty array', { transactions })
          transactions = []
        }
      } catch (historyError) {
        // Logger sans notification
        logger.warn('Failed to load user history from API', historyError, {}, false)
        // Si l'API est activée, ne pas charger depuis localStorage
        // Les données doivent être uniquement en base de données
        if (this.useApi) {
          this.history = []
          return
        }
        // Essayer de charger depuis localStorage en fallback seulement si l'API n'est pas activée
        try {
          this.history = await this.loadHistory()
          logger.info('Loaded history from localStorage fallback', { count: this.history.length })
          return
        } catch (fallbackError) {
          // Logger sans notification - erreur silencieuse
          logger.error('Failed to load history from localStorage fallback', fallbackError, {}, false)
          this.history = []
          return
        }
      }
      
      // Normaliser le format des transactions retournées par l'API
      this.history = transactions.map(t => ({
        id: t.id || t.transaction_id || Date.now().toString(),
        date: t.date || t.created_at || new Date().toISOString(),
        user: t.user || t.username || this.currentUser?.username || 'Utilisateur',
        seller: t.seller || '',
        items: Array.isArray(t.items) ? t.items : 
               (typeof t.items === 'string' ? (() => {
                 try {
                   return JSON.parse(t.items)
                 } catch (e) {
                   logger.warn('Failed to parse items JSON', { items: t.items, error: e })
                   return []
                 }
               })() : []),
        totalBuy: t.total_buy || t.totalBuy || 0,
        totalSell: t.total_sell || t.totalSell || 0,
        margin: t.margin !== undefined ? t.margin : 
                ((t.total_sell || t.totalSell || 0) - (t.total_buy || t.totalBuy || 0))
      }))
      
      // Ne PAS sauvegarder en localStorage si l'API est activée
      // Les données doivent être uniquement en base de données
      if (!this.useApi) {
        await this.saveHistory()
      }
      
      // Rafraîchir le cache
      this.refreshItemsCache()
      
      logger.info('User data loaded from API', { 
        userId, 
        transactionsCount: this.history.length,
        transactions: this.history.map(t => ({ id: t.id, date: t.date, user: t.user }))
      })
    } catch (error) {
      // Logger sans notification
      logger.error('Failed to load user data from API', error, {}, false)
      // Si l'API est activée, ne pas charger depuis localStorage
      // Les données doivent être uniquement en base de données
      if (this.useApi) {
        this.history = []
        this.priceOverrides = this.priceOverrides || {}
        return
      }
      // Essayer de charger depuis localStorage en fallback seulement si l'API n'est pas activée
      try {
        this.history = await this.loadHistory()
        logger.info('Loaded history from localStorage fallback after error', { count: this.history.length })
      } catch (fallbackError) {
        // Logger sans notification - erreur silencieuse
        logger.error('Failed to load history from localStorage fallback', fallbackError, {}, false)
        this.history = []
      }
      this.priceOverrides = this.priceOverrides || {}
    }
  }

  async login(user, rememberMe = false) {
    this.currentUser = user
    localStorage.setItem('currentUser', user.username)
    apiService.setCurrentUser(user)
    
    // Le token est déjà sauvegardé dans apiService.login() si rememberMe est true
    // On sauvegarde aussi les informations de session pour compatibilité
    if (rememberMe && this.useApi) {
      // Sauvegarder les informations de session
      const sessionData = {
        userId: user.id,
        username: user.username,
        role: user.role,
        timestamp: Date.now()
      }
      localStorage.setItem('savedSession', JSON.stringify(sessionData))
    } else {
      // Supprimer la session sauvegardée si elle existe
      localStorage.removeItem('savedSession')
    }
    
    // Charger les données depuis l'API si activé
    if (this.useApi && user.id) {
      // Charger d'abord les prix d'achat personnalisés (localStorage)
      const loadedOverrides = await this.loadPriceOverrides()
      this.priceOverrides = loadedOverrides || {}
      
      // Invalider le cache pour forcer le rechargement avec les nouveaux prix
      this.refreshItemsCache()
      
      // Si on a chargé des prix, s'assurer qu'ils sont sauvegardés avec la bonne clé
      if (Object.keys(this.priceOverrides).length > 0) {
        await this.savePriceOverrides()
      }
      
      // Ensuite charger l'historique depuis l'API (base de données)
      await this.loadUserDataFromApi(user.id)
      
      // Charger aussi les données du clan
      await this.loadClanData()
    } else {
      // Mode hors ligne - charger les prix d'achat depuis localStorage
      this.priceOverrides = await this.loadPriceOverrides() || {}
      // Invalider le cache pour forcer le rechargement avec les nouveaux prix
      this.refreshItemsCache()
    }
    
    this.showApp()
    
    // Mettre à jour le nom d'utilisateur dans toutes les vues
    const currentUserEl = document.getElementById('current-user')
    if (currentUserEl) {
      currentUserEl.textContent = user.username
    }
    
    // Afficher le modal de bienvenue pour les nouveaux utilisateurs
    // Utiliser un petit délai pour s'assurer que l'UI est prête
    setTimeout(() => {
      this.showWelcomeModal()
    }, 500)
    
    const dashboardUser = document.getElementById('current-user-dashboard')
    if (dashboardUser) {
      dashboardUser.textContent = user.username
    }
    
    const clanCurrentUserEl = document.getElementById('clan-current-user')
    if (clanCurrentUserEl) {
      clanCurrentUserEl.textContent = user.username
    }

    // Afficher le menu admin pour les admins et développeurs
    if (user.role === 'admin' || user.role === 'developpeur') {
      document.getElementById('admin-nav').style.display = 'block'
    } else {
      document.getElementById('admin-nav').style.display = 'none'
    }
    
    // Mettre à jour la visibilité des onglets admin
    // Utiliser requestAnimationFrame pour s'assurer que le DOM est prêt
    requestAnimationFrame(() => {
      setTimeout(() => {
        this.updateAdminTabsVisibility()
      }, 100)
    })
    
    // Rafraîchir les vues actives pour afficher les prix personnalisés
    setTimeout(() => {
      const currentView = document.querySelector('.view:not(.hidden)')
      if (currentView) {
        const viewId = currentView.id
        if (viewId === 'drugs-view' || viewId === 'weapons-view') {
          // Re-rendre la vue actuelle pour afficher les prix personnalisés
          if (viewId === 'drugs-view') {
            this.renderDrugsModern()
            this.renderDrugCalculator()
          } else if (viewId === 'weapons-view') {
            this.renderWeaponsModern()
            this.renderWeaponsCalculator()
          }
        }
      }
    }, 100)
    
    // Démarrer la vérification des nouveaux feedbacks pour les développeurs
    // Attendre un peu pour s'assurer que le token est bien disponible
    if (user.role === 'developpeur') {
      setTimeout(() => {
        this.startFeedbackCheck()
      }, 500)
    }
  }

  logout() {
    // Arrêter la vérification des feedbacks
    this.stopFeedbackCheck()
    
    // Sauvegarder les prix d'achat avant de déconnecter
    if (this.currentUser && this.currentUser.id) {
      this.savePriceOverrides().catch(err => {
        logger.error('Failed to save price overrides on logout', err)
      })
    }
    
    this.currentUser = null
    localStorage.removeItem('currentUser')
    localStorage.removeItem('savedSession') // Supprimer la session sauvegardée
    apiService.logout()
    this.selectedItems.clear() 
    this.priceOverrides = {}
    this.history = []
    this.showLogin()
  }

  showLogin() {
    document.getElementById('login-view').classList.remove('hidden')
    document.getElementById('app-view').classList.add('hidden')
    
    // Réinitialiser complètement les formulaires de connexion et d'inscription
    const loginForm = document.getElementById('login-form')
    const registerForm = document.getElementById('register-form')
    const loginUsername = document.getElementById('login-username')
    const loginPassword = document.getElementById('login-password')
    const registerUsername = document.getElementById('register-username')
    const registerPassword = document.getElementById('register-password')
    const registerPasswordConfirm = document.getElementById('register-password-confirm')
    
    // Réinitialiser le formulaire de connexion
    if (loginForm) {
      loginForm.reset()
    }
    if (loginUsername) {
      loginUsername.value = ''
      loginUsername.disabled = false
      loginUsername.readOnly = false
      loginUsername.required = true
    }
    if (loginPassword) {
      loginPassword.value = ''
      loginPassword.disabled = false
      loginPassword.readOnly = false
      loginPassword.required = true
    }
    
    // Réinitialiser le formulaire d'inscription
    if (registerForm) {
      registerForm.reset()
    }
    if (registerUsername) {
      registerUsername.value = ''
      registerUsername.disabled = false
      registerUsername.readOnly = false
      registerUsername.required = true
    }
    if (registerPassword) {
      registerPassword.value = ''
      registerPassword.disabled = false
      registerPassword.readOnly = false
      registerPassword.required = true
    }
    if (registerPasswordConfirm) {
      registerPasswordConfirm.value = ''
      registerPasswordConfirm.disabled = false
      registerPasswordConfirm.readOnly = false
      registerPasswordConfirm.required = true
    }
  }

  showApp() {
    document.getElementById('login-view').classList.add('hidden')
    document.getElementById('app-view').classList.remove('hidden')

    // Vérifier si une vue est déjà active ou visible
    setTimeout(() => {
      // Si un changement de vue est en cours, ne pas interférer
      if (this.viewSwitchInProgress) {
        return
      }
      
      // Vérifier si un élément de navigation est déjà actif
      const activeNav = document.querySelector('.nav-item.active')
      if (activeNav && activeNav.dataset.view) {
        const viewName = activeNav.dataset.view
        // Si une vue autre que dashboard est active, ne pas la changer
        if (viewName !== 'dashboard') {
          // S'assurer que la vue est bien affichée
          this.switchView(viewName)
          return
        }
      }
      
      // Vérifier si une vue autre que dashboard est déjà visible
      // En vérifiant les styles inline qui peuvent être appliqués par switchView
      const allViews = document.querySelectorAll('.view')
      let hasNonDashboardView = false
      allViews.forEach(view => {
        if (view.id && view.id !== 'dashboard-view') {
          const style = window.getComputedStyle(view)
          const isVisible = style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           !view.classList.contains('hidden') &&
                           style.opacity !== '0'
          if (isVisible) {
            hasNonDashboardView = true
          }
        }
      })
      
      // Si une autre vue est visible, ne pas forcer dashboard
      if (hasNonDashboardView) {
        return
      }
      
      // Sinon, afficher dashboard par défaut
      this.switchView('dashboard')
    }, 100)
  }

  initSidebar() {
    const sidebar = document.getElementById('sidebar')
    const toggle = document.getElementById('sidebar-toggle')

    toggle.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.toggleSidebar()
    })

    const savedState = localStorage.getItem('sidebarCollapsed')
    if (savedState === 'true') {

      sidebar.classList.add('collapsed')
      this.updateSidebarContent(false)
    } else {
      this.updateSidebarContent(true)
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.id !== 'logout-btn' && item.id !== 'settings-btn') {
        item.addEventListener('click', (e) => {
          const view = item.dataset.view
          const calcType = item.dataset.calcType

          if (view) {
            this.switchView(view)

            document.querySelectorAll('.nav-item').forEach(nav => {
              if (nav.id !== 'logout-btn' && nav.id !== 'settings-btn') {
                nav.classList.remove('active')
              }
            })
            item.classList.add('active')

            if (view === 'calculator' && calcType) {
              this.currentCalcType = calcType
              this.switchCalculatorType(calcType)
            } else if (view === 'calculator' && !calcType) {

              this.switchCalculatorType(this.currentCalcType || 'drogue')
            }
          }
        })
      }
    })

    // Gérer le clic sur le bouton Paramètres
    const settingsBtn = document.getElementById('settings-btn')
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.switchView('settings')
        
        // Mettre à jour l'état actif
        document.querySelectorAll('.nav-item').forEach(nav => {
          if (nav.id !== 'logout-btn') {
            nav.classList.remove('active')
          }
        })
        settingsBtn.classList.add('active')
      })
    }
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar')
    const isCollapsed = sidebar.classList.contains('collapsed')

    if (isCollapsed) {
      sidebar.classList.remove('collapsed')
      this.updateSidebarContent(true)
    } else {
      sidebar.classList.add('collapsed')
      this.updateSidebarContent(false)
    }

    this.saveSidebarState()
  }

  updateSidebarContent(isExpanded) {
    const sidebar = document.getElementById('sidebar')

    requestAnimationFrame(() => {

      const elements = {
        logoText: sidebar.querySelector('.logo-text'),
        navLabels: sidebar.querySelectorAll('.nav-section-label'),
        navTexts: sidebar.querySelectorAll('.nav-text'),
        footerText: sidebar.querySelector('.footer-text')
      }

      if (isExpanded) {

        setTimeout(() => {
          if (elements.logoText) elements.logoText.style.display = 'flex'
          elements.navLabels.forEach(label => {
            label.style.display = 'block'
          })
          elements.navTexts.forEach(text => {
            text.style.display = 'block'
          })
          if (elements.footerText) elements.footerText.style.display = 'block'
        }, 150)
      } else {

        if (elements.logoText) elements.logoText.style.display = 'none'
        elements.navLabels.forEach(label => {
          label.style.display = 'none'
        })
        elements.navTexts.forEach(text => {
          text.style.display = 'none'
        })
        if (elements.footerText) elements.footerText.style.display = 'none'
      }
    })
  }

  saveSidebarState() {
    const sidebar = document.getElementById('sidebar')
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'))
  }

  /**
   * Nettoyer les intervalles de vote quand on quitte la page vote
   */
  stopVoteCooldownCheck() {
    if (this.voteCooldownInterval) {
      clearInterval(this.voteCooldownInterval)
      this.voteCooldownInterval = null
    }
    if (this.voteCooldownDisplayInterval) {
      if (typeof this.voteCooldownDisplayInterval === 'number') {
        clearInterval(this.voteCooldownDisplayInterval)
      }
      this.voteCooldownDisplayInterval = null
    }
    if (this.voteCooldownDisplayAnimationFrame !== null) {
      cancelAnimationFrame(this.voteCooldownDisplayAnimationFrame)
      this.voteCooldownDisplayAnimationFrame = null
    }
    if (this.voteStatsInterval) {
      clearInterval(this.voteStatsInterval)
      this.voteStatsInterval = null
    }
  }

  async switchView(viewName) {
    if (this.viewSwitchInProgress) return
    
    // Nettoyer tous les intervalles et timers actifs avant de changer de vue
    const currentView = document.querySelector('.view:not(.hidden)')
    if (currentView) {
      // Nettoyer les intervalles de vote si on quitte la page vote
      if (currentView.id === 'vote-view') {
        this.stopVoteCooldownCheck()
      }
      // Nettoyer les intervalles de cooldown de clan si on quitte la page clan
      if (currentView.id === 'clan-view') {
        if (this.cooldownInterval) {
          clearTimeout(this.cooldownInterval)
          this.cooldownInterval = null
        }
        if (this.cooldownCheckInterval) {
          clearInterval(this.cooldownCheckInterval)
          this.cooldownCheckInterval = null
        }
      }
    }
    this.viewSwitchInProgress = true

    // Mettre à jour l'état actif dans la sidebar (batch DOM updates)
    const navItems = document.querySelectorAll('.nav-item')
    const targetNav = Array.from(navItems).find(nav => nav.dataset.view === viewName && nav.id !== 'logout-btn')
    
    navItems.forEach(nav => {
      if (nav.id !== 'logout-btn') {
        nav.classList.toggle('active', nav === targetNav)
      }
    })

    // Cacher toutes les vues sauf la cible (batch DOM updates)
    const views = document.querySelectorAll('.view')
    const targetViewId = `${viewName}-view`
    
    views.forEach(view => {
      if (view.id !== targetViewId) {
        view.classList.add('hidden')
        view.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; left: -9999px !important; z-index: -1 !important;'
      }
    })

    const targetView = document.getElementById(`${viewName}-view`)
    if (targetView) {
      const mainContent = targetView.closest('.main-content')
      if (mainContent) {
        mainContent.style.setProperty('display', 'flex', 'important')
        mainContent.style.setProperty('overflow', 'visible', 'important')
      }

      targetView.classList.remove('hidden')
      targetView.removeAttribute('hidden')
      targetView.style.setProperty('display', 'flex', 'important')
      targetView.style.setProperty('visibility', 'visible', 'important')
      targetView.style.setProperty('opacity', '1', 'important')
      targetView.style.setProperty('width', '100%', 'important')
      targetView.style.setProperty('height', '100%', 'important')
      targetView.style.setProperty('position', 'relative', 'important')
      targetView.style.setProperty('z-index', '100', 'important')
      targetView.style.removeProperty('left')

        const parent = targetView.parentElement
        if (parent) {
          const parentStyle = window.getComputedStyle(parent)
          if (parent.classList.contains('view') && parent.classList.contains('hidden')) {
            const mainContent = document.querySelector('.main-content')
            if (mainContent && mainContent !== parent) {
              mainContent.appendChild(targetView)
            }
          }
          if (parentStyle.display === 'none' && !parent.classList.contains('view')) {
            parent.style.setProperty('display', 'flex', 'important')
          }
        }

        const calculatorView = document.getElementById('calculator-view')
        if (calculatorView && viewName === 'history') {
          const calcStyle = window.getComputedStyle(calculatorView)
          if (calcStyle.display !== 'none') {
            calculatorView.style.setProperty('display', 'none', 'important')
            calculatorView.style.setProperty('visibility', 'hidden', 'important')
            calculatorView.style.setProperty('opacity', '0', 'important')
            calculatorView.style.setProperty('position', 'absolute', 'important')
            calculatorView.style.setProperty('left', '-9999px', 'important')
            calculatorView.classList.add('hidden')
          }
        }

      const computedStyle = window.getComputedStyle(targetView)
      const rect = targetView.getBoundingClientRect()
        if (computedStyle.display === 'none' || rect.width === 0 || rect.height === 0) {
          targetView.style.cssText = 'display: flex !important; visibility: visible !important; opacity: 1 !important; width: 100% !important; height: 100% !important; position: relative !important; z-index: 100 !important;'
          if (parent) {
            parent.style.setProperty('display', 'flex', 'important')
            parent.style.setProperty('overflow', 'visible', 'important')
          }
        }
    }

    // Charger les données et rendre la vue de manière optimisée
      if (viewName === 'calculator') {
      requestAnimationFrame(() => {
        if (this.currentCalcType === 'drogue') {
          this.renderDrugCalculator()
        } else if (this.currentCalcType === 'armes') {
          this.renderItems()
        }
        this.updateTotals()
      })
      } else if (viewName === 'history') {
      // Ne pas recharger si on vient de sauvegarder (déjà fait dans saveToHistory)
      if (!this._justSavedTransaction && this.useApi && this.currentUser?.id) {
        const loadPromise = this.loadUserDataFromApi(this.currentUser.id)
        await loadPromise
      }
      requestAnimationFrame(() => {
        this.renderHistory()
      })
    } else if (viewName === 'dashboard') {
      const loadPromise = this.useApi && this.currentUser?.id 
        ? this.loadUserDataFromApi(this.currentUser.id)
        : Promise.resolve()

      await loadPromise
        requestAnimationFrame(() => {
        this.renderDashboard()
        })
      } else if (viewName === 'admin') {
      // Recharger les données depuis l'API pour s'assurer que tout est à jour
      if (this.useApi && this.currentUser && this.currentUser.id) {
        await this.loadUserDataFromApi(this.currentUser.id)
      }
      await this.renderAdminDashboard()
      } else if (viewName === 'support') {
      requestAnimationFrame(() => {
        this.initWikiNavigation()
      })
    } else if (viewName === 'map') {
      this.renderMapView()
    } else if (viewName === 'clan') {
      this.renderClanView()
    } else if (viewName === 'settings') {
      this.renderSettings()
    } else if (viewName === 'vote') {
      // Utiliser requestAnimationFrame pour s'assurer que le DOM est prêt
      requestAnimationFrame(() => {
        this.initVotePage()
        // Mettre à jour l'affichage avec les stats actuelles (qui sont déjà à jour globalement)
        this.updateVotePageDisplay()
      })
    }
    
    // Mettre à jour la visibilité des onglets admin si on est sur la vue admin
    if (viewName === 'admin') {
      // Utiliser un petit délai pour s'assurer que le DOM est prêt
      setTimeout(() => {
        this.updateAdminTabsVisibility()
      }, 50)
    }
    
    // Réinitialiser le flag après un court délai
    setTimeout(() => {
      this.viewSwitchInProgress = false
    }, 200)
  }

  initCalculator() {
    this.currentCalcType = 'drogue'
    this.renderDrugCalculator()
    this.renderItems()

    const saveBtn = document.getElementById('save-selection-btn')
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (this.selectedItems.size === 0) {
          alert('Veuillez sélectionner au moins un item')
          return
        }
        this.saveToHistory()
      })
    }

    this.initSearchInputs()
  }

  switchCalculatorType(type) {

    this.currentCalcType = type

    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.id !== 'logout-btn') {
        item.classList.remove('active')
        if (item.dataset.calcType === type) {
          item.classList.add('active')
        }
      }
    })

    document.querySelectorAll('.calculator-content').forEach(content => {
      content.classList.add('hidden')
      content.style.display = 'none'
      content.style.visibility = 'hidden'
      content.style.position = 'absolute'
      content.style.left = '-9999px'
      content.style.opacity = '0'
      content.style.pointerEvents = 'none'
    })

    let targetId = `calc-${type}`
    if (type === 'armes' || type === 'sniper' || type === 'arme-skin' || type === 'fusil') {
      targetId = 'calc-armes'
    }

    const targetContent = document.getElementById(targetId)
    if (targetContent) {

      targetContent.classList.remove('hidden')
      targetContent.style.display = 'flex'
      targetContent.style.visibility = 'visible'
      targetContent.style.position = 'relative'
      targetContent.style.left = 'auto'
      targetContent.style.opacity = '1'
      targetContent.style.pointerEvents = 'auto'
    } else {

    }

    if (type === 'drogue') {
      this.currentCalcType = 'drogue'
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.renderDrugsModern()
          this.initDrugsModern()
        }, 50)
      })
    } else if (type === 'armes' || type === 'sniper' || type === 'arme-skin' || type === 'fusil') {
      this.currentCalcType = 'armes'

      requestAnimationFrame(() => {
        setTimeout(() => {
          this.renderWeaponsModern()
          this.initWeaponsModern()
        }, 50)
      })
    } else {
      this.updateTotals()
    }
  }

  initSearchInputs() {

    const armesSearch = document.getElementById('armes-search')
    if (armesSearch) {

      const newSearch = armesSearch.cloneNode(true)
      armesSearch.parentNode.replaceChild(newSearch, armesSearch)

      let debounceTimer
      newSearch.addEventListener('input', (e) => {
        e.stopPropagation()
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          this.searchQuery = newSearch.value.trim().toLowerCase()

          this.renderCategory('sniper', 'sniper-tbody')
          this.renderCategory('weaponSkins', 'weaponSkins-tbody')
          this.renderCategory('rifle', 'rifle-tbody')
          this.renderCategory('armement', 'armement-tbody')
          this.renderCategory('accessoire', 'accessoire-tbody')
          this.renderCategory('vanillaSkin', 'vanillaSkin-tbody')
          this.updateTotals()
        }, 150)
      })

      newSearch.addEventListener('focus', (e) => {
        e.stopPropagation()
      })

      newSearch.addEventListener('click', (e) => {
        e.stopPropagation()
      })
    }
  }

  // ===== NOUVELLE FONCTIONNALITÉ ARMES MODERNE =====
  initWeaponsModern() {
    // Initialiser la recherche
    const searchInput = document.getElementById('armes-search')
    const searchClear = document.getElementById('armes-search-clear')
    
    if (searchInput) {
      let debounceTimer
      searchInput.addEventListener('input', (e) => {
        const value = e.target.value.trim()
        
        // Afficher/masquer le bouton clear
        if (searchClear) {
          searchClear.style.display = value ? 'flex' : 'none'
        }
        
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          this.searchQuery = value.toLowerCase()
          this.renderWeaponsModern()
        }, 200)
      })

      // Bouton clear
      if (searchClear) {
        searchClear.addEventListener('click', () => {
          searchInput.value = ''
          searchClear.style.display = 'none'
          this.searchQuery = ''
          this.renderWeaponsModern()
          searchInput.focus()
        })
      }
    }

    // Initialiser les onglets de catégories
    const tabs = document.querySelectorAll('.weapon-tab')
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const category = tab.dataset.category
        
        // Mettre à jour l'état actif
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // Stocker la catégorie active
        this.activeWeaponCategory = category === 'all' ? null : category
        
        // Re-rendre
        this.renderWeaponsModern()
      })
    })

    // Initialiser la catégorie active
    this.activeWeaponCategory = null
  }

  renderWeaponsModern() {
    const grid = document.getElementById('weapons-grid')
    const emptyState = document.getElementById('weapons-empty-state')
    
    if (!grid) return

    const categories = {
      sniper: { name: 'Sniper', icon: '🎯' },
      weaponSkins: { name: 'Skin BM', icon: '🎨' },
      rifle: { name: 'Fusil', icon: '🔫' },
      armement: { name: 'Armement', icon: '⚔️' },
      accessoire: { name: 'Accessoire', icon: '🔧' },
      vanillaSkin: { name: 'Vanilla Skin', icon: '🎨' }
    }

    // Collecter tous les items
    let allWeapons = []
    const query = this.searchQuery || ''
    const activeCategory = this.activeWeaponCategory

    Object.keys(categories).forEach(categoryKey => {
      if (activeCategory && activeCategory !== categoryKey) return
      
      const items = this.getItemsData()[categoryKey] || []
      items.forEach(item => {
        // Nettoyer le nom
        let cleanName = item.name
        const pricePatternStartEnd = /^\d{1,3}(?:\s?\d{3})*\s*€\s*(.+?)\s+\d{1,3}(?:\s?\d{3})*\s*€\s*$/i
        const pricePatternEnd = /^(.+?)\s+\d{1,3}(?:\s?\d{3})*\s*€\s*$/i
        const pricePatternStart = /^\d{1,3}(?:\s?\d{3})*\s*€\s*(.+?)$/i
        
        let match = cleanName.match(pricePatternStartEnd)
        if (match && match[1]) {
          cleanName = match[1].trim()
        } else {
          match = cleanName.match(pricePatternEnd)
          if (match && match[1]) {
            cleanName = match[1].trim()
          } else {
            match = cleanName.match(pricePatternStart)
            if (match && match[1]) {
              cleanName = match[1].trim()
            }
          }
        }
        cleanName = cleanName.replace(/\s+/g, ' ').trim()

        // Filtrer par recherche
        if (query && !cleanName.toLowerCase().includes(query)) {
          return
        }

        const sellPrice = typeof item.sellPrice === 'number' ? item.sellPrice : (parseFloat(item.sellPrice) || 0)
        const buyPrice = typeof item.buyPrice === 'number' ? item.buyPrice : (parseFloat(item.buyPrice) || 0)
        const profit = sellPrice - buyPrice

        allWeapons.push({
          name: cleanName,
          originalName: item.name,
          category: categoryKey,
          categoryInfo: categories[categoryKey],
          sellPrice,
          buyPrice,
          profit
        })
      })
    })

    // Mettre à jour les compteurs d'onglets
    Object.keys(categories).forEach(categoryKey => {
      const count = (this.getItemsData()[categoryKey] || []).length
      const countEl = document.getElementById(`tab-count-${categoryKey}`)
      if (countEl) countEl.textContent = count
    })
    
    const totalCount = Object.keys(categories).reduce((sum, key) => {
      return sum + (this.getItemsData()[key] || []).length
    }, 0)
    const totalCountEl = document.getElementById('tab-count-all')
    if (totalCountEl) totalCountEl.textContent = totalCount

    // Afficher/masquer l'état vide
    if (allWeapons.length === 0) {
      grid.style.display = 'none'
      if (emptyState) emptyState.style.display = 'flex'
      this.updateWeaponsStats([], [])
      return
    }

    grid.style.display = 'grid'
    if (emptyState) emptyState.style.display = 'none'

    // Générer les cartes
    grid.innerHTML = ''
    const fragment = document.createDocumentFragment()

    allWeapons.forEach((weapon, index) => {
      const card = this.createWeaponCard(weapon, index)
      fragment.appendChild(card)
    })

    grid.appendChild(fragment)

    // Animer les cartes
    requestAnimationFrame(() => {
      const cards = grid.querySelectorAll('.weapon-card')
      cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.05}s`
        card.classList.add('visible')
      })
    })

    // Mettre à jour les stats
    this.updateWeaponsStats(allWeapons, categories)
  }

  createWeaponCard(weapon, index) {
    const card = document.createElement('div')
    card.className = 'weapon-card'
    card.style.animationDelay = `${index * 0.05}s`

    const isAdmin = this.currentUser && this.currentUser.role === 'admin'
    const profitClass = weapon.profit >= 0 ? 'profit-positive' : 'profit-negative'
    const profitBadgeClass = weapon.profit >= 0 ? '' : 'negative'
    
    // Créer l'ID unique pour l'item
    const itemId = `${weapon.category}::${weapon.originalName}`
    const isSelected = this.selectedItems.has(itemId)
    const quantity = this.selectedItems.get(itemId) || 1

    card.innerHTML = `
      <div class="weapon-card-header">
        <div class="weapon-card-checkbox-container">
          <input type="checkbox" class="weapon-card-checkbox" data-item-id="${itemId}" ${isSelected ? 'checked' : ''}>
          <h3 class="weapon-card-name">${this.escapeHtml(weapon.name)}</h3>
        </div>
        <span class="weapon-card-category">${weapon.categoryInfo.icon} ${weapon.categoryInfo.name}</span>
      </div>
      <div class="weapon-card-stats">
        <div class="weapon-stat-item">
          <div class="weapon-stat-item-label">Prix de Revente</div>
          <div class="weapon-stat-item-value">${weapon.sellPrice > 0 ? this.formatPrice(weapon.sellPrice) : '-'}</div>
        </div>
        <div class="weapon-stat-item">
          <div class="weapon-stat-item-label">Prix d'Achat</div>
          <div class="weapon-stat-item-value">${weapon.buyPrice > 0 ? this.formatPrice(weapon.buyPrice) : '0 €'}</div>
        </div>
        <div class="weapon-stat-item">
          <div class="weapon-stat-item-label">Bénéfice</div>
          <div class="weapon-stat-item-value ${profitClass}">${weapon.sellPrice > 0 ? (weapon.profit >= 0 ? '+' : '') + this.formatPrice(Math.abs(weapon.profit)) : '-'}</div>
        </div>
      </div>
      ${isSelected ? `
      <div class="weapon-card-quantity">
        <label class="weapon-quantity-label">Quantité:</label>
        <input type="number" class="weapon-quantity-input" data-item-id="${itemId}" value="${quantity}" min="1" step="1">
      </div>
      ` : ''}
      <div class="weapon-card-footer">
        <div class="weapon-card-actions">
          <button class="weapon-action-btn edit-price-btn-modern" data-category="${weapon.category}" data-item-name="${this.escapeHtml(weapon.originalName)}">Modifier Prix</button>
        </div>
        <div class="weapon-card-profit-badge ${profitBadgeClass}">
          ${weapon.profit >= 0 ? '📈' : '📉'} ${weapon.sellPrice > 0 ? this.formatPrice(Math.abs(weapon.profit)) : '-'}
        </div>
      </div>
    `

    // Ajouter les event listeners
    const checkbox = card.querySelector('.weapon-card-checkbox')
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId
        if (e.target.checked) {
          this.selectedItems.set(itemId, 1)
          // Ajouter le champ quantité
          const quantityContainer = document.createElement('div')
          quantityContainer.className = 'weapon-card-quantity'
          quantityContainer.innerHTML = `
            <label class="weapon-quantity-label">Quantité:</label>
            <input type="number" class="weapon-quantity-input" data-item-id="${itemId}" value="1" min="1" step="1">
          `
          const stats = card.querySelector('.weapon-card-stats')
          stats.after(quantityContainer)
          
          // Ajouter l'event listener pour la quantité
          const quantityInput = quantityContainer.querySelector('.weapon-quantity-input')
          quantityInput.addEventListener('input', () => {
            const qty = Math.max(1, parseInt(quantityInput.value) || 1)
            this.selectedItems.set(itemId, qty)
            this.updateTotals()
          })
          quantityInput.addEventListener('change', () => {
            const qty = Math.max(1, parseInt(quantityInput.value) || 1)
            quantityInput.value = qty
            this.selectedItems.set(itemId, qty)
            this.updateTotals()
          })
        } else {
          this.selectedItems.delete(itemId)
          // Retirer le champ quantité
          const quantityContainer = card.querySelector('.weapon-card-quantity')
          if (quantityContainer) {
            quantityContainer.remove()
          }
        }
        this.updateTotals()
      })
    }

    // Event listener pour la quantité si elle existe déjà
    const quantityInput = card.querySelector('.weapon-quantity-input')
    if (quantityInput) {
      quantityInput.addEventListener('input', () => {
        const itemId = quantityInput.dataset.itemId
        const qty = Math.max(1, parseInt(quantityInput.value) || 1)
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
      quantityInput.addEventListener('change', () => {
        const itemId = quantityInput.dataset.itemId
        const qty = Math.max(1, parseInt(quantityInput.value) || 1)
        quantityInput.value = qty
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
    }

    // Ajouter les event listeners pour l'édition des prix (tous les utilisateurs peuvent modifier leurs prix d'achat)
    const editBtn = card.querySelector('.edit-price-btn-modern')
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.handleEditWeaponPrice(weapon, card)
      })
    }

    return card
  }

  async handleEditWeaponPrice(weapon, card) {
    const allItems = this.getItemsData()[weapon.category] || []
    const itemIndex = allItems.findIndex(item => item.name === weapon.originalName)
    if (itemIndex === -1) return

    const currentItem = allItems[itemIndex]
    const itemId = `${weapon.category}::${weapon.originalName}`
    const buyPriceKey = `${itemId}::buyPrice`
    const currentPrice = (this.priceOverrides[buyPriceKey] ?? currentItem.buyPrice) || 0

    // Utiliser un modal personnalisé au lieu de prompt()
    const price = await this.openEditPriceModal(weapon.name, currentPrice)
    if (price === null) return

    // Si le prix est 0 ou égal au prix par défaut, supprimer l'override
    if (price === 0 || price === currentItem.buyPrice) {
      delete this.priceOverrides[buyPriceKey]
    } else {
      this.priceOverrides[buyPriceKey] = price
    }
    
    this._priceOverridesChanged = true
    await this.savePriceOverrides()
    this.renderWeaponsModern()
    this.updateTotals()
  }

  updateWeaponsStats(weapons, categories) {
    // Total count
    const totalCountEl = document.getElementById('weapons-total-count')
    if (totalCountEl) {
      totalCountEl.textContent = weapons.length
    }

    // Prix moyen
    if (weapons.length > 0) {
      const totalSellPrice = weapons.reduce((sum, w) => sum + (w.sellPrice || 0), 0)
      const avgPrice = Math.round(totalSellPrice / weapons.length)
      const avgPriceEl = document.getElementById('weapons-avg-price')
      if (avgPriceEl) {
        avgPriceEl.textContent = this.formatPrice(avgPrice)
      }

      // Bénéfice moyen
      const totalProfit = weapons.reduce((sum, w) => sum + (w.profit || 0), 0)
      const avgProfit = Math.round(totalProfit / weapons.length)
      const avgProfitEl = document.getElementById('weapons-avg-profit')
      if (avgProfitEl) {
        avgProfitEl.textContent = (avgProfit >= 0 ? '+' : '') + this.formatPrice(Math.abs(avgProfit))
        avgProfitEl.className = 'weapon-stat-value profit'
      }
    } else {
      const avgPriceEl = document.getElementById('weapons-avg-price')
      if (avgPriceEl) avgPriceEl.textContent = '0 €'
      const avgProfitEl = document.getElementById('weapons-avg-profit')
      if (avgProfitEl) {
        avgProfitEl.textContent = '0 €'
        avgProfitEl.className = 'weapon-stat-value'
      }
    }

    // Résumé total
    const totalBuy = weapons.reduce((sum, w) => sum + (w.buyPrice || 0), 0)
    const totalSell = weapons.reduce((sum, w) => sum + (w.sellPrice || 0), 0)
    const totalProfit = totalSell - totalBuy

    const totalBuyEl = document.getElementById('weapons-total-buy')
    if (totalBuyEl) totalBuyEl.textContent = this.formatPrice(totalBuy)

    const totalSellEl = document.getElementById('weapons-total-sell')
    if (totalSellEl) totalSellEl.textContent = this.formatPrice(totalSell)

    const totalProfitEl = document.getElementById('weapons-total-profit')
    if (totalProfitEl) {
      totalProfitEl.textContent = (totalProfit >= 0 ? '+' : '') + this.formatPrice(Math.abs(totalProfit))
      totalProfitEl.className = 'summary-stat-value profit'
    }
  }

  // Recherche pour les drogues
  initDrugSearch() {
    const drugSearch = document.getElementById('drug-search')
    if (drugSearch) {
      let debounceTimer
      drugSearch.addEventListener('input', (e) => {
        e.stopPropagation()
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          this.drugSearchQuery = drugSearch.value.trim()
          this.renderDrugCalculator()
        }, 150)
      })

      drugSearch.addEventListener('focus', (e) => {
        e.stopPropagation()
      })
    }
  }

  // ===== NOUVELLE FONCTIONNALITÉ DROGUES MODERNE =====
  initDrugsModern() {
    // Initialiser la recherche
    const searchInput = document.getElementById('drug-search')
    const searchClear = document.getElementById('drug-search-clear')
    
    if (searchInput) {
      let debounceTimer
      searchInput.addEventListener('input', (e) => {
        const value = e.target.value.trim()
        
        // Afficher/masquer le bouton clear
        if (searchClear) {
          searchClear.style.display = value ? 'flex' : 'none'
        }
        
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          this.drugSearchQuery = value.toLowerCase()
          this.renderDrugsModern()
        }, 200)
      })

      // Bouton clear
      if (searchClear) {
        searchClear.addEventListener('click', () => {
          searchInput.value = ''
          searchClear.style.display = 'none'
          this.drugSearchQuery = ''
          this.renderDrugsModern()
          searchInput.focus()
        })
      }
    }

    // Initialiser les onglets de catégories
    const tabs = document.querySelectorAll('.drug-tab')
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const category = tab.dataset.category
        
        // Mettre à jour l'état actif
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // Stocker la catégorie active
        this.activeDrugCategory = category === 'all' ? null : category
        
        // Re-rendre
        this.renderDrugsModern()
      })
    })

    // Initialiser la catégorie active
    this.activeDrugCategory = null
  }

  renderDrugsModern() {
    const grid = document.getElementById('drugs-grid')
    const emptyState = document.getElementById('drugs-empty-state')
    
    if (!grid) return

    const categories = {
      drugBriques: { name: 'Brique', icon: '🔵' },
      drugSachetGraine: { name: 'Sachet Graine', icon: '🟡' },
      drugGraine: { name: 'Graine', icon: '🟣' },
      drugBourgeons: { name: 'Bourgeon', icon: '🟢' },
      drugPochon: { name: 'Pochon', icon: '🔴' }
    }

    // Collecter tous les items
    let allDrugs = []
    const query = this.drugSearchQuery || ''
    const activeCategory = this.activeDrugCategory

    Object.keys(categories).forEach(categoryKey => {
      if (activeCategory && activeCategory !== categoryKey) return
      
      const items = this.getItemsData()[categoryKey] || []
      items.forEach(item => {
        // Filtrer par recherche
        if (query && !item.name.toLowerCase().includes(query)) {
          return
        }

        const sellPrice = typeof item.sellPrice === 'number' ? item.sellPrice : (parseFloat(item.sellPrice) || 0)
        const buyPrice = typeof item.buyPrice === 'number' ? item.buyPrice : (parseFloat(item.buyPrice) || 0)
        const profit = sellPrice - buyPrice

        allDrugs.push({
          name: item.name,
          originalName: item.name,
          category: categoryKey,
          categoryInfo: categories[categoryKey],
          sellPrice,
          buyPrice,
          profit
        })
      })
    })

    // Mettre à jour les compteurs d'onglets
    Object.keys(categories).forEach(categoryKey => {
      const count = (this.getItemsData()[categoryKey] || []).length
      const countEl = document.getElementById(`tab-count-${categoryKey}`)
      if (countEl) countEl.textContent = count
    })
    
    const totalCount = Object.keys(categories).reduce((sum, key) => {
      return sum + (this.getItemsData()[key] || []).length
    }, 0)
    const totalCountEl = document.getElementById('tab-count-all-drugs')
    if (totalCountEl) totalCountEl.textContent = totalCount

    // Afficher/masquer l'état vide
    if (allDrugs.length === 0) {
      grid.style.display = 'none'
      if (emptyState) emptyState.style.display = 'flex'
      this.updateDrugsStats([], [])
      return
    }

    grid.style.display = 'grid'
    if (emptyState) emptyState.style.display = 'none'

    // Générer les cartes
    grid.innerHTML = ''
    const fragment = document.createDocumentFragment()

    allDrugs.forEach((drug, index) => {
      const card = this.createDrugCard(drug, index)
      fragment.appendChild(card)
    })

    grid.appendChild(fragment)

    // Animer les cartes
    requestAnimationFrame(() => {
      const cards = grid.querySelectorAll('.drug-card')
      cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.05}s`
        card.classList.add('visible')
      })
    })

    // Mettre à jour les stats
    this.updateDrugsStats(allDrugs, categories)
  }

  createDrugCard(drug, index) {
    const card = document.createElement('div')
    card.className = 'drug-card'
    card.style.animationDelay = `${index * 0.05}s`

    const profitClass = drug.profit >= 0 ? 'profit-positive' : 'profit-negative'
    const profitBadgeClass = drug.profit >= 0 ? '' : 'negative'
    
    // Créer l'ID unique pour l'item
    const itemId = `${drug.category}::${drug.originalName}`
    const isSelected = this.selectedItems.has(itemId)
    const quantity = this.selectedItems.get(itemId) || 1
    
    // Récupérer le prix personnalisé s'il existe
    const buyPriceKey = `${itemId}::buyPrice`
    const customBuyPrice = this.priceOverrides[buyPriceKey] ?? drug.buyPrice
    const actualProfit = drug.sellPrice - customBuyPrice

    card.innerHTML = `
      <div class="drug-card-header">
        <div class="drug-card-checkbox-container">
          <input type="checkbox" class="drug-card-checkbox" data-item-id="${itemId}" ${isSelected ? 'checked' : ''}>
          <h3 class="drug-card-name">${this.escapeHtml(drug.name)}</h3>
        </div>
        <span class="drug-card-category">${drug.categoryInfo.icon} ${drug.categoryInfo.name}</span>
      </div>
      <div class="drug-card-stats">
        <div class="drug-stat-item">
          <div class="drug-stat-item-label">Prix de Revente</div>
          <div class="drug-stat-item-value">${drug.sellPrice > 0 ? this.formatPrice(drug.sellPrice) : '-'}</div>
        </div>
        <div class="drug-stat-item">
          <div class="drug-stat-item-label">Prix d'Achat</div>
          <div class="drug-stat-item-value">${customBuyPrice > 0 ? this.formatPrice(customBuyPrice) : '0 €'}</div>
        </div>
        <div class="drug-stat-item">
          <div class="drug-stat-item-label">Bénéfice</div>
          <div class="drug-stat-item-value ${actualProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${drug.sellPrice > 0 ? (actualProfit >= 0 ? '+' : '') + this.formatPrice(Math.abs(actualProfit)) : '-'}</div>
        </div>
      </div>
      ${isSelected ? `
      <div class="drug-card-quantity">
        <label class="drug-quantity-label">Quantité:</label>
        <input type="number" class="drug-quantity-input" data-item-id="${itemId}" value="${quantity}" min="1" step="1">
      </div>
      ` : ''}
      <div class="drug-card-footer">
        <div class="drug-card-actions">
          <button class="drug-action-btn edit-price-btn-drug" data-category="${drug.category}" data-item-name="${this.escapeHtml(drug.originalName)}">Modifier Prix</button>
        </div>
        <div class="drug-card-profit-badge ${actualProfit >= 0 ? '' : 'negative'}">
          ${actualProfit >= 0 ? '📈' : '📉'} ${drug.sellPrice > 0 ? this.formatPrice(Math.abs(actualProfit)) : '-'}
        </div>
      </div>
    `

    // Ajouter les event listeners
    const checkbox = card.querySelector('.drug-card-checkbox')
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId
        if (e.target.checked) {
          this.selectedItems.set(itemId, 1)
          // Ajouter le champ quantité
          const quantityContainer = document.createElement('div')
          quantityContainer.className = 'drug-card-quantity'
          quantityContainer.innerHTML = `
            <label class="drug-quantity-label">Quantité:</label>
            <input type="number" class="drug-quantity-input" data-item-id="${itemId}" value="1" min="1" step="1">
          `
          const stats = card.querySelector('.drug-card-stats')
          stats.after(quantityContainer)
          
          // Ajouter l'event listener pour la quantité
          const quantityInput = quantityContainer.querySelector('.drug-quantity-input')
          quantityInput.addEventListener('input', () => {
            const qty = Math.max(1, parseInt(quantityInput.value) || 1)
            this.selectedItems.set(itemId, qty)
            this.updateTotals()
          })
          quantityInput.addEventListener('change', () => {
            const qty = Math.max(1, parseInt(quantityInput.value) || 1)
            quantityInput.value = qty
            this.selectedItems.set(itemId, qty)
            this.updateTotals()
          })
        } else {
          this.selectedItems.delete(itemId)
          // Retirer le champ quantité
          const quantityContainer = card.querySelector('.drug-card-quantity')
          if (quantityContainer) {
            quantityContainer.remove()
          }
        }
        this.updateTotals()
      })
    }

    // Event listener pour la quantité si elle existe déjà
    const quantityInput = card.querySelector('.drug-quantity-input')
    if (quantityInput) {
      quantityInput.addEventListener('input', () => {
        const itemId = quantityInput.dataset.itemId
        const qty = Math.max(1, parseInt(quantityInput.value) || 1)
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
      quantityInput.addEventListener('change', () => {
        const itemId = quantityInput.dataset.itemId
        const qty = Math.max(1, parseInt(quantityInput.value) || 1)
        quantityInput.value = qty
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
    }

    // Event listener pour modifier le prix
    const editBtn = card.querySelector('.edit-price-btn-drug')
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.handleEditDrugPrice(drug, card)
      })
    }

    return card
  }

  async handleEditDrugPrice(drug, card) {
    const allItems = this.getItemsData()[drug.category] || []
    const itemIndex = allItems.findIndex(item => item.name === drug.originalName)
    if (itemIndex === -1) return

    const currentItem = allItems[itemIndex]
    const itemId = `${drug.category}::${drug.originalName}`
    const buyPriceKey = `${itemId}::buyPrice`
    const currentPrice = (this.priceOverrides[buyPriceKey] ?? currentItem.buyPrice) || 0

    // Utiliser un modal personnalisé au lieu de prompt()
    const price = await this.openEditPriceModal(drug.name, currentPrice)
    if (price === null) return

    if (price === currentItem.buyPrice || price === 0) {
      delete this.priceOverrides[buyPriceKey]
    } else {
      this.priceOverrides[buyPriceKey] = price
    }
    
    this._priceOverridesChanged = true
    await this.savePriceOverrides()
    this.renderDrugsModern()
    this.updateTotals()
  }

  updateDrugsStats(drugs, categories) {
    // Total count
    const totalCountEl = document.getElementById('drugs-total-count')
    if (totalCountEl) {
      totalCountEl.textContent = drugs.length
    }

    // Prix moyen
    if (drugs.length > 0) {
      const totalSellPrice = drugs.reduce((sum, d) => sum + (d.sellPrice || 0), 0)
      const avgPrice = Math.round(totalSellPrice / drugs.length)
      const avgPriceEl = document.getElementById('drugs-avg-price')
      if (avgPriceEl) {
        avgPriceEl.textContent = this.formatPrice(avgPrice)
      }

      // Bénéfice moyen
      const totalProfit = drugs.reduce((sum, d) => {
        const itemId = `${d.category}::${d.originalName}`
        const buyPriceKey = `${itemId}::buyPrice`
        const customBuyPrice = this.priceOverrides[buyPriceKey] ?? d.buyPrice
        return sum + (d.sellPrice - customBuyPrice)
      }, 0)
      const avgProfit = Math.round(totalProfit / drugs.length)
      const avgProfitEl = document.getElementById('drugs-avg-profit')
      if (avgProfitEl) {
        avgProfitEl.textContent = (avgProfit >= 0 ? '+' : '') + this.formatPrice(Math.abs(avgProfit))
        avgProfitEl.className = 'drug-stat-value profit'
      }
    } else {
      const avgPriceEl = document.getElementById('drugs-avg-price')
      if (avgPriceEl) avgPriceEl.textContent = '0 €'
      const avgProfitEl = document.getElementById('drugs-avg-profit')
      if (avgProfitEl) {
        avgProfitEl.textContent = '0 €'
        avgProfitEl.className = 'drug-stat-value'
      }
    }
  }

  renderItems() {
    if (this.currentCalcType === 'armes') {
      const calcArmesView = document.getElementById('calc-armes')
      if (calcArmesView) {
        calcArmesView.classList.remove('hidden')
      }

      this.renderCategory('sniper', 'sniper-tbody')
      this.renderCategory('weaponSkins', 'weaponSkins-tbody')
      this.renderCategory('rifle', 'rifle-tbody')
      this.renderCategory('armement', 'armement-tbody')
      this.renderCategory('accessoire', 'accessoire-tbody')
      this.renderCategory('vanillaSkin', 'vanillaSkin-tbody')
    }
  }

  renderDrugCalculator() {
    const drugCategories = [
      { key: 'drugBriques', tbody: 'drug-briques-tbody', name: 'Brique' },
      { key: 'drugSachetGraine', tbody: 'drug-sachet-tbody', name: 'Sachet Graine' },
      { key: 'drugGraine', tbody: 'drug-graine-tbody', name: 'Graine Unitaire' },
      { key: 'drugBourgeons', tbody: 'drug-bourgeon-tbody', name: 'Bourgeon' },
      { key: 'drugPochon', tbody: 'drug-pochon-tbody', name: 'Pochon' }
    ]

    // Utiliser requestAnimationFrame pour un rendu non-bloquant
    requestAnimationFrame(() => {
    drugCategories.forEach(cat => {
      this.renderDrugCategory(cat.key, cat.tbody, cat.name)
    })
    this.updateDrugSummary()
    })
  }

  renderDrugCategory(categoryKey, tbodyId, categoryName) {
    const items = this.getItemsData()[categoryKey] || []
    const tbody = document.getElementById(tbodyId)

    if (!tbody) return

    // Filtrer les items selon la recherche (optimisé avec cache)
    const searchQuery = (this.drugSearchQuery || '').toLowerCase()
    const filteredItems = searchQuery 
      ? items.filter(item => {
          // Cache de recherche pour éviter les toLowerCase répétés
          if (!item._searchCache) {
            item._searchCache = item.name.toLowerCase()
          }
          return item._searchCache.includes(searchQuery)
        })
      : items

    // Utiliser DocumentFragment pour une insertion DOM plus rapide
    const fragment = document.createDocumentFragment()
    const rows = filteredItems.map(item => {
      const itemId = `${categoryKey}::${item.name}`
      const quantity = this.selectedItems.get(itemId) || 0
      const buyPriceKey = `${itemId}::buyPrice`
      const customBuyPrice = this.priceOverrides[buyPriceKey] ?? item.buyPrice
      const buyTotal = customBuyPrice * quantity
      const sellTotal = item.sellPrice * quantity
      const margin = sellTotal - buyTotal
      const marginClass = margin >= 0 ? 'text-success' : 'text-danger'

      const isCustomPrice = customBuyPrice !== item.buyPrice && customBuyPrice > 0
      const priceInputClass = isCustomPrice ? 'drug-buy-price-input custom-price' : 'drug-buy-price-input'

      return `
        <tr>
          <td><strong>${this.escapeHtml(item.name)}</strong></td>
          <td class="text-right">
            <input type="number" 
                   class="${priceInputClass}" 
                   data-item-id="${itemId}"
                   data-category="${categoryKey}"
                   data-default-price="${item.buyPrice}"
                   value="${customBuyPrice}"
                   min="0"
                   step="1"
                   placeholder="0"
                   title="${isCustomPrice ? 'Prix personnalisé (double-clic pour réinitialiser)' : 'Entrez le prix d&apos;achat'}">
          </td>
          <td class="text-right">
            <input type="number" 
                   class="drug-quantity-input" 
                   data-item-id="${itemId}"
                   data-category="${categoryKey}"
                   value="${quantity}"
                   min="0"
                   step="1">
          </td>
          <td class="text-right">${buyTotal > 0 ? this.formatPrice(buyTotal) : '0 €'}</td>
          <td class="text-right">${item.sellPrice > 0 ? this.formatPrice(item.sellPrice) : '-'}</td>
          <td class="text-right">${sellTotal > 0 ? this.formatPrice(sellTotal) : '0 €'}</td>
          <td class="text-right ${marginClass}">
            ${margin >= 0 ? '+' : ''}${this.formatPrice(margin)}
          </td>
        </tr>
      `
    })
    
    // Créer les éléments DOM une seule fois
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = rows.join('')
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild)
    }
    tbody.innerHTML = ''
    tbody.appendChild(fragment)

    tbody.querySelectorAll('.drug-quantity-input').forEach(input => {
      input.addEventListener('input', () => {
        const itemId = input.dataset.itemId
        const qty = Math.max(0, parseInt(input.value) || 0)
        this.selectedItems.set(itemId, qty)
        // Utiliser requestAnimationFrame pour les mises à jour non-bloquantes
        requestAnimationFrame(() => {
          this.updateDrugCategory(categoryKey, tbodyId)
        this.updateDrugSummary()
        this.updateTotals()
        })
      })
    })

    // Debounce pour la sauvegarde des prix
    let savePriceDebounce = null
    
    tbody.querySelectorAll('.drug-buy-price-input').forEach(input => {
      const defaultPrice = parseFloat(input.dataset.defaultPrice) || 0
      
      // Mettre à jour le style initial
      const updateInputStyle = () => {
        const currentValue = parseFloat(input.value) || 0
        const isCustom = currentValue !== defaultPrice && currentValue > 0
        input.classList.toggle('custom-price', isCustom)
      }
      
      updateInputStyle()
      
      input.addEventListener('input', () => {
        const itemId = input.dataset.itemId
        const buyPrice = Math.max(0, parseFloat(input.value) || 0)
        const buyPriceKey = `${itemId}::buyPrice`
        
        // Si le prix est égal au prix par défaut, supprimer l'override
        if (buyPrice === defaultPrice || buyPrice === 0) {
          delete this.priceOverrides[buyPriceKey]
        } else {
          this.priceOverrides[buyPriceKey] = buyPrice
        }
        
        // Marquer que les overrides ont changé pour invalider le cache
        this._priceOverridesChanged = true
        
        // Debounce la sauvegarde pour éviter trop d'appels
        clearTimeout(savePriceDebounce)
        savePriceDebounce = setTimeout(() => {
          this.savePriceOverrides()
        }, 500)
        
        updateInputStyle()
        // Utiliser requestAnimationFrame pour les mises à jour non-bloquantes
        requestAnimationFrame(() => {
          this.updateDrugCategory(categoryKey, tbodyId)
          this.updateDrugSummary()
          this.updateTotals()
        })
      })
      
      // Permettre la réinitialisation avec un double-clic
      input.addEventListener('dblclick', () => {
        input.value = defaultPrice
        const itemId = input.dataset.itemId
        const buyPriceKey = `${itemId}::buyPrice`
        delete this.priceOverrides[buyPriceKey]
        this._priceOverridesChanged = true
        this.savePriceOverrides()
        updateInputStyle()
        // Utiliser requestAnimationFrame pour les mises à jour non-bloquantes
        requestAnimationFrame(() => {
          this.updateDrugCategory(categoryKey, tbodyId)
          this.updateDrugSummary()
          this.updateTotals()
        })
        notificationService.info('Prix réinitialisé')
      })
    })
  }

  updateDrugCategory(categoryKey, tbodyId) {
    const items = this.getItemsData()[categoryKey] || []
    const tbody = document.getElementById(tbodyId)

    if (!tbody) return

    const searchQuery = (this.drugSearchQuery || '').toLowerCase()
    const filteredItems = searchQuery 
      ? items.filter(item => {
          // Cache de recherche pour éviter les toLowerCase répétés
          if (!item._searchCache) {
            item._searchCache = item.name.toLowerCase()
          }
          return item._searchCache.includes(searchQuery)
        })
      : items

    tbody.querySelectorAll('tr').forEach((row, index) => {
      const item = filteredItems[index]
      if (item) {
        const itemId = `${categoryKey}::${item.name}`
        const quantity = this.selectedItems.get(itemId) || 0
        const buyPriceKey = `${itemId}::buyPrice`
        const customBuyPrice = this.priceOverrides[buyPriceKey] ?? item.buyPrice
        const buyTotal = customBuyPrice * quantity
        const sellTotal = item.sellPrice * quantity
        const margin = sellTotal - buyTotal
        const marginClass = margin >= 0 ? 'text-success' : 'text-danger'

        const cells = row.querySelectorAll('td')
        if (cells.length >= 7) {
          cells[3].textContent = this.formatPrice(buyTotal)
          cells[5].textContent = this.formatPrice(sellTotal)
          cells[6].textContent = (margin >= 0 ? '+' : '') + this.formatPrice(margin)
          cells[6].className = `text-right ${marginClass}`
        }

        const quantityInput = row.querySelector('.drug-quantity-input')
        if (quantityInput) {
          quantityInput.value = quantity
        }

        const buyPriceInput = row.querySelector('.drug-buy-price-input')
        if (buyPriceInput) {
          buyPriceInput.value = customBuyPrice
          const isCustom = customBuyPrice !== item.buyPrice && customBuyPrice > 0
          buyPriceInput.classList.toggle('custom-price', isCustom)
        }
      }
    })
  }

  updateDrugSummary() {
    const categories = [
      { key: 'drugBriques', name: 'Brique' },
      { key: 'drugSachetGraine', name: 'Sachet Graine' },
      { key: 'drugGraine', name: 'Graine Unitaire' },
      { key: 'drugBourgeons', name: 'Bourgeon' },
      { key: 'drugPochon', name: 'Pochon' }
    ]

    let totalBuy = 0
    let totalSell = 0

    const summaryTbody = document.getElementById('drug-summary-tbody')

    if (summaryTbody) {
      // Utiliser DocumentFragment pour une insertion DOM plus rapide
      const fragment = document.createDocumentFragment()
      const rows = categories.map(cat => {
        const items = this.getItemsData()[cat.key] || []
        let categoryQty = 0
        let categoryBuyTotal = 0
        let categorySellTotal = 0

        items.forEach(item => {
          const itemId = `${cat.key}::${item.name}`
          const qty = this.selectedItems.get(itemId) || 0
          const buyPriceKey = `${itemId}::buyPrice`
          const customBuyPrice = this.priceOverrides[buyPriceKey] ?? item.buyPrice
          categoryQty += qty
          categoryBuyTotal += customBuyPrice * qty
          categorySellTotal += item.sellPrice * qty
        })

        totalBuy += categoryBuyTotal
        totalSell += categorySellTotal
        const profit = categorySellTotal - categoryBuyTotal
        const profitClass = profit >= 0 ? 'text-success' : 'text-danger'

        return `
          <tr>
            <td>${cat.name}</td>
            <td class="text-right">${categoryQty}</td>
            <td class="text-right">${this.formatPrice(categoryBuyTotal)}</td>
            <td class="text-right">${this.formatPrice(categorySellTotal)}</td>
            <td class="text-right ${profitClass}">
              ${profit >= 0 ? '+' : ''}${this.formatPrice(profit)}
            </td>
          </tr>
        `
      })
      
      // Créer les éléments DOM une seule fois
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = rows.join('')
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild)
      }
      summaryTbody.innerHTML = ''
      summaryTbody.appendChild(fragment)
    }

    const drugTotalBuy = document.getElementById('drug-total-buy')
    const drugTotalSell = document.getElementById('drug-total-sell')
    const drugProfitSpan = document.querySelector('#drug-profit')

    if (drugTotalBuy) drugTotalBuy.textContent = this.formatPrice(totalBuy)
    if (drugTotalSell) drugTotalSell.textContent = this.formatPrice(totalSell)
    if (drugProfitSpan) {
      const profit = totalSell - totalBuy
      drugProfitSpan.textContent = this.formatPrice(profit)
      drugProfitSpan.className = profit >= 0 ? 'text-success' : 'text-danger'
    }
  }

  renderCategory(categoryKey, tbodyId) {
    const tbody = document.getElementById(tbodyId)
    if (!tbody) {
      requestAnimationFrame(() => {
        const retryTbody = document.getElementById(tbodyId)
        if (retryTbody) {
          this.renderCategory(categoryKey, tbodyId)
        }
      })
      return
    }

    const allItems = this.getItemsData()[categoryKey] || []

    if (!allItems.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Aucun item dans cette catégorie</td></tr>'
      return
    }

    const query = this.searchQuery.toLowerCase()
    const items = query
      ? allItems.filter(it => {
          // Cache de recherche pour éviter les toLowerCase répétés
          if (!it._searchCache) {
            it._searchCache = it.name.toLowerCase()
          }
          return it._searchCache.includes(query)
        })
      : allItems

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Aucun item trouvé</td></tr>'
      return
    }

    const isAdmin = this.currentUser && this.currentUser.role === 'admin'
    const isArmeCategory = categoryKey === 'sniper' || categoryKey === 'weaponSkins' || categoryKey === 'rifle' || categoryKey === 'armement' || categoryKey === 'accessoire' || categoryKey === 'vanillaSkin'

    // Utiliser DocumentFragment pour une insertion DOM plus rapide
    const fragment = document.createDocumentFragment()
    const rows = items.map((item) => {
      const realIndex = allItems.findIndex(it => it.name === item.name)

      // Nettoyer le nom s'il contient des prix (formats: "18000 € Nom 90000 €", "Nom 68000 €", "18000 € Nom")
      let cleanName = item.name
      // Pattern pour détecter les prix au début et à la fin du nom (ex: "18000 € Nom 90000 €")
      // Supporte les formats avec ou sans espaces : "18000 €", "18 000 €", "18000€"
      const pricePatternStartEnd = /^\d{1,3}(?:\s?\d{3})*\s*€\s*(.+?)\s+\d{1,3}(?:\s?\d{3})*\s*€\s*$/i
      // Pattern pour détecter un prix à la fin seulement (ex: "Nom 68000 €" ou "AR 50A1 68000 €")
      const pricePatternEnd = /^(.+?)\s+\d{1,3}(?:\s?\d{3})*\s*€\s*$/i
      // Pattern pour détecter un prix au début seulement (ex: "18000 € Nom")
      const pricePatternStart = /^\d{1,3}(?:\s?\d{3})*\s*€\s*(.+?)$/i
      
      // Essayer d'abord le pattern avec prix au début et à la fin
      let match = cleanName.match(pricePatternStartEnd)
      if (match && match[1]) {
        cleanName = match[1].trim()
      } else {
        // Essayer le pattern avec prix à la fin
        match = cleanName.match(pricePatternEnd)
        if (match && match[1]) {
          cleanName = match[1].trim()
        } else {
          // Essayer le pattern avec prix au début
          match = cleanName.match(pricePatternStart)
          if (match && match[1]) {
            cleanName = match[1].trim()
          }
        }
      }
      
      // Nettoyage final : supprimer les espaces multiples et les prix restants
      cleanName = cleanName.replace(/\s+/g, ' ').trim()

      if (isArmeCategory) {
        // Format pour les armes : Nom | Prix de Revente | Prix d'Achat | Bénéfice
        // S'assurer que les prix sont bien numériques
        const sellPrice = typeof item.sellPrice === 'number' ? item.sellPrice : (parseFloat(item.sellPrice) || 0)
        const buyPrice = typeof item.buyPrice === 'number' ? item.buyPrice : (parseFloat(item.buyPrice) || 0)
        const calculatedMargin = sellPrice - buyPrice
        const marginClass = calculatedMargin >= 0 ? 'text-success' : 'text-danger'

      return `
        <tr>
            <td><strong>${this.escapeHtml(cleanName)}</strong></td>
            <td class="text-right">${sellPrice > 0 ? this.formatPrice(sellPrice) : '-'}</td>
          <td class="text-right">
            ${isAdmin ? `
              <div class="price-cell" data-category="${categoryKey}" data-item-name="${this.escapeHtml(item.name)}" data-real-index="${realIndex}">
                  <span class="price-text">${buyPrice > 0 ? this.formatPrice(buyPrice) : '0 €'}</span>
                <button class="icon-btn edit-price-btn" title="Modifier" data-category="${categoryKey}" data-item-name="${this.escapeHtml(item.name)}" data-real-index="${realIndex}" data-tbody="${tbodyId}">✏️</button>
              </div>
              ` : (buyPrice > 0 ? this.formatPrice(buyPrice) : '0 €')}
          </td>
            <td class="text-right ${marginClass}">
              ${sellPrice > 0 ? this.formatPrice(Math.abs(calculatedMargin)) : '-'}
            </td>
          </tr>
        `
      } else {
        // Format pour les autres catégories (si nécessaire)
        const sellPrice = typeof item.sellPrice === 'number' ? item.sellPrice : (parseFloat(item.sellPrice) || 0)
        const buyPrice = typeof item.buyPrice === 'number' ? item.buyPrice : (parseFloat(item.buyPrice) || 0)
        const calculatedMargin = sellPrice - buyPrice
        const marginClass = calculatedMargin >= 0 ? 'text-success' : 'text-danger'
        
        return `
          <tr>
            <td><strong>${this.escapeHtml(cleanName)}</strong></td>
          <td class="text-right">
              ${isAdmin ? `
                <div class="price-cell" data-category="${categoryKey}" data-item-name="${this.escapeHtml(item.name)}" data-real-index="${realIndex}">
                  <span class="price-text">${buyPrice > 0 ? this.formatPrice(buyPrice) : '0 €'}</span>
                  <button class="icon-btn edit-price-btn" title="Modifier" data-category="${categoryKey}" data-item-name="${this.escapeHtml(item.name)}" data-real-index="${realIndex}" data-tbody="${tbodyId}">✏️</button>
                </div>
              ` : (buyPrice > 0 ? this.formatPrice(buyPrice) : '0 €')}
          </td>
            <td class="text-right">${sellPrice > 0 ? this.formatPrice(sellPrice) : '-'}</td>
          <td class="text-right ${marginClass}">
              ${sellPrice > 0 ? (calculatedMargin >= 0 ? '+' : '') + this.formatPrice(calculatedMargin) : '-'}
          </td>
        </tr>
      `
      }
    })
    
    // Créer les éléments DOM une seule fois
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = rows.join('')
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild)
    }
    tbody.innerHTML = ''
    tbody.appendChild(fragment)

    if (isArmeCategory) {
      // Ajouter les event listeners pour l'édition des prix (admins)
      tbody.querySelectorAll('.edit-price-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const category = btn.dataset.category
          const realIndex = parseInt(btn.dataset.realIndex)
          const itemName = btn.dataset.itemName
          const container = btn.closest('.price-cell')
          const allItems = this.getItemsData()[category]
          const currentItem = allItems[realIndex]
          if (!container || !currentItem) return
        })
      })
    } else {
      tbody.querySelectorAll('.item-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId
        if (e.target.checked) {

          this.selectedItems.set(itemId, 1)

          const container = e.target.closest('.checkbox-quantity-container')
          if (container && !container.querySelector('.item-quantity')) {
            const quantityInput = document.createElement('input')
            quantityInput.type = 'number'
            quantityInput.className = 'item-quantity'
            quantityInput.setAttribute('data-item-id', itemId)
            quantityInput.value = '1'
            quantityInput.min = '1'
            quantityInput.step = '1'
            quantityInput.title = 'Quantité'
            container.appendChild(quantityInput)

            quantityInput.addEventListener('input', () => {
              const qty = Math.max(1, parseInt(quantityInput.value) || 1)
              this.selectedItems.set(itemId, qty)
              this.updateTotals()
            })
            quantityInput.addEventListener('change', () => {
              const qty = Math.max(1, parseInt(quantityInput.value) || 1)
              quantityInput.value = qty
              this.selectedItems.set(itemId, qty)
              this.updateTotals()
            })
          }
        } else {

          this.selectedItems.delete(itemId)

          const container = e.target.closest('.checkbox-quantity-container')
          const quantityInput = container?.querySelector('.item-quantity')
          if (quantityInput) {
            quantityInput.remove()
          }
        }
        this.updateTotals()
      })
    })

    tbody.querySelectorAll('.item-quantity').forEach(quantityInput => {
      quantityInput.addEventListener('input', (e) => {
        const itemId = e.target.dataset.itemId
        const qty = Math.max(1, parseInt(e.target.value) || 1)
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
      quantityInput.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId
        const qty = Math.max(1, parseInt(e.target.value) || 1)
        e.target.value = qty
        this.selectedItems.set(itemId, qty)
        this.updateTotals()
      })
    })
    }

    // Permettre à tous les utilisateurs de modifier leurs prix
    if (this.currentUser) {
      tbody.querySelectorAll('.edit-price-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation() 
          const category = btn.dataset.category
          const realIndex = parseInt(btn.dataset.realIndex)
          const itemName = btn.dataset.itemName
          const container = btn.closest('.price-cell')
          const allItems = this.getItemsData()[category]
          const currentItem = allItems[realIndex]
          if (!container || !currentItem) return
          const current = currentItem.buyPrice
          container.innerHTML = `
            <div class="price-editor">
              <input type="number" class="buy-input" value="${current}" min="0" step="1">
              <button class="icon-btn save-price-btn" title="Enregistrer">✔️</button>
              <button class="icon-btn cancel-price-btn" title="Annuler">✖️</button>
            </div>
          `

          const input = container.querySelector('.buy-input')
          const saveBtn = container.querySelector('.save-price-btn')
          const cancelBtn = container.querySelector('.cancel-price-btn')

          const finish = async (commit) => {
            if (commit) {
              const value = Math.max(0, parseInt(input.value || '0'))
              await this.updateBuyPrice(category, realIndex, value)
            }
            this.renderCategory(category, tbodyId)
            this.updateTotals()
          }

          saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            await finish(true)
          })
          cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            finish(false)
          })
          input.addEventListener('keydown', async (e) => {
            e.stopPropagation()
            if (e.key === 'Enter') await finish(true)
            if (e.key === 'Escape') finish(false)
          })
          input.focus()
          input.select()
        })
      })
    }

  }

  updateArmesCategoryRow(categoryKey, tbodyId, itemIdToUpdate) {
    const items = this.getItemsData()[categoryKey] || []
    const tbody = document.getElementById(tbodyId)
    if (!tbody) return

    const itemIndex = items.findIndex(item => `${categoryKey}::${item.name}` === itemIdToUpdate)
    if (itemIndex === -1) return

    const item = items[itemIndex]
    const row = tbody.children[itemIndex]
    if (!row) return

    const quantity = this.selectedItems.get(itemIdToUpdate) || 0
    const buyTotalPrice = item.buyPrice * quantity
    const sellTotalPrice = item.sellPrice * quantity
    const margin = sellTotalPrice - buyTotalPrice
    const marginClass = margin >= 0 ? 'text-success' : 'text-danger'

    const cells = row.querySelectorAll('td')
    if (cells.length >= 7) {
      cells[3].textContent = this.formatPrice(buyTotalPrice) 
      cells[5].textContent = item.sellPrice > 0 ? this.formatPrice(sellTotalPrice) : '-' 
      const marginCell = cells[6]
      marginCell.textContent = item.sellPrice > 0 ? ((margin >= 0 ? '+' : '') + this.formatPrice(margin)) : '-'
      marginCell.className = `text-right ${marginClass}`
    }
  }

  updateCalculator() {
    this.updateTotals()
  }

  updateTotals = debounce(() => {
    this._performUpdateTotals()
  }, 150)

  _performUpdateTotals() {
    performanceMonitor.start('updateTotals')

    const items = []
    const itemsData = this.getItemsData()

    // Optimiser avec Map pour les recherches rapides
    const categoryCache = new Map()
    
    this.selectedItems.forEach((quantity, itemId) => {
      let category, itemName
      if (itemId.includes('::')) {
        const parts = itemId.split('::')
        category = parts[0]
        itemName = parts.slice(1).join('::')
      } else {
        const parts = itemId.split('-')
        category = parts[0]
        itemName = parts.slice(1).join('-')
      }
      
      const qty = Math.max(0, quantity || 0)
      if (qty === 0) return // Skip les items avec quantité 0
      
      // Utiliser le cache pour éviter les recherches répétées
      let categoryMap = categoryCache.get(category)
      if (!categoryMap) {
        const categoryData = itemsData[category]
        if (!categoryData) return
        
        // Créer une Map pour recherche O(1) au lieu de O(n)
        categoryMap = new Map(categoryData.map(it => [it.name, it]))
        categoryCache.set(category, categoryMap)
      }
      
      const item = categoryMap.get(itemName)
        if (item) {
        const buyPriceKey = `${itemId}::buyPrice`
        const customBuyPrice = this.priceOverrides[buyPriceKey] ?? item.buyPrice
        
          items.push({
          buyPrice: parseFloat(customBuyPrice) || 0,
            sellPrice: parseFloat(item.sellPrice) || 0,
            quantity: qty
          })
      }
    })

    const result = calculationService.calculateTotals(items)

    const totalBuyEl = document.getElementById('total-buy')
    const totalSellEl = document.getElementById('total-sell')
    const marginElement = document.getElementById('total-margin')

    if (totalBuyEl) totalBuyEl.textContent = formatPrice(result.totalBuy)
    if (totalSellEl) totalSellEl.textContent = formatPrice(result.totalSell)

    if (marginElement) {
      marginElement.textContent = (result.totalMargin >= 0 ? '+' : '') + formatPrice(result.totalMargin)
      marginElement.className = 'summary-value ' + (result.totalMargin >= 0 ? 'text-success' : 'text-danger')
    }

    marginAlertService.checkMargin(result.totalMargin, result.totalBuy, result.totalSell)

    if (this.currentCalcType === 'drogue') {
      this.updateDrugSummary()
    }

    performanceMonitor.end('updateTotals')
  }

  setSearchQuery(query) {
    this.searchQuery = query

    this.renderItems()
    this.updateTotals()
  }

  toggleFiltered(checked) {

    document.querySelectorAll('.items-table tbody tr').forEach(row => {

      if (row.querySelector('.item-checkbox')) {
        const isHidden = row.classList.contains('hidden')
        if (!isHidden) {
          const cb = row.querySelector('.item-checkbox')
          if (cb) {
            cb.checked = checked
            const itemId = cb.dataset.itemId
            if (checked) {
              this.selectedItems.set(itemId, 1)

              const container = cb.closest('.checkbox-quantity-container')
              if (container && !container.querySelector('.item-quantity')) {
                const quantityInput = document.createElement('input')
                quantityInput.type = 'number'
                quantityInput.className = 'item-quantity'
                quantityInput.setAttribute('data-item-id', itemId)
                quantityInput.value = '1'
                quantityInput.min = '1'
                quantityInput.step = '1'
                quantityInput.title = 'Quantité'
                container.appendChild(quantityInput)

                quantityInput.addEventListener('input', () => {
                  const qty = Math.max(1, parseInt(quantityInput.value) || 1)
                  this.selectedItems.set(itemId, qty)
                  this.updateTotals()
                })
                quantityInput.addEventListener('change', () => {
                  const qty = Math.max(1, parseInt(quantityInput.value) || 1)
                  quantityInput.value = qty
                  this.selectedItems.set(itemId, qty)
                  this.updateTotals()
                })
              }
            } else {
              this.selectedItems.delete(itemId)

              const container = cb.closest('.checkbox-quantity-container')
              const quantityInput = container?.querySelector('.item-quantity')
              if (quantityInput) {
                quantityInput.remove()
              }
            }
          }
        }
      }
    })
    this.updateTotals()
  }

  async saveToHistory() {
    if (this.selectedItems.size === 0) {
      notificationService.warning('Aucun item sélectionné')
      return
    }

    try {

      const previousHistory = [...this.history]
      const previousSelectedItems = new Map(this.selectedItems)

      let totalBuy = 0
      let totalSell = 0
      const itemsList = []

      this.selectedItems.forEach((quantity, itemId) => {
        let category, itemName
        if (itemId.includes('::')) {
          const parts = itemId.split('::')
          category = parts[0]
          itemName = parts.slice(1).join('::')
        } else {
          const parts = itemId.split('-')
          category = parts[0]
          itemName = parts.slice(1).join('-')
        }
        const qty = Math.max(1, quantity || 1)
        const categoryData = this.getItemsData()[category]
        if (categoryData) {
          let item = categoryData.find(it => it.name === itemName)
          if (!item && !isNaN(parseInt(itemName))) {
            item = categoryData[parseInt(itemName)]
          }
          if (item) {
            totalBuy += item.buyPrice * qty
            totalSell += item.sellPrice * qty
            itemsList.push({
              name: item.name,
              quantity: qty
            })
          }
        }
      })

      // Demander le nom du vendeur
      const sellerName = await this.openSellerNameModal()
      if (sellerName === null) {
        // L'utilisateur a annulé, on arrête la sauvegarde
        return
      }
      // Si sellerName est '', l'utilisateur a cliqué sur "Passer", on continue avec une chaîne vide

      const historyEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        user: this.currentUser.username,
        seller: sellerName || '',
        items: itemsList,
        totalBuy,
        totalSell,
        margin: totalSell - totalBuy
      }

      // Sauvegarder via l'API si activé
      let savedToApi = false
      if (this.useApi && this.currentUser && this.currentUser.id) {
        try {
          const result = await apiService.saveTransaction(this.currentUser.id, historyEntry)
          
          // Vérifier que la réponse est valide
          if (!result) {
            throw new Error('Réponse vide du serveur')
          }
          
          if (!result.success) {
            throw new Error(result.error || 'Erreur lors de la sauvegarde')
          }
          
          // Ne pas ajouter à l'historique local immédiatement
          // On va recharger depuis l'API pour avoir les données complètes et à jour
          savedToApi = true
          
          logger.info('Transaction saved to API successfully', { 
            transactionId: result.transaction_id || result.transaction?.id,
            hasTransaction: !!result.transaction
          })
          
          // Ne PAS sauvegarder en localStorage si l'API fonctionne
          // Les données doivent être uniquement en base de données
          // L'historique sera rechargé depuis l'API après la sauvegarde
        } catch (error) {
          // En cas d'erreur API, NE PAS sauvegarder du tout
          logger.error('Failed to save transaction to API', error)
          
          // Ne pas ajouter à l'historique local si l'API échoue
          // L'utilisateur doit corriger le problème avant de pouvoir sauvegarder
          const errorMessage = error.message || error.data?.error || 'Erreur serveur'
          const errorDetails = error.data?.details || ''
          
          // Afficher une erreur claire avec les détails
          if (errorDetails) {
            notificationService.error(`Erreur lors de la sauvegarde en base de données: ${errorDetails}`)
          } else {
            notificationService.error(`Erreur lors de la sauvegarde en base de données: ${errorMessage}`)
          }
          
          // Ne pas continuer - la transaction n'est pas sauvegardée
          // Ne pas vider les items sélectionnés pour que l'utilisateur puisse réessayer
          return // Arrêter l'exécution ici
        }
      } else {
        // Mode local uniquement (si l'API n'est pas activée)
      this.history.push(historyEntry)
      await this.saveHistory()
      }
      
      // Vider les items sélectionnés seulement si la sauvegarde a réussi
      this.selectedItems.clear()
      this.updateCalculator()

      // Créer une copie de l'historique actuel pour undo/redo
      const currentHistory = [...this.history]

      undoRedoService.addAction({
        type: 'saveTransaction',
        data: historyEntry,
        undo: async () => {
          this.history = previousHistory
          this.selectedItems = previousSelectedItems
          
          // Si sauvegardé via API, on ne peut pas vraiment annuler côté serveur
          // On met juste à jour localement
          if (savedToApi) {
            logger.warn('Cannot undo API transaction on server, only local undo')
          }
          
          await this.saveHistory()
          this.updateCalculator()
          notificationService.info('Transaction annulée')
        },
        redo: async () => {
          this.history = currentHistory
          this.selectedItems.clear()
          
          // Si sauvegardé via API, on ne peut pas vraiment refaire côté serveur
          // On met juste à jour localement
          if (savedToApi) {
            logger.warn('Cannot redo API transaction on server, only local redo')
          }
          
          await this.saveHistory()
          this.updateCalculator()
          notificationService.info('Transaction rétablie')
        }
      })

      // Afficher le message de succès seulement si la sauvegarde a réussi
      if (savedToApi) {
        notificationService.success('Transaction sauvegardée avec succès dans la base de données')
      } else if (!this.useApi) {
        notificationService.success('Transaction sauvegardée localement')
      }
      
      // Mettre à jour la navigation active avant de basculer
      document.querySelectorAll('.nav-item').forEach(nav => {
        if (nav.id !== 'logout-btn') nav.classList.remove('active')
      })
      const historyNav = document.querySelector('.nav-item[data-view="history"]')
      if (historyNav) historyNav.classList.add('active')
      
      // Recharger l'historique depuis l'API AVANT de basculer vers la vue
      // pour s'assurer qu'on a les dernières données
      if (savedToApi && this.useApi && this.currentUser && this.currentUser.id) {
        try {
          // Recharger l'historique complet depuis l'API pour s'assurer qu'on a les dernières données
          logger.info('Reloading history from API after save...')
          await this.loadUserDataFromApi(this.currentUser.id)
          logger.info('History reloaded from API', { 
            count: this.history.length,
            transactions: this.history.map(t => ({ id: t.id, date: t.date }))
          })
        } catch (reloadError) {
          logger.error('Failed to reload history from API after save', reloadError)
        }
      }
      
      // Marquer qu'on vient de sauvegarder pour éviter le double rechargement dans switchView
      this._justSavedTransaction = true
      
      // Basculer vers la vue historique
      await this.switchView('history')
      
      // Réinitialiser le flag
      this._justSavedTransaction = false
      
      // Attendre un peu pour que le DOM soit prêt, puis forcer le rendu
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Forcer le rendu de l'historique après le rechargement
      this.renderHistory()
      
      // Double vérification : si l'historique est toujours vide, recharger une fois de plus
      if (this.history.length === 0 && savedToApi && this.useApi && this.currentUser && this.currentUser.id) {
        logger.warn('History is empty after reload, trying again...')
        setTimeout(async () => {
          try {
            await this.loadUserDataFromApi(this.currentUser.id)
            this.renderHistory()
            logger.info('History reloaded again', { count: this.history.length })
          } catch (error) {
            logger.error('Failed to reload history on retry', error)
          }
        }, 500)
      }
      
      // Mettre à jour le dashboard si on y est (en arrière-plan)
      const dashboardView = document.getElementById('dashboard-view')
      if (dashboardView && !dashboardView.classList.contains('hidden')) {
        // Ne pas attendre pour ne pas bloquer l'affichage de l'historique
        this.renderDashboard().catch(err => {
          logger.warn('Failed to update dashboard after save', err)
        })
      }
    } catch (error) {
      logger.error('Failed to save transaction', error)
      notificationService.error('Erreur lors de la sauvegarde de la transaction')
    }
  }

  renderHistory() {
    const historyView = document.getElementById('history-view')

    if (!historyView) {
      requestAnimationFrame(() => this.renderHistory())
      return
    }

    // Optimiser l'affichage avec requestAnimationFrame
    requestAnimationFrame(() => {
    historyView.classList.remove('hidden')
    historyView.removeAttribute('hidden')
    historyView.style.setProperty('display', 'flex', 'important')
    historyView.style.setProperty('visibility', 'visible', 'important')
    historyView.style.setProperty('opacity', '1', 'important')
    })

    if (!this.history || !Array.isArray(this.history)) {
      this.history = []
    }

    this.updateHistoryStats()

    const container = document.getElementById('history-tbody')

    if (!container) {
      requestAnimationFrame(() => {
        const retryContainer = document.getElementById('history-tbody')
        if (retryContainer) {
          this.renderHistory()
        }
      })
      return
    }

    try {

      const filteredHistory = this.getFilteredHistory()

      if (!filteredHistory || filteredHistory.length === 0) {
        container.innerHTML = `
          <div class="history-empty-state">
            <div class="history-empty-icon">📜</div>
            <h3>Aucune transaction</h3>
            <p>Votre historique de transactions apparaîtra ici</p>
          </div>
        `
        this.initHistoryFilters()
        this.initHistorySearchClear()
        return
      }

      // Optimiser le tri avec cache de dates
      const sortedHistory = filteredHistory.map(entry => ({
        ...entry,
        _sortDate: new Date(entry.date).getTime()
      })).sort((a, b) => b._sortDate - a._sortDate)

      // Utiliser DocumentFragment pour une insertion DOM plus rapide
      const fragment = document.createDocumentFragment()
      const rows = sortedHistory.map(entry => {
        const date = new Date(entry.date)
        const marginClass = entry.margin >= 0 ? 'profit-positive' : 'profit-negative'
        const isProfit = entry.margin >= 0

        let itemsList = []
        if (entry.items && entry.items.length > 0) {
          if (typeof entry.items[0] === 'string') {

            itemsList = entry.items.map(name => ({ name, quantity: 1 }))
          } else {

            itemsList = entry.items
          }
        }

        const itemsCount = itemsList.length
        const totalItems = itemsList.reduce((sum, item) => sum + (item.quantity || 1), 0)

        return `
          <div class="transaction-card" data-transaction-id="${entry.id}">
            <div class="transaction-card-header">
              <div class="transaction-header-left">
                <div class="transaction-date-badge">
                  <svg class="date-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span class="date-text">${this.formatDate(date)}</span>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <div class="transaction-buyer-badge" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3);">
                    <svg class="user-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #a78bfa;">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span style="color: #a78bfa; font-size: 12px;">Acheteur: <strong>${this.escapeHtml(entry.user)}</strong></span>
                  </div>
                  <div class="transaction-seller-badge" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; background: ${entry.seller ? 'rgba(59, 130, 246, 0.15)' : 'rgba(156, 163, 175, 0.15)'}; border: 1px solid ${entry.seller ? 'rgba(59, 130, 246, 0.3)' : 'rgba(156, 163, 175, 0.3)'};">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: ${entry.seller ? '#60a5fa' : '#9ca3af'};">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="8.5" cy="7" r="4"></circle>
                      <path d="M20 8v6M23 11h-6"></path>
                    </svg>
                    <span style="color: ${entry.seller ? '#60a5fa' : '#9ca3af'}; font-size: 12px;">Vendeur: <strong>${this.escapeHtml(entry.seller || 'Inconnu')}</strong></span>
                  </div>
                </div>
              </div>
              <button class="transaction-delete-btn" data-transaction-id="${entry.id}" title="Supprimer cette transaction">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>

            <div class="transaction-items-section">
              <div class="transaction-items-header">
                <span class="items-count-badge">${itemsCount} item${itemsCount > 1 ? 's' : ''} • ${totalItems} unité${totalItems > 1 ? 's' : ''}</span>
                <div class="transaction-seller-info" style="display: flex; align-items: center; gap: 6px; margin-left: auto; padding: 6px 12px; background: ${entry.seller ? 'rgba(59, 130, 246, 0.15)' : 'rgba(156, 163, 175, 0.15)'}; border-radius: 8px; color: ${entry.seller ? '#3b82f6' : '#9ca3af'}; font-size: 13px; font-weight: 500;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="8.5" cy="7" r="4"></circle>
                    <path d="M20 8v6M23 11h-6"></path>
                  </svg>
                  <span>Acheté à: <strong>${this.escapeHtml(entry.seller || 'Inconnu')}</strong></span>
                </div>
              </div>
              <div class="transaction-items-grid">
                ${itemsList.slice(0, 6).map(item => {
                  const qty = item.quantity || 1
                  return `
                    <div class="transaction-item-tag">
                      <span class="item-name">${this.escapeHtml(item.name)}</span>
                      ${qty > 1 ? `<span class="item-quantity">x${qty}</span>` : ''}
                    </div>
                  `
                }).join('')}
                ${itemsCount > 6 ? `<div class="transaction-item-tag more-items">+${itemsCount - 6} autre${itemsCount - 6 > 1 ? 's' : ''}</div>` : ''}
              </div>
            </div>

            <div class="transaction-financials">
              <div class="financial-row">
                <div class="financial-item">
                  <span class="financial-label">Achat</span>
                  <span class="financial-value buy-value">${this.formatPrice(entry.totalBuy)}</span>
                </div>
                <div class="financial-item">
                  <span class="financial-label">Revente</span>
                  <span class="financial-value sell-value">${this.formatPrice(entry.totalSell)}</span>
                </div>
                <div class="financial-item profit-item ${marginClass}">
                  <span class="financial-label">Bénéfice Net</span>
                  <span class="financial-value profit-amount">
                    ${(entry.margin >= 0 ? '+' : '') + this.formatPrice(entry.margin)}
                  </span>
                </div>
              </div>
              <div class="transaction-seller-row" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: ${entry.seller ? '#60a5fa' : '#9ca3af'};">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="8.5" cy="7" r="4"></circle>
                  <path d="M20 8v6M23 11h-6"></path>
                </svg>
                <span style="color: #9ca3af; font-size: 13px;">Acheté à:</span>
                <span style="color: ${entry.seller ? '#60a5fa' : '#9ca3af'}; font-size: 14px; font-weight: 600;">${this.escapeHtml(entry.seller || 'Inconnu')}</span>
              </div>
            </div>
          </div>
        `
      })
      
      // Créer les éléments DOM une seule fois avec DocumentFragment
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = rows.join('')
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild)
      }
      container.innerHTML = ''
      container.appendChild(fragment)

      // Animer les cartes
      requestAnimationFrame(() => {
        const cards = container.querySelectorAll('.transaction-card')
        cards.forEach((card, index) => {
          card.style.animationDelay = `${index * 0.05}s`
        })
      })

      this.initHistoryFilters()
      this.initHistorySearchClear()
      this.initDeleteButtons()

    } catch (error) {

      container.innerHTML = `
        <div class="history-empty-state">
          <div class="history-empty-icon">⚠️</div>
          <h3>Erreur lors du chargement</h3>
          <p>Une erreur s'est produite lors de l'affichage de l'historique</p>
          <p style="font-size: 12px; color: #f48771; margin-top: 10px;">${error.message}</p>
        </div>
      `
    }
  }

  getFilteredHistory() {
    if (!this.history || !Array.isArray(this.history)) {
      return []
    }

    let filtered = this.history.filter(entry => {
      if (!entry) return false
      
      // Si pas d'utilisateur dans l'entrée, on l'accepte si on a un utilisateur actuel
      if (!entry.user) {
        return this.currentUser !== null
      }

      if (this.currentUser && this.currentUser.role === 'admin') {
        return true
      }

      // Comparer avec le username de l'utilisateur actuel
      const entryUser = entry.user || ''
      const currentUsername = this.currentUser ? this.currentUser.username : ''
      return entryUser === currentUsername
    })

    if (this.currentUser && this.currentUser.role === 'admin') {
      const userFilter = document.getElementById('history-user-filter')
      if (userFilter && userFilter.value) {
        filtered = filtered.filter(entry => entry && entry.user === userFilter.value)
      }
    }

    const dateFilter = document.getElementById('history-date-filter')
    if (dateFilter && dateFilter.value) {
      const now = new Date()
      const entryDate = new Date()

      filtered = filtered.filter(entry => {
        if (!entry || !entry.date) return false
        entryDate.setTime(new Date(entry.date).getTime())

        if (dateFilter.value === 'today') {
          return entryDate.toDateString() === now.toDateString()
        } else if (dateFilter.value === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          return entryDate >= weekAgo
        } else if (dateFilter.value === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          return entryDate >= monthAgo
        }
        return true
      })
    }

    const searchInput = document.getElementById('history-search')
    if (searchInput && searchInput.value.trim()) {
      const query = searchInput.value.trim().toLowerCase()
      filtered = filtered.filter(entry => {
        if (!entry) return false
        const userMatch = entry.user && entry.user.toLowerCase().includes(query)
        const itemsMatch = entry.items && Array.isArray(entry.items) && entry.items.some(item => {
          if (!item) return false
          const name = typeof item === 'string' ? item : (item.name || '')
          return name.toLowerCase().includes(query)
        })
        return userMatch || itemsMatch
      })
    }

    return filtered
  }

  updateHistoryStats() {
    if (!this.history || !Array.isArray(this.history)) {
      this.history = []
    }

    let userHistory = this.history
    if (this.currentUser && this.currentUser.role !== 'admin') {
      userHistory = this.history.filter(entry => 
        entry && entry.user === this.currentUser.username
      )
    }

    const totalCount = userHistory.length
    let totalBuy = 0
    let totalSell = 0

    userHistory.forEach(entry => {
      if (entry) {
        totalBuy += entry.totalBuy || 0
        totalSell += entry.totalSell || 0
      }
    })

    const totalMargin = totalSell - totalBuy

    const countEl = document.getElementById('history-total-count')
    const buyEl = document.getElementById('history-total-buy')
    const sellEl = document.getElementById('history-total-sell')
    const marginEl = document.getElementById('history-total-margin')

    if (countEl) {
      countEl.textContent = totalCount
      countEl.style.display = 'block'
      countEl.style.visibility = 'visible'
    }
    if (buyEl) {
      buyEl.textContent = this.formatPrice(totalBuy)
      buyEl.style.display = 'block'
      buyEl.style.visibility = 'visible'
    }
    if (sellEl) {
      sellEl.textContent = this.formatPrice(totalSell)
      sellEl.style.display = 'block'
      sellEl.style.visibility = 'visible'
    }
    if (marginEl) {
      marginEl.textContent = (totalMargin >= 0 ? '+' : '') + this.formatPrice(totalMargin)
      marginEl.className = `history-stat-value profit-value ${totalMargin >= 0 ? '' : 'text-danger'}`
      marginEl.style.display = 'block'
      marginEl.style.visibility = 'visible'
    }
  }

  initHistoryFilters() {

    const userFilter = document.getElementById('history-user-filter')
    if (userFilter) {

      if (this.currentUser && this.currentUser.role === 'admin') {
        userFilter.style.display = 'block'
        const users = [...new Set(this.history.map(entry => entry.user).filter(Boolean))]
        const currentValue = userFilter.value
        userFilter.innerHTML = '<option value="">Tous les utilisateurs</option>' + 
          users.map(user => `<option value="${this.escapeHtml(user)}">${this.escapeHtml(user)}</option>`).join('')
        if (currentValue) userFilter.value = currentValue
      } else {
        userFilter.style.display = 'none'
      }
    }

    const searchInput = document.getElementById('history-search')
    const userFilterSelect = document.getElementById('history-user-filter')
    const dateFilterSelect = document.getElementById('history-date-filter')

    const updateHistory = () => {
      this.renderHistory()
    }

    if (searchInput) {
      const newSearchInput = searchInput.cloneNode(true)
      searchInput.parentNode.replaceChild(newSearchInput, searchInput)

      let debounceTimer
      newSearchInput.addEventListener('input', (e) => {
        const value = e.target.value.trim()
        const clearBtn = document.getElementById('history-search-clear')
        if (clearBtn) {
          clearBtn.style.display = value ? 'flex' : 'none'
        }
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(updateHistory, 300)
      })
    }

    if (userFilterSelect && !userFilterSelect.dataset.listenerAttached) {
      userFilterSelect.dataset.listenerAttached = 'true'
      userFilterSelect.addEventListener('change', updateHistory)
    }

    if (dateFilterSelect && !dateFilterSelect.dataset.listenerAttached) {
      dateFilterSelect.dataset.listenerAttached = 'true'
      dateFilterSelect.addEventListener('change', updateHistory)
    }

    const clearHistoryBtn = document.getElementById('clear-history-btn')
    if (clearHistoryBtn && !clearHistoryBtn.dataset.listenerAttached) {
      clearHistoryBtn.dataset.listenerAttached = 'true'
      clearHistoryBtn.onclick = async () => {
        const currentUsername = this.currentUser ? this.currentUser.username : ''
        const userTransactions = this.history.filter(entry => entry.user === currentUsername)

        if (userTransactions.length === 0) {
          alert('Aucune transaction à effacer')
          return
        }

        if (confirm(`Êtes-vous sûr de vouloir effacer vos ${userTransactions.length} transaction${userTransactions.length > 1 ? 's' : ''} ?`)) {
          try {
            // Supprimer via l'API si activée
            if (this.useApi && this.currentUser && this.currentUser.id) {
              if (this.currentUser && this.currentUser.role === 'admin') {
                if (confirm('En tant qu\'admin, cela effacera toutes les transactions. Continuer ?')) {
                  // Supprimer toutes les transactions via l'API
                  try {
                    const result = await apiService.deleteAllTransactions()
                    if (!result.success) {
                      notificationService.error(result.error || 'Erreur lors de la suppression de l\'historique')
                      return
                    }
                    // Ne pas modifier l'historique local ici - il sera rechargé depuis l'API
                  } catch (apiError) {
                    logger.error('Failed to delete all transactions from API', apiError)
                    const errorMessage = apiError.message || apiError.data?.error || 'Erreur serveur'
                    const errorDetails = apiError.data?.details || ''
                    if (errorDetails) {
                      notificationService.error(`Erreur lors de la suppression de l'historique: ${errorDetails}`)
                    } else {
                      notificationService.error(`Erreur lors de la suppression de l'historique: ${errorMessage}`)
                    }
                    return
                  }
                } else {
                  // Supprimer uniquement les transactions de l'utilisateur via l'API
                  try {
                    const result = await apiService.deleteUserTransactions(this.currentUser.id)
                    if (!result.success) {
                      notificationService.error(result.error || 'Erreur lors de la suppression de l\'historique')
                      return
                    }
                    // Ne pas modifier l'historique local ici - il sera rechargé depuis l'API
                  } catch (apiError) {
                    logger.error('Failed to delete user transactions from API', apiError)
                    const errorMessage = apiError.message || apiError.data?.error || 'Erreur serveur'
                    const errorDetails = apiError.data?.details || ''
                    if (errorDetails) {
                      notificationService.error(`Erreur lors de la suppression de l'historique: ${errorDetails}`)
                    } else {
                      notificationService.error(`Erreur lors de la suppression de l'historique: ${errorMessage}`)
                    }
                    return
                  }
                }
              } else {
                // Supprimer uniquement les transactions de l'utilisateur via l'API
                try {
                  const result = await apiService.deleteUserTransactions(this.currentUser.id)
                  if (!result.success) {
                    notificationService.error(result.error || 'Erreur lors de la suppression de l\'historique')
                    return
                  }
                  // Ne pas modifier l'historique local ici - il sera rechargé depuis l'API
                } catch (apiError) {
                  logger.error('Failed to delete user transactions from API', apiError)
                  const errorMessage = apiError.message || apiError.data?.error || 'Erreur serveur'
                  const errorDetails = apiError.data?.details || ''
                  if (errorDetails) {
                    notificationService.error(`Erreur lors de la suppression de l'historique: ${errorDetails}`)
                  } else {
                    notificationService.error(`Erreur lors de la suppression de l'historique: ${errorMessage}`)
                  }
                  return
                }
              }

              // Recharger l'historique depuis l'API pour s'assurer que tout est à jour
              await this.loadUserDataFromApi(this.currentUser.id)
              
              // Forcer le rechargement de l'affichage après la suppression
              this.renderHistory()
              
              // Actualiser les statistiques si on est sur le dashboard
              const dashboardView = document.getElementById('dashboard-view')
              if (dashboardView && !dashboardView.classList.contains('hidden')) {
                await this.renderDashboard()
              }
              
              // Afficher le message de succès après le rechargement
              notificationService.success('Historique supprimé avec succès de la base de données')
            } else {
              // Mode hors ligne - suppression locale uniquement
          if (this.currentUser && this.currentUser.role === 'admin') {
            if (confirm('En tant qu\'admin, cela effacera toutes les transactions. Continuer ?')) {
              this.history = []
            } else {
              this.history = this.history.filter(entry => entry.user !== currentUsername)
            }
          } else {
            this.history = this.history.filter(entry => entry.user !== currentUsername)
          }
              
              // Sauvegarder en localStorage seulement si l'API n'est pas activée
              await this.saveHistory()
              
              // Recharger l'affichage
          this.renderHistory()
              
              // Actualiser les statistiques si on est sur le dashboard
              const dashboardView = document.getElementById('dashboard-view')
              if (dashboardView && !dashboardView.classList.contains('hidden')) {
                await this.renderDashboard()
              }
              
              notificationService.success('Historique supprimé avec succès')
            }
          } catch (error) {
            logger.error('Failed to clear history', error)
            notificationService.error('Erreur lors de la suppression de l\'historique')
          }
        }
      }
    }
  }

  initHistorySearchClear() {
    const searchInput = document.getElementById('history-search')
    const clearBtn = document.getElementById('history-search-clear')
    
    if (!searchInput || !clearBtn) return

    // Vérifier l'état initial
    if (searchInput.value.trim()) {
      clearBtn.style.display = 'flex'
    } else {
      clearBtn.style.display = 'none'
    }

    // Event listener pour le bouton clear
    if (!clearBtn.dataset.listenerAttached) {
      clearBtn.dataset.listenerAttached = 'true'
      clearBtn.addEventListener('click', () => {
        searchInput.value = ''
        clearBtn.style.display = 'none'
        this.renderHistory()
        searchInput.focus()
      })
    }
  }

  initDeleteButtons() {
    const deleteButtons = document.querySelectorAll('.transaction-delete-btn')
    deleteButtons.forEach(btn => {
      // Retirer les anciens listeners pour éviter les doublons
      const newBtn = btn.cloneNode(true)
      btn.parentNode.replaceChild(newBtn, btn)
      
      // Ajouter le listener sur le nouveau bouton
      const transactionId = newBtn.getAttribute('data-transaction-id')
      if (transactionId) {
        newBtn.addEventListener('click', async (e) => {
          e.preventDefault()
          e.stopPropagation()
          await this.deleteTransaction(transactionId)
        })
      }
    })
  }

  async deleteTransaction(transactionId) {
    if (!transactionId) {
      notificationService.warning('ID de transaction manquant')
      return
    }

    // Chercher la transaction dans l'historique
    const transaction = this.history.find(entry => 
      String(entry.id) === String(transactionId) || 
      String(entry.transaction_id) === String(transactionId)
    )
    
    if (!transaction) {
      notificationService.warning('Transaction introuvable')
      return
    }

    const currentUsername = this.currentUser ? this.currentUser.username : ''
    const isAdmin = this.currentUser && this.currentUser.role === 'admin'

    if (!isAdmin && transaction.user !== currentUsername) {
      notificationService.error('Vous ne pouvez pas supprimer cette transaction')
      return
    }

    const userName = isAdmin ? transaction.user : 'votre'
    if (confirm(`Êtes-vous sûr de vouloir supprimer ${isAdmin ? `la transaction de ${transaction.user}` : 'cette transaction'} ?`)) {
      try {
        // Supprimer via l'API si activée
        if (this.useApi && this.currentUser && this.currentUser.id) {
          try {
            const result = await apiService.deleteTransaction(transactionId)
            if (!result || !result.success) {
              const errorMessage = result?.error || result?.message || 'Erreur lors de la suppression de la transaction'
              notificationService.error(errorMessage)
              return
            }
          } catch (apiError) {
            // Logger sans notification automatique
            logger.error('Failed to delete transaction from API', apiError, { transactionId }, false)
            // Extraire le message d'erreur de la réponse API si disponible
            const errorMessage = apiError.data?.error || apiError.data?.message || apiError.message || 'Erreur lors de la suppression de la transaction sur le serveur'
            notificationService.error(errorMessage)
            return
          }
        }

        // Supprimer de l'historique local
        this.history = this.history.filter(entry => 
          String(entry.id) !== String(transactionId) && 
          String(entry.transaction_id) !== String(transactionId) &&
          String(entry.id) !== String(transaction.id)
        )

        // Sauvegarder l'historique local (backup)
        await this.saveHistory()

        // Recharger l'historique depuis l'API pour s'assurer que tout est à jour
        if (this.useApi && this.currentUser && this.currentUser.id) {
          await this.loadUserDataFromApi(this.currentUser.id)
        }

        // Recharger l'affichage
      this.renderHistory()

        // Actualiser les statistiques si on est sur le dashboard
        const dashboardView = document.getElementById('dashboard-view')
        if (dashboardView && !dashboardView.classList.contains('hidden')) {
          await this.renderDashboard()
        }
        
        // Si on est dans la vue clan, mettre à jour l'historique du clan aussi
        const clanView = document.getElementById('clan-view')
        if (clanView && !clanView.classList.contains('hidden')) {
          await this.renderClanHistory()
        }
        
        notificationService.success('Transaction supprimée définitivement')
      } catch (error) {
        logger.error('Failed to delete transaction', error)
        notificationService.error('Erreur lors de la suppression de la transaction')
      }
    }
  }

  initWikiNavigation() {
    const navTabs = document.querySelectorAll('.support-nav-tab')
    const sections = document.querySelectorAll('.support-section-modern')

    navTabs.forEach(tab => {
      // Supprimer les anciens listeners pour éviter les doublons
      const newTab = tab.cloneNode(true)
      tab.parentNode.replaceChild(newTab, tab)
    })

    // Réattacher les listeners
    const newNavTabs = document.querySelectorAll('.support-nav-tab')
    newNavTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault()
        const targetSection = tab.dataset.section

        // Mettre à jour les onglets actifs
        newNavTabs.forEach(nav => nav.classList.remove('active'))
        tab.classList.add('active')

        // Mettre à jour les sections actives
        sections.forEach(section => {
          section.classList.remove('active')
          if (section.id === targetSection) {
            section.classList.add('active')

            // Animation de scroll fluide
            requestAnimationFrame(() => {
              section.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }
        })
      })
    })
  }

  initClan() {
    // Event listeners pour créer/rejoindre un clan
    const createClanBtn = document.getElementById('create-clan-btn')
    const joinClanBtn = document.getElementById('join-clan-btn')
    const createClanModal = document.getElementById('create-clan-modal')
    const joinClanModal = document.getElementById('join-clan-modal')
    const createClanForm = document.getElementById('create-clan-form')
    const joinClanForm = document.getElementById('join-clan-form')
    const createClanModalClose = document.getElementById('create-clan-modal-close')
    const joinClanModalClose = document.getElementById('join-clan-modal-close')
    const cancelCreateClanBtn = document.getElementById('cancel-create-clan-btn')
    const cancelJoinClanBtn = document.getElementById('cancel-join-clan-btn')
    const copyInvitationKeyBtn = document.getElementById('copy-invitation-key-btn')
    const leaveClanBtn = document.getElementById('leave-clan-btn')

    // Quitter le clan
    if (leaveClanBtn) {
      leaveClanBtn.addEventListener('click', async () => {
        await this.handleLeaveClan()
      })
    }

    // Créer un clan
    if (createClanBtn) {
      createClanBtn.addEventListener('click', () => {
        // Vérifier le cooldown
        const remainingSeconds = this.getClanDeleteCooldownRemaining()
        if (remainingSeconds > 0) {
          notificationService.warning(`Vous devez attendre ${remainingSeconds} seconde${remainingSeconds > 1 ? 's' : ''} avant de créer un nouveau clan.`)
          return
        }
        
        if (createClanModal) {
          // S'assurer qu'aucun autre modal n'est ouvert
          const transferModal = document.getElementById('transfer-ownership-modal')
          if (transferModal) {
            transferModal.style.display = 'none'
            transferModal.remove()
          }
          
          // Réinitialiser le formulaire AVANT d'ouvrir le modal
          if (createClanForm) {
            createClanForm.reset()
          }
          
          // Réinitialiser le champ immédiatement
          const clanNameInput = document.getElementById('clan-name')
          if (clanNameInput) {
            clanNameInput.removeAttribute('disabled')
            clanNameInput.removeAttribute('readonly')
            clanNameInput.value = ''
            clanNameInput.disabled = false
            clanNameInput.readOnly = false
            clanNameInput.style.pointerEvents = 'auto'
            clanNameInput.style.opacity = '1'
            clanNameInput.style.cursor = 'text'
            clanNameInput.style.zIndex = '1001'
          }
          
          // Ouvrir le modal
          createClanModal.style.display = 'flex'
          
          // Focus immédiat avec requestAnimationFrame pour meilleure réactivité
          requestAnimationFrame(() => {
            if (clanNameInput) {
              clanNameInput.focus()
              clanNameInput.select()
            }
          })
        }
      })
      
      // Vérifier l'état du bouton au chargement
      this.updateCreateClanButton()
    }

    if (createClanModalClose) {
      createClanModalClose.addEventListener('click', () => {
        if (createClanModal) createClanModal.style.display = 'none'
        if (createClanForm) {
          createClanForm.reset()
          const clanNameInput = document.getElementById('clan-name')
          if (clanNameInput) {
            clanNameInput.value = ''
            clanNameInput.removeAttribute('disabled')
            clanNameInput.removeAttribute('readonly')
            clanNameInput.style.pointerEvents = 'auto'
          }
        }
      })
    }

    if (cancelCreateClanBtn) {
      cancelCreateClanBtn.addEventListener('click', () => {
        if (createClanModal) createClanModal.style.display = 'none'
        if (createClanForm) {
          createClanForm.reset()
          const clanNameInput = document.getElementById('clan-name')
          if (clanNameInput) {
            clanNameInput.value = ''
            clanNameInput.removeAttribute('disabled')
            clanNameInput.removeAttribute('readonly')
            clanNameInput.style.pointerEvents = 'auto'
          }
        }
      })
    }

    if (createClanForm) {
      createClanForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        const clanName = document.getElementById('clan-name').value.trim()
        
        if (!clanName) {
          notificationService.warning('Veuillez entrer un nom de clan')
          return
        }

        if (this.useApi && this.currentUser && this.currentUser.id) {
          try {
            const result = await apiService.createClan(clanName)
            if (result.success) {
              this.currentClan = result.clan
              await this.loadClanData()
              this.renderClanView()
              if (createClanModal) createClanModal.style.display = 'none'
              if (createClanForm) {
                createClanForm.reset()
                // S'assurer que le champ est réinitialisé
                const clanNameInput = document.getElementById('clan-name')
                if (clanNameInput) {
                  clanNameInput.value = ''
                  clanNameInput.removeAttribute('disabled')
                  clanNameInput.removeAttribute('readonly')
                }
              }
              notificationService.success('Clan créé avec succès!')
            } else {
              notificationService.error(result.error || 'Erreur lors de la création du clan')
            }
          } catch (error) {
            logger.error('Failed to create clan', error)
            notificationService.error('Erreur lors de la création du clan')
          }
        }
      })
    }

    // Rejoindre un clan
    if (joinClanBtn) {
      joinClanBtn.addEventListener('click', () => {
        if (joinClanModal) joinClanModal.style.display = 'flex'
      })
    }

    if (joinClanModalClose) {
      joinClanModalClose.addEventListener('click', () => {
        if (joinClanModal) joinClanModal.style.display = 'none'
        if (joinClanForm) joinClanForm.reset()
      })
    }

    if (cancelJoinClanBtn) {
      cancelJoinClanBtn.addEventListener('click', () => {
        if (joinClanModal) joinClanModal.style.display = 'none'
        if (joinClanForm) joinClanForm.reset()
      })
    }

    if (joinClanForm) {
      joinClanForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        const invitationKey = document.getElementById('invitation-key').value.trim()
        
        if (!invitationKey) {
          notificationService.warning('Veuillez entrer une clé d\'invitation')
          return
        }

        if (this.useApi && this.currentUser && this.currentUser.id) {
          try {
            const result = await apiService.joinClan(invitationKey)
            if (result.success) {
              this.currentClan = result.clan
              await this.loadClanData()
              this.renderClanView()
              if (joinClanModal) joinClanModal.style.display = 'none'
              if (joinClanForm) joinClanForm.reset()
              notificationService.success('Vous avez rejoint le clan avec succès!')
            } else {
              notificationService.error(result.error || 'Erreur lors de la jonction au clan')
            }
          } catch (error) {
            logger.error('Failed to join clan', error)
            notificationService.error('Erreur lors de la jonction au clan')
          }
        }
      })
    }

    // Copier la clé d'invitation
    if (copyInvitationKeyBtn) {
      copyInvitationKeyBtn.addEventListener('click', () => {
        const keyDisplay = document.getElementById('clan-invitation-key-display')
        if (keyDisplay && this.currentClan) {
          navigator.clipboard.writeText(this.currentClan.invitation_key).then(() => {
            notificationService.success('Clé d\'invitation copiée!')
          }).catch(() => {
            notificationService.error('Erreur lors de la copie')
          })
        }
      })
    }

    // Event listeners pour ajouter un membre
    const addMemberBtn = document.getElementById('add-member-btn')
    const clanMemberModal = document.getElementById('clan-member-modal')
    const clanMemberModalClose = document.getElementById('clan-member-modal-close')
    const cancelClanMemberBtn = document.getElementById('cancel-clan-member-btn')
    const clanMemberForm = document.getElementById('clan-member-form')

    if (addMemberBtn) {
      addMemberBtn.addEventListener('click', () => {
        if (clanMemberModal) {
          clanMemberModal.style.display = 'flex'
          document.getElementById('clan-member-username')?.focus()
        }
      })
    }

    if (clanMemberModalClose) {
      clanMemberModalClose.addEventListener('click', () => {
        if (clanMemberModal) clanMemberModal.style.display = 'none'
        if (clanMemberForm) clanMemberForm.reset()
      })
    }

    if (cancelClanMemberBtn) {
      cancelClanMemberBtn.addEventListener('click', () => {
        if (clanMemberModal) clanMemberModal.style.display = 'none'
        if (clanMemberForm) clanMemberForm.reset()
      })
    }

    // Note: L'ajout de membre via username n'est plus utilisé, on utilise les clés d'invitation
    // Mais on garde le modal pour compatibilité

    // Filtres
    const memberFilter = document.getElementById('clan-member-filter')
    const dateFilter = document.getElementById('clan-date-filter')

    if (memberFilter) {
      memberFilter.addEventListener('change', () => {
        this.renderClanHistory()
      })
    }

    if (dateFilter) {
      dateFilter.addEventListener('change', () => {
        this.renderClanHistory()
      })
    }
  }

  /**
   * Charger les données du clan depuis l'API
   */
  async loadClanData() {
    if (!this.useApi || !this.currentUser || !this.currentUser.id) {
      return
    }

    // Vérifier que le token est disponible
    if (!apiService.authToken) {
      const savedToken = apiService.getSavedToken()
      if (savedToken) {
        apiService.authToken = savedToken
      } else {
        logger.warn('No auth token available for clan data')
        return
      }
    }

    try {
      // Charger le clan de l'utilisateur
      this.currentClan = await apiService.getMyClan()
      
      if (this.currentClan) {
        // Charger les membres du clan
        this.clanMembers = await apiService.getClanMembers(this.currentClan.id)
      } else {
        this.clanMembers = []
      }
    } catch (error) {
      logger.error('Failed to load clan data', error)
      this.currentClan = null
      this.clanMembers = []
    }
  }

  initAdmin() {
    const addUserBtn = document.getElementById('add-user-btn')
    const userModal = document.getElementById('user-modal')
    const userForm = document.getElementById('user-form')
    const closeModal = document.getElementById('user-modal-close')
    const cancelBtn = document.getElementById('cancel-user-btn')

    if (addUserBtn) {
      addUserBtn.addEventListener('click', () => {
        this.openUserModal()
      })
    }

    if (closeModal) {
      closeModal.addEventListener('click', () => {
        this.closeUserModal()
      })
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.closeUserModal()
      })
    }

    if (userForm) {
      userForm.addEventListener('submit', (e) => {
        e.preventDefault()
        this.saveUser()
      })
    }

    userModal.addEventListener('click', (e) => {
      if (e.target === userModal) {
        this.closeUserModal()
      }
    })
  }

  openUserModal(user = null) {
    const modal = document.getElementById('user-modal')
    const form = document.getElementById('user-form')
    const title = document.getElementById('user-modal-title')
    const usernameInput = document.getElementById('user-username')
    const passwordInput = document.getElementById('user-password')
    const passwordHint = document.getElementById('user-password-hint')
    const roleSelect = document.getElementById('user-role')
    const developpeurOption = roleSelect?.querySelector('option[value="developpeur"]')

    // Réinitialiser complètement le formulaire d'abord
    form.reset()
    
    // S'assurer que tous les champs sont activés et accessibles
    if (usernameInput) {
      usernameInput.disabled = false
      usernameInput.readOnly = false
      usernameInput.value = ''
    }
    if (passwordInput) {
      passwordInput.disabled = false
      passwordInput.readOnly = false
      passwordInput.value = ''
    }
    if (roleSelect) {
      roleSelect.disabled = false
      roleSelect.title = ''
    }

    // Masquer l'option "Développeur" si l'utilisateur actuel n'est pas développeur
    if (developpeurOption) {
      if (this.currentUser?.role === 'developpeur') {
        developpeurOption.style.display = 'block'
      } else {
        developpeurOption.style.display = 'none'
      }
    }

    if (user) {
      title.textContent = 'Modifier un compte'
      if (usernameInput) {
        usernameInput.value = user.username
        usernameInput.disabled = false
        usernameInput.readOnly = false
      }
      if (passwordInput) {
        passwordInput.value = ''
        passwordInput.required = false
        passwordInput.placeholder = 'Laisser vide pour ne pas modifier'
        passwordInput.disabled = false
        passwordInput.readOnly = false
      }
      if (passwordHint) {
        passwordHint.textContent = 'Pour modifier le mot de passe, entrez un nouveau mot de passe (min. 6 caractères)'
        passwordHint.style.display = 'block'
      }
      if (roleSelect) {
        roleSelect.value = user.role
        roleSelect.disabled = false
      }
      form.dataset.userId = user.id
      
      // Si l'utilisateur à modifier est développeur et que l'utilisateur actuel n'est pas développeur, empêcher la modification
      if (user.role === 'developpeur' && this.currentUser?.role !== 'developpeur') {
        if (roleSelect) {
          roleSelect.disabled = true
          roleSelect.title = 'Seuls les développeurs peuvent modifier le rôle développeur'
        }
      } else {
        if (roleSelect) {
          roleSelect.disabled = false
          roleSelect.title = ''
        }
      }
      
      // Les développeurs peuvent modifier n'importe quel compte, y compris les admins
      // Donc si l'utilisateur actuel est développeur, tout est autorisé
    } else {
      title.textContent = 'Créer un compte'
      if (usernameInput) {
        usernameInput.value = ''
        usernameInput.disabled = false
        usernameInput.readOnly = false
        usernameInput.required = true
      }
      if (passwordInput) {
        passwordInput.value = ''
        passwordInput.required = true
        passwordInput.placeholder = ''
        passwordInput.disabled = false
        passwordInput.readOnly = false
      }
      if (passwordHint) {
        passwordHint.style.display = 'none'
      }
      if (roleSelect) {
        roleSelect.value = 'user'
        roleSelect.disabled = false
        roleSelect.title = ''
      }
      delete form.dataset.userId
    }

    modal.classList.add('active')
  }

  closeUserModal() {
    const modal = document.getElementById('user-modal')
    const form = document.getElementById('user-form')
    const usernameInput = document.getElementById('user-username')
    const passwordInput = document.getElementById('user-password')
    const roleSelect = document.getElementById('user-role')
    
    modal.classList.remove('active')
    form.reset()
    delete form.dataset.userId
    
    // S'assurer que tous les champs sont réinitialisés et activés
    if (usernameInput) {
      usernameInput.value = ''
      usernameInput.disabled = false
      usernameInput.readOnly = false
    }
    if (passwordInput) {
      passwordInput.value = ''
      passwordInput.disabled = false
      passwordInput.readOnly = false
      passwordInput.required = true
      passwordInput.placeholder = ''
    }
    if (roleSelect) {
      roleSelect.value = 'user'
      roleSelect.disabled = false
      roleSelect.title = ''
    }
  }

  async saveUser() {
    const form = document.getElementById('user-form')
    const username = document.getElementById('user-username').value.trim()
    const password = document.getElementById('user-password').value
    const role = document.getElementById('user-role').value
    const userId = form.dataset.userId
    const submitBtn = form.querySelector('button[type="submit"]')

    // Validation
    if (!username) {
      notificationService.error('Le nom d\'utilisateur est requis')
      return
    }

    if (!userId && !password) {
      notificationService.error('Le mot de passe est requis pour créer un compte')
      return
    }

    if (password && password.length < 6) {
      notificationService.error('Le mot de passe doit contenir au moins 6 caractères')
      return
    }

    // Vérifier les permissions pour les développeurs
    // Les développeurs peuvent tout faire (créer/modifier n'importe quel compte)
    // Les admins ne peuvent pas créer/modifier des développeurs
    if (this.currentUser?.role !== 'developpeur') {
      // Si l'utilisateur actuel n'est pas développeur, vérifier les restrictions
      if (role === 'developpeur') {
        notificationService.error('Accès refusé - Seuls les développeurs peuvent créer ou modifier des utilisateurs développeurs')
        return
      }
      
      // Vérifier aussi lors de la modification d'un utilisateur existant
    if (userId) {
        const existingUser = await this.getUserById(userId)
        if (existingUser && existingUser.role === 'developpeur') {
          notificationService.error('Accès refusé - Seuls les développeurs peuvent modifier des utilisateurs développeurs')
          return
        }
      }
    }

    // Désactiver le bouton pendant la sauvegarde
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Enregistrement...'
    }

    try {
      if (this.useApi && (this.currentUser?.role === 'admin' || this.currentUser?.role === 'developpeur') && this.currentUser.id) {
        // Utiliser l'API
    if (userId) {
          // Mettre à jour un utilisateur existant
          await apiService.updateUser(
            this.currentUser.id,
            userId,
            username,
            role,
            password || null // Ne mettre à jour le mot de passe que s'il est fourni
          )
          notificationService.success('Utilisateur mis à jour avec succès')
        } else {
          // Créer un nouvel utilisateur
          const newUser = await apiService.register(username, password, role)
          notificationService.success('Utilisateur créé avec succès')
        }
        
        // Recharger la liste des utilisateurs depuis l'API
        await this.renderUsers()
      } else {
        // Mode local (fallback)
        if (userId) {
      const user = this.users.find(u => u.id === userId)
      if (user) {
        user.username = username
        if (password) {
          user.password = password
        }
        user.role = role
      }
    } else {
      if (this.users.find(u => u.username === username)) {
            notificationService.error('Ce nom d\'utilisateur existe déjà')
        return
      }

      const newUser = {
        id: Date.now().toString(),
        username,
        password,
        role,
        createdAt: new Date().toISOString()
      }
      this.users.push(newUser)
    }

        await this.saveUsers()
    this.renderUsers()
      }

    this.closeUserModal()
    } catch (error) {
      logger.error('Save user error', error)
      notificationService.error(error.message || 'Erreur lors de la sauvegarde')
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false
        submitBtn.textContent = 'Enregistrer'
      }
    }
  }

  /**
   * Obtenir un utilisateur par son ID
   */
  async getUserById(userId) {
    if (!userId) return null
    
    // Si on utilise l'API, chercher dans la liste des utilisateurs chargés
    if (this.useApi && this.users && Array.isArray(this.users)) {
      return this.users.find(u => u.id === userId.toString() || u.id === userId) || null
    }
    
    // Mode local
    if (this.users && Array.isArray(this.users)) {
      return this.users.find(u => u.id === userId.toString() || u.id === userId) || null
    }
    
    return null
  }

  async deleteUser(id) {
    if (!id) return
    
    // Récupérer l'utilisateur à supprimer
    const userToDelete = await this.getUserById(id)
    if (!userToDelete) {
      notificationService.error('Utilisateur introuvable')
      return
    }
    
    // Vérifier les permissions : les admins ne peuvent pas supprimer des développeurs
    if (this.currentUser?.role === 'admin' && userToDelete.role === 'developpeur') {
      notificationService.error('Accès refusé - Les administrateurs ne peuvent pas supprimer des comptes développeurs')
      return
    }
    
    // Les développeurs peuvent supprimer n'importe quel compte
    // Les admins peuvent supprimer les autres comptes (sauf développeurs)
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le compte "${userToDelete.username}" ?`)) {
      return
    }
    
    try {
      if (this.useApi && (this.currentUser?.role === 'admin' || this.currentUser?.role === 'developpeur') && this.currentUser.id) {
        // Utiliser l'API pour supprimer
        await apiService.deleteUser(id)
        notificationService.success('Utilisateur supprimé avec succès')
      } else {
        // Mode local
      this.users = this.users.filter(u => u.id !== id)
        await this.saveUsers()
        notificationService.success('Utilisateur supprimé avec succès')
      }
      
      await this.renderUsers()
    } catch (error) {
      logger.error('Delete user error', error)
      notificationService.error(error.message || 'Erreur lors de la suppression de l\'utilisateur')
    }
  }

  async renderUsers() {
    const tbody = document.getElementById('users-tbody')
    if (!tbody) {
      console.warn('users-tbody not found')
      return
    }
    
    // Initialiser this.users si vide
    if (!this.users) {
      this.users = []
    }
    
    // Charger les utilisateurs depuis l'API si activé (admin ou développeur)
    const canLoadUsers = this.useApi && (this.currentUser?.role === 'admin' || this.currentUser?.role === 'developpeur') && this.currentUser.id
    
    if (canLoadUsers) {
      try {
        const usersFromApi = await apiService.getAllUsers()
        
        if (usersFromApi && Array.isArray(usersFromApi)) {
          // Convertir le format pour compatibilité
          this.users = usersFromApi.map(u => ({
            id: u.id ? u.id.toString() : String(Date.now() + Math.random()),
            username: u.username || 'Inconnu',
            role: u.role || 'user',
            createdAt: u.created_at || u.createdAt || new Date().toISOString()
          }))
        } else {
          this.users = []
        }
      } catch (error) {
        logger.error('Failed to load users from API', error)
        const errorMsg = error.data?.error || error.message || 'Erreur inconnue'
        notificationService.error('Erreur lors du chargement des utilisateurs: ' + errorMsg)
        this.users = []
      }
    } else {
      if (!this.useApi) {
        // Mode local - charger depuis localStorage si disponible
        try {
          const savedUsers = localStorage.getItem('backhub-users')
          if (savedUsers) {
            this.users = JSON.parse(savedUsers)
          }
        } catch (error) {
          logger.error('Failed to load users from localStorage', error)
          this.users = []
        }
      }
    }
    
    // Afficher un message si aucun utilisateur
    if (!this.users || this.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: rgba(255, 255, 255, 0.6);">Aucun utilisateur trouvé</td></tr>'
      return
    }
    
    const userStats = {}
    this.history.forEach(t => {
      if (!userStats[t.user]) {
        userStats[t.user] = { transactions: 0, volume: 0 }
      }
      userStats[t.user].transactions++
      userStats[t.user].volume += t.totalSell || 0
    })
    
    tbody.innerHTML = this.users.map(user => {
      const date = new Date(user.createdAt)
      const stats = userStats[user.username] || { transactions: 0, volume: 0 }
      
      return `
        <tr>
          <td><strong>${this.escapeHtml(user.username)}</strong></td>
          <td><span class="badge ${user.role === 'admin' ? 'badge-admin' : user.role === 'developpeur' ? 'badge-developpeur' : 'badge-user'}">${user.role === 'admin' ? 'Admin' : user.role === 'developpeur' ? 'Développeur' : 'Utilisateur'}</span></td>
          <td>${this.formatDate(date)}</td>
          <td class="text-right">${stats.transactions}</td>
          <td class="text-right">${this.formatPrice(stats.volume)}</td>
          <td>
            <div class="table-actions">
              <button class="btn-icon btn-edit" data-user-id="${user.id}" title="Modifier">
                ✏️
              </button>
              ${user.id !== this.currentUser.id ? `
                ${(this.currentUser?.role === 'developpeur' || (this.currentUser?.role === 'admin' && user.role !== 'developpeur')) ? `
                <button class="btn-icon btn-delete" onclick="app.deleteUser('${user.id}')" title="Supprimer">
                  🗑️
                </button>
                ` : ''}
              ` : ''}
            </div>
          </td>
        </tr>
      `
    }).join('')

    tbody.querySelectorAll('.btn-edit[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId
        const user = this.users.find(u => u.id === userId)
        if (user) {
          this.openUserModal(user)
        }
      })
    })
  }

  async renderDashboard() {
    // Recharger les données depuis l'API pour s'assurer que tout est à jour
    if (this.useApi && this.currentUser && this.currentUser.id) {
      await this.loadUserDataFromApi(this.currentUser.id)
    }
    
    // Afficher la date actuelle
    const dateElement = document.getElementById('dashboard-current-date')
    if (dateElement) {
      const now = new Date()
      const dateStr = now.toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      })
      dateElement.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1)
    }

    // Calculer les statistiques principales
    const totalProfit = this.history.reduce((sum, t) => sum + (t.margin || 0), 0)
    const totalTransactions = this.history.length
    const avgMargin = totalTransactions > 0 ? totalProfit / totalTransactions : 0
    const totalBuy = this.history.reduce((sum, t) => sum + (t.totalBuy || 0), 0)
    const totalSell = this.history.reduce((sum, t) => sum + (t.totalSell || 0), 0)
    
    // Calculer le pourcentage de marge moyen
    const avgMarginPercent = totalBuy > 0 ? ((totalProfit / totalBuy) * 100) : 0
    
    // Calculer le nombre total d'items
    const totalItems = this.history.reduce((sum, t) => {
      return sum + (t.items ? t.items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0) : 0)
    }, 0)
    
    // Trouver la meilleure transaction
    const bestTransaction = this.history.length > 0 
      ? this.history.reduce((best, t) => (t.margin || 0) > (best.margin || 0) ? t : best, this.history[0])
      : null
    const bestMargin = bestTransaction ? (bestTransaction.margin || 0) : 0

    // Mettre à jour les statistiques principales
    document.getElementById('dashboard-total-profit').textContent = formatPrice(totalProfit)
    document.getElementById('dashboard-total-transactions').textContent = totalTransactions.toString()
    document.getElementById('dashboard-avg-margin').textContent = formatPrice(avgMargin)
    document.getElementById('dashboard-total-buy').textContent = formatPrice(totalBuy)
    
    // Mettre à jour les statistiques avancées
    const totalSellEl = document.getElementById('dashboard-total-sell')
    if (totalSellEl) totalSellEl.textContent = formatPrice(totalSell)
    const totalSellAdvancedEl = document.getElementById('dashboard-total-sell-advanced')
    if (totalSellAdvancedEl) totalSellAdvancedEl.textContent = formatPrice(totalSell)
    document.getElementById('dashboard-avg-margin-percent').textContent = `${avgMarginPercent.toFixed(1)}%`
    document.getElementById('dashboard-best-margin').textContent = formatPrice(bestMargin)
    document.getElementById('dashboard-total-items').textContent = totalItems.toString()

    // Afficher les transactions récentes (5 dernières)
    const recentContainer = document.getElementById('dashboard-recent-transactions')
    if (recentContainer) {
      const recentTransactions = this.history.slice(-5).reverse()
      
      if (recentTransactions.length === 0) {
        recentContainer.innerHTML = `
          <div class="empty-state-modern">
            <div class="empty-state-icon-large">📋</div>
            <div class="empty-state-title">Aucune transaction</div>
            <div class="empty-state-text">Vos transactions récentes apparaîtront ici</div>
          </div>
        `
      } else {
        recentContainer.innerHTML = recentTransactions.map((transaction, index) => {
          const date = new Date(transaction.date)
          const dateStr = date.toLocaleDateString('fr-FR', { 
            day: '2-digit', 
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
          const itemsText = transaction.items 
            ? transaction.items.map(i => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`).join(', ')
            : 'N/A'
          return `
            <div class="recent-transaction-item" style="animation-delay: ${index * 0.1}s">
              <div class="transaction-info">
                <div class="transaction-items">${this.escapeHtml(itemsText)}</div>
                <div class="transaction-date">${dateStr}</div>
              </div>
              <div class="transaction-margin ${transaction.margin >= 0 ? 'positive' : 'negative'}">
                ${transaction.margin >= 0 ? '+' : ''}${formatPrice(transaction.margin)}
              </div>
            </div>
          `
        }).join('')
      }
    }

    // Afficher les meilleures transactions (top 5)
    const topContainer = document.getElementById('dashboard-top-transactions')
    if (topContainer) {
      const topTransactions = [...this.history]
        .sort((a, b) => (b.margin || 0) - (a.margin || 0))
        .slice(0, 5)
      
      if (topTransactions.length === 0) {
        topContainer.innerHTML = `
          <div class="empty-state-modern">
            <div class="empty-state-icon-large">🏆</div>
            <div class="empty-state-title">Aucune transaction</div>
            <div class="empty-state-text">Vos meilleures transactions apparaîtront ici</div>
          </div>
        `
      } else {
        topContainer.innerHTML = topTransactions.map((transaction, index) => {
          const date = new Date(transaction.date)
          const dateStr = date.toLocaleDateString('fr-FR', { 
            day: '2-digit', 
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
          const itemsText = transaction.items 
            ? transaction.items.map(i => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`).join(', ')
            : 'N/A'
          const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''
          return `
            <div class="top-transaction-item" style="animation-delay: ${index * 0.1}s">
              <div class="transaction-rank ${rankClass}">${index + 1}</div>
              <div class="transaction-info">
                <div class="transaction-items">${this.escapeHtml(itemsText)}</div>
                <div class="transaction-date">${dateStr}</div>
              </div>
              <div class="transaction-margin positive">
                ${formatPrice(transaction.margin || 0)}
              </div>
            </div>
          `
        }).join('')
      }
    }

    // Gérer les clics sur les boutons d'action rapide
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
      if (!btn.dataset.listenerAttached) {
        btn.dataset.listenerAttached = 'true'
        
        btn.addEventListener('click', (e) => {
          const view = btn.dataset.view
          const calcType = btn.dataset.calcType
          
          if (view) {
            this.switchView(view)
            
            // Mettre à jour la navigation active
            document.querySelectorAll('.nav-item').forEach(nav => {
              if (nav.id !== 'logout-btn' && nav.id !== 'settings-btn') {
                nav.classList.remove('active')
              }
            })
            
            // Activer le bon élément de navigation
            if (view === 'calculator' && calcType) {
              const navItem = document.querySelector(`.nav-item[data-view="calculator"][data-calc-type="${calcType}"]`)
              if (navItem) navItem.classList.add('active')
            } else {
              const navItem = document.querySelector(`.nav-item[data-view="${view}"]`)
              if (navItem) navItem.classList.add('active')
            }
            
            // Si c'est le calculateur, changer le type
            if (view === 'calculator' && calcType) {
              this.currentCalcType = calcType
              this.switchCalculatorType(calcType)
            }
          }
        })
      }
    })

    // Gérer le bouton "Tout voir" dans les transactions récentes
    const seeAllBtn = document.querySelector('.modern-card-action[data-view="history"]')
    if (seeAllBtn && !seeAllBtn.dataset.listenerAttached) {
      seeAllBtn.dataset.listenerAttached = 'true'
      seeAllBtn.addEventListener('click', () => {
        this.switchView('history')
        document.querySelectorAll('.nav-item').forEach(nav => {
          if (nav.id !== 'logout-btn') {
            nav.classList.remove('active')
          }
        })
        const historyNav = document.querySelector('.nav-item[data-view="history"]')
        if (historyNav) historyNav.classList.add('active')
      })
    }
  }

  async renderAdminDashboard() {
    // Recharger les données depuis l'API pour s'assurer que tout est à jour
    if (this.useApi && this.currentUser && this.currentUser.id) {
      await this.loadUserDataFromApi(this.currentUser.id)
    }
    
    // Afficher/masquer l'onglet feedbacks selon le rôle
    this.updateAdminTabsVisibility()
    
    this.initAdminTabs()
    await this.calculateStats()
    await this.renderUsers()
    this.renderCharts()
    await this.renderPriceAnalysis()
    
    // Initialiser les feedbacks si l'onglet est actif
    const feedbacksTab = document.querySelector('.admin-tab[data-tab="feedbacks"]')
    if (feedbacksTab && feedbacksTab.classList.contains('active')) {
      this.initAdminFeedbacks()
      await this.loadAdminFeedbacks()
    }
    
    const refreshBtn = document.getElementById('refresh-stats-btn')
    if (refreshBtn && !refreshBtn.dataset.listenerAttached) {
      refreshBtn.dataset.listenerAttached = 'true'
      refreshBtn.addEventListener('click', async () => {
        // Recharger les données depuis l'API avant de recalculer
        if (this.useApi && this.currentUser && this.currentUser.id) {
          await this.loadUserDataFromApi(this.currentUser.id)
        }
        await this.calculateStats()
        this.renderCharts()
        await this.renderPriceAnalysis()
        await this.renderUsers()
      })
    }
  }

  /**
   * Mettre à jour la visibilité des onglets admin selon le rôle
   */
  updateAdminTabsVisibility() {
    if (!this.currentUser) {
      return
    }
    
    const feedbacksTab = document.querySelector('.admin-nav-tab[data-tab="feedbacks"]')
    if (!feedbacksTab) {
      return
    }
    
    if (this.currentUser.role === 'developpeur') {
      feedbacksTab.style.display = 'flex'
      feedbacksTab.style.visibility = 'visible'
      feedbacksTab.style.opacity = '1'
    } else {
      feedbacksTab.style.display = 'none'
      feedbacksTab.style.visibility = 'hidden'
    }
  }

  initAdminTabs() {
    const tabs = document.querySelectorAll('.admin-nav-tab')
    const contents = document.querySelectorAll('.admin-tab-content')
    
    tabs.forEach(tab => {
      if (!tab.dataset.listenerAttached) {
        tab.dataset.listenerAttached = 'true'
        tab.addEventListener('click', () => {
          const targetTab = tab.dataset.tab
          
          tabs.forEach(t => t.classList.remove('active'))
          contents.forEach(c => c.classList.remove('active'))
          
          tab.classList.add('active')
          const targetContent = document.getElementById(`admin-${targetTab}`)
          if (targetContent) {
            targetContent.classList.add('active')
            if (targetTab === 'prices') {
              this.renderPriceAnalysis()
            } else if (targetTab === 'users') {
              this.renderUsers()
            } else if (targetTab === 'feedbacks') {
              this.initAdminFeedbacks()
              this.loadAdminFeedbacks()
            }
          }
        })
      }
    })
  }

  /**
   * Initialiser les filtres et boutons pour les feedbacks admin
   */
  initAdminFeedbacks() {
    const statusFilter = document.getElementById('feedback-filter-status')
    const typeFilter = document.getElementById('feedback-filter-type')
    const refreshBtn = document.getElementById('refresh-feedbacks-btn')

    if (statusFilter && !statusFilter.dataset.listenerAttached) {
      statusFilter.dataset.listenerAttached = 'true'
      statusFilter.addEventListener('change', () => {
        this.loadAdminFeedbacks()
      })
    }

    if (typeFilter && !typeFilter.dataset.listenerAttached) {
      typeFilter.dataset.listenerAttached = 'true'
      typeFilter.addEventListener('change', () => {
        this.loadAdminFeedbacks()
      })
    }

    if (refreshBtn && !refreshBtn.dataset.listenerAttached) {
      refreshBtn.dataset.listenerAttached = 'true'
      refreshBtn.addEventListener('click', () => {
        this.loadAdminFeedbacks()
      })
    }
  }

  /**
   * Charger les feedbacks pour l'admin
   */
  async loadAdminFeedbacks() {
    const feedbacksList = document.getElementById('admin-feedbacks-list')
    if (!feedbacksList) return

    // Vérifier que l'utilisateur est développeur
    if (!this.currentUser || this.currentUser.role !== 'developpeur') {
      feedbacksList.innerHTML = '<div class="error-message">Accès refusé - Développeur seulement</div>'
      return
    }

    if (!this.useApi) {
      feedbacksList.innerHTML = '<div class="error-message">Mode hors ligne - Les feedbacks ne sont pas disponibles</div>'
      return
    }

    const statusFilter = document.getElementById('feedback-filter-status')
    const typeFilter = document.getElementById('feedback-filter-type')
    const status = statusFilter?.value || ''
    const type = typeFilter?.value || ''

    feedbacksList.innerHTML = '<div class="loading-state"><span>Chargement...</span></div>'

    try {
      const result = await apiService.getAllFeedbacks(status, type, 100, 0)
      if (result && result.success && result.feedbacks) {
        this.renderAdminFeedbacks(result.feedbacks)
      } else {
        feedbacksList.innerHTML = '<div class="empty-message">Aucun feedback trouvé</div>'
      }
    } catch (error) {
      feedbacksList.innerHTML = '<div class="error-message">Erreur lors du chargement des feedbacks</div>'
    }
  }

  /**
   * Rendre la liste des feedbacks pour l'admin
   */
  renderAdminFeedbacks(feedbacks) {
    const feedbacksList = document.getElementById('admin-feedbacks-list')
    if (!feedbacksList) return

    if (!feedbacks || feedbacks.length === 0) {
      feedbacksList.innerHTML = `
        <div class="admin-empty-state">
          <div class="admin-empty-icon">📝</div>
          <div class="admin-empty-title">Aucun feedback trouvé</div>
          <div class="admin-empty-text">Aucun feedback ne correspond aux filtres sélectionnés</div>
        </div>
      `
      return
    }

    const typeIcons = {
      bug: '🐛',
      suggestion: '💡',
      question: '❓',
      other: '📝'
    }

    const typeLabels = {
      bug: 'Bug',
      suggestion: 'Suggestion',
      question: 'Question',
      other: 'Autre'
    }

    const statusLabels = {
      new: 'Nouveau',
      in_progress: 'En cours',
      resolved: 'Résolu',
      closed: 'Fermé'
    }

    const statusColors = {
      new: '#f97316',
      in_progress: '#3b82f6',
      resolved: '#10b981',
      closed: '#6b7280'
    }

    feedbacksList.innerHTML = feedbacks.map(feedback => {
      const createdDate = new Date(feedback.created_at)
      const dateStr = createdDate.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })

      return `
        <div class="admin-feedback-card-modern" data-feedback-id="${feedback.id}">
          <div class="admin-feedback-header-modern">
            <div class="admin-feedback-type-badge admin-feedback-type-${feedback.type}">
              <span class="admin-feedback-type-icon">${typeIcons[feedback.type] || '📝'}</span>
              <span class="admin-feedback-type-text">${typeLabels[feedback.type] || 'Autre'}</span>
            </div>
            <div class="admin-feedback-status-badge" style="background-color: ${statusColors[feedback.status] || '#6b7280'}20; color: ${statusColors[feedback.status] || '#6b7280'}; border-color: ${statusColors[feedback.status] || '#6b7280'}40;">
              ${statusLabels[feedback.status] || feedback.status}
            </div>
          </div>
          <div class="admin-feedback-body-modern">
            <div class="admin-feedback-title-wrapper">
              <span class="admin-feedback-label">Titre:</span>
              <h4 class="admin-feedback-title-modern">${this.escapeHtml(feedback.title)}</h4>
            </div>
            <div class="admin-feedback-description-box">
              <span class="admin-feedback-label">Description:</span>
              <div class="admin-feedback-description-content">
                <p class="admin-feedback-description-modern">${this.escapeHtml(feedback.description)}</p>
              </div>
            </div>
            <div class="admin-feedback-meta-modern">
              <div class="admin-feedback-meta-item">
                <span class="admin-feedback-meta-label">Utilisateur:</span>
                <span class="admin-feedback-meta-value">${this.escapeHtml(feedback.username || 'Inconnu')}</span>
              </div>
              <div class="admin-feedback-meta-item">
                <span class="admin-feedback-meta-label">Date:</span>
                <span class="admin-feedback-meta-value">${dateStr}</span>
              </div>
            </div>
            ${feedback.admin_response ? `
              <div class="admin-feedback-response-modern">
                <div class="admin-feedback-response-header-modern">
                  <span class="admin-feedback-response-label">Réponse de ${this.escapeHtml(feedback.admin_username || 'l\'équipe')}:</span>
                </div>
                <div class="admin-feedback-response-content-modern">${this.escapeHtml(feedback.admin_response)}</div>
              </div>
            ` : ''}
          </div>
          <div class="admin-feedback-footer-modern">
            <div class="admin-feedback-actions-modern">
              <select class="admin-feedback-status-select" data-feedback-id="${feedback.id}" data-current-status="${feedback.status}">
                <option value="new" ${feedback.status === 'new' ? 'selected' : ''}>Nouveau</option>
                <option value="in_progress" ${feedback.status === 'in_progress' ? 'selected' : ''}>En cours</option>
                <option value="resolved" ${feedback.status === 'resolved' ? 'selected' : ''}>Résolu</option>
                <option value="closed" ${feedback.status === 'closed' ? 'selected' : ''}>Fermé</option>
              </select>
              <button class="admin-action-btn admin-action-btn-primary admin-feedback-response-btn" data-feedback-id="${feedback.id}" data-feedback-title="${this.escapeHtml(feedback.title)}" data-feedback-response="${this.escapeHtml(feedback.admin_response || '')}">
                <span class="admin-action-icon">${feedback.admin_response ? '✏️' : '💬'}</span>
                <span>${feedback.admin_response ? 'Modifier la réponse' : 'Répondre'}</span>
              </button>
              <button class="admin-action-btn admin-action-btn-danger admin-feedback-delete-btn" data-feedback-id="${feedback.id}" data-feedback-title="${this.escapeHtml(feedback.title)}" title="Supprimer ce feedback">
                <span class="admin-action-icon">🗑️</span>
                <span>Supprimer</span>
              </button>
            </div>
            ${feedback.resolved_at ? `
              <div class="admin-feedback-resolved-date">
                Résolu le ${new Date(feedback.resolved_at).toLocaleDateString('fr-FR')}
              </div>
            ` : ''}
          </div>
        </div>
      `
    }).join('')

    // Attacher les listeners pour les changements de statut
    feedbacksList.querySelectorAll('.admin-feedback-status-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const feedbackId = parseInt(e.target.dataset.feedbackId)
        const newStatus = e.target.value
        const oldStatus = e.target.dataset.currentStatus

        if (newStatus !== oldStatus) {
          await this.updateFeedbackStatus(feedbackId, newStatus)
        }
      })
    })

    // Attacher les listeners pour les boutons de réponse
    feedbacksList.querySelectorAll('.admin-feedback-response-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const feedbackId = parseInt(btn.dataset.feedbackId)
        const title = btn.dataset.feedbackTitle
        const currentResponse = btn.dataset.feedbackResponse
        const feedbackCard = btn.closest('.admin-feedback-card-modern')
        
        // Extraire les données du feedback depuis la carte
        let feedbackData = null
        if (feedbackCard) {
          const typeBadge = feedbackCard.querySelector('.admin-feedback-type-badge')
          const type = typeBadge?.classList.contains('admin-feedback-type-bug') ? 'bug' :
                      typeBadge?.classList.contains('admin-feedback-type-suggestion') ? 'suggestion' :
                      typeBadge?.classList.contains('admin-feedback-type-question') ? 'question' : 'other'
          const usernameEl = feedbackCard.querySelectorAll('.admin-feedback-meta-value')[0]
          const dateEl = feedbackCard.querySelectorAll('.admin-feedback-meta-value')[1]
          const descEl = feedbackCard.querySelector('.admin-feedback-description-modern')
          
          feedbackData = {
            type: type,
            username: usernameEl?.textContent || 'Inconnu',
            date: dateEl?.textContent || '',
            description: descEl?.textContent || ''
          }
        }
        
        this.openFeedbackResponseModal(feedbackId, title, currentResponse, feedbackData)
      })
    })

    // Attacher les listeners pour les boutons de suppression
    feedbacksList.querySelectorAll('.admin-feedback-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feedbackId = parseInt(btn.dataset.feedbackId)
        const title = btn.dataset.feedbackTitle
        if (confirm(`Êtes-vous sûr de vouloir supprimer le feedback "${title}" ? Cette action est irréversible.`)) {
          await this.deleteFeedback(feedbackId)
        }
      })
    })
  }

  /**
   * Supprimer un feedback (développeur seulement)
   */
  async deleteFeedback(feedbackId) {
    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible de supprimer le feedback en mode hors ligne')
      return
    }

    // Vérifier que l'utilisateur est développeur
    if (this.currentUser.role !== 'developpeur') {
      notificationService.error('Accès refusé - Développeur seulement')
      return
    }

    try {
      const result = await apiService.deleteFeedback(feedbackId)
      if (result && result.success) {
        notificationService.success('Feedback supprimé avec succès')
        await this.loadAdminFeedbacks()
      } else {
        notificationService.error(result?.message || 'Erreur lors de la suppression')
      }
    } catch (error) {
      const errorMessage = error.data?.message || error.data?.error || error.message || 'Erreur lors de la suppression'
      notificationService.error(errorMessage)
    }
  }

  /**
   * Mettre à jour le statut d'un feedback
   */
  async updateFeedbackStatus(feedbackId, status) {
    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible de mettre à jour le statut en mode hors ligne')
      return
    }

    try {
      const result = await apiService.updateFeedbackStatus(feedbackId, status)
      if (result && result.success) {
        notificationService.success('Statut mis à jour avec succès')
        await this.loadAdminFeedbacks()
      } else {
        notificationService.error(result?.message || 'Erreur lors de la mise à jour')
      }
    } catch (error) {
      const errorMessage = error.data?.message || error.data?.error || error.message || 'Erreur lors de la mise à jour'
      notificationService.error(errorMessage)
    }
  }

  /**
   * Ouvrir le modal pour répondre à un feedback
   */
  openFeedbackResponseModal(feedbackId, title, currentResponse = '', feedbackData = null) {
    // Récupérer les données du feedback depuis la liste si disponibles
    if (!feedbackData) {
      const feedbackCard = document.querySelector(`[data-feedback-id="${feedbackId}"]`)
      if (feedbackCard) {
        const typeEl = feedbackCard.querySelector('.admin-feedback-type-text')
        const usernameEl = feedbackCard.querySelector('.admin-feedback-meta-value')
        const dateEl = feedbackCard.querySelectorAll('.admin-feedback-meta-value')[1]
        const descEl = feedbackCard.querySelector('.admin-feedback-description-modern')
        
        feedbackData = {
          type: feedbackCard.querySelector('.admin-feedback-type-badge')?.classList.contains('admin-feedback-type-bug') ? 'bug' :
                 feedbackCard.querySelector('.admin-feedback-type-badge')?.classList.contains('admin-feedback-type-suggestion') ? 'suggestion' :
                 feedbackCard.querySelector('.admin-feedback-type-badge')?.classList.contains('admin-feedback-type-question') ? 'question' : 'other',
          username: usernameEl?.textContent || 'Inconnu',
          date: dateEl?.textContent || '',
          description: descEl?.textContent || ''
        }
      }
    }

    const typeConfig = {
      bug: { icon: '🐛', label: 'Bug', color: '#ef4444' },
      suggestion: { icon: '💡', label: 'Suggestion', color: '#3b82f6' },
      question: { icon: '❓', label: 'Question', color: '#f97316' },
      other: { icon: '📝', label: 'Autre', color: '#6b7280' }
    }
    const config = typeConfig[feedbackData?.type || 'other'] || typeConfig.other

    // Créer un modal professionnel et moderne
    const modal = document.createElement('div')
    modal.className = 'feedback-response-modal-overlay'
    modal.id = 'feedback-response-modal'
    document.body.appendChild(modal)

    modal.innerHTML = `
      <div class="feedback-response-modal-container">
        <div class="feedback-response-modal-header">
          <div class="feedback-response-modal-header-left">
            <div class="feedback-response-modal-icon-wrapper">
              <svg class="feedback-response-modal-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <div class="feedback-response-modal-title-group">
              <h2 class="feedback-response-modal-title">Répondre au feedback</h2>
              <p class="feedback-response-modal-subtitle">Rédigez une réponse claire et professionnelle</p>
            </div>
          </div>
          <button class="feedback-response-modal-close" id="feedback-response-modal-close" aria-label="Fermer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="feedback-response-modal-body">
          <div class="feedback-response-context-section">
            <div class="feedback-response-context-header">
              <div class="feedback-response-context-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              </div>
              <span class="feedback-response-context-label">Feedback original</span>
            </div>
            <div class="feedback-response-context-card">
              <div class="feedback-response-context-meta">
                <div class="feedback-response-context-type-badge" style="--type-color: ${config.color}">
                  <span class="feedback-response-context-type-icon">${config.icon}</span>
                  <span class="feedback-response-context-type-label">${config.label}</span>
                </div>
                ${feedbackData ? `
                  <div class="feedback-response-context-info">
                    <div class="feedback-response-context-info-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                      <span>${this.escapeHtml(feedbackData.username)}</span>
                    </div>
                    ${feedbackData.date ? `
                      <div class="feedback-response-context-info-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>${this.escapeHtml(feedbackData.date)}</span>
                      </div>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
              <div class="feedback-response-context-content">
                <h3 class="feedback-response-context-title">${this.escapeHtml(title)}</h3>
                ${feedbackData?.description ? `
                  <p class="feedback-response-context-description">${this.escapeHtml(feedbackData.description)}</p>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="feedback-response-form-section">
            <div class="feedback-response-form-header">
              <div class="feedback-response-form-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </div>
              <span class="feedback-response-form-label">Votre réponse</span>
            </div>
            <div class="feedback-response-form-field">
              <textarea 
                id="feedback-response-text" 
                class="feedback-response-textarea" 
                rows="10" 
                placeholder="Rédigez votre réponse ici... Assurez-vous d'être clair, professionnel et de répondre à toutes les questions soulevées.">${this.escapeHtml(currentResponse)}</textarea>
              <div class="feedback-response-field-footer">
                <div class="feedback-response-field-hint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>Votre réponse sera visible par l'utilisateur</span>
                </div>
                <span class="feedback-response-char-count" id="feedback-response-char-count">0 caractères</span>
              </div>
            </div>
          </div>
        </div>
        <div class="feedback-response-modal-footer">
          <button type="button" class="feedback-response-btn feedback-response-btn-secondary" id="cancel-feedback-response-btn">
            <span>Annuler</span>
          </button>
          <button type="button" class="feedback-response-btn feedback-response-btn-primary" id="save-feedback-response-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span>Enregistrer la réponse</span>
          </button>
        </div>
      </div>
    `

    // Fermer le modal
    const closeBtn = modal.querySelector('#feedback-response-modal-close')
    const cancelBtn = modal.querySelector('#cancel-feedback-response-btn')
    const saveBtn = modal.querySelector('#save-feedback-response-btn')
    const textarea = modal.querySelector('#feedback-response-text')
    const charCount = modal.querySelector('#feedback-response-char-count')

    // Mettre à jour le compteur de caractères
    const updateCharCount = () => {
      if (charCount && textarea) {
        const count = textarea.value.length
        charCount.textContent = `${count} caractère${count > 1 ? 's' : ''}`
      }
    }

    // Initialiser le compteur
    if (textarea && charCount) {
      updateCharCount()
      textarea.addEventListener('input', updateCharCount)
    }

    const closeModal = () => {
      modal.style.opacity = '0'
      setTimeout(() => {
        modal.remove()
        document.body.style.overflow = ''
      }, 200)
    }

    closeBtn?.addEventListener('click', closeModal)
    cancelBtn?.addEventListener('click', closeModal)

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal()
    })

    const modalContainer = modal.querySelector('.feedback-response-modal-container')
    if (modalContainer) {
      modalContainer.addEventListener('click', (e) => {
        e.stopPropagation()
      })
    }

    // Sauvegarder la réponse
    saveBtn?.addEventListener('click', async () => {
      const responseText = document.getElementById('feedback-response-text')?.value.trim() || ''
      await this.saveFeedbackResponse(feedbackId, responseText)
      closeModal()
    })

    // Focus sur le textarea
    if (textarea) {
      setTimeout(() => {
        textarea.focus()
      }, 100)
    }

    // Empêcher le scroll du body
    document.body.style.overflow = 'hidden'
  }

  /**
   * Sauvegarder la réponse à un feedback
   */
  async saveFeedbackResponse(feedbackId, response) {
    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible d\'enregistrer la réponse en mode hors ligne')
      return
    }

    try {
      // Mettre à jour le statut en "resolved" si ce n'est pas déjà le cas
      const result = await apiService.updateFeedbackStatus(feedbackId, 'resolved', response)
      if (result && result.success) {
        notificationService.success('Réponse enregistrée avec succès')
        await this.loadAdminFeedbacks()
      } else {
        notificationService.error(result?.message || 'Erreur lors de l\'enregistrement')
      }
    } catch (error) {
      const errorMessage = error.data?.message || error.data?.error || error.message || 'Erreur lors de l\'enregistrement'
      notificationService.error(errorMessage)
    }
  }

  calculateStats() {
    const stats = this.getMarketStats()
    
    const totalEl = document.getElementById('stat-total-transactions')
    const usersEl = document.getElementById('stat-active-users')
    const buyEl = document.getElementById('stat-total-buy')
    const sellEl = document.getElementById('stat-total-sell')
    const marginEl = document.getElementById('stat-total-margin')
    const avgEl = document.getElementById('stat-avg-margin')
    
    if (totalEl) totalEl.textContent = stats.totalTransactions
    if (usersEl) usersEl.textContent = stats.activeUsers
    if (buyEl) buyEl.textContent = this.formatPrice(stats.totalBuy)
    if (sellEl) sellEl.textContent = this.formatPrice(stats.totalSell)
    if (marginEl) marginEl.textContent = this.formatPrice(stats.totalMargin)
    if (avgEl) avgEl.textContent = this.formatPrice(stats.avgMargin)
  }

  getMarketStats() {
    const totalTransactions = this.history.length
    const activeUsers = new Set(this.history.map(t => t.user)).size
    const totalBuy = this.history.reduce((sum, t) => sum + (t.totalBuy || 0), 0)
    const totalSell = this.history.reduce((sum, t) => sum + (t.totalSell || 0), 0)
    const totalMargin = totalSell - totalBuy
    const avgMargin = totalTransactions > 0 ? totalMargin / totalTransactions : 0
    
    return {
      totalTransactions,
      activeUsers,
      totalBuy,
      totalSell,
      totalMargin,
      avgMargin
    }
  }

  renderCharts() {
    if (typeof Chart === 'undefined') {
      setTimeout(() => this.renderCharts(), 100)
      return
    }
    
    this.renderTransactionsTimeline()
    this.renderUsersDistribution()
    this.renderVolumeTimeline()
    this.renderTopItems()
    this.renderMarginDistribution()
    this.renderCategoryDistribution()
    this.renderPriceBalance()
    this.renderMarginRatio()
    this.renderUserActivity()
    this.renderUserPerformance()
  }

  renderTransactionsTimeline() {
    const ctx = document.getElementById('chart-transactions-timeline')
    if (!ctx) return
    
    const last7Days = this.getLast7Days()
    const data = last7Days.map(date => {
      return this.history.filter(t => {
        const tDate = new Date(t.date).toDateString()
        return tDate === date.toDateString()
      }).length
    })
    
    if (this.chartTransactionsTimeline) {
      this.chartTransactionsTimeline.destroy()
    }
    
    this.chartTransactionsTimeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: last7Days.map(d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Nombre de transactions',
          data: data,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderUsersDistribution() {
    const ctx = document.getElementById('chart-users-distribution')
    if (!ctx) return
    
    const userStats = {}
    this.history.forEach(t => {
      if (!userStats[t.user]) {
        userStats[t.user] = 0
      }
      userStats[t.user]++
    })
    
    const labels = Object.keys(userStats)
    const data = Object.values(userStats)
    
    if (this.chartUsersDistribution) {
      this.chartUsersDistribution.destroy()
    }
    
    this.chartUsersDistribution = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: [
            '#f97316',
            '#fb923c',
            '#fdba74',
            '#fed7aa',
            '#ffedd5',
            '#fef3c7',
            '#fde68a',
            '#fcd34d'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#cccccc'
            }
          }
        }
      }
    })
  }

  renderVolumeTimeline() {
    const ctx = document.getElementById('chart-volume-timeline')
    if (!ctx) return
    
    const last7Days = this.getLast7Days()
    const buyData = last7Days.map(date => {
      return this.history.filter(t => {
        const tDate = new Date(t.date).toDateString()
        return tDate === date.toDateString()
      }).reduce((sum, t) => sum + (t.totalBuy || 0), 0)
    })
    
    const sellData = last7Days.map(date => {
      return this.history.filter(t => {
        const tDate = new Date(t.date).toDateString()
        return tDate === date.toDateString()
      }).reduce((sum, t) => sum + (t.totalSell || 0), 0)
    })
    
    if (this.chartVolumeTimeline) {
      this.chartVolumeTimeline.destroy()
    }
    
    this.chartVolumeTimeline = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: last7Days.map(d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Volume Achat',
          data: buyData,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: '#ef4444',
          borderWidth: 1
        }, {
          label: 'Volume Revente',
          data: sellData,
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: '#22c55e',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#cccccc'
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#cccccc',
              callback: function(value) {
                return value.toLocaleString('fr-FR') + ' €'
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderTopItems() {
    const ctx = document.getElementById('chart-top-items')
    if (!ctx) return
    
    const itemStats = {}
    this.history.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          const key = item.name || item.item
          if (!itemStats[key]) {
            itemStats[key] = { quantity: 0, volume: 0 }
          }
          itemStats[key].quantity += item.quantity || 0
          itemStats[key].volume += (item.sellPrice || 0) * (item.quantity || 0)
        })
      }
    })
    
    const sorted = Object.entries(itemStats)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 10)
    
    const labels = sorted.map(([name]) => name)
    const data = sorted.map(([, stats]) => stats.quantity)
    
    if (this.chartTopItems) {
      this.chartTopItems.destroy()
    }
    
    this.chartTopItems = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Quantité vendue',
          data: data,
          backgroundColor: 'rgba(249, 115, 22, 0.7)',
          borderColor: '#f97316',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            beginAtZero: true,
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderMarginDistribution() {
    const ctx = document.getElementById('chart-margin-distribution')
    if (!ctx) return
    
    const margins = this.history.map(t => t.margin || 0)
    const ranges = [
      { label: '< 0 €', min: -Infinity, max: 0 },
      { label: '0-1000 €', min: 0, max: 1000 },
      { label: '1000-5000 €', min: 1000, max: 5000 },
      { label: '5000-10000 €', min: 5000, max: 10000 },
      { label: '> 10000 €', min: 10000, max: Infinity }
    ]
    
    const data = ranges.map(range => {
      return margins.filter(m => m >= range.min && m < range.max).length
    })
    const labels = ranges.map(r => r.label)
    
    if (this.chartMarginDistribution) {
      this.chartMarginDistribution.destroy()
    }
    
    this.chartMarginDistribution = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: [
            '#ef4444',
            '#f97316',
            '#fbbf24',
            '#84cc16',
            '#22c55e'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#cccccc'
            }
          }
        }
      }
    })
  }

  renderCategoryDistribution() {
    const ctx = document.getElementById('chart-category-distribution')
    if (!ctx) return
    
    const categoryStats = {}
    this.history.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          const category = item.category || 'Autre'
          if (!categoryStats[category]) {
            categoryStats[category] = 0
          }
          categoryStats[category] += item.quantity || 0
        })
      }
    })
    
    const labels = Object.keys(categoryStats)
    const data = Object.values(categoryStats)
    
    if (this.chartCategoryDistribution) {
      this.chartCategoryDistribution.destroy()
    }
    
    this.chartCategoryDistribution = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: [
            '#f97316',
            '#fb923c',
            '#fdba74',
            '#fed7aa',
            '#ffedd5',
            '#fef3c7',
            '#fde68a',
            '#fcd34d'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#cccccc'
            }
          }
        }
      }
    })
  }

  renderPriceBalance() {
    const ctx = document.getElementById('chart-price-balance')
    if (!ctx) return
    
    const itemStats = this.getItemPriceStats()
    const top20 = itemStats.slice(0, 20)
    
    const labels = top20.map(item => item.name)
    const buyPrices = top20.map(item => item.buyPrice)
    const sellPrices = top20.map(item => item.sellPrice)
    
    if (this.chartPriceBalance) {
      this.chartPriceBalance.destroy()
    }
    
    this.chartPriceBalance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Prix Achat',
          data: buyPrices,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: '#ef4444',
          borderWidth: 1
        }, {
          label: 'Prix Revente',
          data: sellPrices,
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: '#22c55e',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            labels: {
              color: '#cccccc'
            }
          }
        },
        scales: {
          y: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            beginAtZero: true,
            ticks: {
              color: '#cccccc',
              callback: function(value) {
                return value.toLocaleString('fr-FR') + ' €'
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderMarginRatio() {
    const ctx = document.getElementById('chart-margin-ratio')
    if (!ctx) return
    
    const itemStats = this.getItemPriceStats()
    const top15 = itemStats.slice(0, 15)
    
    const labels = top15.map(item => item.name)
    const ratios = top15.map(item => {
      return item.buyPrice > 0 ? ((item.sellPrice - item.buyPrice) / item.buyPrice * 100) : 0
    })
    
    if (this.chartMarginRatio) {
      this.chartMarginRatio.destroy()
    }
    
    this.chartMarginRatio = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Marge %',
          data: ratios,
          backgroundColor: ratios.map(r => r < 0 ? 'rgba(239, 68, 68, 0.7)' : r < 10 ? 'rgba(251, 191, 36, 0.7)' : 'rgba(34, 197, 94, 0.7)'),
          borderColor: ratios.map(r => r < 0 ? '#ef4444' : r < 10 ? '#fbbf24' : '#22c55e'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#cccccc',
              callback: function(value) {
                return value.toFixed(1) + '%'
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderUserActivity() {
    const ctx = document.getElementById('chart-user-activity')
    if (!ctx) return
    
    const userStats = {}
    this.history.forEach(t => {
      if (!userStats[t.user]) {
        userStats[t.user] = 0
      }
      userStats[t.user]++
    })
    
    const sorted = Object.entries(userStats).sort((a, b) => b[1] - a[1])
    const labels = sorted.map(([user]) => user)
    const data = sorted.map(([, count]) => count)
    
    if (this.chartUserActivity) {
      this.chartUserActivity.destroy()
    }
    
    this.chartUserActivity = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Nombre de transactions',
          data: data,
          backgroundColor: 'rgba(249, 115, 22, 0.7)',
          borderColor: '#f97316',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  renderUserPerformance() {
    const ctx = document.getElementById('chart-user-performance')
    if (!ctx) return
    
    const userStats = {}
    this.history.forEach(t => {
      if (!userStats[t.user]) {
        userStats[t.user] = { margin: 0, transactions: 0 }
      }
      userStats[t.user].margin += t.margin || 0
      userStats[t.user].transactions++
    })
    
    const sorted = Object.entries(userStats)
      .sort((a, b) => b[1].margin - a[1].margin)
      .slice(0, 10)
    
    const labels = sorted.map(([user]) => user)
    const margins = sorted.map(([, stats]) => stats.margin)
    
    if (this.chartUserPerformance) {
      this.chartUserPerformance.destroy()
    }
    
    this.chartUserPerformance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Marge totale',
          data: margins,
          backgroundColor: margins.map(m => m < 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(34, 197, 94, 0.7)'),
          borderColor: margins.map(m => m < 0 ? '#ef4444' : '#22c55e'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            ticks: {
              color: '#cccccc'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#cccccc',
              callback: function(value) {
                return value.toLocaleString('fr-FR') + ' €'
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    })
  }

  getItemPriceStats() {
    const itemMap = {}
    const itemsData = this.getItemsData()
    
    Object.keys(itemsData).forEach(category => {
      itemsData[category].forEach(item => {
        const key = item.name
        if (!itemMap[key]) {
          itemMap[key] = {
            name: key,
            category: category,
            buyPrice: item.buyPrice || 0,
            sellPrice: item.sellPrice || 0,
            quantity: 0,
            volume: 0
          }
        }
      })
    })
    
    this.history.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          const key = item.name || item.item
          if (itemMap[key]) {
            itemMap[key].quantity += item.quantity || 0
            itemMap[key].volume += (item.sellPrice || 0) * (item.quantity || 0)
          }
        })
      }
    })
    
    return Object.values(itemMap)
      .filter(item => item.quantity > 0)
      .sort((a, b) => b.volume - a.volume)
  }

  async renderPriceAnalysis() {
    const tbody = document.getElementById('price-analysis-tbody')
    const header = document.getElementById('price-analysis-header')
    const modeIndicator = document.getElementById('price-stats-mode')
    if (!tbody) return
    
    // Si admin et API activée, afficher les statistiques globales
    if (this.currentUser?.role === 'admin' && this.useApi && this.currentUser.id) {
      try {
        // Modifier l'en-tête du tableau
        if (header) {
          header.innerHTML = `
            <th>Item</th>
            <th>Catégorie</th>
            <th>Statistiques des Prix</th>
            <th>Nb Utilisateurs</th>
            <th>Détails par Utilisateur</th>
          `
        }
        if (modeIndicator) {
          modeIndicator.textContent = '(Vue globale - Tous les utilisateurs)'
        }
        
        const stats = await apiService.getGlobalPriceStats(this.currentUser.id)
        
        if (stats && stats.length > 0) {
          tbody.innerHTML = stats.map(stat => {
            return `
              <tr>
                <td><strong>${this.escapeHtml(stat.item_name)}</strong></td>
                <td>${this.escapeHtml(stat.item_category)}</td>
                <td class="text-right">
                  <div style="display: flex; flex-direction: column; gap: 4px; text-align: right;">
                    <span><strong>Min:</strong> ${this.formatPrice(stat.min_price)}</span>
                    <span><strong>Max:</strong> ${this.formatPrice(stat.max_price)}</span>
                    <span><strong>Moy:</strong> ${this.formatPrice(stat.avg_price)}</span>
                    <span><strong>Méd:</strong> ${this.formatPrice(stat.median_price)}</span>
                  </div>
                </td>
                <td class="text-right">${stat.user_count} utilisateur(s)</td>
                <td>
                  <details>
                    <summary style="cursor: pointer; color: #f97316;">Voir les prix par utilisateur</summary>
                    <ul style="margin-top: 8px; padding-left: 20px; list-style: none;">
                      ${stat.users.map(u => `<li>${this.escapeHtml(u.username)}: ${this.formatPrice(u.price)}</li>`).join('')}
                    </ul>
                  </details>
                </td>
              </tr>
            `
          }).join('')
        } else {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center">Aucune donnée disponible</td></tr>'
        }
      } catch (error) {
        logger.error('Failed to load global price stats', error)
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Erreur lors du chargement des statistiques</td></tr>'
      }
    } else {
      // Mode normal : statistiques basées sur l'historique local
      // Restaurer l'en-tête original
      if (header) {
        header.innerHTML = `
          <th>Item</th>
          <th>Catégorie</th>
          <th>Prix Achat</th>
          <th>Prix Revente</th>
          <th>Marge</th>
          <th>Marge %</th>
          <th>Quantité Totale</th>
          <th>Volume Total</th>
        `
      }
      if (modeIndicator) {
        modeIndicator.textContent = ''
      }
    
    const itemStats = this.getItemPriceStats()
    
    tbody.innerHTML = itemStats.map(item => {
      const margin = item.sellPrice - item.buyPrice
      const marginPercent = item.buyPrice > 0 ? ((margin / item.buyPrice) * 100).toFixed(2) : 0
      
      return `
        <tr>
          <td><strong>${this.escapeHtml(item.name)}</strong></td>
          <td>${this.escapeHtml(item.category)}</td>
          <td class="text-right">${this.formatPrice(item.buyPrice)}</td>
          <td class="text-right">${this.formatPrice(item.sellPrice)}</td>
          <td class="text-right ${margin < 0 ? 'text-danger' : 'text-success'}">${this.formatPrice(margin)}</td>
          <td class="text-right ${marginPercent < 0 ? 'text-danger' : 'text-success'}">${marginPercent}%</td>
          <td class="text-right">${item.quantity}</td>
          <td class="text-right">${this.formatPrice(item.volume)}</td>
        </tr>
      `
    }).join('')
    }
  }

  getLast7Days() {
    const days = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      date.setHours(0, 0, 0, 0)
      days.push(date)
    }
    return days
  }

  async saveHistory() {
    try {
      // Si l'API est activée, ne PAS sauvegarder en localStorage
      // Les données doivent être uniquement en base de données
      if (this.useApi) {
        // Ne rien sauvegarder localement si l'API est activée
        return
      }
      
      // Sauvegarder en localStorage seulement si l'API n'est pas activée
      localStorage.setItem('backhub-history', JSON.stringify(this.history))

      // Si l'API n'est pas activée, sauvegarder aussi dans SQLite si disponible
      if (!this.useApi && window.electronAPI && window.electronAPI.dbExec) {
        for (const entry of this.history) {
          try {
            await window.electronAPI.dbExec(
              'INSERT OR REPLACE INTO history (id, date, user, items, totalBuy, totalSell, margin) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [
                entry.id,
                entry.date,
                entry.user,
                JSON.stringify(entry.items),
                entry.totalBuy,
                entry.totalSell,
                entry.margin
              ]
            )
          } catch (err) {
            logger.warn('Failed to save history entry to SQLite', err)
          }
        }
      }
    } catch (error) {
      logger.error('Failed to save history', error)
      // Tentative de fallback
      try {
      localStorage.setItem('backhub-history', JSON.stringify(this.history))
      } catch (e) {
        logger.error('Failed to save history to localStorage (fallback)', e)
      }
    }
  }

  async loadHistory() {
    try {
      // Si l'API est activée et qu'on a un utilisateur, charger depuis l'API
      if (this.useApi && this.currentUser && this.currentUser.id) {
        try {
          const transactions = await apiService.getUserHistory(this.currentUser.id, 1000)
          // Normaliser le format des transactions retournées par l'API
          return transactions.map(t => ({
            id: t.id || t.transaction_id || Date.now().toString(),
            date: t.date || t.created_at || new Date().toISOString(),
            user: t.user || t.username || this.currentUser.username,
            items: Array.isArray(t.items) ? t.items : 
                   (typeof t.items === 'string' ? JSON.parse(t.items) : []),
            totalBuy: t.total_buy || t.totalBuy || 0,
            totalSell: t.total_sell || t.totalSell || 0,
            margin: t.margin !== undefined ? t.margin : 
                    ((t.total_sell || t.totalSell || 0) - (t.total_buy || t.totalBuy || 0))
          }))
        } catch (apiError) {
          // Logger sans notification - on va utiliser le fallback
          logger.error('Failed to load history from API', apiError, {}, false)
          // Fallback sur localStorage
        }
      }

      // Fallback sur SQLite si disponible
      if (window.electronAPI && window.electronAPI.dbQuery) {
        try {
          const results = await window.electronAPI.dbQuery('SELECT * FROM history ORDER BY date DESC')
          if (results && results.length > 0) {
            return results.map(row => ({
              id: row.id,
              date: row.date,
              user: row.user,
              items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
              totalBuy: row.totalBuy,
              totalSell: row.totalSell,
              margin: row.margin
            }))
          }
        } catch (sqlError) {
          logger.warn('SQLite query failed, using localStorage', sqlError)
        }
      }

      // Fallback sur localStorage
      const data = localStorage.getItem('backhub-history')
      if (data) {
        const parsed = JSON.parse(data)
        // S'assurer que toutes les transactions ont le bon format
        return Array.isArray(parsed) ? parsed.map(t => ({
          id: t.id || Date.now().toString(),
          date: t.date || new Date().toISOString(),
          user: t.user || 'Utilisateur',
          items: Array.isArray(t.items) ? t.items : [],
          totalBuy: t.totalBuy || t.total_buy || 0,
          totalSell: t.totalSell || t.total_sell || 0,
          margin: t.margin !== undefined ? t.margin : ((t.totalSell || t.total_sell || 0) - (t.totalBuy || t.total_buy || 0))
        })) : []
      }
      return []
    } catch (error) {
      logger.error('Failed to load history', error)
      return []
    }
  }

  async saveUsers() {
    try {
      await storageService.save('backhub-users', this.users)

      localStorage.setItem('backhub-users', JSON.stringify(this.users))
    } catch (error) {
      logger.error('Failed to save users', error)
      notificationService.error('Erreur lors de la sauvegarde des utilisateurs')

      localStorage.setItem('backhub-users', JSON.stringify(this.users))
    }
  }

  async loadUsers() {
    try {
      const data = await storageService.load('backhub-users', null)
      if (data) return data

      const localData = localStorage.getItem('backhub-users')
      return localData ? JSON.parse(localData) : []
    } catch (error) {
      logger.error('Failed to load users', error)
      return []
    }
  }

  getItemsData() {
    // Utiliser le cache si disponible et si les overrides n'ont pas changé
    if (this.itemsCache && !this._priceOverridesChanged) {
      return this.itemsCache
    }

    // Créer une copie shallow pour éviter le deep clone coûteux
    const base = {}
    const overrides = this.priceOverrides || {}

    Object.keys(ITEMS_DATA || {}).forEach(category => {
      base[category] = ITEMS_DATA[category].map(item => {
        // Utiliser la même clé que lors de la sauvegarde
        const itemId = `${category}::${item.name}`
        const buyPriceKey = `${itemId}::buyPrice`
        const key = this.itemKey(category, item.name)
        
        // Chercher le prix personnalisé dans l'ordre : buyPriceKey (clé principale), key (ancienne clé), puis prix par défaut
        const customPrice = overrides[buyPriceKey] ?? overrides[key] ?? item.buyPrice
        
        // Retourner un nouvel objet seulement si nécessaire
        if (customPrice !== item.buyPrice) {
          return { ...item, buyPrice: customPrice }
        }
        return item
      })
    })
    
    this.itemsCache = base
    this._priceOverridesChanged = false
    return this.itemsCache
  }

  refreshItemsCache() {
    this.itemsCache = null
    this._priceOverridesChanged = true
  }

  itemKey(category, name) {
    return `${category}|${name}`
  }

  async loadPriceOverrides() {
    try {
      // Déterminer la clé de stockage
      let storageKey
      let tempKey = null
      
      if (this.currentUser && this.currentUser.id) {
        // Utiliser l'ID de l'utilisateur pour créer une clé unique
        storageKey = `backhub-price-overrides-${this.currentUser.id}`
      } else {
        // Si aucun utilisateur n'est connecté, essayer de charger depuis la session sauvegardée
        const savedSession = localStorage.getItem('savedSession')
        if (savedSession) {
          try {
            const sessionData = JSON.parse(savedSession)
            if (sessionData.userId) {
              storageKey = `backhub-price-overrides-${sessionData.userId}`
            } else if (sessionData.username) {
              storageKey = `backhub-price-overrides-temp-${sessionData.username}`
            }
          } catch (e) {
            // Ignorer l'erreur
          }
        }
        
        // Toujours vérifier la clé temporaire aussi
        tempKey = 'backhub-price-overrides-temp'
      }
      
      // Les prix d'achat sont stockés uniquement en localStorage (pas en BDD)
      // Car ils sont uniques à chaque joueur
      
      // Essayer d'abord avec la clé principale
      if (storageKey) {
        try {
          const data = await storageService.load(storageKey, null)
          if (data && Object.keys(data).length > 0) {
            logger.info('Loaded price overrides from storageService', { storageKey, count: Object.keys(data).length })
            return data
          }
        } catch (storageError) {
          logger.warn('Failed to load from storageService, trying localStorage', storageError)
        }
        
        // Fallback vers localStorage
        const localData = localStorage.getItem(storageKey)
        if (localData) {
          try {
            const parsed = JSON.parse(localData)
            if (parsed && Object.keys(parsed).length > 0) {
              logger.info('Loaded price overrides from localStorage', { storageKey, count: Object.keys(parsed).length })
              return parsed
            }
          } catch (parseError) {
            logger.warn('Failed to parse price overrides from localStorage', parseError)
          }
        }
      }
      
      // Si on n'a rien trouvé et qu'il y a une clé temporaire, essayer celle-ci
      if (tempKey && storageKey !== tempKey) {
        const tempData = localStorage.getItem(tempKey)
        if (tempData) {
          try {
            const parsed = JSON.parse(tempData)
            if (parsed && Object.keys(parsed).length > 0) {
              logger.info('Loaded price overrides from temp storage', { tempKey, count: Object.keys(parsed).length })
              // Migrer vers la clé principale si un utilisateur est connecté
              if (this.currentUser && this.currentUser.id) {
                const mainKey = `backhub-price-overrides-${this.currentUser.id}`
                localStorage.setItem(mainKey, tempData)
                localStorage.removeItem(tempKey)
                logger.info('Migrated price overrides from temp to main key', { from: tempKey, to: mainKey })
              }
              return parsed
            }
          } catch (parseError) {
            logger.warn('Failed to parse temp price overrides', parseError)
          }
        }
      }
      
      return {}
    } catch (error) {
      logger.error('Failed to load price overrides', error)
      return {}
    }
  }

  async savePriceOverrides() {
    try {
      // Déterminer la clé de stockage
      let storageKey
      if (this.currentUser && this.currentUser.id) {
        // Utiliser l'ID de l'utilisateur pour créer une clé unique
        storageKey = `backhub-price-overrides-${this.currentUser.id}`
      } else {
        // Si aucun utilisateur n'est connecté, utiliser une clé temporaire
        // qui sera migrée lors de la connexion
        const savedSession = localStorage.getItem('savedSession')
        if (savedSession) {
          try {
            const sessionData = JSON.parse(savedSession)
            if (sessionData.userId) {
              storageKey = `backhub-price-overrides-${sessionData.userId}`
            } else {
              // Fallback : utiliser le nom d'utilisateur si disponible
              storageKey = `backhub-price-overrides-temp-${sessionData.username || 'guest'}`
            }
          } catch (e) {
            // Si on ne peut pas parser la session, utiliser une clé temporaire
            storageKey = 'backhub-price-overrides-temp'
          }
        } else {
          // Dernier recours : clé temporaire
          storageKey = 'backhub-price-overrides-temp'
        }
      }
      
      // Sauvegarder dans localStorage
      localStorage.setItem(storageKey, JSON.stringify(this.priceOverrides))
      
      // Sauvegarder aussi via storageService si disponible (pour compatibilité)
      if (storageService) {
        try {
          await storageService.save(storageKey, this.priceOverrides)
        } catch (storageError) {
          logger.warn('Failed to save via storageService, using localStorage only', storageError)
        }
      }
      
      const userId = this.currentUser?.id || 'temp'
      logger.info('Saved price overrides', { userId, storageKey, count: Object.keys(this.priceOverrides).length })
    } catch (error) {
      logger.error('Failed to save price overrides', error)
      // Tentative de fallback
      try {
        const fallbackKey = this.currentUser?.id 
          ? `backhub-price-overrides-${this.currentUser.id}`
          : 'backhub-price-overrides-temp'
        localStorage.setItem(fallbackKey, JSON.stringify(this.priceOverrides))
        logger.info('Saved price overrides using fallback', { key: fallbackKey })
      } catch (e) {
        logger.error('Failed to save price overrides to localStorage (fallback)', e)
      }
    }
  }

  async updateBuyPrice(category, index, newPrice) {
    const items = this.getItemsData()[category]
    if (!items || !items[index]) return
    const name = items[index].name
    this.priceOverrides[this.itemKey(category, name)] = newPrice
    await this.savePriceOverrides()
    this.refreshItemsCache()
  }

  formatPrice(price) {
    return formatPrice(price)
  }

  formatDate(date) {
    return formatDate(date)
  }

  escapeHtml(text) {
    return escapeHtml(text)
  }

  /**
   * Afficher le modal de bienvenue pour les nouveaux utilisateurs
   */
  showWelcomeModal() {
    // Vérifier si le modal a déjà été affiché pour cet utilisateur
    if (!this.currentUser || !this.currentUser.id) {
      return
    }

    const welcomeKey = `backhub-welcome-shown-${this.currentUser.id}`
    const hasSeenWelcome = localStorage.getItem(welcomeKey)
    
    if (hasSeenWelcome) {
      return // L'utilisateur a déjà vu le message
    }

    // Créer le modal
    const modal = document.createElement('div')
    modal.className = 'modal active'
    modal.id = 'welcome-modal'
    modal.style.zIndex = '100001'
    
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 700px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
        <!-- Header avec gradient -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; color: white; position: relative; overflow: hidden;">
          <div style="position: absolute; top: -50px; right: -50px; width: 200px; height: 200px; background: rgba(255, 255, 255, 0.1); border-radius: 50%;"></div>
          <div style="position: absolute; bottom: -30px; left: -30px; width: 150px; height: 150px; background: rgba(255, 255, 255, 0.05); border-radius: 50%;"></div>
          <div style="position: relative; z-index: 1;">
            <h2 style="margin: 0 0 8px 0; color: white; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Bienvenue sur BackHub</h2>
            <p style="margin: 0; color: rgba(255, 255, 255, 0.9); font-size: 15px; font-weight: 400;">Votre outil de gestion pour RevolutionDayZ</p>
          </div>
          <button class="modal-close" id="welcome-modal-close" style="position: absolute; top: 20px; right: 20px; background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 36px; height: 36px; border-radius: 8px; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 2;">&times;</button>
        </div>

        <!-- Contenu principal -->
        <div style="padding: 40px; background: #1a1a1a; max-height: 70vh; overflow-y: auto;">
          <!-- Section Information importante -->
          <div style="margin-bottom: 32px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                ⚠️
              </div>
              <h3 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">Information importante</h3>
            </div>
            <div style="padding: 20px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; border-left: 4px solid #ef4444;">
              <p style="color: #e5e7eb; line-height: 1.8; margin: 0 0 12px 0; font-size: 15px;">
                L'application <strong style="color: #a78bfa; font-weight: 600;">BackHub</strong> est un projet <strong style="color: #f87171;">indépendant</strong> et n'est <strong style="color: #ef4444;">en aucun cas</strong> créée, développée, maintenue ou hébergée par les administrateurs du serveur <strong style="color: #fff;">RevolutionDayZ</strong>.
              </p>
              <p style="color: #e5e7eb; line-height: 1.8; margin: 0; font-size: 15px;">
                Cette application a été conçue et développée <strong style="color: #60a5fa; font-weight: 600;">bénévolement par Kaen</strong>, dans le but de fournir à la communauté un outil pratique et gratuit pour faciliter la gestion de leurs transactions et activités sur le serveur.
              </p>
            </div>
          </div>

          <!-- Section À propos -->
          <div style="margin-bottom: 32px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                ℹ️
              </div>
              <h3 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">À propos de BackHub</h3>
            </div>
            <div style="padding: 20px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 12px;">
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 12px 0; font-size: 15px;">
                BackHub est une application de gestion complète conçue spécialement pour les joueurs de RevolutionDayZ. Elle vous permet de suivre vos transactions, gérer vos prix d'achat personnalisés, calculer vos bénéfices, et bien plus encore.
              </p>
              <p style="color: #d1d5db; line-height: 1.8; margin: 0; font-size: 15px;">
                Toutes les fonctionnalités sont développées avec passion et mises à disposition <strong style="color: #60a5fa;">gratuitement</strong> pour l'ensemble de la communauté.
              </p>
            </div>
          </div>

          <!-- Section Support et Feedback -->
          <div style="margin-bottom: 32px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                🐛
              </div>
              <h3 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">Support et Signalement</h3>
            </div>
            <div style="padding: 20px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 12px; border-left: 4px solid #10b981;">
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 12px 0; font-size: 15px;">
                Votre retour est essentiel pour améliorer BackHub. Si vous rencontrez un bug, une erreur, ou si vous avez une suggestion d'amélioration, n'hésitez pas à nous le signaler.
              </p>
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 16px 0; font-size: 15px;">
                Vous pouvez nous contacter via la section <strong style="color: #10b981; font-weight: 600;">Feedback</strong> accessible depuis le menu de l'application, ou directement par email (voir section Contact ci-dessous).
              </p>
              <div style="padding: 12px; background: rgba(16, 185, 129, 0.15); border-radius: 8px; margin-top: 12px;">
                <p style="color: #6ee7b7; margin: 0; font-size: 14px; font-weight: 500;">
                  💡 Astuce : Plus vos signalements sont détaillés (étapes pour reproduire, captures d'écran, etc.), plus nous pourrons résoudre rapidement les problèmes.
                </p>
              </div>
            </div>
          </div>

          <!-- Section Rejoindre l'équipe -->
          <div style="margin-bottom: 32px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                🤝
              </div>
              <h3 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">Rejoindre l'équipe de développement</h3>
            </div>
            <div style="padding: 20px; background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.15); border-radius: 12px; border-left: 4px solid #8b5cf6;">
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 12px 0; font-size: 15px;">
                BackHub est un projet communautaire en constante évolution. Nous recherchons activement des personnes <strong style="color: #a78bfa; font-weight: 600;">motivées et passionnées</strong> pour nous aider à faire évoluer ce projet.
              </p>
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 16px 0; font-size: 15px;">
                Que vous soyez développeur, designer, testeur, ou simplement quelqu'un avec de bonnes idées, votre contribution est la bienvenue. Ensemble, nous pouvons rendre BackHub encore meilleur pour toute la communauté.
              </p>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px;">
                <div style="padding: 14px; background: rgba(139, 92, 246, 0.15); border-radius: 10px; border: 1px solid rgba(139, 92, 246, 0.2);">
                  <div style="color: #c4b5fd; font-size: 14px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span>💻</span>
                    <span>Développement</span>
                  </div>
                  <div style="color: #d1d5db; font-size: 13px; line-height: 1.6;">
                    <div style="margin-bottom: 4px;">• Frontend & Backend</div>
                    <div style="margin-bottom: 4px;">• Architecture & APIs</div>
                    <div>• Applications Desktop</div>
                  </div>
                </div>
                <div style="padding: 14px; background: rgba(139, 92, 246, 0.15); border-radius: 10px; border: 1px solid rgba(139, 92, 246, 0.2);">
                  <div style="color: #c4b5fd; font-size: 14px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span>🎨</span>
                    <span>Design</span>
                  </div>
                  <div style="color: #d1d5db; font-size: 13px; line-height: 1.6;">
                    <div style="margin-bottom: 4px;">• Interface utilisateur</div>
                    <div style="margin-bottom: 4px;">• Expérience utilisateur</div>
                    <div>• Identité visuelle</div>
                  </div>
                </div>
                <div style="padding: 14px; background: rgba(139, 92, 246, 0.15); border-radius: 10px; border: 1px solid rgba(139, 92, 246, 0.2);">
                  <div style="color: #c4b5fd; font-size: 14px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span>🧪</span>
                    <span>Tests</span>
                  </div>
                  <div style="color: #d1d5db; font-size: 13px; line-height: 1.6;">
                    <div style="margin-bottom: 4px;">• Assurance qualité</div>
                    <div style="margin-bottom: 4px;">• Tests utilisateurs</div>
                    <div>• Retours & Feedback</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Section Contact -->
          <div style="margin-bottom: 32px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                📧
              </div>
              <h3 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">Contact</h3>
            </div>
            <div style="padding: 20px; background: rgba(236, 72, 153, 0.08); border: 1px solid rgba(236, 72, 153, 0.15); border-radius: 12px; border-left: 4px solid #ec4899;">
              <p style="color: #d1d5db; line-height: 1.8; margin: 0 0 16px 0; font-size: 15px;">
                Pour toute question, suggestion, signalement de bug, ou pour rejoindre l'équipe de développement, n'hésitez pas à nous contacter :
              </p>
              <div style="padding: 16px; background: rgba(236, 72, 153, 0.15); border-radius: 10px; margin-top: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0;">
                    ✉️
                  </div>
                  <div style="flex: 1;">
                    <div style="color: #f9a8d4; font-size: 13px; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Email de contact</div>
                    <a href="mailto:kaen@backhub.online" style="color: #f472b6; font-size: 18px; font-weight: 600; text-decoration: none; display: inline-block; transition: all 0.2s; border-bottom: 2px solid transparent;" onmouseover="this.style.borderBottomColor='#f472b6'" onmouseout="this.style.borderBottomColor='transparent'">kaen@backhub.online</a>
                  </div>
                </div>
              </div>
              <p style="color: #d1d5db; line-height: 1.8; margin: 16px 0 0 0; font-size: 14px; font-style: italic;">
                Nous nous efforçons de répondre à tous les messages dans les plus brefs délais.
              </p>
            </div>
          </div>

          <!-- Footer avec remerciements -->
          <div style="padding: 20px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); border-radius: 12px; text-align: center; border: 1px solid rgba(102, 126, 234, 0.2);">
            <p style="color: #a78bfa; margin: 0; font-size: 15px; font-weight: 500; line-height: 1.6;">
              Merci d'utiliser BackHub ! Nous espérons que cette application vous sera utile dans votre aventure sur RevolutionDayZ.
            </p>
          </div>

          <!-- Bouton d'action -->
          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
            <button type="button" class="btn btn-primary" id="welcome-understand-btn" style="min-width: 180px; padding: 14px 28px; font-size: 15px; font-weight: 600; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 10px; color: white; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.3)'">
              J'ai compris, commencer
            </button>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(modal)
    
    const closeBtn = document.getElementById('welcome-modal-close')
    const understandBtn = document.getElementById('welcome-understand-btn')
    
    const closeModal = () => {
      // Marquer comme vu dans localStorage
      localStorage.setItem(welcomeKey, 'true')
      modal.remove()
      document.body.style.overflow = ''
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal)
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(255, 255, 255, 0.3)'
      })
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'
      })
    }
    
    if (understandBtn) {
      understandBtn.addEventListener('click', closeModal)
    }
    
    // Fermer avec Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape' && modal.parentElement) {
        closeModal()
        document.removeEventListener('keydown', handleEscape)
      }
    }
    document.addEventListener('keydown', handleEscape)
    
    // Empêcher la fermeture en cliquant à l'extérieur
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        e.stopPropagation()
      }
    })
    
    // Bloquer le scroll
    document.body.style.overflow = 'hidden'
  }

  /**
   * Ouvrir un modal pour demander le nom du vendeur
   * @returns {Promise<string|null>} - Le nom du vendeur, '' si passé, ou null si annulé
   */
  openSellerNameModal() {
    return new Promise((resolve) => {
      // Créer le modal
      const modal = document.createElement('div')
      modal.className = 'modal active'
      modal.id = 'seller-name-modal'
      modal.style.zIndex = '100000'
      
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
          <div class="modal-header">
            <h2>Nom du vendeur</h2>
            <button class="modal-close" id="seller-name-modal-close">&times;</button>
          </div>
          <div style="padding: 20px;">
            <div class="form-group">
              <label for="seller-name-input">Nom de la personne à qui vous avez acheté</label>
              <input type="text" id="seller-name-input" placeholder="Entrez le nom du vendeur" style="width: 100%; padding: 10px; font-size: 16px; background: #2d2d2d; border: 1px solid #444; border-radius: 6px; color: #fff;" autofocus>
            </div>
            <div class="form-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="seller-name-cancel">Annuler</button>
              <button type="button" class="btn btn-secondary" id="seller-name-skip" style="background: #4b5563; border-color: #4b5563;">Passer</button>
              <button type="button" class="btn btn-primary" id="seller-name-save">Enregistrer</button>
            </div>
          </div>
        </div>
      `
      
      document.body.appendChild(modal)
      
      const input = document.getElementById('seller-name-input')
      const saveBtn = document.getElementById('seller-name-save')
      const skipBtn = document.getElementById('seller-name-skip')
      const cancelBtn = document.getElementById('seller-name-cancel')
      const closeBtn = document.getElementById('seller-name-modal-close')
      
      // S'assurer que l'input est focusable et peut recevoir du texte
      if (input) {
        input.setAttribute('readonly', false)
        input.removeAttribute('readonly')
        input.disabled = false
      }
      
      const cleanup = () => {
        modal.remove()
      }
      
      const save = () => {
        const sellerName = input ? input.value.trim() : ''
        cleanup()
        resolve(sellerName || '')
      }
      
      const skip = () => {
        cleanup()
        resolve('') // Retourne une chaîne vide pour "Passer"
      }
      
      const cancel = () => {
        cleanup()
        resolve(null) // Retourne null pour "Annuler"
      }
      
      if (saveBtn) saveBtn.addEventListener('click', save)
      if (skipBtn) skipBtn.addEventListener('click', skip)
      if (cancelBtn) cancelBtn.addEventListener('click', cancel)
      if (closeBtn) closeBtn.addEventListener('click', cancel)
      
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        })
        
        // Focus sur l'input après un court délai
        setTimeout(() => {
          if (input) {
            input.focus()
            input.select()
          }
        }, 150)
      }
      
      // Empêcher la fermeture du modal en cliquant à l'extérieur
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          e.stopPropagation()
        }
      })
    })
  }

  /**
   * Ouvrir un modal pour éditer le prix d'un item
   * @param {string} itemName - Nom de l'item
   * @param {number} currentPrice - Prix actuel
   * @returns {Promise<number|null>} - Le nouveau prix ou null si annulé
   */
  openEditPriceModal(itemName, currentPrice) {
    return new Promise((resolve) => {
      // Créer le modal
      const modal = document.createElement('div')
      modal.className = 'modal active'
      modal.id = 'edit-price-modal'
      modal.style.zIndex = '100000'
      
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
          <div class="modal-header">
            <h2>Modifier le prix d'achat</h2>
            <button class="modal-close" id="edit-price-modal-close">&times;</button>
          </div>
          <div style="padding: 20px;">
            <div class="form-group">
              <label for="edit-price-item-name">Item</label>
              <input type="text" id="edit-price-item-name" value="${this.escapeHtml(itemName)}" readonly style="background: #2d2d2d; cursor: not-allowed;">
            </div>
            <div class="form-group">
              <label for="edit-price-input">Prix d'achat (€)</label>
              <input type="number" id="edit-price-input" value="${currentPrice}" min="0" step="0.01" style="width: 100%; padding: 10px; font-size: 16px;">
            </div>
            <div class="form-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="edit-price-cancel">Annuler</button>
              <button type="button" class="btn btn-primary" id="edit-price-save">Enregistrer</button>
            </div>
          </div>
        </div>
      `
      
      document.body.appendChild(modal)
      document.body.style.overflow = 'hidden'
      
      const input = modal.querySelector('#edit-price-input')
      const saveBtn = modal.querySelector('#edit-price-save')
      const cancelBtn = modal.querySelector('#edit-price-cancel')
      const closeBtn = modal.querySelector('#edit-price-modal-close')
      
      // Focus sur l'input
      setTimeout(() => {
        input.focus()
        input.select()
      }, 100)
      
      // Fonction pour fermer le modal
      const closeModal = (result) => {
        document.body.removeChild(modal)
        document.body.style.overflow = ''
        resolve(result)
      }
      
      // Event listeners
      saveBtn.addEventListener('click', () => {
        const price = Math.max(0, parseFloat(input.value) || 0)
        closeModal(price)
      })
      
      cancelBtn.addEventListener('click', () => {
        closeModal(null)
      })
      
      closeBtn.addEventListener('click', () => {
        closeModal(null)
      })
      
      // Fermer en cliquant sur le fond
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(null)
        }
      })
      
      // Entrée pour sauvegarder, Échap pour annuler
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          saveBtn.click()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelBtn.click()
        }
      })
    })
  }

  showNotification(message, type = 'info') {
    notificationService.show(message, type)
  }

  /**
   * Rendre la vue clan
   */
  async renderClanView() {
    const clanView = document.getElementById('clan-view')
    if (!clanView) return

    // Vérifier que le token est disponible pour les appels API
    if (this.useApi && !apiService.authToken) {
      const savedToken = apiService.getSavedToken()
      if (savedToken) {
        apiService.authToken = savedToken
      } else {
        logger.warn('No auth token available for clan view')
        return
      }
    }

    // Mettre à jour le nom d'utilisateur
    const currentUserEl = document.getElementById('clan-current-user')
    if (currentUserEl && this.currentUser) {
      currentUserEl.textContent = this.currentUser.username || 'Utilisateur'
    } else if (currentUserEl) {
      currentUserEl.textContent = 'Non connecté'
    }

    // Charger les données du clan si on utilise l'API
    if (this.useApi && this.currentUser && this.currentUser.id) {
      await this.loadClanData()
    }

    // Charger et afficher la liste des clans
    await this.renderClansList()

    // Mettre à jour l'état du bouton de création (cooldown)
    this.updateCreateClanButton()

    // Afficher la bonne section selon si l'utilisateur a un clan ou non
    const noClanSection = document.getElementById('no-clan-section')
    const hasClanSection = document.getElementById('has-clan-section')

    if (this.currentClan) {
      // Afficher la section avec le clan
      if (noClanSection) noClanSection.style.display = 'none'
      if (hasClanSection) hasClanSection.style.display = 'block'

      // Afficher les informations du clan
      const clanNameDisplay = document.getElementById('clan-name-display')
      const invitationKeyDisplay = document.getElementById('clan-invitation-key-display')
      
      if (clanNameDisplay) {
        clanNameDisplay.textContent = this.currentClan.name
      }
      
      if (invitationKeyDisplay) {
        // Formater la clé d'invitation (ajouter des tirets pour la lisibilité)
        const key = this.currentClan.invitation_key || ''
        const formattedKey = key.match(/.{1,8}/g)?.join('-') || key
        invitationKeyDisplay.textContent = formattedKey
      }

      // Rendre les membres et l'historique
      this.renderClanMembers()
      await this.renderClanHistory()
    } else {
      // Afficher la section pour créer/rejoindre un clan
      if (noClanSection) noClanSection.style.display = 'block'
      if (hasClanSection) hasClanSection.style.display = 'none'
    }

    // Initialiser le bouton refresh
    this.initClansRefresh()
  }

  /**
   * Rendre la liste des clans disponibles
   */
  async renderClansList() {
    const container = document.getElementById('clans-list-container')
    if (!container) return

    // Vérifier que le token est disponible pour les appels API
    if (this.useApi && !apiService.authToken) {
      const savedToken = apiService.getSavedToken()
      if (savedToken) {
        apiService.authToken = savedToken
      } else {
        container.innerHTML = `
          <div class="empty-state-modern">
            <div class="empty-state-icon-large">🔒</div>
            <h3>Non authentifié</h3>
            <p>Veuillez vous reconnecter pour voir les clans.</p>
          </div>
        `
        return
      }
    }

    // Afficher l'état de chargement
    container.innerHTML = `
      <div class="clan-loading-state">
        <div class="loading-spinner"></div>
        <p>Chargement des clans...</p>
      </div>
    `

    try {
      const clans = await apiService.getAllClans()

      if (!clans || clans.length === 0) {
        container.innerHTML = `
          <div class="empty-state-modern">
            <div class="empty-state-icon-large">🏰</div>
            <div class="empty-state-title">Aucun clan disponible</div>
            <div class="empty-state-text">Soyez le premier à créer un clan !</div>
          </div>
        `
        return
      }

      // Récupérer le nombre de membres pour chaque clan
      const clansWithMembers = await Promise.all(
        clans.map(async (clan) => {
          try {
            const members = await apiService.getClanMembers(clan.id)
            return {
              ...clan,
              memberCount: members.length
            }
          } catch (error) {
            return {
              ...clan,
              memberCount: 0
            }
          }
        })
      )

      // Générer les cartes de clans
      container.innerHTML = ''
      const fragment = document.createDocumentFragment()

      clansWithMembers.forEach((clan, index) => {
        const isMyClan = this.currentClan && this.currentClan.id === clan.id
        const card = document.createElement('div')
        card.className = 'clan-card-item'
        card.style.animationDelay = `${index * 0.05}s`
        
        card.innerHTML = `
          <div class="clan-card-header">
            <h3 class="clan-card-name">${this.escapeHtml(clan.name)}</h3>
            ${isMyClan ? '<span class="clan-card-badge">Mon Clan</span>' : ''}
          </div>
          <div class="clan-card-info">
            <div class="clan-card-stat">
              <span class="clan-card-stat-icon">👥</span>
              <span>${clan.memberCount} membre${clan.memberCount > 1 ? 's' : ''}</span>
            </div>
            ${clan.created_at ? `
              <div class="clan-card-stat">
                <span class="clan-card-stat-icon">📅</span>
                <span>Créé le ${new Date(clan.created_at).toLocaleDateString('fr-FR')}</span>
              </div>
            ` : ''}
          </div>
        `

        fragment.appendChild(card)
      })

      container.appendChild(fragment)

      // Animer les cartes
      requestAnimationFrame(() => {
        const cards = container.querySelectorAll('.clan-card-item')
        cards.forEach((card, index) => {
          card.style.animationDelay = `${index * 0.05}s`
        })
      })

    } catch (error) {
      logger.error('Failed to render clans list', error)
      container.innerHTML = `
        <div class="empty-state-modern">
          <div class="empty-state-icon-large">⚠️</div>
          <div class="empty-state-title">Erreur de chargement</div>
          <div class="empty-state-text">Impossible de charger la liste des clans</div>
        </div>
      `
    }
  }

  /**
   * Initialiser le bouton refresh des clans
   */
  initClansRefresh() {
    const refreshBtn = document.getElementById('refresh-clans-btn')
    if (refreshBtn && !refreshBtn.dataset.listenerAttached) {
      refreshBtn.dataset.listenerAttached = 'true'
      refreshBtn.addEventListener('click', async () => {
        await this.renderClansList()
        notificationService.success('Liste des clans actualisée')
      })
    }
  }

  /**
   * Rendre la liste des membres du clan
   */
  renderClanMembers() {
    const membersList = document.getElementById('clan-members-list')
    if (!membersList) return

    if (!this.currentClan || this.clanMembers.length === 0) {
      membersList.innerHTML = `
        <div class="empty-state-modern">
          <div class="empty-state-icon-large">👥</div>
          <div class="empty-state-title">Aucun membre</div>
          <div class="empty-state-text">Les membres du clan apparaîtront ici</div>
        </div>
      `
      return
    }

    // Mettre à jour le filtre des membres
    const memberFilter = document.getElementById('clan-member-filter')
    if (memberFilter) {
      const currentValue = memberFilter.value
      memberFilter.innerHTML = '<option value="">Tous les membres</option>'
      this.clanMembers.forEach(member => {
        const option = document.createElement('option')
        option.value = member.id || member.user_id
        option.textContent = member.username
        if (currentValue === String(member.id || member.user_id)) {
          option.selected = true
        }
        memberFilter.appendChild(option)
      })
    }

    // Comparer les IDs en convertissant en string pour éviter les problèmes de type
    const currentUserId = String(this.currentUser?.id || '')
    const clanOwnerId = String(this.currentClan?.owner_id || '')
    const isOwner = this.currentClan && clanOwnerId === currentUserId

    membersList.innerHTML = this.clanMembers.map(member => {
      const memberId = String(member.id || member.user_id || '')
      const isMemberOwner = member.is_owner || memberId === clanOwnerId
      const canRemove = isOwner && !isMemberOwner && memberId !== currentUserId
      const joinedDate = new Date(member.joined_at || member.addedDate)
      const dateStr = joinedDate.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })

      return `
        <div class="clan-member-item" style="animation-delay: ${index * 0.05}s">
          <div class="clan-member-info">
            <div class="clan-member-avatar">${this.escapeHtml(member.username).charAt(0).toUpperCase()}</div>
            <div class="clan-member-details">
              <div class="clan-member-name">${this.escapeHtml(member.username)}</div>
              <div class="clan-member-role ${isMemberOwner ? 'owner' : ''}">${isMemberOwner ? '👑 Propriétaire' : 'Membre'} • Rejoint le ${dateStr}</div>
            </div>
          </div>
          ${canRemove ? `
            <div class="clan-member-actions">
              <button class="clan-member-action-btn remove-member-btn" data-member-id="${memberId}" title="Retirer ce membre">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    // Event listeners pour retirer les membres
    membersList.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const memberId = btn.getAttribute('data-member-id')
        this.removeClanMember(memberId)
      })
    })
  }

  /**
   * Retirer un membre du clan
   */
  async removeClanMember(memberId) {
    // Convertir en string pour la comparaison
    const memberIdStr = String(memberId)
    const member = this.clanMembers.find(m => String(m.id || m.user_id) === memberIdStr)
    if (!member) return

    if (confirm(`Voulez-vous vraiment retirer ${member.username} du clan ?`)) {
      if (this.useApi && this.currentClan && this.currentUser && this.currentUser.id) {
        try {
          const result = await apiService.removeClanMember(this.currentClan.id, memberIdStr)
          if (result.success) {
            await this.loadClanData()
            this.renderClanView()
            notificationService.success('Membre retiré du clan')
          } else {
            notificationService.error(result.error || 'Erreur lors du retrait du membre')
          }
        } catch (error) {
          logger.error('Failed to remove clan member', error)
          notificationService.error('Erreur lors du retrait du membre')
        }
      } else {
        // Mode local
        this.clanMembers = this.clanMembers.filter(m => String(m.id || m.user_id) !== memberIdStr)
        this.saveClanMembers()
        this.renderClanView()
      }
    }
  }

  /**
   * Rendre l'historique du clan
   */
  async renderClanHistory() {
    const historyList = document.getElementById('clan-history-list')
    const memberFilter = document.getElementById('clan-member-filter')
    const dateFilter = document.getElementById('clan-date-filter')

    if (!historyList) return

    // Mettre à jour le filtre des membres
    if (memberFilter) {
      const currentValue = memberFilter.value
      memberFilter.innerHTML = '<option value="">Tous les membres</option>'
      this.clanMembers.forEach(member => {
        const option = document.createElement('option')
        option.value = member.id
        option.textContent = member.username
        if (member.id === currentValue) option.selected = true
        memberFilter.appendChild(option)
      })
    }

    // Récupérer toutes les transactions des membres du clan
    let allTransactions = []

    if (this.clanMembers.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state-modern">
          <div class="empty-state-icon-large">📜</div>
          <div class="empty-state-title">Aucune transaction</div>
          <div class="empty-state-text">L'historique des transactions du clan apparaîtra ici</div>
        </div>
      `
      return
    }

    // Charger l'historique de chaque membre
    if (this.useApi) {
      try {
        for (const member of this.clanMembers) {
          const memberId = member.id || member.user_id
          if (!memberId) continue
          
          try {
            const memberHistory = await apiService.getUserHistory(memberId, 1000)
            if (!Array.isArray(memberHistory)) continue
            
            memberHistory.forEach(transaction => {
              // Normaliser les valeurs de la transaction
              allTransactions.push({
                ...transaction,
                memberUsername: member.username,
                memberId: memberId,
                totalBuy: transaction.totalBuy || transaction.total_buy || 0,
                totalSell: transaction.totalSell || transaction.total_sell || 0,
                margin: transaction.margin !== undefined ? transaction.margin : 
                        ((transaction.totalSell || transaction.total_sell || 0) - (transaction.totalBuy || transaction.total_buy || 0))
              })
            })
          } catch (memberHistoryError) {
            // Logger sans notification - erreur silencieuse pour un membre
            logger.warn('Failed to load history for clan member', memberHistoryError, { memberId }, false)
          }
        }
      } catch (error) {
        // Logger sans notification - erreur générale lors du chargement de l'historique du clan
        logger.error('Failed to load clan history', error, {}, false)
      }
    } else {
      // Mode local - utiliser l'historique local
      this.history.forEach(transaction => {
        const member = this.clanMembers.find(m => m.username === transaction.user)
        if (member) {
          allTransactions.push({
            ...transaction,
            memberUsername: member.username,
            memberId: member.id
          })
        }
      })
    }

    // Filtrer par membre
    const selectedMemberId = memberFilter?.value
    if (selectedMemberId) {
      allTransactions = allTransactions.filter(t => t.memberId === selectedMemberId)
    }

    // Filtrer par date
    const dateFilterValue = dateFilter?.value
    if (dateFilterValue && dateFilterValue !== 'all') {
      const now = new Date()
      const filterDate = new Date()
      
      if (dateFilterValue === 'today') {
        filterDate.setHours(0, 0, 0, 0)
        allTransactions = allTransactions.filter(t => new Date(t.date) >= filterDate)
      } else if (dateFilterValue === 'week') {
        filterDate.setDate(now.getDate() - 7)
        allTransactions = allTransactions.filter(t => new Date(t.date) >= filterDate)
      } else if (dateFilterValue === 'month') {
        filterDate.setMonth(now.getMonth() - 1)
        allTransactions = allTransactions.filter(t => new Date(t.date) >= filterDate)
      }
    }

    // Trier par date (plus récent en premier)
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date))

    if (allTransactions.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state-modern">
          <div class="empty-state-icon-large">📜</div>
          <div class="empty-state-title">Aucune transaction trouvée</div>
          <div class="empty-state-text">Aucune transaction ne correspond aux filtres sélectionnés</div>
        </div>
      `
      return
    }

    // Utiliser DocumentFragment pour une insertion DOM plus rapide
    const fragment = document.createDocumentFragment()
    const rows = allTransactions.map((transaction, index) => {
      const date = new Date(transaction.date)
      const marginClass = transaction.margin >= 0 ? 'profit-positive' : 'profit-negative'
      
      let itemsList = []
      if (transaction.items && transaction.items.length > 0) {
        if (typeof transaction.items[0] === 'string') {
          itemsList = transaction.items.map(name => ({ name, quantity: 1 }))
        } else {
          itemsList = transaction.items
        }
      }

      const itemsCount = itemsList.length
      const totalItems = itemsList.reduce((sum, item) => sum + (item.quantity || 0), 0)

      // Normaliser les valeurs pour éviter NaN
      const totalBuy = parseFloat(transaction.totalBuy || transaction.total_buy || 0) || 0
      const totalSell = parseFloat(transaction.totalSell || transaction.total_sell || 0) || 0
      const margin = parseFloat(transaction.margin !== undefined ? transaction.margin : (totalSell - totalBuy)) || 0
      
      // S'assurer que les valeurs sont des nombres valides
      const safeTotalBuy = isNaN(totalBuy) ? 0 : totalBuy
      const safeTotalSell = isNaN(totalSell) ? 0 : totalSell
      const safeMargin = isNaN(margin) ? 0 : margin

      const transactionId = transaction.id || transaction.transaction_id
      const canDelete = this.currentUser && (
        this.currentUser.role === 'admin' || 
        (transaction.user === this.currentUser.username || transaction.memberUsername === this.currentUser.username)
      )

      return `
        <div class="transaction-card" data-transaction-id="${transactionId}" style="animation-delay: ${index * 0.05}s">
          <div class="transaction-card-header">
            <div class="transaction-header-left">
              <div class="transaction-date-badge">
                <svg class="date-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span class="date-text">${this.formatDate(date)}</span>
              </div>
              <div class="transaction-user-badge">
                <svg class="user-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>${this.escapeHtml(transaction.memberUsername || transaction.user || 'Inconnu')}</span>
              </div>
            </div>
            ${canDelete ? `
              <button class="transaction-delete-btn" data-transaction-id="${transactionId}" title="Supprimer cette transaction">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            ` : ''}
          </div>

          <div class="transaction-items-section">
            <div class="transaction-items-header">
              <span class="items-count-badge">${itemsCount} item${itemsCount > 1 ? 's' : ''} • ${totalItems} unité${totalItems > 1 ? 's' : ''}</span>
            </div>
            <div class="transaction-items-grid">
              ${itemsList.slice(0, 6).map(item => {
                const qty = item.quantity || 1
                return `
                  <div class="transaction-item-tag">
                    <span class="item-name">${this.escapeHtml(item.name)}</span>
                    ${qty > 1 ? `<span class="item-quantity">x${qty}</span>` : ''}
                  </div>
                `
              }).join('')}
              ${itemsCount > 6 ? `<div class="transaction-item-tag more-items">+${itemsCount - 6} autre${itemsCount - 6 > 1 ? 's' : ''}</div>` : ''}
            </div>
          </div>

          <div class="transaction-financials">
            <div class="financial-row">
              <div class="financial-item">
                <span class="financial-label">Achat</span>
                <span class="financial-value buy-value">${this.formatPrice(safeTotalBuy)}</span>
              </div>
              <div class="financial-item">
                <span class="financial-label">Revente</span>
                <span class="financial-value sell-value">${this.formatPrice(safeTotalSell)}</span>
              </div>
              <div class="financial-item profit-item ${marginClass}">
                <span class="financial-label">Bénéfice Net</span>
                <span class="financial-value profit-amount">
                  ${(safeMargin >= 0 ? '+' : '') + this.formatPrice(safeMargin)}
                </span>
              </div>
            </div>
          </div>
        </div>
      `
    })

    // Créer les éléments DOM une seule fois avec DocumentFragment
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = rows.join('')
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild)
    }
    historyList.innerHTML = ''
    historyList.appendChild(fragment)

    // Animer les cartes
    requestAnimationFrame(() => {
      const cards = historyList.querySelectorAll('.transaction-card')
      cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.05}s`
      })
    })

    // Ajouter les event listeners pour les boutons de suppression
    historyList.querySelectorAll('.transaction-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const transactionId = btn.getAttribute('data-transaction-id')
        if (transactionId) {
          await this.deleteClanTransaction(transactionId)
        }
      })
    })
  }

  /**
   * Sauvegarder les membres du clan
   */
  saveClanMembers() {
    try {
      localStorage.setItem('clan-members', JSON.stringify(this.clanMembers))
    } catch (error) {
      logger.error('Failed to save clan members', error)
    }
  }

  /**
   * Gérer la demande de quitter le clan
   */
  async handleLeaveClan() {
    if (!this.currentClan || !this.currentUser) {
      notificationService.error('Vous devez être connecté et membre d\'un clan')
      return
    }

    const isOwner = this.currentClan.owner_id === this.currentUser.id
    const otherMembers = this.clanMembers.filter(m => 
      (m.id || m.user_id) !== this.currentUser.id
    )

    if (isOwner) {
      // Si c'est le propriétaire
      if (otherMembers.length > 0) {
        // Il y a d'autres membres, demander de choisir un successeur
        const memberOptions = otherMembers.map(m => 
          `<option value="${m.id || m.user_id}">${escapeHtml(m.username)}</option>`
        ).join('')

        const modalHtml = `
          <div class="modal" id="transfer-ownership-modal" style="display: flex;">
            <div class="modal-content">
              <div class="modal-header">
                <h2>Transférer la propriété du clan</h2>
                <button class="modal-close" onclick="document.getElementById('transfer-ownership-modal').style.display='none'">&times;</button>
              </div>
              <div style="padding: 20px;">
                <p>Vous êtes le propriétaire du clan. Choisissez un successeur ou supprimez le clan.</p>
                <div class="form-group" style="margin-top: 20px;">
                  <label for="successor-select">Choisir un successeur:</label>
                  <select id="successor-select" class="form-select">
                    ${memberOptions}
                  </select>
                </div>
                <div class="form-actions" style="margin-top: 20px; display: flex; gap: 10px;">
                  <button class="btn btn-primary" id="transfer-ownership-btn">Transférer la propriété</button>
                  <button class="btn btn-danger-outline" id="delete-clan-btn">Supprimer le clan</button>
                  <button class="btn btn-secondary" onclick="document.getElementById('transfer-ownership-modal').style.display='none'">Annuler</button>
                </div>
              </div>
            </div>
          </div>
        `

        // Créer le modal
        const existingModal = document.getElementById('transfer-ownership-modal')
        if (existingModal) {
          existingModal.remove()
        }

        const modalDiv = document.createElement('div')
        modalDiv.innerHTML = modalHtml
        document.body.appendChild(modalDiv.firstElementChild)

        const transferBtn = document.getElementById('transfer-ownership-btn')
        const deleteClanBtn = document.getElementById('delete-clan-btn')

        if (transferBtn) {
          transferBtn.addEventListener('click', async () => {
            const successorId = document.getElementById('successor-select').value
            if (successorId) {
              await this.transferClanOwnership(successorId)
              const transferModal = document.getElementById('transfer-ownership-modal')
              if (transferModal) {
                transferModal.style.display = 'none'
                transferModal.remove()
              }
            }
          })
        }

        if (deleteClanBtn) {
          deleteClanBtn.addEventListener('click', async () => {
            if (confirm('⚠️ Êtes-vous sûr de vouloir supprimer définitivement ce clan ? Cette action est irréversible et tous les membres seront retirés.')) {
              if (confirm('⚠️ DERNIÈRE CONFIRMATION : Voulez-vous vraiment supprimer ce clan ?')) {
                const transferModal = document.getElementById('transfer-ownership-modal')
                if (transferModal) {
                  transferModal.style.display = 'none'
                  transferModal.remove()
                }
                await this.deleteClan()
              }
            }
          })
        }
      } else {
        // Pas d'autres membres, proposer de supprimer le clan
        if (confirm('Vous êtes le seul membre du clan. Voulez-vous supprimer le clan ?')) {
          if (confirm('⚠️ DERNIÈRE CONFIRMATION : Voulez-vous vraiment supprimer ce clan ?')) {
            await this.deleteClan()
          }
        }
      }
    } else {
      // Membre normal, juste quitter
      if (confirm(`Voulez-vous vraiment quitter le clan "${this.currentClan.name}" ?`)) {
        await this.leaveClan()
      }
    }
  }

  /**
   * Transférer la propriété du clan
   */
  async transferClanOwnership(successorId) {
    if (!this.currentClan || !this.currentUser || !this.useApi) return

    try {
      const result = await apiService.transferClanOwnership(this.currentClan.id, successorId)
      if (result.success) {
        notificationService.success('Propriété du clan transférée avec succès')
        await this.loadClanData()
        await this.renderClanView()
      } else {
        notificationService.error(result.error || 'Erreur lors du transfert de propriété')
      }
    } catch (error) {
      logger.error('Failed to transfer ownership', error)
      notificationService.error('Erreur lors du transfert de propriété')
    }
  }

  /**
   * Supprimer le clan
   */
  async deleteClan() {
    if (!this.currentClan || !this.currentUser || !this.useApi) return

    try {
      const result = await apiService.deleteClan(this.currentClan.id)
      if (result.success) {
        // Enregistrer le timestamp de suppression pour le cooldown de 30 secondes
        const deleteTimestamp = Date.now()
        localStorage.setItem('clan-delete-cooldown', deleteTimestamp.toString())
        
        notificationService.success('Clan supprimé avec succès. Vous devez attendre 30 secondes avant de créer un nouveau clan.')
        this.currentClan = null
        this.clanMembers = []
        
        // Supprimer complètement le modal de transfert du DOM
        const transferModal = document.getElementById('transfer-ownership-modal')
        if (transferModal) {
          transferModal.style.display = 'none'
          transferModal.remove()
        }
        
        // Fermer et réinitialiser le modal de création de clan
        const createClanModal = document.getElementById('create-clan-modal')
        const createClanForm = document.getElementById('create-clan-form')
        
        if (createClanModal) {
          createClanModal.style.display = 'none'
        }
        
        // Réinitialiser complètement le formulaire
        if (createClanForm) {
          createClanForm.reset()
        }
        
        // Forcer la réinitialisation du champ de saisie
        const clanNameInput = document.getElementById('clan-name')
        if (clanNameInput) {
          clanNameInput.value = ''
          clanNameInput.removeAttribute('disabled')
          clanNameInput.removeAttribute('readonly')
          clanNameInput.style.pointerEvents = 'auto'
          clanNameInput.style.opacity = '1'
          clanNameInput.blur()
        }
        
        // Démarrer la mise à jour du bouton de création
        this.updateCreateClanButton()
        
        await this.renderClanView()
      } else {
        notificationService.error(result.error || 'Erreur lors de la suppression du clan')
      }
    } catch (error) {
      logger.error('Failed to delete clan', error)
      notificationService.error('Erreur lors de la suppression du clan')
    }
  }

  /**
   * Vérifier si le cooldown de suppression de clan est actif
   */
  getClanDeleteCooldownRemaining() {
    const cooldownTimestamp = localStorage.getItem('clan-delete-cooldown')
    if (!cooldownTimestamp) return 0
    
    const deleteTime = parseInt(cooldownTimestamp, 10)
    const cooldownDuration = 30000 // 30 secondes en millisecondes
    const elapsed = Date.now() - deleteTime
    const remaining = cooldownDuration - elapsed
    
    if (remaining <= 0) {
      localStorage.removeItem('clan-delete-cooldown')
      return 0
    }
    
    return Math.ceil(remaining / 1000) // Retourner en secondes
  }

  /**
   * Mettre à jour l'état du bouton de création de clan
   */
  updateCreateClanButton() {
    const createClanBtn = document.getElementById('create-clan-btn')
    if (!createClanBtn) return
    
    const remainingSeconds = this.getClanDeleteCooldownRemaining()
    
    if (remainingSeconds > 0) {
      // Cooldown actif : désactiver le bouton et afficher le temps restant
      createClanBtn.disabled = true
      createClanBtn.innerHTML = `<span>⏳ Attendre ${remainingSeconds}s</span>`
      createClanBtn.style.opacity = '0.6'
      createClanBtn.style.cursor = 'not-allowed'
      
      // Programmer la prochaine mise à jour
      if (this.cooldownInterval) {
        clearTimeout(this.cooldownInterval)
      }
      this.cooldownInterval = setTimeout(() => {
        this.updateCreateClanButton()
      }, 1000)
    } else {
      // Cooldown terminé : réactiver le bouton
      createClanBtn.disabled = false
      createClanBtn.innerHTML = `<span>➕ Créer un clan</span>`
      createClanBtn.style.opacity = '1'
      createClanBtn.style.cursor = 'pointer'
      
      // Nettoyer l'intervalle si le cooldown est terminé
      if (this.cooldownInterval) {
        clearTimeout(this.cooldownInterval)
        this.cooldownInterval = null
      }
    }
  }

  /**
   * Démarrer la vérification continue du cooldown
   */
  startCooldownCheck() {
    // Vérifier immédiatement
    this.updateCreateClanButton()
    
    // Vérifier toutes les secondes si un cooldown est actif
    const checkInterval = setInterval(() => {
      const remainingSeconds = this.getClanDeleteCooldownRemaining()
      if (remainingSeconds > 0) {
        // Cooldown actif, mettre à jour le bouton
        this.updateCreateClanButton()
      } else {
        // Plus de cooldown, arrêter la vérification
        clearInterval(checkInterval)
        this.updateCreateClanButton()
      }
    }, 1000)
    
    // Stocker l'intervalle pour pouvoir le nettoyer si nécessaire
    this.cooldownCheckInterval = checkInterval
  }

  /**
   * Quitter le clan (pour les membres non-propriétaires)
   */
  async leaveClan() {
    if (!this.currentClan || !this.currentUser || !this.useApi) return

    try {
      const result = await apiService.leaveClan(this.currentClan.id)
      if (result.success) {
        notificationService.success('Vous avez quitté le clan')
        this.currentClan = null
        this.clanMembers = []
        await this.renderClanView()
      } else {
        notificationService.error(result.error || 'Erreur lors de la sortie du clan')
      }
    } catch (error) {
      logger.error('Failed to leave clan', error)
      notificationService.error('Erreur lors de la sortie du clan')
    }
  }

  /**
   * Supprimer une transaction de l'historique du clan
   */
  async deleteClanTransaction(transactionId) {
    if (!transactionId) return

    // Trouver la transaction dans l'historique
    const transaction = this.history.find(entry => 
      String(entry.id) === String(transactionId) || 
      String(entry.transaction_id) === String(transactionId)
    )
    
    if (!transaction) {
      notificationService.warning('Transaction introuvable')
      return
    }

    const currentUsername = this.currentUser ? this.currentUser.username : ''
    const isAdmin = this.currentUser && this.currentUser.role === 'admin'
    const isOwner = transaction.user === currentUsername || transaction.memberUsername === currentUsername

    if (!isAdmin && !isOwner) {
      notificationService.error('Vous ne pouvez pas supprimer cette transaction')
      return
    }

    const userName = isAdmin ? (transaction.memberUsername || transaction.user) : 'votre'
    if (confirm(`Êtes-vous sûr de vouloir supprimer ${isAdmin ? `la transaction de ${userName}` : 'cette transaction'} ?`)) {
      try {
        // Supprimer via l'API si activée
        if (this.useApi && this.currentUser && this.currentUser.id) {
          try {
            const result = await apiService.deleteTransaction(transactionId)
            if (!result || !result.success) {
              const errorMessage = result?.error || result?.message || 'Erreur lors de la suppression de la transaction'
              notificationService.error(errorMessage)
              return
            }
          } catch (apiError) {
            // Logger sans notification automatique
            logger.error('Failed to delete transaction from API', apiError, { transactionId }, false)
            // Extraire le message d'erreur de la réponse API si disponible
            const errorMessage = apiError.data?.error || apiError.data?.message || apiError.message || 'Erreur lors de la suppression de la transaction sur le serveur'
            notificationService.error(errorMessage)
            return
          }
        }

        // Supprimer de l'historique local
        this.history = this.history.filter(entry => 
          String(entry.id) !== String(transactionId) && 
          String(entry.transaction_id) !== String(transactionId) &&
          String(entry.id) !== String(transaction.id)
        )

        // Sauvegarder l'historique local (backup)
        await this.saveHistory()

        // Recharger l'historique depuis l'API pour s'assurer que tout est à jour
        if (this.useApi && this.currentUser && this.currentUser.id) {
          await this.loadUserDataFromApi(this.currentUser.id)
        }

        // Recharger l'historique du clan
        await this.renderClanHistory()
        notificationService.success('Transaction supprimée définitivement')
      } catch (error) {
        logger.error('Failed to delete transaction', error)
        notificationService.error('Erreur lors de la suppression de la transaction')
      }
    }
  }

  /**
   * Initialiser les paramètres
   */
  initSettings() {
    // Charger les préférences sauvegardées
    this.loadSettings()

    // Initialiser la navigation par onglets
    this.initSettingsTabs()

    // Attacher les listeners pour le changement de mot de passe
    this.attachChangePasswordListeners()

    // Gérer la fermeture du modal
    const changePasswordModal = document.getElementById('change-password-modal')
    const changePasswordModalClose = document.getElementById('change-password-modal-close')
    const cancelChangePasswordBtn = document.getElementById('cancel-change-password-btn')

    if (changePasswordModalClose) {
      changePasswordModalClose.addEventListener('click', () => {
        this.closeChangePasswordModal()
      })
    }

    // Fermer le modal en cliquant sur l'overlay (le modal lui-même)
    if (changePasswordModal) {
      changePasswordModal.addEventListener('click', (e) => {
        // Fermer seulement si on clique directement sur le modal (pas sur le contenu)
        if (e.target === changePasswordModal) {
          this.closeChangePasswordModal()
        }
      })
      
      // Empêcher la propagation du clic sur le contenu du modal
      const modalContent = changePasswordModal.querySelector('.modal-content')
      if (modalContent) {
        modalContent.addEventListener('click', (e) => {
          e.stopPropagation()
        })
      }
    }

    if (cancelChangePasswordBtn) {
      cancelChangePasswordBtn.addEventListener('click', () => {
        this.closeChangePasswordModal()
      })
    }

    // Gérer le formulaire de changement de mot de passe
    const changePasswordForm = document.getElementById('change-password-form')
    if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        await this.handleChangePassword()
      })
    }

    // Gérer les toggles
    const rememberSessionToggle = document.getElementById('settings-remember-session')
    if (rememberSessionToggle) {
      rememberSessionToggle.addEventListener('change', (e) => {
        this.saveSetting('rememberSession', e.target.checked)
      })
    }

    const defaultViewSelect = document.getElementById('settings-default-view')
    if (defaultViewSelect) {
      defaultViewSelect.addEventListener('change', (e) => {
        this.saveSetting('defaultView', e.target.value)
      })
    }

    // Gérer les toggles de notifications
    ['success', 'error', 'warning'].forEach(type => {
      const toggle = document.getElementById(`settings-notif-${type}`)
      if (toggle) {
        toggle.addEventListener('change', (e) => {
          this.saveSetting(`notifications.${type}`, e.target.checked)
        })
      }
    })

    // Initialiser le système de feedback
    this.initFeedback()

    // Gérer le bouton de suppression de compte
    const deleteAccountBtn = document.getElementById('delete-account-btn')
    if (deleteAccountBtn) {
      deleteAccountBtn.addEventListener('click', () => {
        this.openDeleteAccountModal()
      })
    }

    // Gérer la fermeture du modal de suppression
    const deleteAccountModal = document.getElementById('delete-account-modal')
    const deleteAccountModalClose = document.getElementById('delete-account-modal-close')
    const deleteAccountModalOverlay = document.getElementById('delete-account-modal-overlay')
    const cancelDeleteAccountBtn = document.getElementById('cancel-delete-account-btn')

    if (deleteAccountModalClose) {
      deleteAccountModalClose.addEventListener('click', () => {
        this.closeDeleteAccountModal()
      })
    }

    if (deleteAccountModalOverlay) {
      deleteAccountModalOverlay.addEventListener('click', () => {
        this.closeDeleteAccountModal()
      })
    }

    if (cancelDeleteAccountBtn) {
      cancelDeleteAccountBtn.addEventListener('click', () => {
        this.closeDeleteAccountModal()
      })
    }

    // Gérer le formulaire de suppression de compte
    const deleteAccountForm = document.getElementById('delete-account-form')
    if (deleteAccountForm) {
      deleteAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        await this.handleDeleteAccountRequest()
      })
    }

    // Gérer l'annulation de la suppression
    const cancelDeletionModalClose = document.getElementById('cancel-deletion-modal-close')
    const cancelDeletionModalOverlay = document.getElementById('cancel-deletion-modal-overlay')
    const cancelDeletionNoBtn = document.getElementById('cancel-deletion-no-btn')
    const cancelDeletionYesBtn = document.getElementById('cancel-deletion-yes-btn')

    if (cancelDeletionModalClose) {
      cancelDeletionModalClose.addEventListener('click', () => {
        this.closeCancelDeletionModal()
      })
    }

    if (cancelDeletionModalOverlay) {
      cancelDeletionModalOverlay.addEventListener('click', () => {
        this.closeCancelDeletionModal()
      })
    }

    if (cancelDeletionNoBtn) {
      cancelDeletionNoBtn.addEventListener('click', () => {
        this.closeCancelDeletionModal()
      })
    }

    if (cancelDeletionYesBtn) {
      cancelDeletionYesBtn.addEventListener('click', async () => {
        await this.handleCancelDeletion()
      })
    }
  }

  /**
   * Rendre la vue de la carte interactive de Chernarus
   */
  renderMapView() {
    const mapView = document.getElementById('map-view')
    if (!mapView) return

    // Attendre que la vue soit visible avant d'initialiser la carte
    requestAnimationFrame(() => {
      setTimeout(() => {
        // Vérifier si la carte n'est pas déjà initialisée
        if (!mapService.map) {
          mapService.initMap()
        } else {
          // Forcer le redimensionnement si la carte existe déjà
          mapService.invalidateSize()
          // Réajuster la vue pour voir toute la carte
          setTimeout(() => {
            if (mapService.map && mapService.imageBounds) {
              mapService.map.fitBounds(mapService.imageBounds, {
                padding: [50, 50]
              })
              // Forcer un zoom encore plus éloigné si nécessaire
              if (mapService.map.getZoom() > -3) {
                mapService.map.setZoom(-4)
              }
            }
          }, 200)
        }
      }, 150)
    })
  }

  async renderSettings() {
    if (!this.currentUser) return

    // Mettre à jour les informations du compte
    const usernameInput = document.getElementById('settings-username')
    if (usernameInput) {
      usernameInput.value = this.currentUser.username
    }

    const roleBadge = document.getElementById('settings-role-badge')
    if (roleBadge) {
      if (this.currentUser.role === 'admin') {
        roleBadge.textContent = 'Administrateur'
        roleBadge.className = 'settings-badge-modern settings-badge-admin'
      } else if (this.currentUser.role === 'developpeur') {
        roleBadge.textContent = 'Développeur'
        roleBadge.className = 'settings-badge-modern settings-badge-developpeur'
      } else {
        roleBadge.textContent = 'Utilisateur'
        roleBadge.className = 'settings-badge-modern settings-badge-user'
      }
    }

    // Charger les préférences
    this.loadSettings()

    // Initialiser la navigation par onglets
    this.initSettingsTabs()

    // Réattacher les listeners pour le changement de mot de passe
    this.attachChangePasswordListeners()

    // Vérifier le statut de suppression
    await this.checkDeletionStatus()
  }

  /**
   * Initialiser la navigation par onglets dans les paramètres
   */
  initSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-nav-tab')
    const tabContents = document.querySelectorAll('.settings-tab-content')

    tabs.forEach(tab => {
      // Supprimer les anciens listeners pour éviter les doublons
      const newTab = tab.cloneNode(true)
      tab.parentNode.replaceChild(newTab, tab)
      
      newTab.addEventListener('click', () => {
        const targetTab = newTab.dataset.tab

        // Retirer la classe active de tous les onglets et contenus
        document.querySelectorAll('.settings-nav-tab').forEach(t => t.classList.remove('active'))
        tabContents.forEach(content => content.classList.remove('active'))

        // Ajouter la classe active à l'onglet cliqué et son contenu
        newTab.classList.add('active')
        const targetContent = document.getElementById(`settings-tab-${targetTab}`)
        if (targetContent) {
          targetContent.classList.add('active')
        }
      })
    })
  }

  /**
   * Charger les paramètres sauvegardés
   */
  loadSettings() {
    // Charger "Garder la session active"
    const rememberSession = localStorage.getItem('savedSession') !== null
    const rememberSessionToggle = document.getElementById('settings-remember-session')
    if (rememberSessionToggle) {
      rememberSessionToggle.checked = rememberSession
    }

    // Charger la vue par défaut
    const defaultView = localStorage.getItem('defaultView') || 'dashboard'
    const defaultViewSelect = document.getElementById('settings-default-view')
    if (defaultViewSelect) {
      defaultViewSelect.value = defaultView
    }

    // Charger les préférences de notifications
    const notifications = JSON.parse(localStorage.getItem('notifications') || '{"success":true,"error":true,"warning":true}')
    Object.keys(notifications).forEach(type => {
      const toggle = document.getElementById(`settings-notif-${type}`)
      if (toggle) {
        toggle.checked = notifications[type]
      }
    })

    // Charger l'état de la notification de vote
    // Initialiser les toggles de notification de vote (il peut y en avoir plusieurs : paramètres et page de vote)
    const voteNotificationEnabled = this.isVoteNotificationEnabled()
    const voteNotificationToggles = document.querySelectorAll('#vote-notification-toggle')
    
    voteNotificationToggles.forEach(toggle => {
      toggle.checked = voteNotificationEnabled
      
      // Supprimer les anciens listeners pour éviter les doublons
      const newToggle = toggle.cloneNode(true)
      toggle.parentNode.replaceChild(newToggle, toggle)
      
      newToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked
        localStorage.setItem('vote-notification-enabled', isEnabled ? 'true' : 'false')
        
        // Synchroniser tous les autres toggles
        document.querySelectorAll('#vote-notification-toggle').forEach(otherToggle => {
          if (otherToggle !== newToggle) {
            otherToggle.checked = isEnabled
          }
        })
        
        // Afficher/masquer les options de son UNIQUEMENT sur la page vote (pas dans les paramètres)
        const optionsContainer = document.querySelector('#vote-view #vote-notification-options')
        if (optionsContainer) {
          optionsContainer.style.display = isEnabled ? 'block' : 'none'
        }
        
        if (isEnabled && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              notificationService.success('Notifications activées', 'Vous recevrez une alerte quand vous pourrez revoter')
            }
          })
        }
      })
    })
  }

  /**
   * Sauvegarder un paramètre
   */
  saveSetting(key, value) {
    if (key.includes('.')) {
      const [parent, child] = key.split('.')
      const parentObj = JSON.parse(localStorage.getItem(parent) || '{}')
      parentObj[child] = value
      localStorage.setItem(parent, JSON.stringify(parentObj))
    } else {
      localStorage.setItem(key, value)
    }
  }

  /**
   * Attacher les listeners pour le changement de mot de passe
   */
  attachChangePasswordListeners() {
    // Utiliser la délégation d'événements pour être sûr que ça fonctionne
    // même si le bouton est ajouté dynamiquement
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'change-password-btn') {
        e.preventDefault()
        e.stopPropagation()
        this.openChangePasswordModal()
      }
    })
    
    // Aussi attacher directement au bouton s'il existe
    const changePasswordBtn = document.getElementById('change-password-btn')
    
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.openChangePasswordModal()
      })
    }
  }

  /**
   * Ouvrir le modal de changement de mot de passe
   */
  openChangePasswordModal() {
    let modal = document.getElementById('change-password-modal')
    
    if (!modal) {
      logger.error('Modal change-password-modal not found')
      return
    }
    
    // Déplacer le modal directement dans le body pour éviter les problèmes de z-index/overflow
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal)
    }
    
    // Utiliser à la fois la classe et style.display pour forcer l'affichage
    modal.classList.add('active')
    modal.style.display = 'flex'
    modal.style.visibility = 'visible'
    modal.style.opacity = '1'
    modal.style.zIndex = '100000'
    modal.style.position = 'fixed'
    modal.style.top = '0'
    modal.style.left = '0'
    modal.style.right = '0'
    modal.style.bottom = '0'
    modal.style.width = '100%'
    modal.style.height = '100%'
    modal.style.margin = '0'
    modal.style.padding = '0'
    
    // S'assurer que le modal-content a aussi un z-index élevé
    const modalContent = modal.querySelector('.modal-content')
    if (modalContent) {
      modalContent.style.zIndex = '100001'
      modalContent.style.position = 'relative'
    }
    
    document.body.style.overflow = 'hidden' // Empêcher le scroll de la page
    
    const form = document.getElementById('change-password-form')
    if (form) {
      form.reset()
      // Réinitialiser les messages d'erreur visuels
      this.clearPasswordValidationMessages()
      // Ajouter les listeners de validation en temps réel
      this.initPasswordValidation()
    }
  }

  /**
   * Fermer le modal de changement de mot de passe
   */
  closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal')
    if (modal) {
      modal.classList.remove('active')
      modal.style.display = 'none'
      modal.style.visibility = 'hidden'
      document.body.style.overflow = '' // Réactiver le scroll
      const form = document.getElementById('change-password-form')
      if (form) {
        form.reset()
        // Réinitialiser les messages d'erreur visuels
        this.clearPasswordValidationMessages()
      }
    }
  }

  /**
   * Initialiser la validation en temps réel du mot de passe
   */
  initPasswordValidation() {
    const newPasswordInput = document.getElementById('new-password')
    const confirmPasswordInput = document.getElementById('confirm-new-password')

    if (!newPasswordInput || !confirmPasswordInput) return

    // Vérifier si les listeners sont déjà attachés pour éviter les doublons
    if (newPasswordInput.dataset.validationAttached === 'true') {
      return
    }

    // Marquer comme attachés
    newPasswordInput.dataset.validationAttached = 'true'
    confirmPasswordInput.dataset.validationAttached = 'true'

    // Validation de la confirmation en temps réel
    const validatePasswordMatch = () => {
      const newPassword = newPasswordInput.value
      const confirmPassword = confirmPasswordInput.value
      
      if (confirmPassword.length > 0) {
        if (newPassword !== confirmPassword) {
          confirmPasswordInput.setCustomValidity('Les mots de passe ne correspondent pas')
          confirmPasswordInput.classList.add('input-error')
        } else {
          confirmPasswordInput.setCustomValidity('')
          confirmPasswordInput.classList.remove('input-error')
        }
      } else {
        confirmPasswordInput.setCustomValidity('')
        confirmPasswordInput.classList.remove('input-error')
      }
    }

    // Validation de la longueur du nouveau mot de passe
    const validatePasswordLength = () => {
      const newPassword = newPasswordInput.value
      if (newPassword.length > 0 && newPassword.length < 6) {
        newPasswordInput.setCustomValidity('Le mot de passe doit contenir au moins 6 caractères')
        newPasswordInput.classList.add('input-error')
      } else {
        newPasswordInput.setCustomValidity('')
        newPasswordInput.classList.remove('input-error')
      }
      // Re-valider la correspondance si la confirmation est déjà remplie
      if (confirmPasswordInput.value.length > 0) {
        validatePasswordMatch()
      }
    }

    newPasswordInput.addEventListener('input', validatePasswordLength)
    newPasswordInput.addEventListener('blur', validatePasswordLength)
    confirmPasswordInput.addEventListener('input', validatePasswordMatch)
    confirmPasswordInput.addEventListener('blur', validatePasswordMatch)
  }

  /**
   * Réinitialiser les messages de validation visuels
   */
  clearPasswordValidationMessages() {
    const inputs = ['current-password', 'new-password', 'confirm-new-password']
    inputs.forEach(inputId => {
      const input = document.getElementById(inputId)
      if (input) {
        input.setCustomValidity('')
        input.classList.remove('input-error')
        // Réinitialiser le flag pour permettre la réattache des listeners
        if (inputId === 'new-password' || inputId === 'confirm-new-password') {
          input.dataset.validationAttached = 'false'
        }
      }
    })
  }

  /**
   * Gérer le changement de mot de passe
   */
  async handleChangePassword() {
    const currentPasswordInput = document.getElementById('current-password')
    const newPasswordInput = document.getElementById('new-password')
    const confirmPasswordInput = document.getElementById('confirm-new-password')

    const currentPassword = currentPasswordInput?.value.trim()
    const newPassword = newPasswordInput?.value.trim()
    const confirmPassword = confirmPasswordInput?.value.trim()

    // Validation de l'ancien mot de passe
    if (!currentPassword || currentPassword.length === 0) {
      notificationService.error('Veuillez entrer votre mot de passe actuel')
      if (currentPasswordInput) {
        currentPasswordInput.focus()
        currentPasswordInput.classList.add('input-error')
      }
      return
    }

    // Validation du nouveau mot de passe
    if (!newPassword || newPassword.length === 0) {
      notificationService.error('Veuillez entrer un nouveau mot de passe')
      if (newPasswordInput) {
        newPasswordInput.focus()
        newPasswordInput.classList.add('input-error')
      }
      return
    }

    if (newPassword.length < 6) {
      notificationService.error('Le mot de passe doit contenir au moins 6 caractères')
      if (newPasswordInput) {
        newPasswordInput.focus()
        newPasswordInput.classList.add('input-error')
      }
      return
    }

    // Validation de la confirmation
    if (!confirmPassword || confirmPassword.length === 0) {
      notificationService.error('Veuillez confirmer votre nouveau mot de passe')
      if (confirmPasswordInput) {
        confirmPasswordInput.focus()
        confirmPasswordInput.classList.add('input-error')
      }
      return
    }

    if (newPassword !== confirmPassword) {
      notificationService.error('Les mots de passe ne correspondent pas')
      if (confirmPasswordInput) {
        confirmPasswordInput.focus()
        confirmPasswordInput.classList.add('input-error')
      }
      return
    }

    // Vérifier que le nouveau mot de passe est différent de l'ancien
    if (currentPassword === newPassword) {
      notificationService.error('Le nouveau mot de passe doit être différent de l\'ancien')
      if (newPasswordInput) {
        newPasswordInput.focus()
        newPasswordInput.classList.add('input-error')
      }
      return
    }

    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible de changer le mot de passe en mode hors ligne')
      return
    }

    // Désactiver le bouton de soumission pendant le traitement
    const submitButton = document.querySelector('#change-password-form button[type="submit"]')
    const originalButtonText = submitButton?.textContent
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = 'Changement en cours...'
    }

    try {
      // Changer le mot de passe via l'API
      const changeResult = await apiService.changeOwnPassword(this.currentUser.id, currentPassword, newPassword)
      if (changeResult && changeResult.success) {
        notificationService.success('Mot de passe changé avec succès')
        this.closeChangePasswordModal()
      } else {
        // Afficher le message d'erreur spécifique (ex: mot de passe actuel incorrect)
        const errorMessage = changeResult?.message || changeResult?.error || 'Erreur lors du changement de mot de passe'
        notificationService.error(errorMessage)
        
        // Si c'est une erreur d'authentification, mettre en évidence le champ ancien mot de passe
        if (errorMessage.toLowerCase().includes('mot de passe actuel') || 
            errorMessage.toLowerCase().includes('incorrect') ||
            errorMessage.toLowerCase().includes('invalid')) {
          if (currentPasswordInput) {
            currentPasswordInput.focus()
            currentPasswordInput.classList.add('input-error')
          }
        }
      }
    } catch (error) {
      // Ne pas logger comme erreur pour éviter les notifications automatiques du logger
      // Extraire le message d'erreur de la réponse API si disponible
      let errorMessage = 'Erreur lors du changement de mot de passe'
      
      // Si l'erreur contient les données de la réponse API (ajouté dans api-service.js)
      if (error.data) {
        errorMessage = error.data.message || error.data.error || error.message || errorMessage
      } else if (error.message) {
        errorMessage = error.message
      }
      
      // Afficher une seule notification avec le message approprié
      notificationService.error(errorMessage)
      
      // Mettre en évidence le champ approprié selon l'erreur
      const errorLower = errorMessage.toLowerCase()
      if (errorLower.includes('mot de passe actuel') || 
          errorLower.includes('incorrect') ||
          errorLower.includes('invalid') ||
          errorLower.includes('actuel incorrect')) {
        if (currentPasswordInput) {
          currentPasswordInput.focus()
          currentPasswordInput.classList.add('input-error')
        }
      }
    } finally {
      // Réactiver le bouton de soumission
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = originalButtonText || 'Changer le mot de passe'
      }
    }
  }

  /**
   * Initialiser la page de feedback (désactivé - maintenant en modal)
   */
  initFeedbackPage() {
    // Cette fonction n'est plus utilisée car le feedback est maintenant un modal
    return
    // Gérer le formulaire de feedback de la page
    const feedbackPageForm = document.getElementById('feedback-page-form')
    if (feedbackPageForm) {
      feedbackPageForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        await this.handleSubmitFeedback('page')
      })
    }

    // Compteur de caractères pour le titre (page)
    const titleInputPage = document.getElementById('feedback-page-title')
    const titleCountPage = document.getElementById('feedback-page-title-count')
    if (titleInputPage && titleCountPage) {
      titleInputPage.addEventListener('input', () => {
        titleCountPage.textContent = titleInputPage.value.length
      })
    }

    // Compteur de caractères pour la description (page)
    const descriptionInputPage = document.getElementById('feedback-page-description')
    const descriptionCountPage = document.getElementById('feedback-page-description-count')
    if (descriptionInputPage && descriptionCountPage) {
      descriptionInputPage.addEventListener('input', () => {
        descriptionCountPage.textContent = descriptionInputPage.value.length
      })
    }

    // Gérer l'upload de fichier avec drag & drop (page)
    const attachmentInputPage = document.getElementById('feedback-page-attachment')
    const attachmentZonePage = document.getElementById('feedback-page-attachment-zone')
    const attachmentPreviewPage = document.getElementById('feedback-page-attachment-preview')
    const attachmentPreviewImgPage = document.getElementById('feedback-page-attachment-preview-img')
    const attachmentRemoveBtnPage = document.getElementById('feedback-page-attachment-remove-btn')

    const handleFileSelectionPage = (file) => {
      if (!file) return

      // Vérifier la taille (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        notificationService.error('Le fichier est trop volumineux (max 10MB)')
        if (attachmentInputPage) attachmentInputPage.value = ''
        return
      }

      // Vérifier le type
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        notificationService.error('Type de fichier non autorisé. Utilisez une image ou une vidéo.')
        if (attachmentInputPage) attachmentInputPage.value = ''
        return
      }

      // Afficher la prévisualisation
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          if (attachmentPreviewImgPage) {
            attachmentPreviewImgPage.src = e.target.result
          }
          if (attachmentPreviewPage) {
            attachmentPreviewPage.style.display = 'block'
          }
          if (attachmentZonePage) {
            attachmentZonePage.style.display = 'none'
          }
        }
        reader.readAsDataURL(file)
      } else {
        // Pour les vidéos, on affiche juste le nom
        if (attachmentPreviewPage) {
          attachmentPreviewPage.style.display = 'block'
          if (attachmentPreviewImgPage) {
            attachmentPreviewImgPage.src = ''
            attachmentPreviewImgPage.alt = file.name
          }
        }
        if (attachmentZonePage) {
          attachmentZonePage.style.display = 'none'
        }
      }
    }

    if (attachmentInputPage) {
      attachmentInputPage.addEventListener('change', (e) => {
        const file = e.target.files[0]
        handleFileSelectionPage(file)
      })
    }

    // Drag & Drop (page)
    if (attachmentZonePage) {
      attachmentZonePage.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        attachmentZonePage.classList.add('dragover')
      })

      attachmentZonePage.addEventListener('dragleave', (e) => {
        e.preventDefault()
        e.stopPropagation()
        attachmentZonePage.classList.remove('dragover')
      })

      attachmentZonePage.addEventListener('drop', (e) => {
        e.preventDefault()
        attachmentZonePage.classList.remove('dragover')
        const file = e.dataTransfer.files[0]
        if (file && attachmentInputPage) {
          attachmentInputPage.files = e.dataTransfer.files
          handleFileSelectionPage(file)
        }
      })
    }

    if (attachmentRemoveBtnPage) {
      attachmentRemoveBtnPage.addEventListener('click', () => {
        if (attachmentInputPage) attachmentInputPage.value = ''
        if (attachmentPreviewPage) attachmentPreviewPage.style.display = 'none'
        if (attachmentPreviewImgPage) attachmentPreviewImgPage.src = ''
        if (attachmentZonePage) attachmentZonePage.style.display = 'block'
      })
    }
  }

  /**
   * Initialiser le système de feedback
   */
  initFeedback() {
    // Bouton pour ouvrir le modal de feedback dans la sidebar
    const feedbackNavBtn = document.getElementById('feedback-nav-btn')
    if (feedbackNavBtn) {
      feedbackNavBtn.addEventListener('click', () => {
        this.openFeedbackModal()
      })
    }

    // Bouton pour ouvrir le modal de feedback (ancien, dans les paramètres - pour compatibilité)
    const feedbackBtn = document.getElementById('feedback-btn')
    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', () => {
        this.openFeedbackModal()
      })
    }

    // Bouton pour voir mes feedbacks
    const myFeedbacksBtn = document.getElementById('my-feedbacks-btn')
    if (myFeedbacksBtn) {
      myFeedbacksBtn.addEventListener('click', () => {
        this.openMyFeedbacksModal()
      })
    }

    // Gérer la fermeture du modal feedback
    const feedbackModal = document.getElementById('feedback-modal')
    const feedbackModalClose = document.getElementById('feedback-modal-close')
    const cancelFeedbackBtn = document.getElementById('cancel-feedback-btn')

    if (feedbackModalClose) {
      feedbackModalClose.addEventListener('click', () => {
        this.closeFeedbackModal()
      })
    }

    if (cancelFeedbackBtn) {
      cancelFeedbackBtn.addEventListener('click', () => {
        this.closeFeedbackModal()
      })
    }

    if (feedbackModal) {
      feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal || e.target.classList.contains('modal-overlay')) {
          this.closeFeedbackModal()
        }
      })
      
      const modalContent = feedbackModal.querySelector('.feedback-modal-content-v2')
      if (modalContent) {
        modalContent.addEventListener('click', (e) => {
          e.stopPropagation()
        })
      }
    }

    // Gérer la fermeture du modal mes feedbacks
    const myFeedbacksModal = document.getElementById('my-feedbacks-modal')
    const myFeedbacksModalClose = document.getElementById('my-feedbacks-modal-close')

    if (myFeedbacksModalClose) {
      myFeedbacksModalClose.addEventListener('click', () => {
        this.closeMyFeedbacksModal()
      })
    }

    if (myFeedbacksModal) {
      myFeedbacksModal.addEventListener('click', (e) => {
        if (e.target === myFeedbacksModal) {
          this.closeMyFeedbacksModal()
        }
      })
      
      const modalContent = myFeedbacksModal.querySelector('.modal-content')
      if (modalContent) {
        modalContent.addEventListener('click', (e) => {
          e.stopPropagation()
        })
      }
    }

    // Gérer le formulaire de feedback
    const feedbackForm = document.getElementById('feedback-form')
    if (feedbackForm) {
      feedbackForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        await this.handleSubmitFeedback()
      })
    }

    // Compteur de caractères pour le titre
    const titleInput = document.getElementById('feedback-title')
    const titleCount = document.getElementById('feedback-title-count')
    if (titleInput && titleCount) {
      titleInput.addEventListener('input', () => {
        titleCount.textContent = titleInput.value.length
      })
    }

    // Compteur de caractères pour la description
    const descriptionInput = document.getElementById('feedback-description')
    const descriptionCount = document.getElementById('feedback-description-count')
    if (descriptionInput && descriptionCount) {
      descriptionInput.addEventListener('input', () => {
        descriptionCount.textContent = descriptionInput.value.length
      })
    }

    // Gérer l'upload de fichier avec drag & drop
    const attachmentInput = document.getElementById('feedback-attachment')
    const attachmentZone = document.getElementById('feedback-attachment-zone')
    const attachmentPreview = document.getElementById('feedback-attachment-preview')
    const attachmentPreviewImg = document.getElementById('feedback-attachment-preview-img')
    const attachmentRemoveBtn = document.getElementById('feedback-attachment-remove')

    const handleFileSelection = (file) => {
      if (!file) return

      // Vérifier la taille (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        notificationService.error('Le fichier est trop volumineux (max 10MB)')
        if (attachmentInput) attachmentInput.value = ''
        return
      }

      // Vérifier le type
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        notificationService.error('Type de fichier non autorisé. Utilisez une image ou une vidéo.')
        if (attachmentInput) attachmentInput.value = ''
        return
      }

      // Afficher la prévisualisation
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          if (attachmentPreviewImg) {
            attachmentPreviewImg.src = e.target.result
          }
          if (attachmentPreview) {
            attachmentPreview.style.display = 'block'
          }
          if (attachmentZone) {
            attachmentZone.style.display = 'none'
          }
        }
        reader.readAsDataURL(file)
      } else {
        // Pour les vidéos, on affiche juste le nom
        if (attachmentPreview) {
          attachmentPreview.style.display = 'block'
          if (attachmentPreviewImg) {
            attachmentPreviewImg.src = ''
            attachmentPreviewImg.alt = file.name
          }
        }
        if (attachmentZone) {
          attachmentZone.style.display = 'none'
        }
      }
    }

    if (attachmentInput) {
      attachmentInput.addEventListener('change', (e) => {
        const file = e.target.files[0]
        handleFileSelection(file)
      })
    }

    // Drag & Drop
    if (attachmentZone) {
      attachmentZone.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        attachmentZone.classList.add('dragover')
      })

      attachmentZone.addEventListener('dragleave', (e) => {
        e.preventDefault()
        e.stopPropagation()
        attachmentZone.classList.remove('dragover')
      })

      attachmentZone.addEventListener('drop', (e) => {
        e.preventDefault()
        e.stopPropagation()
        attachmentZone.classList.remove('dragover')
        const file = e.dataTransfer.files[0]
        if (file && attachmentInput) {
          attachmentInput.files = e.dataTransfer.files
          handleFileSelection(file)
        }
      })
    }

    if (attachmentRemoveBtn) {
      attachmentRemoveBtn.addEventListener('click', () => {
        if (attachmentInput) attachmentInput.value = ''
        if (attachmentPreview) attachmentPreview.style.display = 'none'
        if (attachmentPreviewImg) attachmentPreviewImg.src = ''
        if (attachmentZone) attachmentZone.style.display = 'block'
      })
    }
  }

  /**
   * Ouvrir le modal de feedback
   */
  openFeedbackModal() {
    const modal = document.getElementById('feedback-modal')
    if (!modal) return

    // Déplacer le modal dans le body si nécessaire
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal)
    }

    modal.classList.add('active')
    modal.style.display = 'flex'
    modal.style.visibility = 'visible'
    modal.style.opacity = '1'
    modal.style.zIndex = '100000'
    modal.style.position = 'fixed'
    modal.style.top = '0'
    modal.style.left = '0'
    modal.style.right = '0'
    modal.style.bottom = '0'
    document.body.style.overflow = 'hidden'

    // Réinitialiser le formulaire
    const form = document.getElementById('feedback-form')
    if (form) {
      form.reset()
      // Réinitialiser le compteur de caractères
      const titleCount = document.getElementById('feedback-title-count')
      const descriptionCount = document.getElementById('feedback-description-count')
      if (titleCount) titleCount.textContent = '0'
      if (descriptionCount) descriptionCount.textContent = '0'
      // Réinitialiser la prévisualisation
      const attachmentPreview = document.getElementById('feedback-attachment-preview')
      const attachmentZone = document.getElementById('feedback-attachment-zone')
      if (attachmentPreview) attachmentPreview.style.display = 'none'
      if (attachmentZone) attachmentZone.style.display = 'block'
    }
  }

  /**
   * Fermer le modal de feedback
   */
  closeFeedbackModal() {
    const modal = document.getElementById('feedback-modal')
    if (modal) {
      modal.classList.remove('active')
      modal.style.display = 'none'
      modal.style.visibility = 'hidden'
      document.body.style.overflow = ''
      
      // Réinitialiser le formulaire
      const form = document.getElementById('feedback-form')
      if (form) {
        form.reset()
        // Réinitialiser le compteur de caractères
        const titleCount = document.getElementById('feedback-title-count')
        if (titleCount) titleCount.textContent = '0'
        // Réinitialiser la prévisualisation
        const attachmentPreview = document.getElementById('feedback-attachment-preview')
        const attachmentZone = document.getElementById('feedback-attachment-zone')
        if (attachmentPreview) attachmentPreview.style.display = 'none'
        if (attachmentZone) attachmentZone.style.display = 'block'
        const attachmentPreviewImg = document.getElementById('feedback-attachment-preview-img')
        if (attachmentPreviewImg) attachmentPreviewImg.src = ''
      }
    }
  }

  /**
   * Gérer la soumission du feedback
   */
  async handleSubmitFeedback(source = 'modal') {
    // Déterminer les IDs selon la source
    const prefix = source === 'page' ? 'feedback-page-' : 'feedback-'
    const typeName = source === 'page' ? 'feedback-page-type' : 'feedback-type'
    
    // Récupérer le type sélectionné depuis les radio buttons
    const typeRadio = document.querySelector(`input[name="${typeName}"]:checked`)
    const titleInput = document.getElementById(`${prefix}title`)
    const descriptionInput = document.getElementById(`${prefix}description`)
    const attachmentInput = document.getElementById(`${prefix}attachment`)

    const type = typeRadio?.value || 'other'
    const title = titleInput?.value.trim() || ''
    const description = descriptionInput?.value.trim() || ''
    const attachmentFile = attachmentInput?.files[0] || null

    // Validation
    if (!title || title.length === 0) {
      notificationService.error('Veuillez entrer un titre')
      if (titleInput) {
        titleInput.focus()
        titleInput.classList.add('input-error')
      }
      return
    }

    if (!description || description.length === 0) {
      notificationService.error('Veuillez entrer une description')
      if (descriptionInput) {
        descriptionInput.focus()
        descriptionInput.classList.add('input-error')
      }
      return
    }

    if (title.length > 255) {
      notificationService.error('Le titre est trop long (maximum 255 caractères)')
      if (titleInput) {
        titleInput.focus()
        titleInput.classList.add('input-error')
      }
      return
    }

    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible d\'envoyer le feedback en mode hors ligne')
      return
    }

    // Désactiver le bouton de soumission
    const formId = source === 'page' ? 'feedback-page-form' : 'feedback-form'
    const submitButton = document.querySelector(`#${formId} button[type="submit"]`)
    const originalButtonText = submitButton?.textContent
    if (submitButton) {
      submitButton.disabled = true
      submitButton.innerHTML = '<span>📤 Envoi en cours...</span>'
    }

    try {
      const result = await apiService.submitFeedback(type, title, description, attachmentFile)
      if (result && result.success) {
        notificationService.success('Feedback envoyé avec succès ! Merci pour votre contribution.')
        
        if (source === 'modal') {
          this.closeFeedbackModal()
        }
        
        // Réinitialiser le formulaire
        const form = document.getElementById(formId)
        if (form) {
          form.reset()
          // Réinitialiser le compteur de caractères
          const titleCount = document.getElementById(`${prefix}title-count`)
          const descriptionCount = document.getElementById(`${prefix}description-count`)
          if (titleCount) titleCount.textContent = '0'
          if (descriptionCount) descriptionCount.textContent = '0'
          // Réinitialiser la prévisualisation
          const attachmentPreview = document.getElementById(`${prefix}attachment-preview`)
          const attachmentZone = document.getElementById(`${prefix}attachment-zone`)
          if (attachmentPreview) attachmentPreview.style.display = 'none'
          if (attachmentZone) attachmentZone.style.display = 'block'
        }
      } else {
        notificationService.error(result?.message || 'Erreur lors de l\'envoi du feedback')
      }
    } catch (error) {
      const errorMessage = error.data?.message || error.data?.error || error.message || 'Erreur lors de l\'envoi du feedback'
      notificationService.error(errorMessage)
    } finally {
      if (submitButton) {
        submitButton.disabled = false
        submitButton.innerHTML = originalButtonText || '<span>📤 Envoyer</span>'
      }
    }
  }

  /**
   * Ouvrir le modal mes feedbacks
   */
  async openMyFeedbacksModal() {
    const modal = document.getElementById('my-feedbacks-modal')
    if (!modal) return

    // Déplacer le modal dans le body si nécessaire
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal)
    }

    modal.classList.add('active')
    modal.style.display = 'flex'
    modal.style.visibility = 'visible'
    modal.style.opacity = '1'
    modal.style.zIndex = '100000'
    modal.style.position = 'fixed'
    modal.style.top = '0'
    modal.style.left = '0'
    modal.style.right = '0'
    modal.style.bottom = '0'
    document.body.style.overflow = 'hidden'

    // Charger les feedbacks
    await this.loadMyFeedbacks()
  }

  /**
   * Fermer le modal mes feedbacks
   */
  closeMyFeedbacksModal() {
    const modal = document.getElementById('my-feedbacks-modal')
    if (modal) {
      modal.classList.remove('active')
      modal.style.display = 'none'
      modal.style.visibility = 'hidden'
      document.body.style.overflow = ''
    }
  }

  /**
   * Charger et afficher les feedbacks de l'utilisateur
   */
  async loadMyFeedbacks() {
    const feedbacksList = document.getElementById('my-feedbacks-list')
    if (!feedbacksList) return

    if (!this.useApi || !this.currentUser) {
      feedbacksList.innerHTML = '<div class="empty-message">Mode hors ligne - Les feedbacks ne sont pas disponibles</div>'
      return
    }

    feedbacksList.innerHTML = '<div class="loading-state"><span>Chargement...</span></div>'

    try {
      const result = await apiService.getMyFeedbacks()
      if (result && result.success && result.feedbacks) {
        this.renderMyFeedbacks(result.feedbacks)
      } else {
        feedbacksList.innerHTML = '<div class="empty-message">Aucun feedback envoyé</div>'
      }
    } catch (error) {
      feedbacksList.innerHTML = '<div class="error-message">Erreur lors du chargement des feedbacks</div>'
    }
  }

  /**
   * Rendre la liste des feedbacks de l'utilisateur
   */
  renderMyFeedbacks(feedbacks) {
    const feedbacksList = document.getElementById('my-feedbacks-list')
    if (!feedbacksList) return

    if (!feedbacks || feedbacks.length === 0) {
      feedbacksList.innerHTML = `
        <div class="empty-message">
          <span class="empty-message-icon">📝</span>
          <span class="empty-message-text">Vous n'avez pas encore envoyé de feedback</span>
        </div>
      `
      return
    }

    const typeIcons = {
      bug: '🐛',
      suggestion: '💡',
      question: '❓',
      other: '📝'
    }

    const typeLabels = {
      bug: 'Bug',
      suggestion: 'Suggestion',
      question: 'Question',
      other: 'Autre'
    }

    const statusLabels = {
      new: 'Nouveau',
      in_progress: 'En cours',
      resolved: 'Résolu',
      closed: 'Fermé'
    }

    const statusColors = {
      new: '#f97316',
      in_progress: '#3b82f6',
      resolved: '#10b981',
      closed: '#6b7280'
    }

    feedbacksList.innerHTML = feedbacks.map(feedback => {
      const createdDate = new Date(feedback.created_at)
      const dateStr = createdDate.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })

      return `
        <div class="feedback-card">
          <div class="feedback-header">
            <div class="feedback-type-badge feedback-type-${feedback.type}">
              ${typeIcons[feedback.type] || '📝'} ${typeLabels[feedback.type] || 'Autre'}
            </div>
            <div class="feedback-status-badge" style="background-color: ${statusColors[feedback.status] || '#6b7280'}20; color: ${statusColors[feedback.status] || '#6b7280'};">
              ${statusLabels[feedback.status] || feedback.status}
            </div>
          </div>
          <div class="feedback-title">${this.escapeHtml(feedback.title)}</div>
          <div class="feedback-description">${this.escapeHtml(feedback.description)}</div>
          ${feedback.admin_response ? `
            <div class="feedback-response">
              <div class="feedback-response-header">
                <strong>Réponse de l'équipe :</strong>
              </div>
              <div class="feedback-response-content">${this.escapeHtml(feedback.admin_response)}</div>
            </div>
          ` : ''}
          <div class="feedback-footer">
            <span class="feedback-date">Envoyé le ${dateStr}</span>
            ${feedback.resolved_at ? `
              <span class="feedback-resolved-date">Résolu le ${new Date(feedback.resolved_at).toLocaleDateString('fr-FR')}</span>
            ` : ''}
          </div>
        </div>
      `
    }).join('')
  }

  /**
   * Vérifier le statut de suppression du compte
   */
  async checkDeletionStatus() {
    if (!this.useApi || !this.currentUser) return

    try {
      const result = await apiService.getDeletionStatus(this.currentUser.id)
      // Si result est null, l'endpoint n'existe pas ou a retourné une erreur 500 (gérée silencieusement)
      if (result && result.deletion_requested_at) {
        this.displayDeletionStatus(result.deletion_requested_at, result.deletion_date)
      } else {
        this.hideDeletionStatus()
      }
    } catch (error) {
      // Ne pas afficher d'erreur si l'endpoint n'existe pas ou si c'est une erreur non critique
      // On log silencieusement pour le débogage (warn ne déclenche pas de notification)
      logger.warn('Failed to check deletion status (non-critical)', error)
      this.hideDeletionStatus()
    }
  }

  /**
   * Afficher le statut de suppression
   */
  displayDeletionStatus(requestedAt, deletionDate) {
    // Créer ou mettre à jour l'affichage du statut
    let statusDiv = document.getElementById('delete-account-status')
    const settingsSection = document.querySelector('.settings-section')
    
    if (!statusDiv && settingsSection) {
      const sectionContent = settingsSection.querySelector('.settings-section-content')
      if (sectionContent) {
        statusDiv = document.createElement('div')
        statusDiv.id = 'delete-account-status'
        statusDiv.className = 'settings-item-danger'
        sectionContent.insertBefore(statusDiv, sectionContent.firstChild)
      }
    }

    if (statusDiv) {
      const deletionDateObj = new Date(deletionDate)
      const daysRemaining = this.calculateWorkingDaysRemaining(new Date(), deletionDateObj)
      
      statusDiv.innerHTML = `
        <div class="settings-item-info">
          <label class="settings-item-label" style="color: #ef4444;">⚠️ Suppression programmée</label>
          <p class="settings-item-description" style="color: #f87171;">
            Votre compte sera supprimé le <strong>${deletionDateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>
            ${daysRemaining > 0 ? '(' + daysRemaining + ' jour' + (daysRemaining > 1 ? 's' : '') + ' ouvré' + (daysRemaining > 1 ? 's' : '') + ' restant' + (daysRemaining > 1 ? 's' : '') + ')' : ''}
          </p>
        </div>
        <div class="settings-item-action">
          <button class="btn btn-primary" id="cancel-deletion-btn">Annuler la suppression</button>
        </div>
      `

      const cancelBtn = document.getElementById('cancel-deletion-btn')
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          this.openCancelDeletionModal()
        })
      }

      // Masquer le bouton de suppression
      const deleteBtn = document.getElementById('delete-account-btn')
      if (deleteBtn) {
        deleteBtn.style.display = 'none'
      }
    }
  }

  /**
   * Masquer le statut de suppression
   */
  hideDeletionStatus() {
    const statusDiv = document.getElementById('delete-account-status')
    if (statusDiv) {
      statusDiv.remove()
    }

    // Afficher le bouton de suppression
    const deleteBtn = document.getElementById('delete-account-btn')
    if (deleteBtn) {
      deleteBtn.style.display = 'inline-flex'
    }
  }

  /**
   * Calculer le nombre de jours ouvrés restants
   */
  calculateWorkingDaysRemaining(startDate, endDate) {
    let count = 0
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current < end) {
      const dayOfWeek = current.getDay()
      // 0 = Dimanche, 6 = Samedi
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++
      }
      current.setDate(current.getDate() + 1)
    }

    return count
  }

  /**
   * Ouvrir le modal de suppression de compte
   */
  openDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal')
    if (modal && this.currentUser) {
      modal.style.display = 'flex'
      const usernameConfirm = document.getElementById('delete-account-username-confirm')
      if (usernameConfirm) {
        usernameConfirm.textContent = this.currentUser.username
      }
      const form = document.getElementById('delete-account-form')
      if (form) {
        form.reset()
      }
    }
  }

  /**
   * Fermer le modal de suppression de compte
   */
  closeDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal')
    if (modal) {
      modal.style.display = 'none'
      const form = document.getElementById('delete-account-form')
      if (form) {
        form.reset()
      }
    }
  }

  /**
   * Ouvrir le modal d'annulation de suppression
   */
  openCancelDeletionModal() {
    const modal = document.getElementById('cancel-deletion-modal')
    if (modal) {
      modal.style.display = 'flex'
    }
  }

  /**
   * Fermer le modal d'annulation de suppression
   */
  closeCancelDeletionModal() {
    const modal = document.getElementById('cancel-deletion-modal')
    if (modal) {
      modal.style.display = 'none'
    }
  }

  /**
   * Gérer la demande de suppression de compte
   */
  async handleDeleteAccountRequest() {
    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible de supprimer le compte en mode hors ligne')
      return
    }

    const usernameInput = document.getElementById('delete-account-username-input')
    const username = usernameInput ? usernameInput.value.trim() : ''

    if (username !== this.currentUser.username) {
      notificationService.error('Le nom d\'utilisateur ne correspond pas')
      return
    }

    try {
      const result = await apiService.requestAccountDeletion(this.currentUser.id)
      if (result.success) {
        notificationService.success('Votre demande de suppression a été enregistrée. Votre compte sera supprimé dans 2 jours ouvrés.')
        this.closeDeleteAccountModal()
        await this.checkDeletionStatus()
        await this.renderSettings()
      } else {
        notificationService.error(result.message || 'Erreur lors de la demande de suppression')
      }
    } catch (error) {
      logger.error('Failed to request account deletion', error)
      notificationService.error('Erreur lors de la demande de suppression')
    }
  }

  /**
   * Gérer l'annulation de la suppression
   */
  async handleCancelDeletion() {
    if (!this.useApi || !this.currentUser) {
      notificationService.error('Impossible d\'annuler la suppression en mode hors ligne')
      return
    }

    try {
      const result = await apiService.cancelAccountDeletion(this.currentUser.id)
      if (result.success) {
        notificationService.success('La suppression de votre compte a été annulée')
        this.closeCancelDeletionModal()
        await this.checkDeletionStatus()
        await this.renderSettings()
      } else {
        notificationService.error(result.message || 'Erreur lors de l\'annulation')
      }
    } catch (error) {
      logger.error('Failed to cancel deletion', error)
      notificationService.error('Erreur lors de l\'annulation de la suppression')
    }
  }

  /**
   * Initialiser la page de vote
   */
  initVotePage() {
    
    // Afficher un état de chargement immédiatement
    const cooldownTimer = document.getElementById('vote-cooldown-timer')
    const cooldownDesc = document.getElementById('vote-cooldown-desc')
    const voteCountElement = document.getElementById('vote-count-month')
    const rankingElement = document.getElementById('vote-ranking')
    
    if (cooldownTimer) {
      cooldownTimer.textContent = 'Chargement...'
      cooldownTimer.className = 'vote-stat-value-new loading'
    }
    if (cooldownDesc) {
      cooldownDesc.textContent = 'Récupération du cooldown...'
      cooldownDesc.classList.add('loading')
    }
    
    // Ne PAS nettoyer voteStatsInterval ici car il doit continuer même hors page vote
    // Il est géré globalement par startGlobalVoteStatsUpdate()
    if (this.voteCooldownInterval) {
      clearInterval(this.voteCooldownInterval)
      this.voteCooldownInterval = null
    }
    if (this.voteCooldownDisplayInterval) {
      clearInterval(this.voteCooldownDisplayInterval)
      this.voteCooldownDisplayInterval = null
    }
    
    // Charger TOUT immédiatement et en parallèle pour un chargement instantané (sans délai)
    
    // Charger le cooldown et les stats en parallèle immédiatement (sans attendre)
    const loadPromises = [
      this.updateVoteCooldown().catch(err => {
        logger.error('Failed to load initial cooldown', err)
      }),
      this.loadVoteStats().catch(err => {
        logger.error('Failed to load initial vote stats', err)
      })
    ]
    
    // Ne pas attendre Promise.all, démarrer les intervalles immédiatement
    Promise.all(loadPromises).then(() => {
    }).catch(() => {
      // Ignorer les erreurs, on continue quand même
    })
    
    // Démarrer les intervalles IMMÉDIATEMENT (pas besoin d'attendre le chargement initial)
    this.startVoteCooldownCheck()
    
    // Les stats de vote sont déjà mises à jour globalement par startGlobalVoteStatsUpdate()
    // On met juste à jour l'affichage immédiatement avec les données actuelles
    this.updateVotePageDisplay()
    
    
    // Initialiser le toggle de notification de vote sur la page de vote
    const voteNotificationEnabled = this.isVoteNotificationEnabled()
    const voteNotificationToggle = document.querySelector('#vote-view #vote-notification-toggle')
    if (voteNotificationToggle) {
      voteNotificationToggle.checked = voteNotificationEnabled
      
      // Supprimer les anciens listeners pour éviter les doublons
      const newToggle = voteNotificationToggle.cloneNode(true)
      voteNotificationToggle.parentNode.replaceChild(newToggle, voteNotificationToggle)
      
      newToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked
        localStorage.setItem('vote-notification-enabled', isEnabled ? 'true' : 'false')
        
        // Les options de notification ont été supprimées (remplacées par overlay)
        
        // Synchroniser tous les autres toggles (paramètres et page de vote)
        document.querySelectorAll('#vote-notification-toggle').forEach(otherToggle => {
          if (otherToggle !== newToggle) {
            otherToggle.checked = isEnabled
          }
        })
        
        if (isEnabled && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              notificationService.success('Notifications activées', 'Vous recevrez une alerte quand vous pourrez revoter')
            }
          })
        }
      })
      
      // Les options de notification ont été supprimées (remplacées par overlay)
    }
    
    // Gérer le clic sur le bouton de vote
    const voteButton = document.getElementById('vote-button-link')
    if (voteButton) {
      voteButton.addEventListener('click', async () => {
        // Marquer qu'un cooldown était actif (pour la notification future)
        this.voteCooldownWasActive = true
        // Mettre à jour le cooldown après un court délai pour laisser le site se mettre à jour
        setTimeout(() => {
          this.updateVoteCooldown()
        }, 2000)
      })
    }
  }

  /**
   * Mettre à jour l'affichage de la page vote avec les stats actuelles
   */
  updateVotePageDisplay() {
    const voteView = document.getElementById('vote-view')
    if (!voteView || voteView.classList.contains('hidden')) {
      // Pas sur la page vote, ne pas mettre à jour l'affichage
      return
    }
    
    // Mettre à jour les votes du mois
    if (this.voteStats.voteCount !== null && this.voteStats.voteCount !== undefined && this.voteStats.voteCount > 0) {
      const voteCountElement = document.getElementById('vote-count-month')
      if (voteCountElement) {
        const newText = this.voteStats.voteCount.toLocaleString('fr-FR')
        voteCountElement.textContent = newText
        voteCountElement.classList.remove('loading')
      }
    }
    
    // Mettre à jour le classement
    if (this.voteStats.ranking !== null && this.voteStats.ranking !== undefined && this.voteStats.ranking > 0) {
      const rankingElement = document.getElementById('vote-ranking')
      if (rankingElement) {
        const newText = `#${this.voteStats.ranking}`
        rankingElement.textContent = newText
        rankingElement.classList.remove('loading')
      }
    }
  }
  
  /**
   * Charger les statistiques de vote (fonctionne même hors page vote)
   */
  async loadVoteStats() {
    if (this.isLoadingVoteStats) {
      return
    }
    this.isLoadingVoteStats = true
    try {
      // Récupérer le cooldown de vote, les votes du mois et le classement
      const cooldownData = await apiService.getVoteCooldown()
      
      if (cooldownData && cooldownData.success) {
        // Stocker les stats globalement pour les utiliser partout (même hors page vote)
        if (cooldownData.voteCount !== null && cooldownData.voteCount !== undefined && cooldownData.voteCount > 0) {
          this.voteStats.voteCount = cooldownData.voteCount
        }
        if (cooldownData.ranking !== null && cooldownData.ranking !== undefined && cooldownData.ranking > 0) {
          this.voteStats.ranking = cooldownData.ranking
        }
        
        // Mettre à jour l'affichage seulement si on est sur la page vote
        this.updateVotePageDisplay()
        
        // Mettre à jour aussi le cooldown avec les mêmes données pour éviter un double appel
        // MAIS seulement si on n'a pas déjà un cooldown actif (pour éviter les conflits)
        if (cooldownData.available !== undefined && !this.lastCooldownUpdate) {
          if (cooldownData.available) {
            const hadCooldown = this.voteCooldownWasActive
            this.setVoteAvailable()
            this.voteCooldownWasActive = false
            
            if (hadCooldown && this.isVoteNotificationEnabled()) {
              this.triggerVoteAvailableNotification()
            }
            this.lastCooldownUpdate = null
          } else if (cooldownData.remainingMs && cooldownData.remainingMs > 0) {
            this.voteCooldownWasActive = true
            this.lastCooldownUpdate = {
              remainingMs: cooldownData.remainingMs,
              timestamp: Date.now()
            }
            this.setVoteCooldown(cooldownData.remainingMs)
          }
        }
      } else {
        // Si pas de données, essayer quand même de mettre à jour le cooldown
        if (!this.lastCooldownUpdate) {
          await this.updateVoteCooldown()
        }
      }
    } catch (error) {
      logger.error('Failed to load vote stats', error)
      // En cas d'erreur, essayer quand même de mettre à jour le cooldown
      try {
        await this.updateVoteCooldown()
      } catch (cooldownError) {
        logger.error('Failed to update cooldown as fallback', cooldownError)
      }
    } finally {
      this.isLoadingVoteStats = false
    }
  }

  /**
   * Récupérer et mettre à jour le cooldown de vote depuis Top Serveurs (temps réel)
   */
  async updateVoteCooldown() {
    try {
      
      // Récupérer le cooldown directement depuis le site Top Serveurs
      const cooldownData = await apiService.getVoteCooldown()
      
      if (cooldownData && cooldownData.success) {
        // Retirer immédiatement le texte "Récupération du cooldown..." dès qu'on a des données
        const cooldownDesc = document.getElementById('vote-cooldown-desc')
        if (cooldownDesc && cooldownDesc.textContent === 'Récupération du cooldown...') {
          cooldownDesc.classList.remove('loading')
        }
        
        if (cooldownData.available) {
          // Vérifier si on avait un cooldown actif avant (pour la notification)
          const hadCooldown = this.voteCooldownWasActive
          this.setVoteAvailable()
          this.voteCooldownWasActive = false
          
          // Déclencher la notification si le vote vient de redevenir disponible
          if (hadCooldown && this.isVoteNotificationEnabled()) {
            this.triggerVoteAvailableNotification()
          }
          // Sauvegarder le timestamp pour le décrément local
          this.lastCooldownUpdate = null
          return
        }
        
        if (cooldownData.remainingMs && cooldownData.remainingMs > 0) {
          this.voteCooldownWasActive = true
          // Sauvegarder le temps réel récupéré et le timestamp
          this.lastCooldownUpdate = {
            remainingMs: cooldownData.remainingMs,
            timestamp: Date.now()
          }
          this.setVoteCooldown(cooldownData.remainingMs)
          return
        }
      }
      
      // Si l'API ne retourne pas de données valides, considérer comme disponible
      this.setVoteAvailable()
      this.lastCooldownUpdate = null
    } catch (error) {
      logger.error('Failed to update vote cooldown', error)
      // En cas d'erreur, utiliser le dernier cooldown connu si disponible
      if (this.lastCooldownUpdate) {
        const elapsed = Date.now() - this.lastCooldownUpdate.timestamp
        const remaining = this.lastCooldownUpdate.remainingMs - elapsed
        if (remaining > 0) {
          this.setVoteCooldown(remaining)
        } else {
          this.setVoteAvailable()
          this.lastCooldownUpdate = null
        }
      } else {
        // Afficher un message d'erreur stylisé
        const cooldownTimer = document.getElementById('vote-cooldown-timer')
        const cooldownDesc = document.getElementById('vote-cooldown-desc')
        if (cooldownTimer) {
          cooldownTimer.textContent = 'Erreur'
          cooldownTimer.className = 'vote-stat-value-new'
          cooldownTimer.style.color = '#ef4444'
        }
        if (cooldownDesc) {
          cooldownDesc.textContent = 'Impossible de récupérer le cooldown'
          cooldownDesc.classList.remove('loading')
          cooldownDesc.style.color = '#ef4444'
        }
      }
    }
  }

  /**
   * Définir l'état "vote disponible"
   */
  setVoteAvailable() {
    const cooldownTimer = document.getElementById('vote-cooldown-timer')
    const cooldownDesc = document.getElementById('vote-cooldown-desc')
    const cooldownInfo = document.getElementById('vote-cooldown-info')
    const voteButton = document.getElementById('vote-button-link')

    if (cooldownTimer) {
      cooldownTimer.textContent = 'Disponible'
      cooldownTimer.className = 'vote-stat-value-new vote-available'
    }
    if (cooldownDesc) {
      cooldownDesc.textContent = 'Vous pouvez voter maintenant'
      cooldownDesc.classList.remove('loading')
    }
    if (cooldownInfo) {
      cooldownInfo.style.display = 'none'
    }
    if (voteButton) {
      voteButton.classList.remove('vote-button-disabled')
      voteButton.style.pointerEvents = 'auto'
      voteButton.style.opacity = '1'
    }
  }

  /**
   * Définir l'état "cooldown actif"
   */
  setVoteCooldown(remainingMs) {
    const cooldownTimer = document.getElementById('vote-cooldown-timer')
    const cooldownDesc = document.getElementById('vote-cooldown-desc')
    const cooldownInfo = document.getElementById('vote-cooldown-info')
    const cooldownDisplay = document.getElementById('vote-cooldown-display')
    const voteButton = document.getElementById('vote-button-link')

    if (cooldownTimer) {
      cooldownTimer.className = 'vote-stat-value-new vote-cooldown-active'
      // S'assurer que la classe loading est retirée pour éviter les points de suspension
      cooldownTimer.classList.remove('loading')
    }
    if (cooldownDesc) {
      cooldownDesc.textContent = 'Temps restant avant le prochain vote'
      cooldownDesc.classList.remove('loading')
    }
    if (cooldownInfo) {
      cooldownInfo.style.display = 'flex'
    }
    if (voteButton) {
      voteButton.classList.add('vote-button-disabled')
      voteButton.style.pointerEvents = 'none'
      voteButton.style.opacity = '0.6'
    }

    this.updateCooldownDisplay(remainingMs, cooldownDisplay, cooldownTimer)
  }

  /**
   * Mettre à jour l'affichage du cooldown
   */
  updateCooldownDisplay(remainingMs, displayElement, timerElement) {
    const hours = Math.floor(remainingMs / (1000 * 60 * 60))
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000)

    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    
    if (displayElement) {
      displayElement.textContent = timeString
      // Retirer la classe loading pour éviter les points de suspension
      displayElement.classList.remove('loading')
    }
    if (timerElement) {
      timerElement.textContent = timeString
      // Retirer la classe loading pour éviter les points de suspension
      timerElement.classList.remove('loading')
    }
  }

  /**
   * Démarrer la vérification du cooldown de vote en temps réel
   */
  startVoteCooldownCheck() {
    // Nettoyer les intervalles précédents s'ils existent (important pour le reload)
    if (this.voteCooldownInterval) {
      clearInterval(this.voteCooldownInterval)
      this.voteCooldownInterval = null
    }
    if (this.voteCooldownDisplayInterval) {
      if (typeof this.voteCooldownDisplayInterval === 'number') {
        clearInterval(this.voteCooldownDisplayInterval)
      }
      this.voteCooldownDisplayInterval = null
    }
    if (this.voteCooldownDisplayAnimationFrame !== null) {
      cancelAnimationFrame(this.voteCooldownDisplayAnimationFrame)
      this.voteCooldownDisplayAnimationFrame = null
    }

    // Récupérer le cooldown directement depuis le site toutes les 200ms pour avoir le temps réel quasi-instantané
    // Note: Le premier appel est déjà fait dans initVotePage(), donc on démarre l'intervalle directement
    this.voteCooldownInterval = setInterval(() => {
      this.updateVoteCooldown()
    }, 200) // Vérifier toutes les 200ms pour une mise à jour quasi-instantanée

    // Utiliser requestAnimationFrame pour un affichage ultra-fluide et instantané (60 FPS)
    let lastUpdateTime = 0
    const updateDisplay = (currentTime) => {
      // Limiter à ~60 FPS (environ 16ms entre chaque frame)
      if (currentTime - lastUpdateTime >= 16) {
        lastUpdateTime = currentTime
        
        if (this.lastCooldownUpdate) {
          const elapsed = Date.now() - this.lastCooldownUpdate.timestamp
          const remaining = this.lastCooldownUpdate.remainingMs - elapsed
          
          if (remaining > 0) {
            // Mettre à jour l'affichage avec le temps restant calculé
            const cooldownDisplay = document.getElementById('vote-cooldown-display')
            const cooldownTimer = document.getElementById('vote-cooldown-timer')
            const cooldownDesc = document.getElementById('vote-cooldown-desc')
            
            // Mettre à jour le timer
            this.updateCooldownDisplay(remaining, cooldownDisplay, cooldownTimer)
            
            // S'assurer que la description est correcte (retirer "Récupération du cooldown...")
            if (cooldownDesc && (cooldownDesc.textContent === 'Récupération du cooldown...' || cooldownDesc.classList.contains('loading'))) {
              cooldownDesc.textContent = 'Temps restant avant le prochain vote'
              cooldownDesc.classList.remove('loading')
            }
            
            // Vérifier si le cooldown vient de se terminer (pour la notification)
            if (remaining <= 1000 && this.isVoteNotificationEnabled()) {
              this.triggerVoteAvailableNotification()
            }
          } else {
            // Le cooldown est terminé, vérifier immédiatement avec l'API
            this.updateVoteCooldown()
          }
        } else {
          // Pas de cooldown actif, vérifier quand même périodiquement
          const cooldownTimer = document.getElementById('vote-cooldown-timer')
          const cooldownDesc = document.getElementById('vote-cooldown-desc')
          if (cooldownTimer && (cooldownTimer.textContent === 'Chargement...' || cooldownTimer.textContent.includes('...'))) {
            this.updateVoteCooldown()
          }
          // Si la description est toujours sur "Récupération du cooldown..." mais qu'on a pas de cooldown, vérifier
          if (cooldownDesc && cooldownDesc.textContent === 'Récupération du cooldown...') {
            this.updateVoteCooldown()
          }
        }
      }
      
      // Continuer l'animation si l'animation frame est toujours actif
      if (this.voteCooldownDisplayAnimationFrame !== null) {
        this.voteCooldownDisplayAnimationFrame = requestAnimationFrame(updateDisplay)
      }
    }
    
    // Démarrer l'animation
    this.voteCooldownDisplayAnimationFrame = requestAnimationFrame(updateDisplay)
    // Marquer l'intervalle comme actif pour la vérification dans l'animation
    this.voteCooldownDisplayInterval = true
    
  }

  /**
   * Vérifier si les notifications de vote sont activées
   */
  isVoteNotificationEnabled() {
    const enabled = localStorage.getItem('vote-notification-enabled')
    return enabled === 'true'
  }

  /**
   * Fonctions de son supprimées - remplacées par overlay
   */
  
  /**
   * Déclencher une notification quand le vote est disponible
   */
  triggerVoteAvailableNotification() {
    // Vérifier si on a déjà notifié pour éviter les doublons
    const lastNotification = localStorage.getItem('vote-notification-last')
    const now = Date.now()
    
    // Ne notifier qu'une fois toutes les 5 minutes maximum
    if (lastNotification && (now - parseInt(lastNotification, 10)) < 5 * 60 * 1000) {
      return
    }
    
    localStorage.setItem('vote-notification-last', now.toString())
    
    // Afficher l'overlay de notification
    if (window.electronAPI && window.electronAPI.showOverlayNotification) {
      window.electronAPI.showOverlayNotification(
        '🗳️ Vote disponible !',
        'Vous pouvez maintenant voter pour le serveur RevolutionDayZ'
      )
    }
  }

  /**
   * Démarrer la vérification périodique des nouveaux feedbacks (pour les développeurs)
   */
  startFeedbackCheck() {
    // Arrêter toute vérification existante
    this.stopFeedbackCheck()
    
    if (!this.currentUser || this.currentUser.role !== 'developpeur') {
      return
    }
    
    if (!this.useApi) {
      return
    }
    
    // Initialiser la dernière vérification à maintenant
    this.lastFeedbackCheck = new Date().toISOString()
    
    // Vérifier immédiatement
    this.checkNewFeedbacks()
    
    // Vérifier toutes les 30 secondes
    this.feedbackCheckInterval = setInterval(() => {
      this.checkNewFeedbacks()
    }, 30000) // 30 secondes
  }

  /**
   * Arrêter la vérification des nouveaux feedbacks
   */
  stopFeedbackCheck() {
    if (this.feedbackCheckInterval) {
      clearInterval(this.feedbackCheckInterval)
      this.feedbackCheckInterval = null
    }
    this.lastFeedbackCheck = null
  }

  /**
   * Vérifier les nouveaux feedbacks et notifier les développeurs
   */
  async checkNewFeedbacks() {
    if (!this.currentUser || this.currentUser.role !== 'developpeur') {
      return
    }
    
    if (!this.useApi) {
      return
    }
    
    // Vérifier que le token est disponible
    if (!apiService.authToken) {
      const savedToken = apiService.getSavedToken()
      if (savedToken) {
        apiService.authToken = savedToken
      } else {
        logger.warn('No auth token available for feedback check')
        return
      }
    }
    
    try {
      const lastCheck = this.lastFeedbackCheck || new Date(Date.now() - 3600000).toISOString()
      const result = await apiService.checkNewFeedbacks(lastCheck)
      
      if (result && result.success && result.new_count > 0) {
        // Mettre à jour la dernière vérification
        if (result.last_check) {
          this.lastFeedbackCheck = result.last_check
        }
        
        // Préparer le message de notification
        const count = result.new_count
        const feedbacks = result.feedbacks || []
        
        // Notification overlay personnalisée pour les feedbacks
        if (count === 1 && feedbacks.length > 0) {
          const feedback = feedbacks[0]
          
          // Notification overlay moderne avec bouton cliquable
          if (window.electronAPI && window.electronAPI.showOverlayNotification) {
            window.electronAPI.showOverlayNotification(
              null, // title (non utilisé pour feedback)
              null, // message (non utilisé pour feedback)
              'feedback', // type
              feedback.type || 'other', // feedbackType
              feedback.username || 'Utilisateur', // username
              feedback.title || 'Sans titre', // feedbackTitle
              feedback.description || '' // feedbackDescription
            )
          }
          
          // Notification système Windows/macOS via Electron (fallback)
          if (window.electronAPI && window.electronAPI.showNotification) {
            const typeLabels = {
              'bug': '🐛 Bug',
              'suggestion': '💡 Suggestion',
              'question': '❓ Question',
              'other': '📝 Autre'
            }
            const typeLabel = typeLabels[feedback.type] || '📝 Feedback'
            window.electronAPI.showNotification(
              `${typeLabel} - ${feedback.username}`,
              feedback.title || 'Nouveau feedback reçu'
            )
          }
        } else {
          // Plusieurs feedbacks
          const notificationBody = `Vous avez ${count} nouveau${count > 1 ? 'x' : ''} feedback${count > 1 ? 's' : ''}`
          
          // Notification système Windows/macOS via Electron
          if (window.electronAPI && window.electronAPI.showNotification) {
            window.electronAPI.showNotification('💬 Nouveaux Feedbacks', notificationBody)
          }
          
          // Notification overlay avec le premier feedback si disponible
          if (feedbacks.length > 0 && window.electronAPI && window.electronAPI.showOverlayNotification) {
            const feedback = feedbacks[0]
            window.electronAPI.showOverlayNotification(
              null,
              null,
              'feedback',
              feedback.type || 'other',
              feedback.username || 'Utilisateur',
              feedback.title || 'Sans titre',
              `${count} nouveau${count > 1 ? 'x' : ''} feedback${count > 1 ? 's' : ''}`
            )
          }
        }
        
        // Notification dans l'app
        const notificationBody = count === 1 
          ? `Nouveau feedback de ${feedbacks[0]?.username || 'un utilisateur'}`
          : `Vous avez ${count} nouveau${count > 1 ? 'x' : ''} feedback${count > 1 ? 's' : ''}`
        notificationService.info(notificationBody, 5000)
      } else if (result && result.last_check) {
        // Mettre à jour la dernière vérification même s'il n'y a pas de nouveaux feedbacks
        this.lastFeedbackCheck = result.last_check
      }
    } catch (error) {
      // Ignorer les erreurs silencieusement pour ne pas perturber l'utilisateur
      console.error('Erreur lors de la vérification des feedbacks:', error)
    }
  }
}

let app
document.addEventListener('DOMContentLoaded', () => {
  app = new BackHubApp();
});


