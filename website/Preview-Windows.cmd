@echo off
setlocal
cd /d "%~dp0"
title BookedRadar - Preview Only
echo BookedRadar homepage preview - this does NOT publish the site.
echo Target site: dc96494e-5565-41be-8513-deeeedcf59d7
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node -e "const c=require('./wix.config.json');if(c.siteId!=='dc96494e-5565-41be-8513-deeeedcf59d7'||c.appId!=='a5fc33eb-4eb3-4562-9e5d-6c1a61623499')process.exit(1);if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo STOP: Wrong site configuration or Node.js is older than version 22.
  pause
  exit /b 1
)
node build.mjs
if errorlevel 1 goto failed
call npx --yes @wix/cli@1.1.251 whoami
if not errorlevel 1 goto preview
echo Please approve Wix CLI access using the code and link printed below.
call npx --yes @wix/cli@1.1.251 login
call npx --yes @wix/cli@1.1.251 whoami
if errorlevel 1 goto failed
:preview
call npx --yes @wix/cli@1.1.251 preview
if errorlevel 1 goto failed
echo.
echo Copy the preview URL into our ChatGPT conversation.
echo Nothing has been published. Do not release until acceptance checks pass.
pause
exit /b 0
:failed
echo.
echo Preview did not complete. Share the error text, but do not share tokens or passwords.
pause
exit /b 1
