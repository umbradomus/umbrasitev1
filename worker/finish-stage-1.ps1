# FINISH STAGE 1 - sets the workers.dev subdomain over the API (no dashboard),
# then runs the deploy, then commits and pushes the worker folder.
# Reads wrangler's own sign-in token from this machine. Never prints it.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo    = Split-Path -Parent $Here
$Acct    = 'a757ce88e5d304fc3cab9196203b3d4c'
$Out     = Join-Path $Here 'FINISH-RESULT.txt'
$lines   = New-Object System.Collections.ArrayList
function L($t){ [void]$lines.Add($t); Write-Host $t }

L "FINISH-STAGE-1  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
L "============================================================"

# ---- 1. find wrangler's sign-in token -------------------------------------
$cands = @(
  (Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'),
  (Join-Path $env:USERPROFILE '.wrangler\config\default.toml'),
  (Join-Path $env:APPDATA '.wrangler\config\default.toml')
)
$tok = $null
foreach ($c in $cands) {
  if (Test-Path $c) {
    $txt = [System.IO.File]::ReadAllText($c)
    $m = [regex]::Match($txt, 'oauth_token\s*=\s*"([^"]+)"')
    if ($m.Success) { $tok = $m.Groups[1].Value; L "STEP A  found the Cloudflare sign-in"; break }
  }
}
if (-not $tok -and $env:CLOUDFLARE_API_TOKEN) { $tok = $env:CLOUDFLARE_API_TOKEN; L "STEP A  using CLOUDFLARE_API_TOKEN from the environment" }
if (-not $tok) {
  L "STEP A  FAIL - could not find wrangler's sign-in on this machine."
  $lines -join "`r`n" | Out-File -FilePath $Out -Encoding utf8
  exit 1
}
$hdr = @{ Authorization = "Bearer $tok" }

# ---- 2. the workers.dev subdomain -----------------------------------------
$base = "https://api.cloudflare.com/client/v4/accounts/$Acct/workers/subdomain"
$have = $null
try {
  $r = Invoke-RestMethod -Uri $base -Headers $hdr -Method GET -TimeoutSec 40
  if ($r.success -and $r.result -and $r.result.subdomain) { $have = $r.result.subdomain }
} catch { L "STEP B  no subdomain yet (that is expected)" }

if ($have) {
  L "STEP B  SKIP - subdomain already set: $have"
} else {
  $names = @('umbradomus','umbra-domus','umbradomus-tx','umbra-intake-ud')
  foreach ($n in $names) {
    try {
      $body = (@{ subdomain = $n } | ConvertTo-Json -Compress)
      $r = Invoke-RestMethod -Uri $base -Headers $hdr -Method PUT -Body $body -ContentType 'application/json' -TimeoutSec 40
      if ($r.success) { $have = $n; L "STEP B  PASS - subdomain set to $n"; break }
      else { L ("STEP B  '" + $n + "' refused: " + ($r.errors | ConvertTo-Json -Compress)) }
    } catch {
      L ("STEP B  '" + $n + "' refused: " + $_.Exception.Message)
    }
  }
}
if (-not $have) {
  L "STEP B  FAIL - could not set a workers.dev name. If Cloudflare's own service is down, run this again later."
  $lines -join "`r`n" | Out-File -FilePath $Out -Encoding utf8
  exit 2
}

# ---- 3. the deploy ---------------------------------------------------------
L ""
L "STEP C  running the deploy - this takes a few minutes"
L "============================================================"
& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'deploy-stage-1.ps1')
$rc = $LASTEXITCODE
L "============================================================"
L "STEP C  deploy exit code: $rc"

# ---- 4. the rest of the worker folder into git -----------------------------
if ($rc -eq 0) {
  Push-Location $Repo
  $g1 = (& git add worker 2>&1 | Out-String)
  $g2 = (& git commit -m "Stage 1: the intake Worker, its tests and README" 2>&1 | Out-String)
  $g3 = (& git push origin HEAD 2>&1 | Out-String)
  Pop-Location
  L "STEP D  git add/commit/push done"
  L ($g2.Trim())
  L ($g3.Trim())
} else {
  L "STEP D  skipped - the deploy stopped. Read DEPLOY-RESULT.md."
}

L ""
L "FINISHED at $(Get-Date -Format 'HH:mm:ss')"
$lines -join "`r`n" | Out-File -FilePath $Out -Encoding utf8
