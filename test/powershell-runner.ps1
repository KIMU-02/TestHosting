# Test the actual functions without running Docker or the scripts' main bodies.
$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPath=Join-Path $projectPath ('results/runner-test/'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
foreach($file in @('Test-Portfolio.ps1','Backup-Restore.ps1')){
  $tokens=$null;$parseErrors=$null
  $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $projectPath ('scripts/'+$file)),[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count){throw 'Parse failed'}
  $definitions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Run-Stage','Invoke-Checked')},$false)
  foreach($definition in $definitions){. ([scriptblock]::Create($definition.Extent.Text))}
}
function Save-Report {}
$report=@{stages=@()}
$dockerPath=$env:ComSpec
$prefix=@('/d','/c','exit')
Run-Stage 'success' @('0')
if($report.stages[-1].exit_code -ne 0){throw 'Success exit not captured'}
$caught=$false
try {Run-Stage 'failure' @('7')}catch{$caught=$true}
if(-not $caught -or $report.stages[-1].exit_code -ne 7){throw 'Failure exit not captured'}
Invoke-Checked $env:ComSpec @('/d','/c','exit','0') | Out-Null
$caught=$false
try {Invoke-Checked $env:ComSpec @('/d','/c','exit','7') | Out-Null}catch{$caught=$true}
if(-not $caught){throw 'Backup runner ignored failing command'}
$caught=$false
try {Invoke-Checked (Join-Path $outputPath 'missing.exe') @() | Out-Null}catch{$caught=$true}
if(-not $caught){throw 'Missing executable reused an old success code'}
Write-Output 'PASS: actual CI and backup functions accept exit 0, reject exit 7; missing executable cannot reuse stale status.'
