
function initWindowControls() {
  const closeBtn = document.getElementById('close-btn')
  const minimizeBtn = document.getElementById('minimize-btn')
  const maximizeBtn = document.getElementById('maximize-btn')

  if (!closeBtn || !minimizeBtn || !maximizeBtn) {
    return
  }

  if (!window.electronAPI) {
    setTimeout(initWindowControls, 100)
    return
  }

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      window.electronAPI.close()
    } catch (error) {
    }
  })

  minimizeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      window.electronAPI.minimize()
    } catch (error) {
    }
  })

  maximizeBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await window.electronAPI.maximize()
      updateMaximizeIcon()
    } catch (error) {
    }
  })

  updateMaximizeIcon()

  window.addEventListener('resize', () => {
    updateMaximizeIcon()
  })

  async function updateMaximizeIcon() {
    if (window.electronAPI && maximizeBtn) {
      try {
        const isMaximized = await window.electronAPI.isMaximized()
        if (isMaximized) {
          maximizeBtn.title = 'Réduire'
        } else {
          maximizeBtn.title = 'Agrandir'
        }
      } catch (error) {
      }
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWindowControls)
} else {
  initWindowControls()
}
