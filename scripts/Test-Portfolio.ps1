$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectPath
$runId=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$composeProject='portfolio-test-'+[Guid]::NewGuid().ToString('N')
$restoreName='portfolio_restore_'+$runId.ToLowerInvariant()
$outputPath=Join-Path $projectPath ('results/ci/'+$runId)
New-Item -ItemType Directory -Path $outputPath | Out-Null
$report=[ordered]@{started_at=(Get-Date).ToUniversalTime().ToString('o');status='running';project=$composeProject;stages=@();cleanup='pending'}
$dockerPath='docker'
if($env:LOCALAPPDATA){
  $candidate=Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
  if(Test-Path -LiteralPath $candidate){$dockerPath=$candidate}
  elseif(Test-Path -LiteralPath 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'){$dockerPath='C:/Program Files/Docker/Docker/resources/bin/docker.exe'}
}
$prefix=@('compose','-f',(Join-Path $projectPath 'compose.ci.yaml'),'-p',$composeProject)
function Save-Report { $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'report.json') -Encoding UTF8 }
function Run-Stage([string]$Name,[string[]]$Arguments){
  Write-Host "Running: $Name"
  $logPath=Join-Path $outputPath ($Name+'.log')
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $exitCode=$null
  try {
    $global:LASTEXITCODE=$null
    # Merge native output into a stage log; any nonzero/missing exit code fails.
    $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
    try { & $dockerPath @prefix @Arguments *> $logPath; $exitCode=$global:LASTEXITCODE }
    finally {$ErrorActionPreference=$old}
    if($null -eq $exitCode -or $exitCode -ne 0){throw "Stage $Name failed; see $logPath"}
  } finally {
    $timer.Stop();$report.stages+=@{name=$Name;exit_code=$exitCode;elapsed_ms=$timer.Elapsed.TotalMilliseconds};Save-Report
  }
}
try {
  Save-Report
  Run-Stage '01-config' @('config','--quiet')
  Run-Stage '02-build' @('build','api','runner')
  Run-Stage '03-database' @('up','-d','--wait','db')
  Run-Stage '04-unit' @('run','--rm','--no-deps','runner','npm','test')
  # This suite seeds 10k rows only inside this unique disposable stack.
  Run-Stage '05-integration' @('run','--rm','--no-deps','runner','npm','run','test:integration')
  Run-Stage '06-api' @('up','-d','--wait','api')
  Run-Stage '07-checkout' @('exec','-T','-e','DASHBOARD_URL=http://127.0.0.1:8080','api','npm','run','test:checkout')
  Run-Stage '08-monitoring' @('run','--rm','--no-deps','runner','npm','run','test:monitoring')
  Run-Stage '09-recovery-guards' @('run','--rm','--no-deps','runner','npm','run','test:recovery-sql')
  Run-Stage '10-http' @('exec','-T','api','node','test/dashboard-http.mjs')
  Run-Stage '11-dump' @('exec','-T','db','pg_dump','-U','portfolio','-d','portfolio','-Fc','--no-owner','--no-acl','-f','/tmp/ci.dump')
  Run-Stage '12-create-restore-db' @('exec','-T','db','createdb','-U','portfolio','--maintenance-db=postgres','--template=template0',$restoreName)
  Run-Stage '13-restore' @('exec','-T','db','pg_restore','-U','portfolio','-d',$restoreName,'--exit-on-error','--single-transaction','--no-owner','--no-acl','/tmp/ci.dump')
  Run-Stage '14-copy-verification' @('cp',(Join-Path $projectPath 'sql/verify-recovery.sql'),'db:/tmp/verify-recovery.sql')
  Run-Stage '15-verify-restored-db' @('exec','-T','db','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','portfolio','-d',$restoreName,'-f','/tmp/verify-recovery.sql')
  $report.status='passed'
} catch {$report.status='failed';$report.error=$_.Exception.Message;Write-Host $report.error}
finally {
  try {Run-Stage 'container-logs' @('logs','--no-color','--tail','200')}catch{$report.log_error=$_.Exception.Message}
  try {
    if($composeProject -notmatch '^portfolio-test-[a-f0-9]{32}$'){throw 'Unsafe cleanup project'}
    Run-Stage 'cleanup' @('down','--volumes','--remove-orphans')
    $report.cleanup='removed'
  } catch {$report.cleanup='failed';$report.status='failed';$report.cleanup_error=$_.Exception.Message}
  $report.finished_at=(Get-Date).ToUniversalTime().ToString('o');Save-Report
  Write-Host "Report: $outputPath"
}
if($report.status -ne 'passed'){exit 1}
