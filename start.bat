@echo off
rem Double-click to start the harness lab. Works even if PowerShell scripts are blocked.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
rem If it stopped with a problem, keep the window open so you can read why
if errorlevel 1 pause
