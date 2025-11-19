
class TooltipManager {
  constructor() {
    this.tooltips = new Map()
    this.init()
  }

  init() {

    const container = document.createElement('div')
    container.id = 'tooltip-container'
    container.className = 'tooltip-container'
    document.body.appendChild(container)
  }

  show(element, text, position = 'top') {
    const tooltip = document.createElement('div')
    tooltip.className = `tooltip tooltip-${position}`
    tooltip.textContent = text

    document.getElementById('tooltip-container').appendChild(tooltip)

    const rect = element.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()

    let top, left

    switch (position) {
      case 'top':
        top = rect.top - tooltipRect.height - 8
        left = rect.left + (rect.width / 2) - (tooltipRect.width / 2)
        break
      case 'bottom':
        top = rect.bottom + 8
        left = rect.left + (rect.width / 2) - (tooltipRect.width / 2)
        break
      case 'left':
        top = rect.top + (rect.height / 2) - (tooltipRect.height / 2)
        left = rect.left - tooltipRect.width - 8
        break
      case 'right':
        top = rect.top + (rect.height / 2) - (tooltipRect.height / 2)
        left = rect.right + 8
        break
    }

    tooltip.style.top = `${top}px`
    tooltip.style.left = `${left}px`
    tooltip.classList.add('show')

    const id = Date.now()
    this.tooltips.set(id, tooltip)

    return id
  }

  hide(id) {
    const tooltip = this.tooltips.get(id)
    if (tooltip) {
      tooltip.classList.remove('show')
      setTimeout(() => tooltip.remove(), 300)
      this.tooltips.delete(id)
    }
  }

  initTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(element => {
      const text = element.dataset.tooltip
      const position = element.dataset.tooltipPosition || 'top'

      let tooltipId = null

      element.addEventListener('mouseenter', () => {
        tooltipId = this.show(element, text, position)
      })

      element.addEventListener('mouseleave', () => {
        if (tooltipId !== null) {
          this.hide(tooltipId)
          tooltipId = null
        }
      })
    })
  }
}

export const tooltipManager = new TooltipManager()
