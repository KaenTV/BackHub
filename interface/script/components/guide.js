
import { storageService } from '../services/storage-service.js'
import { notificationService } from '../services/notification-service.js'

class InteractiveGuide {
  constructor() {
    this.currentStep = 0
    this.steps = [
      {
        title: 'Bienvenue dans BackHub !',
        content: 'Ce guide vous aidera à découvrir les fonctionnalités principales.',
        target: null,
        position: 'center'
      },
      {
        title: 'Calculateur de Marge',
        content: 'Utilisez le calculateur pour calculer les marges de profit sur vos transactions.',
        target: '[data-view="calculator"]',
        position: 'right'
      },
      {
        title: 'Sélection d\'Items',
        content: 'Entrez les quantités dans les champs numériques pour calculer automatiquement les totaux.',
        target: '.drug-quantity-input, .armes-quantity-input',
        position: 'bottom'
      },
      {
        title: 'Sauvegarde',
        content: 'Cliquez sur "Sauvegarder la transaction" pour enregistrer dans l\'historique.',
        target: '#save-selection-btn',
        position: 'left'
      },
      {
        title: 'Historique',
        content: 'Consultez toutes vos transactions passées dans la section Historique.',
        target: '[data-view="history"]',
        position: 'right'
      }
    ]
  }

  async shouldShow() {
    const shown = await storageService.load('backhub-guide-shown', false)
    return !shown
  }

  async start() {
    if (!(await this.shouldShow())) return


    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve)
      })
    }


    await new Promise(resolve => setTimeout(resolve, 500))

    this.currentStep = 0
    this.showStep(this.currentStep)
  }

  showStep(step) {
    if (step >= this.steps.length) {
      this.complete().catch(() => {})
      return
    }

    const stepData = this.steps[step]
    this.createOverlay(stepData, step)
  }

  createOverlay(stepData, stepIndex) {
    const existing = document.getElementById('guide-overlay')
    if (existing) existing.remove()

    const overlay = document.createElement('div')
    overlay.id = 'guide-overlay'
    overlay.className = 'guide-overlay'

    const highlight = document.createElement('div')
    highlight.className = 'guide-highlight'

    const tooltip = document.createElement('div')
    tooltip.className = `guide-tooltip guide-tooltip-${stepData.position}`


    const closeBtn = document.createElement('button')
    closeBtn.className = 'guide-close'
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.skip())

    const prevBtn = stepIndex > 0 ? document.createElement('button') : null
    if (prevBtn) {
      prevBtn.className = 'guide-btn guide-btn-secondary'
      prevBtn.textContent = 'Précédent'
      prevBtn.addEventListener('click', () => this.previous())
    }

    const nextBtn = document.createElement('button')
    nextBtn.className = 'guide-btn guide-btn-primary'
    nextBtn.textContent = stepIndex === this.steps.length - 1 ? 'Terminer' : 'Suivant'
    nextBtn.addEventListener('click', () => {
      if (stepIndex === this.steps.length - 1) {
        this.complete().catch(() => {})
      } else {
        this.next()
      }
    })

    tooltip.innerHTML = `
      <div class="guide-header">
        <h3>${stepData.title}</h3>
      </div>
      <div class="guide-content">${stepData.content}</div>
      <div class="guide-footer">
        <div class="guide-progress">${stepIndex + 1} / ${this.steps.length}</div>
        <div class="guide-actions"></div>
      </div>
    `

    const header = tooltip.querySelector('.guide-header')
    header.appendChild(closeBtn)

    const actions = tooltip.querySelector('.guide-actions')
    if (prevBtn) actions.appendChild(prevBtn)
    actions.appendChild(nextBtn)

    overlay.appendChild(highlight)
    overlay.appendChild(tooltip)
    document.body.appendChild(overlay)


    requestAnimationFrame(() => {
      if (stepData.target) {
        const target = document.querySelector(stepData.target)
        if (target) {

          target.scrollIntoView({ behavior: 'smooth', block: 'center' })

          setTimeout(() => {
            const rect = target.getBoundingClientRect()
            highlight.style.top = `${rect.top}px`
            highlight.style.left = `${rect.left}px`
            highlight.style.width = `${rect.width}px`
            highlight.style.height = `${rect.height}px`

            this.positionTooltip(tooltip, rect, stepData.position)
          }, 300)
        } else {

          tooltip.style.top = '50%'
          tooltip.style.left = '50%'
          tooltip.style.transform = 'translate(-50%, -50%)'
        }
      } else {
        tooltip.style.top = '50%'
        tooltip.style.left = '50%'
        tooltip.style.transform = 'translate(-50%, -50%)'
      }
    })
  }

  positionTooltip(tooltip, rect, position) {
    const tooltipRect = tooltip.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const padding = 20

    let top, left, transform

    switch (position) {
      case 'top':
        top = rect.top - tooltipRect.height - padding
        left = rect.left + (rect.width / 2)
        transform = 'translateX(-50%)'

        if (top < 0) {
          top = rect.bottom + padding
          position = 'bottom'
        }
        break
      case 'bottom':
        top = rect.bottom + padding
        left = rect.left + (rect.width / 2)
        transform = 'translateX(-50%)'

        if (top + tooltipRect.height > viewportHeight) {
          top = rect.top - tooltipRect.height - padding
          position = 'top'
        }
        break
      case 'left':
        top = rect.top + (rect.height / 2)
        left = rect.left - tooltipRect.width - padding
        transform = 'translateY(-50%)'

        if (left < 0) {
          left = rect.right + padding
          position = 'right'
        }
        break
      case 'right':
        top = rect.top + (rect.height / 2)
        left = rect.right + padding
        transform = 'translateY(-50%)'

        if (left + tooltipRect.width > viewportWidth) {
          left = rect.left - tooltipRect.width - padding
          position = 'left'
        }
        break
      default:
        top = rect.top + (rect.height / 2)
        left = rect.left + (rect.width / 2)
        transform = 'translate(-50%, -50%)'
    }


    top = Math.max(padding, Math.min(top, viewportHeight - tooltipRect.height - padding))
    left = Math.max(padding, Math.min(left, viewportWidth - tooltipRect.width - padding))

    tooltip.style.top = `${top}px`
    tooltip.style.left = `${left}px`
    tooltip.style.transform = transform
  }

  next() {
    this.currentStep++
    this.showStep(this.currentStep)
  }

  previous() {
    if (this.currentStep > 0) {
      this.currentStep--
      this.showStep(this.currentStep)
    }
  }

  skip() {
    this.complete().catch(() => {})
  }

  async complete() {
    const overlay = document.getElementById('guide-overlay')
    if (overlay) overlay.remove()

    try {
      await storageService.save('backhub-guide-shown', true)
      notificationService.success('Guide terminé ! Vous pouvez le relancer depuis les paramètres.')
    } catch (error) {
    }
  }
}

export const interactiveGuide = new InteractiveGuide()
window.guide = interactiveGuide
