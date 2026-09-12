@echo off
setlocal
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Test-Portfolio.ps1"
if errorlevel 1 goto failed
echo All validation stages passed. See results\ci.
popd
exit /b 0
:failed
echo Validation did not pass. See results\ci for details.
popd
exit /b 1
