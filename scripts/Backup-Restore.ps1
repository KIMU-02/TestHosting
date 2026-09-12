param([string]$NativeBin = '')
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectPath
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$restoreName = 'portfolio_restore_' + $runId.ToLowerInvariant()
if ($restoreName -notmatch '^portfolio_restore_[0-9]{8}t[0-9]{9}z_[a-f0-9]{8}$') { throw 'Unsafe generated restore target' }
$outputPath = Join-Path $projectPath ('results/recovery/' + $runId)
New-Item -ItemType Directory -Path $outputPath | Out-Null
$dumpPath = Join-Path $outputPath 'portfolio.dump'
$remoteDump = '/tmp/' + $restoreName + '.dump'
$reportPath = Join-Path $outputPath 'report.json'
$report = [ordered]@{ started_at = (Get-Date).ToUniversalTime().ToString('o'); status = 'running'; environment = $(if($NativeBin){'windows-native'}else{'docker-compose'}); source_database = 'portfolio'; restore_database = $restoreName; source_modified = $false; steps = @(); cleanup = 'not-created' }
$created = $false
$dockerPath = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
if (-not (Test-Path -LiteralPath $dockerPath)) { $dockerPath = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) { $dockerPath = 'docker' }
function Save-Report { $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8 }
function Invoke-Checked([string]$Executable,[string[]]$Arguments) {
  $stderrPath = Join-Path $outputPath 'last-command.stderr.txt'
  # Native failures are checked by exit status. Do not pipe binary dumps through PowerShell.
  $oldPreference=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try { $global:LASTEXITCODE=$null; $text = & $Executable @Arguments 2> $stderrPath; $exit = $global:LASTEXITCODE }
  finally { $ErrorActionPreference=$oldPreference }
  if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath | Add-Content -LiteralPath (Join-Path $outputPath 'commands.log') }
  if ($null -eq $exit -or $exit -ne 0) { throw "Command failed: $Executable (exit $exit). See commands.log." }
  return ($text -join "`n")
}
function Invoke-Pg([string]$Tool,[string[]]$Arguments) {
  if ($NativeBin) { return Invoke-Checked (Join-Path $NativeBin ($Tool + '.exe')) $Arguments }
  return Invoke-Checked $dockerPath (@('compose','exec','-T','db',$Tool) + $Arguments)
}
function Invoke-Sql([string]$Database,[string]$Sql) {
  return Invoke-Pg 'psql' @('-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','portfolio','-d',$Database,'-c',$Sql)
}
try {
  Save-Report
  $version=Invoke-Pg 'pg_dump' @('--version')
  $report.tool_version=$version
  $report.server_version=Invoke-Sql 'portfolio' 'SHOW server_version'
  Write-Host '1/4 Creating a consistent logical backup of portfolio...'
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $targetDump = $(if($NativeBin){$dumpPath}else{$remoteDump})
  Invoke-Pg 'pg_dump' @('-U','portfolio','-d','portfolio','--format=custom','--no-owner','--no-acl','--lock-wait-timeout=10s','--file',$targetDump) | Out-Null
  if (-not $NativeBin) { Invoke-Checked $dockerPath @('compose','cp',('db:'+$remoteDump),$dumpPath) | Out-Null }
  $timer.Stop()
  $report.backup_ms=$timer.Elapsed.TotalMilliseconds
  $report.backup_bytes=(Get-Item -LiteralPath $dumpPath).Length
  $report.sha256=(Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $report.steps += 'backup-created'; Save-Report
  Write-Host '2/4 Creating an isolated temporary restore database...'
  # Never use --clean or --create during pg_restore, and never restore into portfolio.
  Invoke-Pg 'createdb' @('-U','portfolio','--maintenance-db=postgres','--template=template0',$restoreName) | Out-Null
  $created=$true; $report.cleanup='pending'
  if ((Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $report.sha256) { throw 'Backup checksum changed' }
  if (-not $NativeBin) { Invoke-Checked $dockerPath @('compose','cp',$dumpPath,('db:'+$remoteDump)) | Out-Null }
  $timer.Restart()
  Invoke-Pg 'pg_restore' @('-U','portfolio','--dbname',$restoreName,'--exit-on-error','--single-transaction','--no-owner','--no-acl',$targetDump) | Out-Null
  $timer.Stop(); $report.restore_ms=$timer.Elapsed.TotalMilliseconds
  $report.steps += 'restore-completed'; Save-Report
  Write-Host '3/4 Checking restored tables, constraints and a rolled-back order...'
  $sql = Get-Content -LiteralPath (Join-Path $projectPath 'sql/verify-recovery.sql') -Raw
  $timer.Restart()
  $validation=Invoke-Sql $restoreName $sql
  $report.validation=$validation | ConvertFrom-Json
  $timer.Stop(); $report.validation_ms=$timer.Elapsed.TotalMilliseconds
  $report.steps += 'validation-passed'
  $report.status='verified'
} catch {
  $report.status='failed'; $report.error=$_.Exception.Message
  Write-Host $report.error
} finally {
  Write-Host '4/4 Removing only the generated temporary database...'
  if ($created) {
    try {
      if ($restoreName -notmatch '^portfolio_restore_[0-9]{8}t[0-9]{9}z_[a-f0-9]{8}$') { throw 'Unsafe cleanup target' }
      Invoke-Pg 'dropdb' @('-U','portfolio','--maintenance-db=postgres',$restoreName) | Out-Null
      $report.cleanup='removed'
    } catch { $report.cleanup='failed';$report.cleanup_error=$_.Exception.Message;$report.status='failed' }
  }
  if (-not $NativeBin) {
    try { Invoke-Checked $dockerPath @('compose','exec','-T','db','rm','-f','--',$remoteDump) | Out-Null }
    catch { $report.temporary_file_cleanup_error=$_.Exception.Message }
  }
  $report.finished_at=(Get-Date).ToUniversalTime().ToString('o'); Save-Report
  Write-Host "Report: $reportPath"
}
if ($report.status -ne 'verified') { exit 1 }
