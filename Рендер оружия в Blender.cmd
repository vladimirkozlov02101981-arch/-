@echo off
rem Render all weapons in the real Blender on this PC GPU, with 4K photo-scanned materials
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev\render-weapons.ps1"
