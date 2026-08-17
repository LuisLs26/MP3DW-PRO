@echo off
title MP3DW Pro - YouTube Downloader & Studio
color 0b

:: Asegurar que el directorio de trabajo sea siempre la carpeta de este script
cd /d "%~dp0"

echo ====================================================================
echo                 🎵 INICIANDO MP3DW STUDIO PRO 🎵
echo ====================================================================
echo.

:: Verificar si Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado en tu sistema.
    echo Por favor, descarga e instala Node.js desde: https://nodejs.org/
    echo.
    pause
    exit /b
)

:: Verificar e instalar dependencias si faltan
if not exist node_modules (
    echo [INFO] Instalando dependencias por primera vez, por favor espera un momento...
    call npm install
    echo.
)

echo [INFO] Iniciando servidor dedicado y abriendo la aplicacion en tu navegador...
echo [INFO] No cierres esta ventana mientras utilices el descargador.
echo.

:: Iniciar el servidor (el servidor abrira automaticamente tu navegador en el puerto dedicado)
node server.js

echo.
echo [INFO] El servidor se ha detenido.
pause
