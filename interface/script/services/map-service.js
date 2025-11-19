
class MapService {
  constructor() {
    this.map = null
    this.markers = []
    this.imageBounds = null
  }


  initMap() {
    const mapElement = document.getElementById('chernarus-map')
    if (!mapElement) {
      return
    }


    if (typeof L === 'undefined') {
      return
    }




    const mapWidth = 15360
    const mapHeight = 15360



    const southWest = [0, 0]
    const northEast = [mapHeight, mapWidth]
    this.imageBounds = [southWest, northEast]


    this.map = L.map('chernarus-map', {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false
    })


    const imageOverlay = L.imageOverlay('https://i.imgur.com/k6gzYIN.png', this.imageBounds).addTo(this.map)


    this.addCustomControls()


    setTimeout(() => {
      this.resetView()
    }, 100)


    window.addEventListener('resize', () => {
      if (this.map) {
        this.map.invalidateSize()
      }
    })

    return this.map
  }


  addCustomControls() {

    const zoomControl = L.control.zoom({
      position: 'topright'
    })
    zoomControl.addTo(this.map)


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


  resetView() {
    if (!this.map || !this.imageBounds) return

    this.map.fitBounds(this.imageBounds, { padding: [50, 50] })
    if (this.map.getZoom() > -3) {
      this.map.setZoom(-4)
    }
  }


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


  clearMarkers() {
    this.markers.forEach(marker => {
      this.map.removeLayer(marker)
    })
    this.markers = []
  }


  removeMarker(marker) {
    const index = this.markers.indexOf(marker)
    if (index > -1) {
      this.markers.splice(index, 1)
      this.map.removeLayer(marker)
    }
  }


  destroy() {
    if (this.map) {
      this.map.remove()
      this.map = null
      this.markers = []
      this.imageBounds = null
    }
  }


  invalidateSize() {
    if (this.map) {
      setTimeout(() => {
        this.map.invalidateSize()
      }, 100)
    }
  }
}


export const mapService = new MapService()

