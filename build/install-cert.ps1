# Script d'installation silencieux du certificat BackHub
# Ce script installe automatiquement le certificat dans le magasin de confiance Windows
param(
    [string]$CertPath = "$PSScriptRoot\BackHub.cer"
)

try {
    if (Test-Path $CertPath) {
        # Charger le certificat
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertPath)
        
        # Ouvrir le magasin "Autorités de certification racines de confiance" (CurrentUser)
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
            [System.Security.Cryptography.X509Certificates.StoreName]::Root,
            [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
        )
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        
        # Vérifier si le certificat existe déjà
        $existing = $store.Certificates.Find(
            [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
            $cert.Thumbprint,
            $false
        )
        
        if ($existing.Count -eq 0) {
            # Ajouter le certificat
            $store.Add($cert)
        }
        
        $store.Close()
        exit 0
    } else {
        # Fichier certificat non trouvé
        exit 1
    }
} catch {
    # Erreur silencieuse - on ne veut pas perturber l'utilisateur
    exit 1
}

