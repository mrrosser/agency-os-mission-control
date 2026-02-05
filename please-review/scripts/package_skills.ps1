param(
  [string]$SkillsDir = (Join-Path (Get-Location) "skills"),
  [string]$OutputDir = (Join-Path (Get-Location) "dist\\skills"),
  [string[]]$Include = @(),
  [string[]]$Exclude = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-SkillMetadata {
  param([string]$SkillPath)
  $skillFile = Join-Path $SkillPath "SKILL.md"
  if (-not (Test-Path $skillFile)) { return $null }
  $lines = Get-Content -Path $skillFile
  $frontmatter = @()
  $inFront = $false
  foreach ($line in $lines) {
    if ($line.Trim() -eq "---") {
      if (-not $inFront) { $inFront = $true; continue }
      break
    }
    if ($inFront) { $frontmatter += $line }
  }
  $name = $null
  $description = $null
  foreach ($line in $frontmatter) {
    if ($line -match "^\s*name:\s*(.+)$") { $name = $Matches[1].Trim() }
    if ($line -match "^\s*description:\s*(.+)$") { $description = $Matches[1].Trim() }
  }
  if (-not $name) { $name = (Split-Path -Leaf $SkillPath) }
  return [PSCustomObject]@{
    name = $name
    description = $description
    path = $SkillPath
  }
}

if (-not (Test-Path $SkillsDir)) {
  throw "Skills directory not found: $SkillsDir"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$skillDirs = Get-ChildItem -Path $SkillsDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }
if ($Include.Count -gt 0) {
  $skillDirs = $skillDirs | Where-Object { $Include -contains $_.Name }
}
if ($Exclude.Count -gt 0) {
  $skillDirs = $skillDirs | Where-Object { $Exclude -notcontains $_.Name }
}

$manifest = [ordered]@{
  generated_at = (Get-Date).ToString("o")
  skills = @()
}

foreach ($dir in $skillDirs) {
  $meta = Get-SkillMetadata -SkillPath $dir.FullName
  if (-not $meta) { continue }
  $outFile = Join-Path $OutputDir "$($meta.name).skills"
  if (Test-Path $outFile) { Remove-Item -Force $outFile }
  Compress-Archive -Path (Join-Path $dir.FullName "*") -DestinationPath $outFile -Force
  $manifest.skills += [ordered]@{
    name = $meta.name
    description = $meta.description
    source = $dir.FullName
    artifact = $outFile
  }
}

$manifestPath = Join-Path $OutputDir "manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath

Write-Host "Packaged $($manifest.skills.Count) skill(s) to $OutputDir"
