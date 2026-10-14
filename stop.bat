@echo off
rem Double-click to stop the harness lab's servers (and nothing else). Add -List to only see what would stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
