@echo off
title ZENTRA Hunter - Phone Tunnel
echo Starting Cloudflare tunnel...
echo Keep this window open. Copy the https://....trycloudflare.com link
echo into your phone browser.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8787
echo.
echo Tunnel stopped. Press any key to close.
pause >nul
