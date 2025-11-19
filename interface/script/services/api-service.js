/**
 * Service API pour communiquer avec le backend
 */

import { logger } from '../utils/logger.js'
import { API_CONFIG } from '../config/api-config.js'

class ApiService {
  constructor() {
    this.baseUrl = API_CONFIG.BASE_URL
    this.timeout = API_CONFIG.TIMEOUT
    this.debug = API_CONFIG.DEBUG
    this.currentUser = null
    // Restaurer le token sauvegardé au démarrage
    try {
      this.authToken = localStorage.getItem('authToken')
    } catch (error) {
      this.authToken = null
    }
  }

  /**
   * Effectuer une requête HTTP
   */
  async request(endpoint, options = {}) {
    const isAutoLogin = options._isAutoLogin || false
    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }

    // S'assurer que le token est à jour (restaurer depuis localStorage si nécessaire)
    if (!this.authToken) {
      const savedToken = this.getSavedToken()
      if (savedToken) {
        this.authToken = savedToken
        if (this.debug) {
          logger.info('Token restored from localStorage', { tokenLength: this.authToken.length })
        }
      }
    }

    // Ajouter le token d'authentification si disponible
    const method = options.method || 'GET'
    if (this.authToken && this.authToken.trim() !== '') {
      headers['Authorization'] = `Bearer ${this.authToken}`
      if (this.debug) {
        logger.info(`API Request with token: ${method} ${url}`, { hasToken: true, tokenLength: this.authToken.length })
      }
    } else {
      if (this.debug) {
        logger.warn(`API Request without token: ${method} ${url}`, { authToken: this.authToken })
      }
    }

    const config = {
      method,
      headers,
      ...options
    }

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body)
    }

    if (this.debug) {
      logger.info(`API Request: ${config.method} ${url}`, options.body || {})
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(url, {
        ...config,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const contentType = response.headers.get('content-type')
      let data = {}
      
      // Lire le texte de la réponse d'abord
      const text = await response.text()
      
      // Nettoyer le texte (enlever les warnings PHP éventuels au début)
      let cleanText = text.trim()
      
      // Si le texte commence par des warnings PHP, essayer de trouver le JSON
      if (cleanText && !cleanText.startsWith('{') && !cleanText.startsWith('[')) {
        // Chercher le premier { ou [ dans le texte
        const jsonStart = Math.max(
          cleanText.indexOf('{'),
          cleanText.indexOf('[')
        )
        if (jsonStart > 0) {
          cleanText = cleanText.substring(jsonStart)
          logger.warn('Removed leading text before JSON', { endpoint, removed: text.substring(0, jsonStart) })
        }
      }
      
      // Essayer de parser le JSON si le content-type indique JSON ou si le texte ressemble à du JSON
      if (contentType?.includes('application/json') || cleanText.startsWith('{') || cleanText.startsWith('[')) {
        if (cleanText) {
          try {
            data = JSON.parse(cleanText)
          } catch (parseError) {
            // Logger avec plus de détails
            logger.error('Failed to parse JSON response', parseError, { 
              endpoint, 
              text: cleanText.substring(0, 500), 
              originalText: text.substring(0, 500),
              status: response.status,
              contentType 
            }, false)
            // Si la réponse est OK mais le JSON est invalide, créer une erreur avec plus de détails
            if (response.ok) {
              const error = new Error('Réponse invalide du serveur')
              error.originalText = text.substring(0, 200)
              throw error
            }
            // Pour les erreurs HTTP, créer un objet d'erreur basique
            data = { 
              success: false,
              error: cleanText || text || `Erreur HTTP ${response.status}` 
            }
          }
        }
      } else if (cleanText) {
        // Si ce n'est pas du JSON mais qu'il y a du contenu, le traiter comme une erreur
        data = { 
          success: false,
          error: cleanText 
        }
      }

      if (!response.ok) {
        const errorMessage = data.error || data.message || `Erreur HTTP ${response.status}`
        
        // Gérer les erreurs 500 pour les endpoints optionnels (comme deletion-status)
        const isOptionalEndpoint = endpoint.includes('deletion-status')
        if (isOptionalEndpoint && response.status === 500) {
          // Pour les endpoints optionnels avec erreur 500, retourner null silencieusement
          if (this.debug) {
            logger.warn('Optional endpoint returned 500, ignoring', { endpoint })
          }
          return null
        }
        
        if (response.status === 401) {
          // Token expiré ou invalide (ou erreur de login)
          this.authToken = null
          this.currentUser = null
          localStorage.removeItem('savedCredentials')
          localStorage.removeItem('authToken')
          localStorage.removeItem('savedSession')
          // Si c'est une requête d'auto-login, ne pas lancer d'erreur pour éviter d'afficher le message
          if (isAutoLogin) {
            const error = new Error('Session expirée')
            error.isAutoLogin = true
            throw error
          }
          // Pour les erreurs de login, utiliser le message exact de l'API
          const loginError = new Error(errorMessage)
          loginError.status = 401
          loginError.data = data
          throw loginError
        }
        
        // Pour les erreurs 400, créer une erreur avec le message mais aussi inclure les données
        // pour que le code appelant puisse accéder au message d'erreur
        const error = new Error(errorMessage)
        error.status = response.status
        error.data = data // Inclure les données de la réponse pour accéder au message
        throw error
      }

      if (this.debug) {
        logger.info(`API Response: ${url}`, data)
      }

      return data
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('API request timeout', null, { endpoint }, false)
        throw new Error('La requête a pris trop de temps')
      }
      
      // Ne pas logger comme erreur critique pour les endpoints optionnels qui peuvent ne pas exister
      const isOptionalEndpoint = endpoint.includes('deletion-status')
      if (isOptionalEndpoint) {
        // Utiliser warn au lieu de error pour éviter les notifications inutiles
        logger.warn('API request failed (optional endpoint)', { endpoint, error: error.message })
      } else {
        // Logger sans notification automatique - les notifications doivent être gérées par le code appelant
        logger.error('API request failed', error, { endpoint, method: config.method }, false)
      }
      throw error
    }
  }

  /**
   * Authentification - Connexion
   */
  async login(username, password, rememberMe = false) {
    try {
      const result = await this.request('/auth.php?action=login', {
        method: 'POST',
        body: { username, password }
      })

      if (result.success) {
        this.currentUser = result.user
        // Créer un token basé sur l'ID utilisateur (compatible avec getUserIdFromToken)
        this.authToken = result.token || btoa(String(result.user.id))
        
        // Sauvegarder le token pour la session en cours (toujours)
        this.saveToken(this.authToken)
        
        if (this.debug) {
          logger.info('Login successful, token saved', { 
            hasToken: !!this.authToken, 
            tokenLength: this.authToken ? this.authToken.length : 0,
            userId: result.user.id 
          })
        }
        
        // Sauvegarder les credentials seulement si "remember me" est activé
        if (rememberMe) {
          this.saveCredentials(username, password)
        } else {
          this.clearCredentials()
        }
        
        return result.user
      } else {
        throw new Error(result.message || 'Échec de la connexion')
      }
    } catch (error) {
      logger.error('Login failed', error)
      throw error
    }
  }

  /**
   * Sauvegarder les credentials de manière sécurisée
   */
  saveCredentials(username, password) {
    try {
      // Encoder en base64 (pas vraiment sécurisé mais mieux que rien)
      const credentials = {
        username: btoa(username),
        password: btoa(password),
        timestamp: Date.now()
      }
      localStorage.setItem('savedCredentials', JSON.stringify(credentials))
    } catch (error) {
      logger.error('Failed to save credentials', error)
    }
  }

  /**
   * Récupérer les credentials sauvegardés
   */
  getSavedCredentials() {
    try {
      const saved = localStorage.getItem('savedCredentials')
      if (!saved) return null
      
      const credentials = JSON.parse(saved)
      // Vérifier que les credentials ne sont pas trop anciens (30 jours)
      const maxAge = 30 * 24 * 60 * 60 * 1000
      if (Date.now() - credentials.timestamp > maxAge) {
        this.clearCredentials()
        this.clearToken()
        return null
      }
      
      return {
        username: atob(credentials.username),
        password: atob(credentials.password)
      }
    } catch (error) {
      logger.error('Failed to get saved credentials', error)
      this.clearCredentials()
      return null
    }
  }

  /**
   * Supprimer les credentials sauvegardés
   */
  clearCredentials() {
    localStorage.removeItem('savedCredentials')
  }

  /**
   * Sauvegarder le token d'authentification
   */
  saveToken(token) {
    try {
      localStorage.setItem('authToken', token)
    } catch (error) {
      logger.error('Failed to save token', error)
    }
  }

  /**
   * Récupérer le token d'authentification sauvegardé
   */
  getSavedToken() {
    try {
      return localStorage.getItem('authToken')
    } catch (error) {
      logger.error('Failed to get saved token', error)
      return null
    }
  }

  /**
   * Supprimer le token sauvegardé
   */
  clearToken() {
    try {
      localStorage.removeItem('authToken')
    } catch (error) {
      logger.error('Failed to clear token', error)
    }
  }

  /**
   * Vérifier si l'utilisateur peut se reconnecter automatiquement
   */
  async tryAutoLogin() {
    // D'abord, essayer de restaurer le token sauvegardé
    const savedToken = this.getSavedToken()
    if (savedToken) {
      this.authToken = savedToken
      // Essayer de récupérer l'ID utilisateur depuis le token
      try {
        const decoded = atob(savedToken)
        const userId = parseInt(decoded)
        if (userId && !isNaN(userId)) {
          // Vérifier que l'utilisateur existe toujours en testant une requête simple
          // On utilise getUserPrices qui est accessible à tous les utilisateurs
          try {
            await this.request(`/prices.php?action=get&user_id=${userId}`, { _isAutoLogin: true })
            // Si la requête réussit, récupérer les infos utilisateur depuis savedSession
            const savedSession = localStorage.getItem('savedSession')
            if (savedSession) {
              try {
                const sessionData = JSON.parse(savedSession)
                if (sessionData.userId === userId) {
                  this.currentUser = {
                    id: sessionData.userId,
                    username: sessionData.username,
                    role: sessionData.role
                  }
                  return this.currentUser
                }
              } catch (e) {
              }
            }
          } catch (e) {
            this.clearToken()
            localStorage.removeItem('savedSession')
          }
        }
      } catch (e) {
        this.clearToken()
        localStorage.removeItem('savedSession')
      }
    }
    
    const credentials = this.getSavedCredentials()
    if (!credentials) {
      this.clearToken()
      localStorage.removeItem('savedSession')
      return null
    }
    
    try {
      // Faire une connexion sans sauvegarder à nouveau (déjà sauvegardé)
      const result = await this.request('/auth.php?action=login', {
        method: 'POST',
        body: { username: credentials.username, password: credentials.password },
        _isAutoLogin: true
      })

      if (result.success) {
        this.currentUser = result.user
        // Créer un token basé sur l'ID utilisateur
        this.authToken = result.token || btoa(String(result.user.id))
        // Sauvegarder le nouveau token
        this.saveToken(this.authToken)
        return result.user
      } else {
        // Si la connexion échoue, supprimer les credentials et le token
        this.clearCredentials()
        this.clearToken()
        localStorage.removeItem('savedSession')
        return null
      }
    } catch (error) {
      // Si la connexion échoue (401 ou autre), supprimer les credentials et le token
      this.clearCredentials()
      this.clearToken()
      localStorage.removeItem('savedSession')
      // Ne pas propager l'erreur pour éviter d'afficher le message à l'utilisateur
      return null
    }
  }

  /**
   * Authentification - Inscription
   */
  async register(username, password, role = 'user') {
    try {
      const result = await this.request('/auth.php?action=register', {
        method: 'POST',
        body: { username, password, role }
      })

      if (result.success) {
        return result.user
      } else {
        throw new Error(result.message || 'Échec de l\'inscription')
      }
    } catch (error) {
      logger.error('Register failed', error)
      throw error
    }
  }

  /**
   * Obtenir tous les utilisateurs (admin seulement)
   */
  async getAllUsers() {
    try {
      const result = await this.request('/auth.php?action=users')
      
      // La réponse peut être directement un tableau ou un objet avec une propriété users
      if (Array.isArray(result)) {
        return result
      } else if (result && result.users && Array.isArray(result.users)) {
        return result.users
      } else if (result && result.success && Array.isArray(result.users)) {
        return result.users
      } else {
        logger.warn('Unexpected response format from getAllUsers:', result)
        return []
      }
    } catch (error) {
      logger.error('Get users failed', error)
      throw error
    }
  }

  /**
   * Mettre à jour le mot de passe d'un utilisateur (admin seulement)
   */
  async updateUserPassword(adminId, userId, newPassword) {
    try {
      const result = await this.request('/auth.php?action=update-password', {
        method: 'POST',
        body: {
          admin_id: adminId,
          user_id: userId,
          password: newPassword
        }
      })

      if (result.success) {
        return result
      } else {
        throw new Error(result.message || 'Échec de la mise à jour du mot de passe')
      }
    } catch (error) {
      logger.error('Update user password failed', error)
      throw error
    }
  }

  /**
   * Mettre à jour un utilisateur (admin seulement)
   */
  async updateUser(adminId, userId, username, role, password = null) {
    try {
      const result = await this.request('/auth.php?action=update-user', {
        method: 'POST',
        body: {
          admin_id: adminId,
          user_id: userId,
          username: username,
          role: role,
          password: password
        }
      })

      if (result.success) {
        return result
      } else {
        throw new Error(result.message || 'Échec de la mise à jour de l\'utilisateur')
      }
    } catch (error) {
      logger.error('Update user failed', error)
      throw error
    }
  }

  /**
   * Supprimer un utilisateur (développeur seulement, ou admin pour les non-développeurs)
   */
  async deleteUser(userId) {
    try {
      const result = await this.request(`/auth.php?action=delete-user&user_id=${userId}`, {
        method: 'DELETE'
      })
      return result
    } catch (error) {
      logger.error('Delete user failed', error)
      throw error
    }
  }

  /**
   * Obtenir les prix d'un utilisateur
   */
  async getUserPrices(userId) {
    try {
      const result = await this.request(`/prices.php?user_id=${userId}`)
      return result.prices || {}
    } catch (error) {
      logger.error('Get user prices failed', error)
      // Retourner un objet vide en cas d'erreur
      return {}
    }
  }

  /**
   * Sauvegarder un prix
   */
  async savePrice(userId, category, itemName, buyPrice) {
    try {
      const result = await this.request('/prices.php', {
        method: 'POST',
        body: {
          user_id: userId,
          category: category,
          item_name: itemName,
          buy_price: buyPrice
        }
      })

      return result
    } catch (error) {
      logger.error('Save price failed', error)
      throw error
    }
  }

  /**
   * Obtenir les statistiques globales des prix (admin seulement)
   */
  async getGlobalPriceStats(userId) {
    try {
      const result = await this.request(`/prices.php?action=stats&user_id=${userId}`)
      return result.stats || []
    } catch (error) {
      logger.error('Get global price stats failed', error)
      throw error
    }
  }

  /**
   * Obtenir l'historique des transactions d'un utilisateur
   */
  async getUserHistory(userId, limit = 100) {
    try {
      const result = await this.request(`/transactions.php?action=list&user_id=${userId}&limit=${limit}`)
      if (!result) {
        logger.warn('getUserHistory: Empty result from API', { userId, limit })
        return []
      }
      if (!result.success) {
        logger.warn('getUserHistory: API returned success=false', { userId, limit, result })
        return []
      }
      return result.transactions || []
    } catch (error) {
      // Logger sans notification automatique - la gestion des erreurs se fait dans loadUserDataFromApi
      logger.error('Get user history failed', error, { userId, limit }, false)
      throw error
    }
  }

  /**
   * Sauvegarder une transaction
   */
  async saveTransaction(userId, transaction) {
    try {
      const result = await this.request('/transactions.php?action=create', {
        method: 'POST',
        body: {
          items: transaction.items,
          totalBuy: transaction.totalBuy,
          totalSell: transaction.totalSell,
          date: transaction.date || new Date().toISOString(),
          seller: transaction.seller || ''
        }
      })

      return result
    } catch (error) {
      // Logger sans notification - la notification sera gérée par le code appelant
      logger.error('Save transaction failed', error, {}, false)
      throw error
    }
  }

  /**
   * Obtenir toutes les transactions (admin seulement)
   */
  async getAllTransactions(userId, limit = 500) {
    try {
      const result = await this.request(`/transactions.php?action=all&user_id=${userId}&limit=${limit}`)
      return result.transactions || []
    } catch (error) {
      logger.error('Get all transactions failed', error)
      throw error
    }
  }

  /**
   * Supprimer une transaction
   */
  async deleteTransaction(transactionId) {
    try {
      const result = await this.request(`/transactions.php?action=delete&transaction_id=${transactionId}`, {
        method: 'DELETE'
      })
      // Vérifier que le résultat est valide
      if (!result) {
        throw new Error('Réponse vide du serveur')
      }
      return result
    } catch (error) {
      // Logger sans notification - la notification sera gérée par le code appelant
      logger.error('Delete transaction failed', error, { transactionId }, false)
      throw error
    }
  }

  /**
   * Obtenir les statistiques globales (admin seulement)
   */
  async getGlobalStats(userId) {
    try {
      const result = await this.request(`/transactions.php?action=stats&user_id=${userId}`)
      return result.stats || {}
    } catch (error) {
      logger.error('Get global stats failed', error)
      throw error
    }
  }

  /**
   * Définir l'utilisateur actuel
   */
  setCurrentUser(user) {
    this.currentUser = user
  }

  /**
   * Obtenir l'utilisateur actuel
   */
  getCurrentUser() {
    return this.currentUser
  }

  /**
   * Déconnexion
   */
  logout() {
    this.currentUser = null
    this.authToken = null
    this.clearCredentials()
    this.clearToken()
  }

  /**
   * Changer le mot de passe de l'utilisateur actuel
   */
  async changeOwnPassword(userId, currentPassword, newPassword) {
    try {
      const result = await this.request('/auth.php?action=change-own-password', {
        method: 'POST',
        body: {
          user_id: userId,
          current_password: currentPassword,
          new_password: newPassword
        }
      })
      return result
    } catch (error) {
      // Ne pas logger comme erreur critique pour éviter les notifications automatiques
      // L'erreur sera gérée dans handleChangePassword avec un message approprié
      if (this.debug) {
        logger.warn('Change password failed', error)
      }
      throw error
    }
  }

  /**
   * Demander la suppression du compte
   */
  async requestAccountDeletion(userId) {
    try {
      const result = await this.request('/auth.php?action=request-deletion', {
        method: 'POST',
        body: {
          user_id: userId
        }
      })
      return result
    } catch (error) {
      logger.error('Request account deletion failed', error)
      throw error
    }
  }

  /**
   * Annuler la suppression du compte
   */
  async cancelAccountDeletion(userId) {
    try {
      const result = await this.request('/auth.php?action=cancel-deletion', {
        method: 'POST',
        body: {
          user_id: userId
        }
      })
      return result
    } catch (error) {
      logger.error('Cancel account deletion failed', error)
      throw error
    }
  }

  /**
   * Obtenir le statut de suppression du compte
   * Endpoint optionnel - ignore silencieusement les erreurs
   */
  async getDeletionStatus(userId) {
    try {
      return await this.request(`/auth.php?action=deletion-status&user_id=${userId}`)
    } catch (error) {
      // Ignorer silencieusement toutes les erreurs pour cet endpoint optionnel
      return null
    }
  }

  /**
   * Créer un clan
   */
  async createClan(clanName) {
    try {
      const result = await this.request('/clans.php?action=create', {
        method: 'POST',
        body: { name: clanName }
      })
      return result
    } catch (error) {
      logger.error('Create clan failed', error)
      throw error
    }
  }

  /**
   * Rejoindre un clan avec une clé d'invitation
   */
  async joinClan(invitationKey) {
    try {
      const result = await this.request('/clans.php?action=join', {
        method: 'POST',
        body: { invitation_key: invitationKey }
      })
      return result
    } catch (error) {
      logger.error('Join clan failed', error)
      throw error
    }
  }

  /**
   * Obtenir le clan de l'utilisateur actuel
   */
  async getMyClan() {
    try {
      const result = await this.request('/clans.php?action=my-clan')
      return result.clan || null
    } catch (error) {
      logger.error('Get my clan failed', error)
      return null
    }
  }

  /**
   * Obtenir les membres d'un clan
   */
  async getClanMembers(clanId) {
    try {
      const result = await this.request(`/clans.php?action=members&clan_id=${clanId}`)
      return result.members || []
    } catch (error) {
      logger.error('Get clan members failed', error)
      return []
    }
  }

  /**
   * Obtenir tous les clans
   */
  async getAllClans() {
    try {
      const result = await this.request('/clans.php?action=all')
      return result.clans || []
    } catch (error) {
      logger.error('Get all clans failed', error)
      return []
    }
  }

  /**
   * Retirer un membre d'un clan
   */
  async removeClanMember(clanId, memberId) {
    try {
      const result = await this.request('/clans.php?action=remove-member', {
        method: 'POST',
        body: { clan_id: clanId, member_id: memberId }
      })
      return result
    } catch (error) {
      logger.error('Remove clan member failed', error)
      throw error
    }
  }

  /**
   * Quitter un clan
   */
  async leaveClan(clanId) {
    try {
      const result = await this.request('/clans.php?action=leave', {
        method: 'POST',
        body: { clan_id: clanId }
      })
      return result
    } catch (error) {
      logger.error('Leave clan failed', error)
      throw error
    }
  }

  /**
   * Transférer la propriété d'un clan
   */
  async transferClanOwnership(clanId, newOwnerId) {
    try {
      const result = await this.request('/clans.php?action=transfer-ownership', {
        method: 'POST',
        body: { clan_id: clanId, new_owner_id: newOwnerId }
      })
      return result
    } catch (error) {
      logger.error('Transfer ownership failed', error)
      throw error
    }
  }

  /**
   * Supprimer un clan
   */
  async deleteClan(clanId) {
    try {
      const result = await this.request('/clans.php?action=delete', {
        method: 'POST',
        body: { clan_id: clanId }
      })
      return result
    } catch (error) {
      logger.error('Delete clan failed', error)
      throw error
    }
  }

  /**
   * Envoyer un feedback (bug, suggestion, etc.)
   */
  async submitFeedback(type, title, description, attachmentFile = null) {
    try {
      const url = `${this.baseUrl}/feedback.php?action=submit`
      
      // Si un fichier est présent, utiliser FormData
      if (attachmentFile) {
        const formData = new FormData()
        formData.append('type', type)
        formData.append('title', title)
        formData.append('description', description)
        formData.append('attachment', attachmentFile)

        const headers = {}
        if (this.authToken) {
          headers['Authorization'] = `Bearer ${this.authToken}`
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        const contentType = response.headers.get('content-type')
        let data = {}
        
        if (contentType?.includes('application/json')) {
          const text = await response.text()
          if (text) {
            try {
              data = JSON.parse(text)
            } catch (parseError) {
              logger.error('Failed to parse JSON response', null, { url, text }, false)
              throw new Error('Réponse invalide du serveur')
            }
          }
        }

        if (!response.ok) {
          const errorMessage = data.error || data.message || `Erreur HTTP ${response.status}`
          
          if (response.status === 401) {
            this.authToken = null
            this.currentUser = null
            localStorage.removeItem('savedCredentials')
            throw new Error('Session expirée. Veuillez vous reconnecter.')
          }
          
          const error = new Error(errorMessage)
          error.status = response.status
          error.data = data
          throw error
        }

        return data
      } else {
        // Sinon, utiliser JSON comme avant
        const result = await this.request('/feedback.php?action=submit', {
          method: 'POST',
          body: {
            type,
            title,
            description
          }
        })
        return result
      }
    } catch (error) {
      logger.error('Submit feedback failed', error)
      throw error
    }
  }

  /**
   * Récupérer les feedbacks de l'utilisateur actuel
   */
  async getMyFeedbacks() {
    try {
      const result = await this.request('/feedback.php?action=my-feedbacks')
      return result
    } catch (error) {
      logger.error('Get my feedbacks failed', error)
      throw error
    }
  }

  /**
   * Récupérer tous les feedbacks (admin seulement)
   */
  async getAllFeedbacks(status = '', type = '', limit = 50, offset = 0) {
    try {
      const params = new URLSearchParams()
      if (status) params.append('status', status)
      if (type) params.append('type', type)
      params.append('limit', limit)
      params.append('offset', offset)

      const result = await this.request(`/feedback.php?action=list&${params.toString()}`)
      return result
    } catch (error) {
      logger.error('Get all feedbacks failed', error)
      throw error
    }
  }

  /**
   * Mettre à jour le statut d'un feedback (admin seulement)
   */
  async updateFeedbackStatus(feedbackId, status, response = '') {
    try {
      const result = await this.request('/feedback.php?action=update-status', {
        method: 'POST',
        body: {
          feedback_id: feedbackId,
          status,
          response
        }
      })
      return result
    } catch (error) {
      logger.error('Update feedback status failed', error)
      throw error
    }
  }

  /**
   * Supprimer un feedback (admin seulement)
   */
  async deleteFeedback(feedbackId) {
    try {
      const result = await this.request(`/feedback.php?action=delete&feedback_id=${feedbackId}`, {
        method: 'DELETE'
      })
      return result
    } catch (error) {
      logger.error('Delete feedback failed', error)
      throw error
    }
  }

  /**
   * Vérifier les nouveaux feedbacks (développeur seulement)
   */
  async checkNewFeedbacks(lastCheck) {
    try {
      const encodedLastCheck = encodeURIComponent(lastCheck)
      const result = await this.request(`/feedback.php?action=check-new&last_check=${encodedLastCheck}`, {
        method: 'GET'
      })
      return result
    } catch (error) {
      logger.error('Check new feedbacks failed', error)
      throw error
    }
  }

  /**
   * Supprimer toutes les transactions (admin seulement)
   */
  async deleteAllTransactions() {
    try {
      const result = await this.request('/transactions.php?action=delete-all', {
        method: 'DELETE'
      })
      return result
    } catch (error) {
      logger.error('Delete all transactions failed', error)
      throw error
    }
  }

  /**
   * Supprimer toutes les transactions d'un utilisateur
   */
  async deleteUserTransactions(userId) {
    try {
      const result = await this.request(`/transactions.php?action=delete-user&user_id=${userId}`, {
        method: 'DELETE'
      })
      return result
    } catch (error) {
      logger.error('Delete user transactions failed', error)
      throw error
    }
  }

  /**
   * Récupérer le cooldown de vote directement depuis Top Serveurs
   */
  async getVoteCooldown() {
    try {
      // Récupérer directement le HTML de la page de vote Top Serveurs via Electron
      const voteUrl = 'https://top-serveurs.net/dayz/vote/fr-revolutiondayz-beta'
      
      // Utiliser l'API Electron pour récupérer le HTML (contourne les restrictions CORS)
      if (!window.electronAPI || !window.electronAPI.fetchHtml) {
        logger.error('Electron API not available for fetching HTML')
        throw new Error('Electron API not available')
      }
      
      // Le handler Electron retourne directement les données JSON avec le cooldown
      const cooldownData = await window.electronAPI.fetchHtml(voteUrl)
      
      // Le handler retourne déjà un objet JSON avec success, available, remainingMs, etc.
      if (cooldownData && cooldownData.success !== undefined) {
        logger.info('Cooldown data received:', cooldownData)
        return cooldownData
      }
      
      // Fallback si le format n'est pas celui attendu
      logger.warn('Unexpected response format from Electron handler:', cooldownData)
      return {
        success: true,
        available: true,
        remainingMs: 0
      }
    } catch (error) {
      logger.error('Get vote cooldown failed', error)
      // En cas d'erreur, retourner une erreur
      throw error
    }
  }
}

export const apiService = new ApiService()

