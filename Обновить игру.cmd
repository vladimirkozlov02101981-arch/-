@echo off
rem Territory War: manual update to the latest version (git fetch + reset --hard, untracked files are kept)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev\update-game.ps1"
