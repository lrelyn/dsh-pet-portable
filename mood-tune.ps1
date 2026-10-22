# mood-tune.ps1 -- mood tuning console (ASCII-only on purpose: PS 5.1 reads .ps1 as ANSI,
# so any non-ASCII char becomes mojibake and breaks parsing. Keep this file pure ASCII.)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File mood-tune.ps1
#   powershell -ExecutionPolicy Bypass -File mood-tune.ps1 -decay 0.02
#   powershell -ExecutionPolicy Bypass -File mood-tune.ps1 -happy 70 -tired 30 -grumpy 15
#   powershell -ExecutionPolicy Bypass -File mood-tune.ps1 -playW 2.0
#   powershell -ExecutionPolicy Bypass -File mood-tune.ps1 -off
#
# Restarts the desktop pet automatically; new numbers show up on screen ~3s later.
param(
  [double]$decay  = -1,
  [double]$happy  = -1,
  [double]$tired  = -1,
  [double]$grumpy = -1,
  [double]$playW  = -1,
  [double]$smallW = -1,
  [switch]$off
)

$ErrorActionPreference = 'Stop'
$cfgPath = Join-Path $env:USERPROFILE '.dsh\dsh-pet\main-config.jsonc'
$bakPath = "$cfgPath.before-tune"
$petRoot = Join-Path $env:USERPROFILE 'Desktop\大肥鱼桌宠'

if (-not (Test-Path $cfgPath)) { throw "config not found: $cfgPath" }
if (-not (Test-Path $bakPath)) { Copy-Item $cfgPath $bakPath; "backup -> $bakPath`n" }

$raw = Get-Content $cfgPath -Raw -Encoding UTF8

$m = [regex]::Match($raw, '"moods"\s*:\s*\{')
if (-not $m.Success) { throw "no moods section in config; add one first (see $bakPath)" }
$start = $m.Index + $m.Length
$depth = 1; $i = $start
while ($depth -gt 0 -and $i -lt $raw.Length) {
  if ($raw[$i] -eq '{') { $depth++ } elseif ($raw[$i] -eq '}') { $depth-- }
  $i++
}
"=== current moods ==="
$raw.Substring($start, $i - $start - 1).Trim()
""

$changed = $false

if ($off) {
  $raw = $raw -replace '("moods"\s*:\s*\{\s*"enabled"\s*:\s*)true', '${1}false'
  "-> moods.enabled = false"
  $changed = $true
}
else {
  $raw = $raw -replace '("moods"\s*:\s*\{\s*"enabled"\s*:\s*)false', '${1}true'

  if ($decay -ge 0) {
    $raw = $raw -replace '("decayPerSec"\s*:\s*)[0-9.]+', "`${1}$decay"
    "-> decayPerSec = $decay"
    $changed = $true
  }
  if ($happy -ge 0) {
    $raw = $raw -replace '("thresholds"\s*:\s*\{\s*"happy"\s*:\s*)[0-9.]+', "`${1}$happy"
    "-> thresholds.happy = $happy"
    $changed = $true
  }
  if ($tired -ge 0) {
    $raw = $raw -replace '("happy"\s*:\s*[0-9.]+,\s*"tired"\s*:\s*)[0-9.]+', "`${1}$tired"
    "-> thresholds.tired = $tired"
    $changed = $true
  }
  if ($grumpy -ge 0) {
    $raw = $raw -replace '("tired"\s*:\s*[0-9.]+,\s*"grumpy"\s*:\s*)[0-9.]+', "`${1}$grumpy"
    "-> thresholds.grumpy = $grumpy"
    $changed = $true
  }
  # Weight tuning: the category ids are Chinese, and this file must stay ASCII.
  # Instead of hardcoding them, take the id by **position** inside the happy.weights
  # object (the order in config.jsonc is fixed: play, small-action, eat, season, text).
  # Position 1 = play, position 2 = small-action.
  if ($playW -ge 0 -or $smallW -ge 0) {
    $wm = [regex]::Match($raw, '(?s)("happy"\s*:\s*\{\s*"weights"\s*:\s*\{)(.*?)(\})')
    if (-not $wm.Success) { throw "happy.weights not found" }
    $entries = [regex]::Matches($wm.Groups[2].Value, '"[^"]+"\s*:\s*[0-9.]+')
    if ($entries.Count -lt 2) { throw "expected >=2 weight entries, got $($entries.Count)" }
    $idx = if ($playW -ge 0) { 0 } else { 1 }
    $val = if ($playW -ge 0) { $playW } else { $smallW }
    $old = $entries[$idx].Value
    $new = $old -replace ':\s*[0-9.]+', ": $val"
    $block = $wm.Groups[2].Value.Replace($old, $new)
    $raw = $raw.Substring(0, $wm.Index) + $wm.Groups[1].Value + $block + $wm.Groups[3].Value + $raw.Substring($wm.Index + $wm.Length)
    $label = if ($playW -ge 0) { 'play' } else { 'small-action' }
    "-> happy.$label weight: $old  =>  $new"
    $changed = $true
  }
  $t = [regex]::Match($raw, '"thresholds"\s*:\s*\{[^}]*\}').Value
  if ($t) { "-> $t" }
}

if (-not $changed) { "`n(no params given; use -decay / -happy / -tired / -grumpy / -playW / -smallW / -off)"; exit 0 }

# JSONC sanity: must parse after stripping comments, else refuse to write
$stripped = $raw -replace '(?s)/\*.*?\*/', '' -replace '(?m)(^|[^\\:])\s*//.*$', '$1'
try { $stripped | ConvertFrom-Json | Out-Null }
catch { throw "resulting JSONC is invalid, nothing written: $($_.Exception.Message)" }

Set-Content -Path $cfgPath -Value $raw -Encoding UTF8 -NoNewline
"`nwritten: $cfgPath"

# --- restart pet ---
$sa = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*standalone.js*' }
if ($sa) {
  foreach ($s in $sa) { Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue }
  "stopped standalone ($($sa.ProcessId -join ','))"
}
Start-Sleep -Seconds 2
# Launch via WMI Win32_Process.Create so the pet is a true orphan (no parent in the
# caller's job). Start-Process from a harness job gets its whole tree killed when the
# job is cancelled, which silently took the pet down with it.
$petCmd = '"' + $petRoot + '\runtime\node.exe" "' + $petRoot + '\app\lib\standalone.js" --port 3080'
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = $petCmd
  CurrentDirectory = $petRoot
}
if ($res.ReturnValue -ne 0) { throw "failed to start pet (rc=$($res.ReturnValue))" }
"pet started (pid $($res.ProcessId))"
Start-Sleep -Seconds 6
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/dsh-pet-7340/config' -TimeoutSec 10
  "`nrestarted OK  moods.enabled = $($r.main.moods.enabled)"
} catch {
  "`nrestart done but config fetch failed: $($_.Exception.Message)"
}
