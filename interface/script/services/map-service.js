/**
 * Service de gestion de la carte interactive de Chernarus
 */
class MapService {
  constructor() {
    this.map = null
    this.markers = []
    this.imageBounds = null
  }

  /**
   * Initialise la carte interactive
   */
  initMap() {
    const mapElement = document.getElementById('chernarus-map')
    if (!mapElement) {
      console.error('Élément de carte non trouvé')
      return
    }

    // Vérifier que Leaflet est chargé
    if (typeof L === 'undefined') {
      console.error('Leaflet n\'est pas chargé')
      return
    }

    // Dimensions de la carte Chernarus
    // Pour Leaflet avec CRS.Simple, on utilise des coordonnées en pixels
    // On définit les bounds pour correspondre à l'image
    const mapWidth = 15360
    const mapHeight = 15360
    
    // Coordonnées pour la projection simple (y, x)
    // Dans CRS.Simple, [0, 0] est en bas à gauche
    const southWest = [0, 0]
    const northEast = [mapHeight, mapWidth]
    this.imageBounds = [southWest, northEast]

    // Créer la carte Leaflet
    this.map = L.map('chernarus-map', {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false
    })

    // Ajouter l'image de la carte comme couche (URL directe depuis Imgur)
    const imageOverlay = L.imageOverlay('https://i.imgur.com/k6gzYIN.png', this.imageBounds).addTo(this.map)

    // Ajouter des contrôles personnalisés
    this.addCustomControls()

    // Attendre que la carte soit complètement initialisée puis ajuster la vue
    setTimeout(() => {
      this.resetView()
    }, 100)

    // Gérer le redimensionnement
    window.addEventListener('resize', () => {
      if (this.map) {
        this.map.invalidateSize()
      }
    })

    return this.map
  }

  /**
   * Ajoute des contrôles personnalisés à la carte
   */
  addCustomControls() {
    // Contrôle de zoom personnalisé
    const zoomControl = L.control.zoom({
      position: 'topright'
    })
    zoomControl.addTo(this.map)

    // Bouton pour réinitialiser la vue
    const resetControl = L.control({ position: 'topright' })
    resetControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-reset-control')
      div.innerHTML = '<button class="map-reset-btn" title="Réinitialiser la vue">🏠</button>'
      L.DomEvent.on(div, 'click', () => {
        this.resetView()
      })
      return div
    }
    resetControl.addTo(this.map)
  }

  /**
   * Réinitialise la vue de la carte
   */
  resetView() {
    if (!this.map || !this.imageBounds) return
    
    this.map.fitBounds(this.imageBounds, { padding: [50, 50] })
    if (this.map.getZoom() > -3) {
      this.map.setZoom(-4)
    }
  }

  /**
   * Ajoute un marqueur sur la carte
   * @param {Array} position - Position [y, x] sur la carte
   * @param {string} title - Titre du marqueur
   * @param {string} description - Description du marqueur
   * @param {string} icon - Icône personnalisée (optionnel)
   */
  addMarker(position, title, description = '', icon = null) {
    if (!this.map) return null

    const markerOptions = {
      title: title
    }

    if (icon) {
      markerOptions.icon = L.icon({
        iconUrl: icon,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      })
    }

    const marker = L.marker(position, markerOptions).addTo(this.map)

    marker.bindPopup(description 
      ? `<strong>${title}</strong><br>${description}`
      : `<strong>${title}</strong>`)

    this.markers.push(marker)
    return marker
  }

  /**
   * Supprime tous les marqueurs
   */
  clearMarkers() {
    this.markers.forEach(marker => {
      this.map.removeLayer(marker)
    })
    this.markers = []
  }

  /**
   * Supprime un marqueur spécifique
   * @param {Object} marker - Le marqueur à supprimer
   */
  removeMarker(marker) {
    const index = this.markers.indexOf(marker)
    if (index > -1) {
      this.markers.splice(index, 1)
      this.map.removeLayer(marker)
    }
  }

  /**
   * Détruit la carte
   */
  destroy() {
    if (this.map) {
      this.map.remove()
      this.map = null
      this.markers = []
      this.imageBounds = null
    }
  }

  /**
   * Force le redimensionnement de la carte
   */
  invalidateSize() {
    if (this.map) {
      setTimeout(() => {
        this.map.invalidateSize()
      }, 100)
    }
  }
}

// Export du service
export const mapService = new MapService()

