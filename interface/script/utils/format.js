
export function formatPrice(price) {
  // S'assurer que la valeur est un nombre valide
  const numPrice = parseFloat(price) || 0
  if (isNaN(numPrice)) {
    return '0 €'
  }
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(numPrice)
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/[&<>"']/g, m => escapeMap[m])
}
