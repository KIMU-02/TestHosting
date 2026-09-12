@echo off
setlocal
pushd "%~dp0"
set "LAB_DOCKER=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto found
set "LAB_DOCKER=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto found
set "LAB_DOCKER=docker"
:found
"%LAB_DOCKER%" compose ps
"%LAB_DOCKER%" compose logs --tail 80 api db
popd
pause
