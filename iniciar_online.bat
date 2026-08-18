@echo off
title MP3DW PRO - Servidor Online (Cloudflare Tunnel)
color 0b

echo ===================================================
echo            MP3DW PRO - ONLINE SERVER
echo ===================================================
echo.
echo [1/3] Verificando dependencias...
if not exist node_modules (
    echo Instalando paquetes necesarios...
    call npm install
)

echo [2/3] Iniciando servidor local en segundo plano...
start /B node server.js

timeout /t 2 /nobreak >nul

echo [3/3] Creando enlace publico con Cloudflare Tunnel...
echo.
echo ===================================================
echo   COPIA EL ENLACE HTTPS QUE APARECE ABAJO Y ABRELO
echo   EN TU CELULAR O CUALQUIER NAVEGADOR
echo ===================================================
echo.

if exist cloudflared.exe (
    cloudflared.exe tunnel --url http://localhost:4895
) else (
    echo Descargando componente Cloudflare...
    curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    cloudflared.exe tunnel --url http://localhost:4895
)

pause
