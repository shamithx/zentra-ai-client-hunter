@echo off
title ZENTRA Hunter - App Server
cd /d "%~dp0"
echo Starting ZENTRA Hunter...
echo Keep this window open while you use the dashboard.
echo.
node server/index.js
echo.
echo Server stopped. Press any key to close.
pause >nul
