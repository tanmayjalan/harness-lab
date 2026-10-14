@echo off
rem Double-click to set up and check the harness lab. Works even if PowerShell scripts are blocked.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if "%~1"=="" pause
