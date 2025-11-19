# Script pour rafraîchir le cache d'icônes Windows
# Cela force Windows à recharger les icônes des fichiers

Write-Host "Rafraîchissement du cache d'icônes Windows..."
Write-Host ""

# Arrêter l'explorateur Windows temporairement pour vider le cache
$explorer = Get-Process explorer -ErrorAction SilentlyContinue
if ($explorer) {
    Write-Host "Arrêt de l'explorateur Windows..."
    Stop-Process -Name explorer -Force
    Start-Sleep -Seconds 2
    Write-Host "Redémarrage de l'explorateur Windows..."
    Start-Process explorer
    Start-Sleep -Seconds 2
}

# Vider le cache d'icônes
$iconCachePath = "$env:LOCALAPPDATA\IconCache.db"
if (Test-Path $iconCachePath) {
    Write-Host "Suppression du cache d'icônes..."
    Remove-Item $iconCachePath -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "✅ Cache d'icônes rafraîchi"
Write-Host ""
Write-Host "Maintenant :"
Write-Host "1. Rebuild l'application : npm run build:win"
Write-Host "2. Redémarrez l'explorateur Windows si nécessaire"
Write-Host "3. Vérifiez l'icône dans le dossier dist"

