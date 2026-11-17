@echo off
rem OmniSearch updater: downloads the latest release from GitHub and replaces this folder.
rem Runs update.ps1 as command text so that the PowerShell execution policy does not block it.
rem Everything is on one line because robocopy may overwrite this file while it is running.
powershell -NoProfile -Command "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath '%~dp0update.ps1'))) -Dir '%~dp0.'" & exit /b
