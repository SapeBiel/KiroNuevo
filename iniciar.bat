@echo off
rem Arranca el servidor local y abre el juego en el navegador.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
