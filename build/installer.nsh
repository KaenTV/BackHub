# Script NSIS personnalisé pour installer le certificat automatiquement
# Ce script s'exécute après l'installation de l'application
# Note: MUI_ICON et MUI_UNICON sont déjà définis par electron-builder via installerIcon et uninstallerIcon

!macro customInstall
  # Installer le certificat silencieusement en arrière-plan
  # Utiliser -WindowStyle Hidden pour ne pas afficher de fenêtre PowerShell
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File "$INSTDIR\install-cert.ps1" -CertPath "$INSTDIR\BackHub.cer"' $0
  
  # Ne pas afficher d'erreur si l'installation du certificat échoue
  # (cela peut arriver si l'utilisateur n'a pas les droits ou si le certificat existe déjà)
!macroend

# Optionnel : retirer le certificat lors de la désinstallation
# On ne le fait généralement pas pour ne pas perturber l'utilisateur
!macro customUninstall
  # Laisser le certificat installé même après désinstallation
  # L'utilisateur peut le retirer manuellement s'il le souhaite
!macroend

