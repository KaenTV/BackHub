

import { logger } from '../utils/logger.js'
import { API_CONFIG } from '../config/api-config.js'

class ApiService {
  constructor() {
    this.baseUrl = API_CONFIG.BASE_URL
    this.timeout = API_CONFIG.TIMEOUT
    this.debug = API_CONFIG.DEBUG
    this.currentUser = null

    try {
      this.authToken = localStorage.getItem('authToken')
    } catch (error) {
      this.authToken = null
    }
  }


  async request(endpoint, options = {}) {
    const isAutoLogin = options._isAutoLogin || false
    const skipAuth = options.skipAuth || false
    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }


    if (!skipAuth && !this.authToken) {
      const savedToken = this.getSavedToken()
      if (savedToken) {
        this.authToken = savedToken
        if (this.debug) {
          logger.info('Token restored from localStorage', { tokenLength: this.authToken.length })
        }
      }
    }


    const method = options.method || 'GET'
    if (!skipAuth && this.authToken && this.authToken.trim() !== '') {
      headers['Authorization'] = `Bearer ${this.authToken}`
      if (this.debug) {
        logger.info(`API Request with token: ${method} ${url}`, { hasToken: true, tokenLength: this.authToken.length })
      }
    } else {
      if (this.debug) {
        logger.warn(`API Request without token: ${method} ${url}`, { authToken: this.authToken, skipAuth })
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


      const text = await response.text()


      let cleanText = text.trim()


      if (cleanText && !cleanText.startsWith('{') && !cleanText.startsWith('[')) {

        const jsonStart = Math.max(
          cleanText.indexOf('{'),
          cleanText.indexOf('[')
        )
        if (jsonStart > 0) {
          cleanText = cleanText.substring(jsonStart)
          logger.warn('Removed leading text before JSON', { endpoint, removed: text.substring(0, jsonStart) })
        }
      }


      if (contentType?.includes('application/json') || cleanText.startsWith('{') || cleanText.startsWith('[')) {
        if (cleanText) {
          try {
            data = JSON.parse(cleanText)
          } catch (parseError) {

            logger.error('Failed to parse JSON response', parseError, {
              endpoint,
              text: cleanText.substring(0, 500),
              originalText: text.substring(0, 500),
              status: response.status,
              contentType
            }, false)

            if (response.ok) {
              const error = new Error('Réponse invalide du serveur')
              error.originalText = text.substring(0, 200)
              throw error
            }

            data = {
              success: false,
              error: cleanText || text || `Erreur HTTP ${response.status}`
            }
          }
        }
      } else if (cleanText) {

        data = {
          success: false,
          error: cleanText
        }
      }

      if (!response.ok) {
        const errorMessage = data.error || data.message || `Erreur HTTP ${response.status}`


        const isOptionalEndpoint = endpoint.includes('deletion-status')
        if (isOptionalEndpoint && response.status === 500) {

          if (this.debug) {
            logger.warn('Optional endpoint returned 500, ignoring', { endpoint })
          }
          return null
        }

        if (response.status === 401) {

          this.authToken = null
          this.currentUser = null
          localStorage.removeItem('savedCredentials')
          localStorage.removeItem('authToken')
          localStorage.removeItem('savedSession')

          if (isAutoLogin) {
            const error = new Error('Session expirée')
            error.isAutoLogin = true
            throw error
          }

          const loginError = new Error(errorMessage)
          loginError.status = 401
          loginError.data = data
          throw loginError
        }



        const error = new Error(errorMessage)
        error.status = response.status
        error.data = data
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


      const isOptionalEndpoint = endpoint.includes('deletion-status')
      if (isOptionalEndpoint) {

        logger.warn('API request failed (optional endpoint)', { endpoint, error: error.message })
      } else {

        logger.error('API request failed', error, { endpoint, method: config.method }, false)
      }
      throw error
    }
  }


  async login(username, password, rememberMe = false) {
    try {
      const result = await this.request('/auth.php?action=login', {
        method: 'POST',
        body: { username, password },
        skipAuth: true
      })

      if (result.success) {
        this.currentUser = result.user

        this.authToken = result.token || btoa(String(result.user.id))


        this.saveToken(this.authToken)

        if (this.debug) {
          logger.info('Login successful, token saved', {
            hasToken: !!this.authToken,
            tokenLength: this.authToken ? this.authToken.length : 0,
            userId: result.user.id
          })
        }


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


  saveCredentials(username, password) {
    try {

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


  getSavedCredentials() {
    try {
      const saved = localStorage.getItem('savedCredentials')
      if (!saved) return null

      const credentials = JSON.parse(saved)

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


  clearCredentials() {
    localStorage.removeItem('savedCredentials')
  }


  saveToken(token) {
    try {
      localStorage.setItem('authToken', token)
    } catch (error) {
      logger.error('Failed to save token', error)
    }
  }


  getSavedToken() {
    try {
      return localStorage.getItem('authToken')
    } catch (error) {
      logger.error('Failed to get saved token', error)
      return null
    }
  }


  clearToken() {
    try {
      localStorage.removeItem('authToken')
    } catch (error) {
      logger.error('Failed to clear token', error)
    }
  }


  async tryAutoLogin() {

    const savedToken = this.getSavedToken()
    if (savedToken) {
      this.authToken = savedToken

      try {
        const decoded = atob(savedToken)
        const userId = parseInt(decoded)
        if (userId && !isNaN(userId)) {


          try {
            await this.request(`/prices.php?action=get&user_id=${userId}`, { _isAutoLogin: true })

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

      const result = await this.request('/auth.php?action=login', {
        method: 'POST',
        body: { username: credentials.username, password: credentials.password },
        _isAutoLogin: true,
        skipAuth: true
      })

      if (result.success) {
        this.currentUser = result.user

        this.authToken = result.token || btoa(String(result.user.id))

        this.saveToken(this.authToken)
        return result.user
      } else {

        this.clearCredentials()
        this.clearToken()
        localStorage.removeItem('savedSession')
        return null
      }
    } catch (error) {

      this.clearCredentials()
      this.clearToken()
      localStorage.removeItem('savedSession')

      return null
    }
  }


  async register(username, password, role = 'user') {
    try {
      const result = await this.request('/auth.php?action=register', {
        method: 'POST',
        body: { username, password, role },
        skipAuth: true
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


  async getAllUsers() {
    try {
      const result = await this.request('/auth.php?action=users')


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


  async getUserPrices(userId) {
    try {
      const result = await this.request(`/prices.php?user_id=${userId}`)
      return result.prices || {}
    } catch (error) {
      logger.error('Get user prices failed', error)

      return {}
    }
  }


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


  async getGlobalPriceStats(userId) {
    try {
      const result = await this.request(`/prices.php?action=stats&user_id=${userId}`)
      return result.stats || []
    } catch (error) {
      logger.error('Get global price stats failed', error)
      throw error
    }
  }


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

      logger.error('Get user history failed', error, { userId, limit }, false)
      throw error
    }
  }


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

      logger.error('Save transaction failed', error, {}, false)
      throw error
    }
  }


  async getAllTransactions(userId, limit = 500) {
    try {
      const result = await this.request(`/transactions.php?action=all&user_id=${userId}&limit=${limit}`)
      return result.transactions || []
    } catch (error) {
      logger.error('Get all transactions failed', error)
      throw error
    }
  }


  async deleteTransaction(transactionId) {
    try {
      const result = await this.request(`/transactions.php?action=delete&transaction_id=${transactionId}`, {
        method: 'DELETE'
      })

      if (!result) {
        throw new Error('Réponse vide du serveur')
      }
      return result
    } catch (error) {

      logger.error('Delete transaction failed', error, { transactionId }, false)
      throw error
    }
  }


  async getGlobalStats(userId) {
    try {
      const result = await this.request(`/transactions.php?action=stats&user_id=${userId}`)
      return result.stats || {}
    } catch (error) {
      logger.error('Get global stats failed', error)
      throw error
    }
  }


  setCurrentUser(user) {
    this.currentUser = user
  }


  getCurrentUser() {
    return this.currentUser
  }


  logout() {
    this.currentUser = null
    this.authToken = null
    this.clearCredentials()
    this.clearToken()
  }


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


      if (this.debug) {
        logger.warn('Change password failed', error)
      }
      throw error
    }
  }


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


  async getDeletionStatus(userId) {
    try {
      return await this.request(`/auth.php?action=deletion-status&user_id=${userId}`)
    } catch (error) {

      return null
    }
  }


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


  async getMyClan() {
    try {
      const result = await this.request('/clans.php?action=my-clan')
      return result.clan || null
    } catch (error) {
      logger.error('Get my clan failed', error)
      return null
    }
  }


  async getClanMembers(clanId) {
    try {
      const result = await this.request(`/clans.php?action=members&clan_id=${clanId}`)
      return result.members || []
    } catch (error) {
      logger.error('Get clan members failed', error)
      return []
    }
  }


  async getAllClans() {
    try {
      const result = await this.request('/clans.php?action=all')
      return result.clans || []
    } catch (error) {
      logger.error('Get all clans failed', error)
      return []
    }
  }


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


  async submitFeedback(type, title, description, attachmentFile = null) {
    try {
      const url = `${this.baseUrl}/feedback.php?action=submit`


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


  async getMyFeedbacks() {
    try {
      const result = await this.request('/feedback.php?action=my-feedbacks')
      return result
    } catch (error) {
      logger.error('Get my feedbacks failed', error)
      throw error
    }
  }


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


  async getVoteCooldown() {
    try {

      const voteUrl = 'https://top-serveurs.net/dayz/vote/fr-revolutiondayz-beta'


      if (!window.electronAPI || !window.electronAPI.fetchHtml) {
        logger.error('Electron API not available for fetching HTML')
        throw new Error('Electron API not available')
      }


      const cooldownData = await window.electronAPI.fetchHtml(voteUrl)


      if (cooldownData && cooldownData.success !== undefined) {
        logger.info('Cooldown data received:', cooldownData)
        return cooldownData
      }


      logger.warn('Unexpected response format from Electron handler:', cooldownData)
      return {
        success: true,
        available: true,
        remainingMs: 0
      }
    } catch (error) {
      logger.error('Get vote cooldown failed', error)

      throw error
    }
  }
}

export const apiService = new ApiService()

