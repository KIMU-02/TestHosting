@echo off
setlocal
pushd "%~dp0"
set "LAB_DOCKER=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto found
set "LAB_DOCKER=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto found
set "LAB_DOCKER=docker"
:found
if not exist results mkdir results
echo Updating dashboard. Existing orders and stock are preserved.
echo Build output is saved to results\dashboard-update.log
"%LAB_DOCKER%" compose build api > results\dashboard-update.log 2>&1
if errorlevel 1 goto failed
"%LAB_DOCKER%" compose run --rm --no-deps api npm test >> results\dashboard-update.log 2>&1
if errorlevel 1 goto failed
"%LAB_DOCKER%" compose up -d --wait api >> results\dashboard-update.log 2>&1
if errorlevel 1 goto failed
"%LAB_DOCKER%" compose exec -T api node test/dashboard-http.mjs >> results\dashboard-update.log 2>&1
if errorlevel 1 goto failed
echo SUCCESS >> results\dashboard-update.log
echo Dashboard ready: http://localhost:8080
popd
exit /b 0
:failed
type results\dashboard-update.log
popd
exit /b 1
