@echo off
echo Lancement du build avec privilèges administrateur...
echo.
powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit', '-Command', 'cd ''F:\Project\App\BackHub''; npm run build:win'"
pause

