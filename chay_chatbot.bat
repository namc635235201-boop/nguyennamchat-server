@echo off
chcp 65001 > nul
title Chay Chatbot AI
echo =======================================================
echo          STARTING CHATBOT AI AND NGROK SYSTEM
echo =======================================================
echo.
echo [*] Cleaning old processes...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1
echo [*] Starting Node.js Server...
start "NodeJS Server" cmd /k "cd /d %~dp0messenger-bot && node server.js"
echo [*] Starting Ngrok Tunnel...
start "Ngrok Tunnel" cmd /k "C:\Users\dell\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe http 3000 --domain=waged-subject-thesis.ngrok-free.dev"
echo [*] Waiting for public link (5 seconds)...
ping 127.0.0.1 -n 6 > nul

for /f "usebackq tokens=*" %%i in (`powershell.exe -Command "@((Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels.public_url)[0]"`) do set PUBLIC_URL=%%i

if "%PUBLIC_URL%"=="" (
    echo ? Failed to get Ngrok URL!
) else (
    echo ---------------------------------------------------
    echo ?? YOUR PUBLIC URL: %PUBLIC_URL%
    echo ?? Webhook URL:     %PUBLIC_URL%/webhook
    echo ---------------------------------------------------
    start %PUBLIC_URL%
)

echo.
echo =======================================================
echo  ? System is running! Keep all command windows open.
echo =======================================================
echo.
pause