
let notificationElement = null
let closeButton = null
let feedbackCloseButton = null
let feedbackViewButton = null
let autoHideTimeout = null

function initOverlay() {
  notificationElement = document.getElementById('overlay-notification')
  closeButton = document.getElementById('overlay-close-btn')
  feedbackCloseButton = document.getElementById('overlay-feedback-close-btn')
  feedbackViewButton = document.getElementById('overlay-feedback-view-btn')

  if (closeButton) {
    closeButton.addEventListener('click', hideNotification)
  }

  if (feedbackCloseButton) {
    feedbackCloseButton.addEventListener('click', hideNotification)
  }

  if (feedbackViewButton) {
    feedbackViewButton.addEventListener('click', () => {

      if (window.electronAPI && window.electronAPI.openFeedbackSection) {
        window.electronAPI.openFeedbackSection()
      }
      hideNotification()
    })
  }


  if (window.electronAPI && window.electronAPI.onOverlayShow) {
    window.electronAPI.onOverlayShow((data) => {
      if (data.type === 'feedback') {
        showFeedbackNotification(data)
      } else {
        showNotification(data.title, data.message)
      }
    })
  }
}

function showNotification(title, message) {
  if (!notificationElement) {
    initOverlay()
  }


  const voteContent = document.getElementById('overlay-vote-content')
  const feedbackContent = document.getElementById('overlay-feedback-content')
  if (voteContent) voteContent.style.display = 'flex'
  if (feedbackContent) feedbackContent.style.display = 'none'


  const titleEl = notificationElement.querySelector('.overlay-notification-title')
  const messageEl = notificationElement.querySelector('.overlay-notification-message')

  if (titleEl) titleEl.textContent = title || 'Vote disponible !'
  if (messageEl) messageEl.textContent = message || 'Vous pouvez maintenant voter pour le serveur RevolutionDayZ'


  notificationElement.classList.remove('hiding')
  notificationElement.classList.add('show')


  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout)
  }


  autoHideTimeout = setTimeout(() => {
    hideNotification()
  }, 8000)
}

function showFeedbackNotification(data) {
  if (!notificationElement) {
    initOverlay()
  }


  const voteContent = document.getElementById('overlay-vote-content')
  const feedbackContent = document.getElementById('overlay-feedback-content')
  if (voteContent) voteContent.style.display = 'none'
  if (feedbackContent) feedbackContent.style.display = 'flex'


  const typeConfig = {
    'bug': { icon: '🐛', text: 'Bug', color: '#ef4444' },
    'suggestion': { icon: '💡', text: 'Suggestion', color: '#3b82f6' },
    'question': { icon: '❓', text: 'Question', color: '#f97316' },
    'other': { icon: '📝', text: 'Autre', color: '#6b7280' }
  }

  const config = typeConfig[data.feedbackType] || typeConfig['other']

  const iconEl = document.getElementById('overlay-feedback-icon')
  const badgeIconEl = document.getElementById('overlay-feedback-badge-icon')
  const badgeTextEl = document.getElementById('overlay-feedback-badge-text')
  const badgeEl = document.getElementById('overlay-feedback-badge')
  const authorEl = document.getElementById('overlay-feedback-author')
  const titleEl = document.getElementById('overlay-feedback-title')
  const descriptionEl = document.getElementById('overlay-feedback-description')

  if (iconEl) iconEl.textContent = config.icon
  if (badgeIconEl) badgeIconEl.textContent = config.icon
  if (badgeTextEl) badgeTextEl.textContent = config.text
  if (badgeEl) badgeEl.style.borderColor = config.color
  if (authorEl) authorEl.textContent = `De: ${data.username || 'Utilisateur'}`
  if (titleEl) titleEl.textContent = data.title || 'Sans titre'
  if (descriptionEl) {
    const desc = data.description || ''
    descriptionEl.textContent = desc.length > 100 ? desc.substring(0, 100) + '...' : desc
  }


  notificationElement.classList.remove('hiding')
  notificationElement.classList.add('show')


  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout)
  }


  autoHideTimeout = setTimeout(() => {
    hideNotification()
  }, 10000)
}

function hideNotification() {
  if (!notificationElement) return

  notificationElement.classList.remove('show')
  notificationElement.classList.add('hiding')

  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout)
    autoHideTimeout = null
  }


  setTimeout(() => {
    notificationElement.classList.remove('hiding')

    if (window.electronAPI && window.electronAPI.hideOverlay) {
      window.electronAPI.hideOverlay()
    }
  }, 300)
}


document.addEventListener('DOMContentLoaded', initOverlay)


window.showOverlayNotification = showNotification
window.showFeedbackNotification = showFeedbackNotification
window.hideOverlayNotification = hideNotification

