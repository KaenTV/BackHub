



!macro customInstall


  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File "$INSTDIR\install-cert.ps1" -CertPath "$INSTDIR\BackHub.cer"' $0
  


!macroend



!macro customUninstall


!macroend

