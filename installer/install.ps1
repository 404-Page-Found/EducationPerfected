# EducationPerfected installer for Windows (PowerShell 5.1+).
# Downloads educationperfected-windows-x64.exe plus SHA256SUMS from a release,
# verifies the checksum, installs under %LOCALAPPDATA%\Programs, adds to user PATH.
# Usage: powershell -File install.ps1 [-Version 2026.11.21]   (default: latest release)
param([string]$Version = 'latest')
$ErrorActionPreference = 'Stop'
if ($Version -eq 'latest') {
  $base = if ($env:EP_INSTALL_BASE_URL) { $env:EP_INSTALL_BASE_URL } else { 'https://github.com/404-Page-Found/EducationPerfected/releases/latest/download' }
} else {
  $base = if ($env:EP_INSTALL_BASE_URL) { $env:EP_INSTALL_BASE_URL } else { "https://github.com/404-Page-Found/EducationPerfected/releases/download/v$Version" }
}
$asset = 'educationperfected-windows-x64.exe'
$tmp = Join-Path $env:TEMP ("ep-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "Downloading $asset"
  if (Test-Path $base) {
    Copy-Item (Join-Path $base $asset) (Join-Path $tmp $asset)
    Copy-Item (Join-Path $base 'SHA256SUMS') (Join-Path $tmp 'SHA256SUMS')
  } else {
    Invoke-WebRequest -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
  }
  $expected = $null
  foreach ($line in Get-Content (Join-Path $tmp 'SHA256SUMS')) {
    $parts = $line -split ' ', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart(' ', '*') -eq $asset) { $expected = $parts[0]; break }
  }
  if (-not $expected) { throw "SHA256SUMS has no line for $asset" }
  $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Checksum mismatch for $asset; download discarded." }
  $dest = Join-Path $env:LOCALAPPDATA 'Programs\EducationPerfected'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item (Join-Path $tmp $asset) (Join-Path $dest 'educationperfected.exe') -Force
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @(); if ($userPath) { $entries = $userPath -split ';' }
  $addedToPath = $false
  if ($entries -notcontains $dest) {
    $combined = if ([string]::IsNullOrEmpty($userPath)) { $dest } else { "$userPath;$dest" }
    [Environment]::SetEnvironmentVariable('Path', $combined, 'User')
    $addedToPath = $true
  }
  # Install record: uninstall reads this to remove exactly what this install created.
  # pathEntries only covers what this installer actually added.
  $exePath = Join-Path $dest 'educationperfected.exe'
  $recordPath = Join-Path $dest 'educationperfected-install.json'
  $recordedPathEntries = @()
  if ($addedToPath) {
    $recordedPathEntries = @($dest)
  } elseif (Test-Path -LiteralPath $recordPath -PathType Leaf) {
    # Reinstall over an earlier install.ps1: keep the PATH ownership it recorded,
    # so uninstall can still remove the entry it added.
    try {
      $previousRecord = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
      if ($previousRecord.method -eq 'install-ps1' -and @($previousRecord.pathEntries) -contains $dest) { $recordedPathEntries = @($dest) }
    } catch {}
  }
  [ordered]@{ version = 1; method = 'install-ps1'; files = @($exePath, $recordPath); pathEntries = $recordedPathEntries } | ConvertTo-Json -Compress | Set-Content -Path $recordPath -Encoding ascii
  Write-Host "Verified and installed to $dest"
  Write-Host 'Open a NEW terminal, then run: educationperfected setup'
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
