@echo off
setlocal
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Backup-Restore.ps1"
if errorlevel 1 goto failed
echo Backup and restore verification completed. See results\recovery.
popd
exit /b 0
:failed
echo Verification failed. Read the report in results\recovery.
popd
exit /b 1
