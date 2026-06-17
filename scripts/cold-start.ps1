<#
.SYNOPSIS
  Launch GitDesktop in cold-start test mode — a brand-new-user simulation for
  walking the onboarding flow.

.DESCRIPTION
  Boots `pnpm tauri dev` with the cold-start Vite flags set. The app then reads
  and writes only throwaway namespaces (coldstart-*.json store files + a
  `coldstart:` keychain namespace), so your real settings, local PRs, and API
  keys are never touched.

  Run a fresh repo (e.g. `git init` in a temp folder) inside it to see the
  unborn-repo "Make your first commit" state. Use -NoGit / -NoGh to exercise the
  GitMissingScreen and GitHub-not-connected empty states without uninstalling
  anything.

.PARAMETER NoGit
  Force the "Git is not installed" screen.

.PARAMETER NoGh
  Force the "GitHub CLI not connected" empty states (Pull Requests / Actions).

.PARAMETER Reset
  Delete the throwaway cold-start store files, then exit (does not launch).

.EXAMPLE
  ./scripts/cold-start.ps1
  ./scripts/cold-start.ps1 -NoGit
  ./scripts/cold-start.ps1 -NoGh
  ./scripts/cold-start.ps1 -Reset
#>
[CmdletBinding()]
param(
  [switch]$NoGit,
  [switch]$NoGh,
  [switch]$Reset
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Tauri app-data dir on Windows = %APPDATA%\<identifier>.
$dataDir = Join-Path $env:APPDATA "com.thebguy.gitdesktop"

if ($Reset) {
  $files = Get-ChildItem -Path $dataDir -Filter "coldstart-*.json" -ErrorAction SilentlyContinue
  if ($files) {
    $files | Remove-Item -Force
    Write-Host "Cleared $($files.Count) cold-start store file(s) in $dataDir" -ForegroundColor Green
  } else {
    Write-Host "No cold-start store files to clear in $dataDir" -ForegroundColor Yellow
  }
  Write-Host "Note: any test API keys live in the 'coldstart:' keychain namespace — clear them from the app's AI settings while in cold-start mode."
  return
}

$env:VITE_COLD_START = "1"
if ($NoGit) { $env:VITE_COLD_START_NO_GIT = "1" }
else { Remove-Item Env:\VITE_COLD_START_NO_GIT -ErrorAction SilentlyContinue }
if ($NoGh) { $env:VITE_COLD_START_NO_GH = "1" }
else { Remove-Item Env:\VITE_COLD_START_NO_GH -ErrorAction SilentlyContinue }

Write-Host "Launching GitDesktop in COLD-START test mode" -ForegroundColor Cyan
Write-Host "  NoGit = $NoGit   NoGh = $NoGh" -ForegroundColor Cyan
Write-Host "  Real settings / local PRs / API keys are untouched." -ForegroundColor DarkGray

Set-Location $repoRoot
pnpm tauri dev
