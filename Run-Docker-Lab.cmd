@echo off
setlocal
pushd "%~dp0"
set "LAB_DOCKER=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto docker_found
set "LAB_DOCKER=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if exist "%LAB_DOCKER%" goto docker_found
set "LAB_DOCKER=docker"
:docker_found
if not exist "results" mkdir "results"
set "LAB_LOG=%CD%\results\docker-verification.log"
echo Docker verification started: %DATE% %TIME%> "%LAB_LOG%"
echo This runs the educational lab and resets ONLY its lab schema / checkout orders.
echo Log: %LAB_LOG%
call :run "%LAB_DOCKER%" version
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose version
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose config --quiet
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose --profile tools build
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose up -d --wait db
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose run --rm runner npm test
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose run --rm runner npm run test:integration
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose run --rm runner npm run seed
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose run --rm runner npm run bench
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose up -d --wait api
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" compose ps
if errorlevel 1 goto failed
call :run "%LAB_DOCKER%" image inspect postgres:18.4-bookworm
if errorlevel 1 goto failed
echo SUCCESS: %DATE% %TIME%>> "%LAB_LOG%"
echo.
echo SUCCESS. API: http://localhost:8080
echo Actual benchmark reports: %CD%\results
echo DB and API remain running. Stop with docker compose down when finished.
popd
exit /b 0

:run
echo.
echo Running: %*
echo Running: %*>> "%LAB_LOG%"
%* >> "%LAB_LOG%" 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:failed
echo FAILED: %DATE% %TIME%>> "%LAB_LOG%"
echo.
echo Failed. Details follow:
type "%LAB_LOG%"
echo.
echo Log saved: %LAB_LOG%
echo If Docker Server is unavailable, open Docker Desktop and wait for the engine.
popd
exit /b 1
