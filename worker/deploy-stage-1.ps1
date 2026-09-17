<#
    UMBRA DOMUS - STAGE 1 DEPLOY
    ============================

    Puts the intake Worker on Cloudflare and switches the website's request form
    over to it. Drew does exactly two things: double-click DEPLOY-STAGE-1.cmd,
    and click Allow in the browser tab that opens once. Everything else is here.

    Written for Windows PowerShell 5.1 (the one that ships with Windows). It does
    not use any syntax newer than 5.1 - no ternaries, no null-coalescing, no
    -Parallel, no -AsHashtable.

    Safe to run again. Every step checks whether it has already been done:
    the KV namespace, the R2 bucket and the two secrets are never recreated or
    rotated on a second run.

        .\deploy-stage-1.ps1            the real thing
        .\deploy-stage-1.ps1 -SelfTest  runs the output-parsing tests only,
                                        touches no network and no files
#>

[CmdletBinding()]
param(
    [switch]$SelfTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'

# Windows PowerShell 5.1 still defaults to old TLS on some builds, and every
# Cloudflare endpoint requires 1.2 or better.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
} catch { }

# ============================================================================
# PATHS
# ============================================================================

$WorkerDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir    = Split-Path -Parent $WorkerDir
$TomlPath   = Join-Path $WorkerDir 'wrangler.toml'
$DevVarPath = Join-Path $WorkerDir '.dev.vars'
$JsPath     = Join-Path $RepoDir  'assets\umbra-endpoint.js'
$ResultPath = Join-Path $WorkerDir 'DEPLOY-RESULT.md'
$LogPath    = Join-Path $WorkerDir 'DEPLOY-LOG.txt'

$WorkerName = 'umbra-intake'
$KvBinding  = 'RECORDS'
$R2Bucket   = 'umbra-job-photos'

# ============================================================================
# LOGGING
# ============================================================================

$script:LogLines = New-Object System.Collections.ArrayList
$script:Steps    = New-Object System.Collections.ArrayList

function Get-Utf8NoBom {
    return (New-Object System.Text.UTF8Encoding($false))
}

function Write-TextFile {
    param([string]$Path, [string]$Text)
    # UTF-8 with no BOM. Set-Content -Encoding UTF8 writes a BOM on 5.1, and a
    # BOM at the top of wrangler.toml or a .js file is a real problem.
    [System.IO.File]::WriteAllText($Path, $Text, (Get-Utf8NoBom))
}

function Log {
    param([string]$Message, [string]$Colour = 'Gray')
    $stamp = (Get-Date).ToString('HH:mm:ss')
    [void]$script:LogLines.Add("[$stamp] $Message")
    try { Write-Host $Message -ForegroundColor $Colour } catch { Write-Host $Message }
}

function Log-Blank { Log '' }

function Log-Head {
    param([string]$Message)
    Log ''
    Log ('--- ' + $Message + ' ' + ('-' * [Math]::Max(1, 66 - $Message.Length))) 'Cyan'
}

function Log-Raw {
    param([string]$Text, [string]$Label = 'output')
    if ([string]::IsNullOrWhiteSpace($Text)) { return }
    foreach ($line in ($Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            [void]$script:LogLines.Add("           | $line")
        }
    }
}

function Add-Step {
    param(
        [int]$Number,
        [string]$Name,
        [string]$Status,          # PASS | SKIP | FAIL
        [string]$Detail = ''
    )
    [void]$script:Steps.Add([PSCustomObject]@{
        Number = $Number; Name = $Name; Status = $Status; Detail = $Detail
    })
    $colour = 'Green'
    if ($Status -eq 'FAIL') { $colour = 'Red' }
    if ($Status -eq 'SKIP') { $colour = 'DarkGray' }
    $line = ("  STEP {0,-2} {1,-4} {2}" -f $Number, $Status, $Name)
    if ($Detail) { $line = $line + "  -  " + $Detail }
    Log $line $colour
}

function Save-Log {
    $text = ($script:LogLines -join "`r`n") + "`r`n"
    # DEPLOY-LOG.txt is the file he is told to send to Claude when something looks
    # wrong, so neither password may survive in it. DEPLOY-RESULT.md keeps them -
    # that is the file he bookmarks from, and it never leaves his disk.
    try {
        if ($script:AdminKey) {
            $text = $text.Replace($script:AdminKey, '<ADMIN_KEY-hidden>')
            $text = $text.Replace([uri]::EscapeDataString($script:AdminKey), '<ADMIN_KEY-hidden>')
        }
        if ($script:NtfyTopic) { $text = $text.Replace($script:NtfyTopic, '<NTFY_TOPIC-hidden>') }
    } catch { }
    $header = "================ RUN $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) ================`r`n"
    try {
        [System.IO.File]::AppendAllText($LogPath, $header + $text + "`r`n", (Get-Utf8NoBom))
    } catch {
        Write-Host "could not append to $LogPath : $($_.Exception.Message)"
    }
}

# ============================================================================
# PURE FUNCTIONS - everything that reads wrangler's output or edits a file.
# These are what -SelfTest exercises. No network, no side effects.
# ============================================================================

function New-UrlSafeSecret {
    <# >= 32 random bytes, base64url, no padding. #>
    param([int]$Bytes = 32)
    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
    $s = [Convert]::ToBase64String($buf)
    return ($s -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

function Get-JsonBlock {
    <# Wrangler prints warnings and banners around its JSON. Pull out the first
       complete [...] or {...} so ConvertFrom-Json has something to chew on. #>
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $a = $Text.IndexOf('[')
    $b = $Text.LastIndexOf(']')
    if ($a -ge 0 -and $b -gt $a) { return $Text.Substring($a, $b - $a + 1) }
    $a = $Text.IndexOf('{')
    $b = $Text.LastIndexOf('}')
    if ($a -ge 0 -and $b -gt $a) { return $Text.Substring($a, $b - $a + 1) }
    return $null
}

function Get-KvIdFromCreateOutput {
    <# `kv namespace create` has printed its result three different ways across
       wrangler versions: a TOML block, a one-line object, and JSON. Every one of
       them contains the id as 32 hex characters, so that is what we look for -
       but prefer an explicit id = "..." / "id": "..." when one is present. #>
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    if ($Text -match '"id"\s*:\s*"([0-9a-fA-F]{32})"') { return $Matches[1].ToLower() }
    if ($Text -match 'id\s*=\s*"([0-9a-fA-F]{32})"')    { return $Matches[1].ToLower() }
    if ($Text -match 'id\s*:\s*"([0-9a-fA-F]{32})"')    { return $Matches[1].ToLower() }
    if ($Text -match '\b([0-9a-fA-F]{32})\b')           { return $Matches[1].ToLower() }
    return $null
}

function Get-KvIdFromListOutput {
    <# Find our namespace among all of them. Wrangler titles it
       "<worker-name>-<binding>", but older versions used just the binding, so
       accept both, plus anything ending in "-<binding>". #>
    param([string]$Text, [string]$WorkerName, [string]$Binding)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }

    $wanted = @(
        ($WorkerName + '-' + $Binding),
        $Binding,
        ($WorkerName + '-' + $Binding.ToLower())
    )

    $json = Get-JsonBlock $Text
    if ($json) {
        $parsed = $null
        try { $parsed = $json | ConvertFrom-Json } catch { $parsed = $null }
        if ($null -ne $parsed) {
            foreach ($row in @($parsed)) {
                $title = ''
                try { if ($row.PSObject.Properties['title']) { $title = [string]$row.title } } catch { }
                if (-not $title) {
                    try { if ($row.PSObject.Properties['name']) { $title = [string]$row.name } } catch { }
                }
                $id = ''
                try { if ($row.PSObject.Properties['id']) { $id = [string]$row.id } } catch { }
                if ($id -and $title) {
                    foreach ($w in $wanted) {
                        if ($title -eq $w) { return $id.ToLower() }
                    }
                    if ($title -match ('-' + [regex]::Escape($Binding) + '$')) { return $id.ToLower() }
                }
            }
            return $null
        }
    }

    # Not JSON: a table. Look for a line that mentions the binding and carries an id.
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match [regex]::Escape($Binding) -and $line -match '\b([0-9a-fA-F]{32})\b') {
            return $Matches[1].ToLower()
        }
    }
    return $null
}

function Test-R2BucketInListOutput {
    param([string]$Text, [string]$Name)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $json = Get-JsonBlock $Text
    if ($json) {
        $parsed = $null
        try { $parsed = $json | ConvertFrom-Json } catch { $parsed = $null }
        if ($null -ne $parsed) {
            $rows = @($parsed)
            # wrangler 4 wraps it: { "buckets": [ ... ] }
            if ($rows.Count -eq 1) {
                try {
                    if ($rows[0].PSObject.Properties['buckets']) { $rows = @($rows[0].buckets) }
                } catch { }
            }
            foreach ($row in $rows) {
                $n = ''
                try { if ($row.PSObject.Properties['name']) { $n = [string]$row.name } } catch { }
                if ($n -eq $Name) { return $true }
            }
            return $false
        }
    }
    # Table form: "name: umbra-job-photos"
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match ('(^|[\s:])' + [regex]::Escape($Name) + '(\s|$)')) { return $true }
    }
    return $false
}

function Get-R2CreateOutcome {
    <# created | exists | needs-enable | error #>
    param([string]$Text, [int]$ExitCode)
    $t = ''
    if ($Text) { $t = $Text.ToLower() }
    if ($t -match 'already (exists|owned)' -or $t -match '10004' -or $t -match 'bucket with that name') {
        return 'exists'
    }
    if ($t -match 'sign up for r2' -or $t -match 'enable r2' -or $t -match 'not entitled' -or
        $t -match 'r2 is not enabled' -or $t -match '10042' -or $t -match 'must purchase r2' -or
        $t -match 'subscription' ) {
        return 'needs-enable'
    }
    if ($ExitCode -eq 0) { return 'created' }
    if ($t -match 'created bucket' -or $t -match 'success') { return 'created' }
    return 'error'
}

function Test-WhoamiLoggedIn {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $t = $Text.ToLower()
    if ($t -match 'you are not authenticated' -or $t -match 'not logged in' -or
        $t -match 'no account id found' -or $t -match 'please run `?wrangler login') {
        return $false
    }
    if ($t -match 'you are logged in' -or $t -match 'account id' -or $t -match 'associated with the email') {
        return $true
    }
    return $false
}

function Get-AccountIdFromWhoami {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    if ($Text -match '\b([0-9a-f]{32})\b') { return $Matches[1] }
    return $null
}

function Get-WorkerUrlFromDeployOutput {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $m = [regex]::Matches($Text, 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.workers\.dev')
    if ($m.Count -gt 0) { return $m[$m.Count - 1].Value.TrimEnd('/') }
    return $null
}

function Test-DeployWantsSubdomain {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $t = $Text.ToLower()
    return ($t -match 'register a workers\.dev subdomain' -or $t -match 'you need to register a workers\.dev subdomain')
}

function Set-TomlValue {
    <# Replaces the value of a top-level-ish `key = "..."` line, keeping the rest
       of the file byte-for-byte. Only touches the first match, which is what we
       want for both id and PUBLIC_BASE_URL. #>
    param([string]$Toml, [string]$Key, [string]$Value)
    $pattern = '(?m)^(\s*' + [regex]::Escape($Key) + '\s*=\s*)"[^"]*"'
    if ($Toml -match $pattern) {
        return [regex]::Replace($Toml, $pattern, ('${1}"' + $Value.Replace('$', '$$') + '"'), 1)
    }
    return $Toml
}

function Get-TomlValue {
    param([string]$Toml, [string]$Key)
    $pattern = '(?m)^\s*' + [regex]::Escape($Key) + '\s*=\s*"([^"]*)"'
    if ($Toml -match $pattern) { return $Matches[1] }
    return $null
}

function Set-WorkerBaseInJs {
    <# The one line on the site. Matches whatever is currently between the quotes,
       so it works on a first run and on a re-run. #>
    param([string]$Js, [string]$Url)
    $pattern = "(?m)^(\s*window\.UMBRA_WORKER_BASE\s*=\s*)'[^']*'\s*;"
    if ($Js -match $pattern) {
        return [regex]::Replace($Js, $pattern, ('${1}''' + $Url.Replace('$', '$$') + ''';'), 1)
    }
    return $null
}

function Get-WorkerBaseFromJs {
    param([string]$Js)
    if ($Js -match "(?m)^\s*window\.UMBRA_WORKER_BASE\s*=\s*'([^']*)'\s*;") { return $Matches[1] }
    return $null
}

function Get-DevVarValue {
    param([string]$Text, [string]$Name)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $pattern = '(?m)^\s*' + [regex]::Escape($Name) + '\s*=\s*(.+?)\s*$'
    if ($Text -match $pattern) {
        $v = $Matches[1].Trim().Trim('"').Trim("'")
        if ($v) { return $v }
    }
    return $null
}

function Set-DevVarValue {
    param([string]$Text, [string]$Name, [string]$Value)
    if ($null -eq $Text) { $Text = '' }
    $pattern = '(?m)^\s*' + [regex]::Escape($Name) + '\s*=.*$'
    if ($Text -match $pattern) {
        return [regex]::Replace($Text, $pattern, ($Name + '=' + $Value.Replace('$', '$$')), 1)
    }
    $sep = ''
    if ($Text.Length -gt 0 -and -not $Text.EndsWith("`n")) { $sep = "`r`n" }
    return $Text + $sep + $Name + '=' + $Value + "`r`n"
}

function Normalise-Crlf {
    <# Keeps .dev.vars all-CRLF, so Notepad shows it as three lines rather than one. #>
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    return (($Text -replace "`r`n", "`n") -replace "`r", "`n") -replace "`n", "`r`n"
}

function Get-ChicagoStamp {
    <# America/Chicago without assuming the machine's zone. Windows calls it
       "Central Standard Time"; if that lookup ever fails we fall back to local
       time and say so, rather than printing a wrong hour as if it were right. #>
    $utc = (Get-Date).ToUniversalTime()
    try {
        $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
        $t = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
        $tag = 'CST'
        if ($tz.IsDaylightSavingTime($t)) { $tag = 'CDT' }
        return $t.ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $tag + ' (Brownsville)'
    } catch {
        return (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' (this computer''s clock; Central lookup failed)'
    }
}

# ============================================================================
# SELF TEST - the parsing above, against real wrangler output shapes.
# ============================================================================

function Invoke-SelfTest {
    $pass = 0; $fail = 0
    function T {
        param([bool]$Cond, [string]$Label, $Got)
        if ($Cond) {
            $script:pass++
            Write-Host ("  PASS  " + $Label) -ForegroundColor Green
        } else {
            $script:fail++
            Write-Host ("  FAIL  " + $Label + "   got: " + ($Got | Out-String).Trim()) -ForegroundColor Red
        }
    }
    $script:pass = 0; $script:fail = 0

    Write-Host ''
    Write-Host 'kv namespace create - three output shapes' -ForegroundColor Cyan
    $kvToml = @'
 ⛅️ wrangler 3.114.17
-------------------
🌀 Creating namespace with title "umbra-intake-RECORDS"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "RECORDS"
id = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
'@
    $r = Get-KvIdFromCreateOutput $kvToml
    T ($r -eq '0f1e2d3c4b5a69788796a5b4c3d2e1f0') 'TOML block (wrangler 3.x)' $r

    $kvOld = @'
🌀 Creating namespace with title "umbra-intake-RECORDS"
✨ Success!
Add the following to your wrangler.toml:
kv_namespaces = [
  { binding = "RECORDS", id = "AABBCCDDEEFF00112233445566778899" }
]
'@
    $r = Get-KvIdFromCreateOutput $kvOld
    T ($r -eq 'aabbccddeeff00112233445566778899') 'one-line object, upper-case id (wrangler 2.x)' $r

    $kvJson = '{"id":"11112222333344445555666677778888","title":"umbra-intake-RECORDS","supports_url_encoding":true}'
    $r = Get-KvIdFromCreateOutput $kvJson
    T ($r -eq '11112222333344445555666677778888') 'JSON object (wrangler 4.x)' $r

    $r = Get-KvIdFromCreateOutput "Authentication error [code: 10000]"
    T ($null -eq $r) 'an error yields no id' $r

    Write-Host ''
    Write-Host 'kv namespace list' -ForegroundColor Cyan
    $listJson = @'
 ⛅️ wrangler 3.114.17
-------------------
[
  { "id": "99998888777766665555444433332222", "title": "some-other-worker-CACHE", "supports_url_encoding": true },
  { "id": "abcdefabcdefabcdefabcdefabcdefab", "title": "umbra-intake-RECORDS", "supports_url_encoding": true }
]
'@
    $r = Get-KvIdFromListOutput $listJson 'umbra-intake' 'RECORDS'
    T ($r -eq 'abcdefabcdefabcdefabcdefabcdefab') 'picks ours out of several, ignores a lookalike' $r

    $r = Get-KvIdFromListOutput '[]' 'umbra-intake' 'RECORDS'
    T ($null -eq $r) 'empty list means not created yet' $r

    $listNoneOfOurs = '[{ "id": "99998888777766665555444433332222", "title": "other-CACHE" }]'
    $r = Get-KvIdFromListOutput $listNoneOfOurs 'umbra-intake' 'RECORDS'
    T ($null -eq $r) 'someone else''s namespace is not ours' $r

    $listBareBinding = '[{ "id": "12341234123412341234123412341234", "title": "RECORDS" }]'
    $r = Get-KvIdFromListOutput $listBareBinding 'umbra-intake' 'RECORDS'
    T ($r -eq '12341234123412341234123412341234') 'older naming (title is just the binding)' $r

    $listTable = @"
┌──────────────────────┬──────────────────────────────────┐
│ title                │ id                               │
│ umbra-intake-RECORDS │ 5555666677778888999900001111aaaa │
└──────────────────────┴──────────────────────────────────┘
"@
    $r = Get-KvIdFromListOutput $listTable 'umbra-intake' 'RECORDS'
    T ($r -eq '5555666677778888999900001111aaaa') 'table output, not JSON' $r

    Write-Host ''
    Write-Host 'r2 bucket' -ForegroundColor Cyan
    $r2List = '[{"name":"umbra-job-photos","creation_date":"2026-09-17T12:00:00.000Z"}]'
    T (Test-R2BucketInListOutput $r2List 'umbra-job-photos') 'bucket found in JSON list' $r2List
    T (-not (Test-R2BucketInListOutput '[]' 'umbra-job-photos')) 'empty list' ''
    $r2Wrapped = '{"buckets":[{"name":"umbra-job-photos","creation_date":"x"}]}'
    T (Test-R2BucketInListOutput $r2Wrapped 'umbra-job-photos') 'wrangler 4 wraps it in {buckets:[...]}' $r2Wrapped
    $r2Table = @"
name: umbra-job-photos
creation_date: 2026-09-17T12:00:00.000Z
"@
    T (Test-R2BucketInListOutput $r2Table 'umbra-job-photos') 'table output' $r2Table
    T (-not (Test-R2BucketInListOutput '[{"name":"something-else"}]' 'umbra-job-photos')) 'a different bucket is not ours' ''

    $r = Get-R2CreateOutcome "✨ Created bucket umbra-job-photos with default storage class set to Standard." 0
    T ($r -eq 'created') 'create succeeded' $r
    $r = Get-R2CreateOutcome "A bucket with that name already exists. [code: 10004]" 1
    T ($r -eq 'exists') 'already exists is not a failure' $r
    $r = Get-R2CreateOutcome "workers.api.error.r2_not_enabled: You must sign up for R2 before creating a bucket. [code: 10042]" 1
    T ($r -eq 'needs-enable') 'R2 not switched on yet' $r
    $r = Get-R2CreateOutcome "Please enable R2 in the Cloudflare dashboard" 1
    T ($r -eq 'needs-enable') 'R2 not switched on, other wording' $r
    $r = Get-R2CreateOutcome "Authentication error [code: 10000]" 1
    T ($r -eq 'error') 'a genuine error stays an error' $r

    Write-Host ''
    Write-Host 'whoami' -ForegroundColor Cyan
    $whoIn = @'
 ⛅️ wrangler 3.114.17
-------------------
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email umbradomus@gmail.com.
┌───────────────┬──────────────────────────────────┐
│ Account Name  │ Account ID                       │
│ Umbra Domus   │ a757ce88e5d304fc3cab9196203b3d4c │
└───────────────┴──────────────────────────────────┘
'@
    T (Test-WhoamiLoggedIn $whoIn) 'logged in' ''
    $r = Get-AccountIdFromWhoami $whoIn
    T ($r -eq 'a757ce88e5d304fc3cab9196203b3d4c') 'account id read out of whoami' $r
    T (-not (Test-WhoamiLoggedIn "You are not authenticated. Please run `wrangler login`.")) 'not logged in' ''
    T (-not (Test-WhoamiLoggedIn '')) 'no output is not logged in' ''

    Write-Host ''
    Write-Host 'deploy' -ForegroundColor Cyan
    $dep = @'
Total Upload: 24.11 KiB / gzip: 6.02 KiB
Your worker has access to the following bindings:
- KV Namespaces:
  - RECORDS: abcdefabcdefabcdefabcdefabcdefab
- R2 Buckets:
  - PHOTOS: umbra-job-photos
Uploaded umbra-intake (3.42 sec)
Deployed umbra-intake triggers (0.71 sec)
  https://umbra-intake.umbradomus.workers.dev
  schedule: */15 * * * *
Current Version ID: 7d2e...
'@
    $r = Get-WorkerUrlFromDeployOutput $dep
    T ($r -eq 'https://umbra-intake.umbradomus.workers.dev') 'workers.dev URL from a 3.x deploy' $r

    $depOld = @'
Uploaded umbra-intake (2.10 sec)
Published umbra-intake (1.02 sec)
  https://umbra-intake.drew-1234.workers.dev
'@
    $r = Get-WorkerUrlFromDeployOutput $depOld
    T ($r -eq 'https://umbra-intake.drew-1234.workers.dev') 'older "Published" wording' $r

    $r = Get-WorkerUrlFromDeployOutput 'Total Upload: 1 KiB'
    T ($null -eq $r) 'no URL in the output' $r

    T (Test-DeployWantsSubdomain 'You need to register a workers.dev subdomain before publishing to workers.dev') 'detects the subdomain prompt' ''
    T (-not (Test-DeployWantsSubdomain $dep)) 'a normal deploy is not the subdomain prompt' ''

    Write-Host ''
    Write-Host 'file edits' -ForegroundColor Cyan
    $toml = @'
name = "umbra-intake"
main = "src/index.js"

[vars]
SITE_BASE_URL = "https://www.umbradomus.com"
PUBLIC_BASE_URL = ""
SEED_LAST_ID = "2"

[[kv_namespaces]]
binding = "RECORDS"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
'@
    $t2 = Set-TomlValue $toml 'id' 'abcdefabcdefabcdefabcdefabcdefab'
    T ((Get-TomlValue $t2 'id') -eq 'abcdefabcdefabcdefabcdefabcdefab') 'KV id written into wrangler.toml' (Get-TomlValue $t2 'id')
    T ($t2 -match 'binding = "RECORDS"') 'and the rest of the file is untouched' ''
    $t3 = Set-TomlValue $t2 'PUBLIC_BASE_URL' 'https://umbra-intake.x.workers.dev'
    T ((Get-TomlValue $t3 'PUBLIC_BASE_URL') -eq 'https://umbra-intake.x.workers.dev') 'PUBLIC_BASE_URL written' (Get-TomlValue $t3 'PUBLIC_BASE_URL')
    T ((Get-TomlValue $t3 'SITE_BASE_URL') -eq 'https://www.umbradomus.com') 'SITE_BASE_URL not disturbed' (Get-TomlValue $t3 'SITE_BASE_URL')
    T ((Get-TomlValue $t3 'name') -eq 'umbra-intake') 'name not disturbed' (Get-TomlValue $t3 'name')
    T ((Set-TomlValue $toml 'NO_SUCH_KEY' 'x') -eq $toml) 'a key that is not there changes nothing' ''

    $js = @"
/* comment */
window.UMBRA_WORKER_BASE = '';

(function () { var x = 1; })();
"@
    $js2 = Set-WorkerBaseInJs $js 'https://umbra-intake.x.workers.dev'
    T ((Get-WorkerBaseFromJs $js2) -eq 'https://umbra-intake.x.workers.dev') 'the one line on the site is flipped' (Get-WorkerBaseFromJs $js2)
    T ($js2 -match 'var x = 1') 'and nothing else in the file moves' ''
    $js3 = Set-WorkerBaseInJs $js2 'https://other.workers.dev'
    T ((Get-WorkerBaseFromJs $js3) -eq 'https://other.workers.dev') 're-running replaces an existing URL' (Get-WorkerBaseFromJs $js3)
    T ($null -eq (Set-WorkerBaseInJs 'nothing here' 'x')) 'refuses a file without the line' ''

    $dv = "ADMIN_KEY=abc123`r`nNTFY_TOPIC=umbra-xyz`r`nALLOW_TEST_HOOKS=false`r`n"
    T ((Get-DevVarValue $dv 'ADMIN_KEY') -eq 'abc123') 'reads an existing ADMIN_KEY (never rotated)' (Get-DevVarValue $dv 'ADMIN_KEY')
    T ((Get-DevVarValue $dv 'NTFY_TOPIC') -eq 'umbra-xyz') 'reads an existing NTFY_TOPIC' (Get-DevVarValue $dv 'NTFY_TOPIC')
    T ($null -eq (Get-DevVarValue $dv 'NOPE')) 'a missing name reads as nothing' ''
    T ($null -eq (Get-DevVarValue "ADMIN_KEY=`r`n" 'ADMIN_KEY')) 'an empty value reads as nothing' ''
    $dv2 = Set-DevVarValue $dv 'ADMIN_KEY' 'newvalue'
    T ((Get-DevVarValue $dv2 'ADMIN_KEY') -eq 'newvalue') 'overwrites in place' ''
    T ((Get-DevVarValue $dv2 'NTFY_TOPIC') -eq 'umbra-xyz') 'without touching its neighbour' ''
    $dv3 = Set-DevVarValue '' 'ADMIN_KEY' 'first'
    T ((Get-DevVarValue $dv3 'ADMIN_KEY') -eq 'first') 'creates the file content from nothing' ''
    $dvQ = 'ADMIN_KEY="quoted-value"'
    T ((Get-DevVarValue $dvQ 'ADMIN_KEY') -eq 'quoted-value') 'strips quotes if the value was quoted' ''

    Write-Host ''
    Write-Host 'secrets' -ForegroundColor Cyan
    $s1 = New-UrlSafeSecret 32
    $s2 = New-UrlSafeSecret 32
    T ($s1.Length -ge 43) 'a 32-byte secret is at least 43 base64url characters' $s1.Length
    T ($s1 -match '^[A-Za-z0-9_-]+$') 'url-safe alphabet only, no padding' $s1
    T ($s1 -ne $s2) 'two runs give two different secrets' ''
    T ((New-UrlSafeSecret 32).Length -ge 43) 'repeatable' ''

    $mixed = "A=1`nB=2`r`nC=3`n"
    $fixed = Normalise-Crlf $mixed
    T (($fixed -split "`r`n").Count -eq 4 -and $fixed -notmatch "[^`r]`n") 'line endings normalised to CRLF' ([regex]::Escape($fixed))

    Write-Host ''
    Write-Host 'the Chicago stamp' -ForegroundColor Cyan
    $st = Get-ChicagoStamp
    T ($st -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') 'stamp has a date and a time' $st

    Write-Host ''
    Write-Host ("SELF TEST: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor (@('Green','Red')[[int]($script:fail -gt 0)])
    if ($script:fail -gt 0) { return 1 }
    return 0
}

if ($SelfTest) {
    $rc = Invoke-SelfTest
    exit $rc
}

# ============================================================================
# RUNNERS
# ============================================================================

function Invoke-Exe {
    <# Run a native command, capture stdout+stderr together, return
       @{ Out; Code }. Nothing here throws. #>
    # NOTE: the parameter is deliberately NOT called $Args - that collides with
    # PowerShell's automatic $args variable and the values arrive empty.
    param([string]$File, [string[]]$CmdArgs, [string]$StdIn = $null)

    $out = ''
    $code = -1
    try {
        # A [string] parameter left unset arrives as '' rather than $null, so test for
        # real content: the exact-bytes path below starts the child through
        # Process.Start, which resolves node.exe but cannot run a PATHEXT shim such as
        # npm.ps1. Only the secret puts genuinely feed stdin; everything else keeps the
        # ordinary call operator, which does resolve shims.
        if (-not [string]::IsNullOrEmpty($StdIn)) {
            # Windows PowerShell builds the child's stdin writer from
            # [Console]::InputEncoding. On this machine that is UTF-8 *with* a 3-byte
            # preamble, so a piped value reached the child as BOM + text, and
            # PowerShell appends a CRLF on top of that. `wrangler secret put` stores
            # exactly what it reads and trims nothing, so ADMIN_KEY and NTFY_TOPIC
            # went up as BOM + value + CRLF and no key ever matched. Write the bytes
            # onto the raw stream ourselves so the child gets the value and nothing
            # else. Clearing the preamble must happen before the process starts,
            # because the writer emits it as soon as it is constructed.
            $savedIn = [Console]::InputEncoding
            try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
            try {
                $psi = New-Object System.Diagnostics.ProcessStartInfo
                $psi.FileName               = $File
                $psi.Arguments              = (($CmdArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ')
                $psi.RedirectStandardInput  = $true
                $psi.RedirectStandardOutput = $true
                $psi.RedirectStandardError  = $true
                $psi.UseShellExecute        = $false
                $psi.CreateNoWindow         = $true
                $p = [System.Diagnostics.Process]::Start($psi)
                # Drain both pipes while the child runs, or a chatty child fills one
                # and blocks forever.
                $tOut = $p.StandardOutput.ReadToEndAsync()
                $tErr = $p.StandardError.ReadToEndAsync()
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($StdIn)
                $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
                $p.StandardInput.BaseStream.Flush()
                $p.StandardInput.Close()
                $p.WaitForExit()
                $out  = ($tOut.Result + $tErr.Result)
                $code = $p.ExitCode
            } finally {
                try { [Console]::InputEncoding = $savedIn } catch { }
            }
        } else {
            $out = (& $File @CmdArgs 2>&1 | Out-String)
            $code = $LASTEXITCODE
            if ($null -eq $code) { $code = 0 }
        }
    } catch {
        $out = $_.Exception.Message
        $code = -1
    }
    return @{ Out = $out; Code = $code }
}

$script:WranglerJs = $null

function Invoke-Wrangler {
    <# Calls the wrangler that npm install just put in node_modules, through node,
       rather than going via npx.cmd. One fewer shim to go wrong, and it cannot
       pick up a different wrangler from somewhere else on the machine. #>
    param([string[]]$CmdArgs, [string]$StdIn = $null)
    $all = @($script:WranglerJs) + $CmdArgs
    return (Invoke-Exe -File 'node' -CmdArgs $all -StdIn $StdIn)
}

function Invoke-WranglerEither {
    <# `kv namespace ...` in wrangler 3.60+, `kv:namespace ...` before that.
       Try the modern spelling, fall back on "Unknown argument". #>
    param([string[]]$Modern, [string[]]$Legacy)
    $r = Invoke-Wrangler -CmdArgs $Modern
    if ($r.Code -ne 0 -and ($r.Out -match 'Unknown argument' -or $r.Out -match 'Did you mean' -or $r.Out -match 'Unknown command')) {
        Log '      (this wrangler wants the older command spelling; retrying)' 'DarkGray'
        $r = Invoke-Wrangler -CmdArgs $Legacy
    }
    return $r
}

function Invoke-Http {
    <# GET, and never throw. Returns @{ Status; Body }. Works the same on
       PowerShell 5.1 and 7 - Invoke-WebRequest does not. #>
    param([string]$Url, [int]$TimeoutMs = 30000)
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = 'GET'
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.UserAgent = 'umbra-stage1-deploy'
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
        $sr.Close(); $resp.Close()
        return @{ Status = $code; Body = $body }
    } catch [System.Net.WebException] {
        $r = $null
        try { $r = $_.Exception.Response } catch { }
        if ($null -ne $r) {
            $code = 0
            try { $code = [int]$r.StatusCode } catch { }
            $body = ''
            try {
                $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
                $body = $sr.ReadToEnd(); $sr.Close()
            } catch { }
            return @{ Status = $code; Body = $body }
        }
        return @{ Status = 0; Body = $_.Exception.Message }
    } catch {
        return @{ Status = 0; Body = $_.Exception.Message }
    }
}

# ============================================================================
# THE RUN
# ============================================================================

$script:Stopped     = $null      # "STEP n: reason"
$script:WorkerUrl   = $null
$script:AdminKey    = $null
$script:NtfyTopic   = $null
$script:KvId        = $null
$script:AccountId   = $null
$script:SiteFlipped = $false
$script:Pushed      = $false
$script:SiteLive    = $false
$script:Notes       = New-Object System.Collections.ArrayList

function Stop-Here {
    param([int]$Step, [string]$Reason)
    $script:Stopped = ("STEP {0}: {1}" -f $Step, $Reason)
    Log ''
    Log '############################################################' 'Red'
    Log ("  STOPPED AT " + $script:Stopped) 'Red'
    Log '############################################################' 'Red'
}

function Note {
    param([string]$Text)
    [void]$script:Notes.Add($Text)
}

Log ''
Log '============================================================' 'White'
Log '  UMBRA DOMUS - STAGE 1 DEPLOY' 'White'
Log ("  " + (Get-ChicagoStamp)) 'White'
Log '============================================================' 'White'
Log ''
Log 'What this does, in order: checks your tools, logs you in to'
Log 'Cloudflare, makes the record store and the photo bucket, makes'
Log 'two passwords and stores them at Cloudflare, puts the Worker'
Log 'up, checks it answers, switches the website over, and pushes.'
Log ''
Log 'The only thing it needs from you is one click on Allow in the'
Log 'browser tab it is about to open.' 'Yellow'
Log ''

# --------------------------------------------------------------- STEP 1 tools
Log-Head 'STEP 1 - is node installed'
$nodeV = Invoke-Exe -File 'node' -CmdArgs @('--version')
if ($nodeV.Code -ne 0) {
    Add-Step 1 'node and npm are installed' 'FAIL' 'node was not found'
    Log ''
    Log 'Node.js is not installed on this computer, or Windows cannot find it.' 'Red'
    Log 'Install it from https://nodejs.org (take the big green LTS button),' 'Yellow'
    Log 'then double-click DEPLOY-STAGE-1.cmd again.' 'Yellow'
    Stop-Here 1 'Node.js is not installed. Get it from https://nodejs.org (LTS), then run this again.'
} else {
    $npmV = Invoke-Exe -File 'npm' -CmdArgs @('--version')
    if ($npmV.Code -ne 0) {
        Add-Step 1 'node and npm are installed' 'FAIL' 'npm was not found'
        Log 'Node is there but npm is not. Reinstall Node.js from https://nodejs.org.' 'Red'
        Stop-Here 1 'npm is missing. Reinstall Node.js from https://nodejs.org, then run this again.'
    } else {
        Add-Step 1 'node and npm are installed' 'PASS' ('node ' + $nodeV.Out.Trim() + ', npm ' + $npmV.Out.Trim())
    }
}

# ------------------------------------------------------------- STEP 2 install
if (-not $script:Stopped) {
    Log-Head 'STEP 2 - fetching what the Worker needs (about a minute)'
    Push-Location $WorkerDir
    $inst = Invoke-Exe -File 'npm' -CmdArgs @('install', '--no-fund', '--no-audit')
    Pop-Location
    Log-Raw $inst.Out
    $script:WranglerJs = Join-Path $WorkerDir 'node_modules\wrangler\bin\wrangler.js'
    if (-not (Test-Path $script:WranglerJs)) {
        Add-Step 2 'npm install' 'FAIL' 'wrangler did not land in node_modules'
        Log 'The download did not finish. The most likely cause is the internet' 'Red'
        Log 'connection dropping. Run DEPLOY-STAGE-1.cmd again.' 'Yellow'
        Stop-Here 2 'npm install did not produce node_modules\wrangler. Check the internet and run again.'
    } else {
        $wv = Invoke-Wrangler -CmdArgs @('--version')
        Add-Step 2 'npm install' 'PASS' ('wrangler ' + (($wv.Out -replace '[^0-9\.]', ' ').Trim() -split '\s+')[0])
    }
}

# --------------------------------------------------------------- STEP 3 login
if (-not $script:Stopped) {
    Log-Head 'STEP 3 - signing in to Cloudflare'
    $who = Invoke-Wrangler -CmdArgs @('whoami')
    Log-Raw $who.Out
    if (Test-WhoamiLoggedIn $who.Out) {
        $script:AccountId = Get-AccountIdFromWhoami $who.Out
        Add-Step 3 'signed in to Cloudflare' 'SKIP' 'already signed in'
    } else {
        Log ''
        Log '  >>> A BROWSER TAB IS ABOUT TO OPEN.' 'Yellow'
        Log '  >>> CLICK "Allow", THEN COME BACK TO THIS WINDOW.' 'Yellow'
        Log '  >>> This window will carry on by itself once you have.' 'Yellow'
        Log ''
        Start-Sleep -Seconds 2
        $login = Invoke-Wrangler -CmdArgs @('login')
        Log-Raw $login.Out
        $who = Invoke-Wrangler -CmdArgs @('whoami')
        Log-Raw $who.Out
        if (Test-WhoamiLoggedIn $who.Out) {
            $script:AccountId = Get-AccountIdFromWhoami $who.Out
            Add-Step 3 'signed in to Cloudflare' 'PASS' ('account ' + $script:AccountId)
        } else {
            Add-Step 3 'signed in to Cloudflare' 'FAIL' 'wrangler still says not signed in'
            Log 'Cloudflare did not confirm the sign-in. If the browser tab did not' 'Red'
            Log 'open, or you closed it, just run DEPLOY-STAGE-1.cmd again and click' 'Yellow'
            Log 'Allow when it appears.' 'Yellow'
            Stop-Here 3 'Cloudflare sign-in did not complete. Run this again and click Allow in the browser tab.'
        }
    }
}

# ------------------------------------------------------------------ STEP 4 KV
if (-not $script:Stopped) {
    Log-Head 'STEP 4 - the record store (KV)'
    $toml = [System.IO.File]::ReadAllText($TomlPath)
    $existing = Get-TomlValue $toml 'id'

    $listed = $null
    $list = Invoke-WranglerEither -Modern @('kv', 'namespace', 'list') -Legacy @('kv:namespace', 'list')
    Log-Raw $list.Out
    if ($list.Code -eq 0) { $listed = Get-KvIdFromListOutput $list.Out $WorkerName $KvBinding }

    if ($existing -and $existing -match '^[0-9a-fA-F]{32}$' -and $listed -and ($listed -eq $existing.ToLower())) {
        $script:KvId = $existing.ToLower()
        Add-Step 4 'record store exists and is wired up' 'SKIP' ('id ' + $script:KvId)
    } elseif ($listed) {
        $script:KvId = $listed
        $toml = Set-TomlValue $toml 'id' $script:KvId
        Write-TextFile $TomlPath $toml
        Add-Step 4 'record store already existed; wired it up' 'PASS' ('id ' + $script:KvId)
    } else {
        $mk = Invoke-WranglerEither -Modern @('kv', 'namespace', 'create', $KvBinding) -Legacy @('kv:namespace', 'create', $KvBinding)
        Log-Raw $mk.Out
        $id = Get-KvIdFromCreateOutput $mk.Out
        if ($mk.Code -ne 0 -or -not $id) {
            Add-Step 4 'record store created' 'FAIL' 'could not read an id back from Cloudflare'
            Log 'Cloudflare did not give back a record-store id. The exact reply is in' 'Red'
            Log 'worker\DEPLOY-LOG.txt. Send that file to Claude.' 'Yellow'
            Stop-Here 4 'creating the KV namespace RECORDS did not return an id. See DEPLOY-LOG.txt.'
        } else {
            $script:KvId = $id
            $toml = Set-TomlValue $toml 'id' $id
            Write-TextFile $TomlPath $toml
            $check = Get-TomlValue ([System.IO.File]::ReadAllText($TomlPath)) 'id'
            if ($check -ne $id) {
                Add-Step 4 'record store created' 'FAIL' 'the id did not save into wrangler.toml'
                Stop-Here 4 'the KV id would not write into wrangler.toml. Is the file read-only?'
            } else {
                Add-Step 4 'record store created' 'PASS' ('id ' + $id)
            }
        }
    }
}

# ------------------------------------------------------------------ STEP 5 R2
if (-not $script:Stopped) {
    Log-Head 'STEP 5 - the photo bucket (R2)'
    $have = $false
    $bl = Invoke-Wrangler -CmdArgs @('r2', 'bucket', 'list')
    Log-Raw $bl.Out
    if ($bl.Code -eq 0) { $have = Test-R2BucketInListOutput $bl.Out $R2Bucket }

    if ($have) {
        Add-Step 5 'photo bucket exists' 'SKIP' $R2Bucket
    } else {
        $mk = Invoke-Wrangler -CmdArgs @('r2', 'bucket', 'create', $R2Bucket)
        Log-Raw $mk.Out
        $outcome = Get-R2CreateOutcome $mk.Out $mk.Code
        if ($outcome -eq 'created' -or $outcome -eq 'exists') {
            Add-Step 5 'photo bucket ready' 'PASS' ($R2Bucket + ' (' + $outcome + ')')
        } elseif ($outcome -eq 'needs-enable') {
            Add-Step 5 'photo bucket ready' 'FAIL' 'R2 is not switched on for this account yet'
            Log ''
            Log '  R2 - the photo storage - has to be switched on once, by hand.' 'Yellow'
            Log '  It is free and it takes about fifteen seconds.' 'Yellow'
            Log ''
            Log '  1. Open this address:' 'Yellow'
            Log ('     https://dash.cloudflare.com/' + [string]$script:AccountId + '/r2/overview') 'White'
            Log '  2. Click the purple button that says Enable R2 / Get started,' 'Yellow'
            Log '     and accept. There is nothing to pay and no card to enter.' 'Yellow'
            Log '  3. Come back and double-click DEPLOY-STAGE-1.cmd again.' 'Yellow'
            Log '     It carries on from here - nothing is lost.' 'Yellow'
            Log ''
            Stop-Here 5 ('R2 needs switching on once. Open https://dash.cloudflare.com/' + [string]$script:AccountId + '/r2/overview , click Enable R2, then run DEPLOY-STAGE-1.cmd again.')
        } else {
            Add-Step 5 'photo bucket ready' 'FAIL' 'Cloudflare refused to make the bucket'
            Log 'Cloudflare would not make the photo bucket. The exact reply is in' 'Red'
            Log 'worker\DEPLOY-LOG.txt. Send that file to Claude.' 'Yellow'
            Stop-Here 5 'creating the R2 bucket failed. See DEPLOY-LOG.txt.'
        }
    }
}

# ------------------------------------------------- STEP 6 the two passwords
if (-not $script:Stopped) {
    Log-Head 'STEP 6 - the two passwords'

    # Three files hold the passwords or print them: .dev.vars, and the two files
    # this script writes at the end. Every one of them has to be excluded from git
    # BEFORE anything is written into any of them. DEPLOY-RESULT.md carries the
    # admin key inside a URL, so a stray `git add -A` later would publish it.
    $mustIgnore = @('worker/.dev.vars', 'worker/DEPLOY-RESULT.md', 'worker/DEPLOY-LOG.txt')

    $gi = Join-Path $RepoDir '.gitignore'
    $giText = ''
    if (Test-Path $gi) { $giText = [System.IO.File]::ReadAllText($gi) }
    $giChanged = $false
    foreach ($f in $mustIgnore) {
        $line = '(?m)^\s*' + [regex]::Escape($f) + '\s*$'
        if ($giText -notmatch $line) {
            $sep = ''
            if ($giText.Length -gt 0 -and -not $giText.EndsWith("`n")) { $sep = "`r`n" }
            $giText = $giText + $sep + $f + "`r`n"
            $giChanged = $true
            Log ('  added ' + $f + ' to .gitignore before writing anything into it') 'Yellow'
        }
    }
    if ($giChanged) { Write-TextFile $gi $giText }

    $notIgnored = @()
    Push-Location $RepoDir
    foreach ($f in $mustIgnore) {
        $ci = Invoke-Exe -File 'git' -CmdArgs @('check-ignore', '-q', $f)
        if ($ci.Code -ne 0) { $notIgnored += $f }
    }
    Pop-Location
    $ignored = ($notIgnored.Count -eq 0)

    if (-not $ignored) {
        Add-Step 6 'the two passwords' 'FAIL' ('not git-ignored: ' + ($notIgnored -join ', '))
        Log 'Refusing to write the passwords, because I cannot prove these files are' 'Red'
        Log 'excluded from git. Nothing was written.' 'Red'
        foreach ($f in $notIgnored) { Log ('  not ignored: ' + $f) 'Red' }
        Stop-Here 6 ('these would-be-secret files are not git-ignored, so nothing was written: ' + ($notIgnored -join ', '))
    } else {
        $dv = ''
        if (Test-Path $DevVarPath) { $dv = [System.IO.File]::ReadAllText($DevVarPath) }
        $script:AdminKey  = Get-DevVarValue $dv 'ADMIN_KEY'
        $script:NtfyTopic = Get-DevVarValue $dv 'NTFY_TOPIC'

        $reused = @()
        if ($script:AdminKey -and $script:AdminKey -ne 'change-me-to-something-long-and-random') {
            $reused += 'ADMIN_KEY'
        } else {
            $script:AdminKey = New-UrlSafeSecret 32
        }
        if ($script:NtfyTopic -and $script:NtfyTopic -ne 'umbra-intake-change-me') {
            $reused += 'NTFY_TOPIC'
        } else {
            # ntfy allows [-_A-Za-z0-9]; trim the ends so it reads as a name and not
            # as punctuation when he types it into the app.
            $rand = ((New-UrlSafeSecret 12).ToLower() -replace '[-_]', '')
            $script:NtfyTopic = 'umbra-' + $rand
        }

        $dv = Set-DevVarValue $dv 'ADMIN_KEY' $script:AdminKey
        $dv = Set-DevVarValue $dv 'NTFY_TOPIC' $script:NtfyTopic
        if ($null -eq (Get-DevVarValue $dv 'ALLOW_TEST_HOOKS')) {
            $dv = Set-DevVarValue $dv 'ALLOW_TEST_HOOKS' 'false'
        }
        Write-TextFile $DevVarPath (Normalise-Crlf $dv)

        $detail = 'made both'
        if ($reused.Count -gt 0) { $detail = 'reused ' + ($reused -join ' and ') + ' (never rotated on a re-run)' }
        Add-Step 6 'the two passwords, written to worker\.dev.vars' 'PASS' $detail
    }
}

# ----------------------------------------------------- STEP 7 the first deploy
# Deliberately before the secrets go up: `wrangler secret put` on a Worker that
# does not exist yet stops and ASKS whether to create one, which would hang this
# window forever. Deploying first means the Worker is there to attach them to.
# It is safe: with no ADMIN_KEY set, every admin address answers 404.
if (-not $script:Stopped) {
    Log-Head 'STEP 7 - putting the Worker up'
    Push-Location $WorkerDir
    $dep = Invoke-Wrangler -CmdArgs @('deploy')
    Pop-Location
    Log-Raw $dep.Out
    $url = Get-WorkerUrlFromDeployOutput $dep.Out

    if (Test-DeployWantsSubdomain $dep.Out) {
        Add-Step 7 'the Worker is up' 'FAIL' 'this account has no workers.dev address yet'
        Log ''
        Log '  Cloudflare wants you to pick a free workers.dev address once.' 'Yellow'
        Log '  1. Open this address:' 'Yellow'
        Log ('     https://dash.cloudflare.com/' + [string]$script:AccountId + '/workers/subdomain') 'White'
        Log '  2. Type anything you like (umbradomus is fine) and save.' 'Yellow'
        Log '  3. Come back and double-click DEPLOY-STAGE-1.cmd again.' 'Yellow'
        Log ''
        Stop-Here 7 ('this Cloudflare account has no workers.dev subdomain yet. Set one at https://dash.cloudflare.com/' + [string]$script:AccountId + '/workers/subdomain , then run DEPLOY-STAGE-1.cmd again.')
    } elseif ($dep.Code -ne 0 -or -not $url) {
        Add-Step 7 'the Worker is up' 'FAIL' 'the upload did not report an address'
        Log 'The Worker did not go up. The exact reply is in worker\DEPLOY-LOG.txt.' 'Red'
        Log 'Send that file to Claude.' 'Yellow'
        Stop-Here 7 'wrangler deploy failed or printed no workers.dev address. See DEPLOY-LOG.txt.'
    } else {
        $script:WorkerUrl = $url
        Add-Step 7 'the Worker is up' 'PASS' $url
    }
}

# -------------------------------------------- STEP 8 the passwords to Cloudflare
if (-not $script:Stopped) {
    Log-Head 'STEP 8 - storing the two passwords at Cloudflare'
    Push-Location $WorkerDir
    $s1 = Invoke-Wrangler -CmdArgs @('secret', 'put', 'ADMIN_KEY')  -StdIn $script:AdminKey
    $s2 = Invoke-Wrangler -CmdArgs @('secret', 'put', 'NTFY_TOPIC') -StdIn $script:NtfyTopic
    Pop-Location
    # Never log the values, only whether it worked.
    Log-Raw ($s1.Out -replace [regex]::Escape($script:AdminKey), '<hidden>')
    Log-Raw ($s2.Out -replace [regex]::Escape($script:NtfyTopic), '<hidden>')
    if ($s1.Code -ne 0 -or $s2.Code -ne 0) {
        Add-Step 8 'passwords stored at Cloudflare' 'FAIL' ('exit ' + $s1.Code + ' / ' + $s2.Code)
        Log 'Cloudflare would not take the passwords. The reply is in' 'Red'
        Log 'worker\DEPLOY-LOG.txt. Send that file to Claude.' 'Yellow'
        Stop-Here 8 'wrangler secret put failed. See DEPLOY-LOG.txt.'
    } else {
        Add-Step 8 'passwords stored at Cloudflare' 'PASS' 'ADMIN_KEY and NTFY_TOPIC'
    }
}

# ---------------------------- STEP 9 tell the Worker its own address, redeploy
if (-not $script:Stopped) {
    Log-Head 'STEP 9 - telling the Worker its own address, and putting it up again'
    $toml = [System.IO.File]::ReadAllText($TomlPath)
    $already = Get-TomlValue $toml 'PUBLIC_BASE_URL'
    if ($already -ne $script:WorkerUrl) {
        $toml = Set-TomlValue $toml 'PUBLIC_BASE_URL' $script:WorkerUrl
        Write-TextFile $TomlPath $toml
    }
    Push-Location $WorkerDir
    $dep2 = Invoke-Wrangler -CmdArgs @('deploy')
    Pop-Location
    Log-Raw $dep2.Out
    if ($dep2.Code -ne 0) {
        Add-Step 9 'the Worker knows its own address' 'FAIL' 'the second upload failed'
        Stop-Here 9 'the second wrangler deploy failed. See DEPLOY-LOG.txt.'
    } else {
        Add-Step 9 'the Worker knows its own address' 'PASS' 'the 90-minute push will link straight to your list'
    }
}

# ------------------------------------------------------------- STEP 10 verify
if (-not $script:Stopped) {
    Log-Head 'STEP 10 - checking it actually answers'
    $adminUrl = $script:WorkerUrl + '/admin?k=' + [uri]::EscapeDataString($script:AdminKey)
    $jobsUrl  = $script:WorkerUrl + '/api/jobs?k=' + [uri]::EscapeDataString($script:AdminKey)

    # Cloudflare can take a few seconds to start serving a brand-new Worker.
    $health = @{ Status = 0; Body = '' }
    for ($i = 0; $i -lt 10; $i++) {
        $health = Invoke-Http ($script:WorkerUrl + '/health')
        if ($health.Status -eq 200) { break }
        Start-Sleep -Seconds 3
    }

    $admin  = Invoke-Http $adminUrl
    $jobs   = Invoke-Http $jobsUrl
    $noJob  = Invoke-Http ($script:WorkerUrl + '/api/job/U-0000?t=x')
    $noKey  = Invoke-Http ($script:WorkerUrl + '/api/jobs?k=definitely-wrong')

    $problems = @()
    if ($health.Status -ne 200) { $problems += ('/health answered ' + $health.Status) }
    if ($admin.Status -ne 200)  { $problems += ('/admin with the key answered ' + $admin.Status) }
    if ($admin.Status -eq 200 -and $admin.Body -notmatch 'oldest unquoted first') {
        $problems += '/admin did not serve the aging list'
    }
    if ($jobs.Status -ne 200)   { $problems += ('/api/jobs with the key answered ' + $jobs.Status) }
    if ($jobs.Status -eq 200 -and $jobs.Body -notmatch '"count"\s*:\s*0') {
        # Not empty is not wrong if he has already sent a test request, so this is
        # a note rather than a failure.
        Note 'The list was not empty on the first check - there is already at least one request in it. That is fine if you have tested the form.'
    }
    if ($noJob.Status -ne 404)  { $problems += ('a made-up request id answered ' + $noJob.Status + ', not 404') }
    if ($noKey.Status -ne 404)  { $problems += ('a wrong password answered ' + $noKey.Status + ', not 404') }

    if ($problems.Count -gt 0) {
        Add-Step 10 'the Worker answers correctly' 'FAIL' ($problems -join '; ')
        Log ''
        foreach ($p in $problems) { Log ('  wrong: ' + $p) 'Red' }
        Log ''
        Log 'The Worker is up but it is not answering the way it should, so the' 'Red'
        Log 'website has NOT been switched over. Send worker\DEPLOY-RESULT.md to' 'Yellow'
        Log 'Claude.' 'Yellow'
        Stop-Here 10 ('the Worker is live but failed its checks: ' + ($problems -join '; '))
    } else {
        Add-Step 10 'the Worker answers correctly' 'PASS' 'empty list with the key, 404 without it'
    }
}

# ----------------------------------------------------- STEP 11 flip the site
if (-not $script:Stopped) {
    Log-Head 'STEP 11 - switching the website over'
    if (-not (Test-Path $JsPath)) {
        Add-Step 11 'the website points at the Worker' 'FAIL' 'assets\umbra-endpoint.js is missing'
        Stop-Here 11 'assets\umbra-endpoint.js was not found. The site files may have moved.'
    } else {
        $js = [System.IO.File]::ReadAllText($JsPath)
        $was = Get-WorkerBaseFromJs $js
        if ($was -eq $script:WorkerUrl) {
            $script:SiteFlipped = $true
            Add-Step 11 'the website points at the Worker' 'SKIP' 'already pointing at it'
        } else {
            $js2 = Set-WorkerBaseInJs $js $script:WorkerUrl
            if ($null -eq $js2) {
                Add-Step 11 'the website points at the Worker' 'FAIL' 'the one line was not found in the file'
                Stop-Here 11 'could not find window.UMBRA_WORKER_BASE in assets\umbra-endpoint.js.'
            } else {
                Write-TextFile $JsPath $js2
                $now = Get-WorkerBaseFromJs ([System.IO.File]::ReadAllText($JsPath))
                if ($now -ne $script:WorkerUrl) {
                    Add-Step 11 'the website points at the Worker' 'FAIL' 'the change did not save'
                    Stop-Here 11 'assets\umbra-endpoint.js would not save. Is it read-only or open in an editor?'
                } else {
                    $script:SiteFlipped = $true
                    Add-Step 11 'the website points at the Worker' 'PASS' ('was "' + [string]$was + '", now ' + $script:WorkerUrl)
                }
            }
        }
    }
}

# --------------------------------------------------- STEP 12 commit and push
if (-not $script:Stopped) {
    Log-Head 'STEP 12 - saving and publishing the change'
    Push-Location $RepoDir
    try {
        $gv = Invoke-Exe -File 'git' -CmdArgs @('--version')
        if ($gv.Code -ne 0) {
            Add-Step 12 'published to the website' 'FAIL' 'git is not installed'
            Note 'git is not installed, so the switch is on this computer but not on the live site. The Worker itself IS live.'
            Stop-Here 12 'git is not installed, so the site change could not be published. The Worker is live.'
        } else {
            $branch = (Invoke-Exe -File 'git' -CmdArgs @('rev-parse', '--abbrev-ref', 'HEAD')).Out.Trim()
            if (-not $branch) { $branch = 'main' }

            # Only what this deploy touched. Nothing else, and never .dev.vars.
            $toAdd = @('assets/umbra-endpoint.js', 'worker/wrangler.toml')
            if ((Invoke-Exe -File 'git' -CmdArgs @('check-ignore', '-q', '.gitignore')).Code -ne 0) {
                $st = Invoke-Exe -File 'git' -CmdArgs @('status', '--porcelain', '--', '.gitignore')
                if ($st.Out.Trim()) { $toAdd += '.gitignore' }
            }
            foreach ($f in $toAdd) {
                $a = Invoke-Exe -File 'git' -CmdArgs (@('add', '--') + $f)
                if ($a.Code -ne 0) { Log-Raw $a.Out }
            }

            # Belt and braces: refuse to go on if a secret somehow got staged.
            $staged = (Invoke-Exe -File 'git' -CmdArgs @('diff', '--cached', '--name-only')).Out
            if ($staged -match '\.dev\.vars') {
                Add-Step 12 'published to the website' 'FAIL' '.dev.vars was staged - refused'
                Invoke-Exe -File 'git' -CmdArgs @('reset') | Out-Null
                Stop-Here 12 'the secrets file was about to be committed. Nothing was committed. Tell Claude.'
            } else {
                Log-Raw $staged 'staged'
                $anything = (Invoke-Exe -File 'git' -CmdArgs @('diff', '--cached', '--quiet')).Code
                if ($anything -eq 0) {
                    Add-Step 12 'saved locally' 'SKIP' 'nothing new to save'
                } else {
                    $cm = Invoke-Exe -File 'git' -CmdArgs @('commit', '-m', 'WSS Stage 1: intake Worker live')
                    Log-Raw $cm.Out
                    if ($cm.Code -ne 0) {
                        Add-Step 12 'published to the website' 'FAIL' 'git commit failed'
                        Stop-Here 12 'git commit failed. See DEPLOY-LOG.txt. The Worker is live.'
                    } else {
                        Add-Step 12 'saved locally' 'PASS' ('committed on ' + $branch)
                    }
                }

                if (-not $script:Stopped) {
                    $remotes = (Invoke-Exe -File 'git' -CmdArgs @('remote')).Out.Trim()
                    if (-not $remotes) {
                        Add-Step 13 'published to the website' 'FAIL' 'this folder has no git remote'
                        Log ''
                        Log '  The change is saved on this computer but there is nowhere to push' 'Yellow'
                        Log '  it to - this folder is not connected to GitHub. The Worker IS live.' 'Yellow'
                        Log '  The website will keep using the old email-only form until the' 'Yellow'
                        Log '  change reaches Vercel.' 'Yellow'
                        Log ''
                        Stop-Here 13 'no git remote, so the site change could not be published. The Worker is live and the change is committed locally.'
                    } else {
                        Log ('  pushing ' + $branch + ' to origin (this can ask for a GitHub login)') 'Gray'
                        $ps = Invoke-Exe -File 'git' -CmdArgs @('push', 'origin', $branch)
                        Log-Raw $ps.Out
                        if ($ps.Code -ne 0) {
                            Add-Step 13 'published to the website' 'FAIL' 'git push was refused'
                            Log ''
                            Log '  The push was refused - almost always a GitHub login.' 'Yellow'
                            Log '  Your change is saved on this computer and nothing is lost.' 'Yellow'
                            Log '  The Worker IS live. Only the website switch is unpublished.' 'Yellow'
                            Log '  Not retrying, so this window does not sit here asking forever.' 'Yellow'
                            Log ''
                            Stop-Here 13 'git push origin failed, most likely a GitHub login. The Worker is live and the commit is saved locally.'
                        } else {
                            $script:Pushed = $true
                            Add-Step 13 'published to the website' 'PASS' ('pushed ' + $branch + ' to origin')
                        }
                    }
                }
            }
        }
    } finally {
        Pop-Location
    }
}

# ----------------------------------------------- STEP 14 wait for the website
if (-not $script:Stopped -and $script:Pushed) {
    Log-Head 'STEP 14 - waiting for umbradomus.com to pick it up (up to 3 minutes)'
    $deadline = (Get-Date).AddMinutes(3)
    $seen = $false
    while ((Get-Date) -lt $deadline) {
        $r = Invoke-Http ('https://umbradomus.com/assets/umbra-endpoint.js?cachebust=' + [Guid]::NewGuid().ToString('N'))
        if ($r.Status -eq 200) {
            $live = Get-WorkerBaseFromJs $r.Body
            if ($live -eq $script:WorkerUrl) { $seen = $true; break }
            Log ('  not yet - the live site still says "' + [string]$live + '"') 'DarkGray'
        } else {
            Log ('  the site answered ' + $r.Status + '; trying again') 'DarkGray'
        }
        Start-Sleep -Seconds 10
    }
    if ($seen) {
        $script:SiteLive = $true
        Add-Step 14 'umbradomus.com is using the Worker' 'PASS' 'the live site now carries the new address'
    } else {
        Add-Step 14 'umbradomus.com is using the Worker' 'FAIL' 'not there after 3 minutes'
        Note 'Vercel had not picked up the change after three minutes. That is usually just slow, not broken - check umbradomus.com again in a few minutes. Everything else is done.'
    }
}

# ============================================================================
# THE RESULT FILE
# ============================================================================

$stamp = Get-ChicagoStamp
$adminUrlFull = ''
if ($script:WorkerUrl -and $script:AdminKey) {
    $adminUrlFull = $script:WorkerUrl + '/admin?k=' + [uri]::EscapeDataString($script:AdminKey)
}

$verdict = 'STAGE 1 IS ON'
if ($script:Stopped) { $verdict = 'STOPPED AT ' + $script:Stopped }
# Step 14 being slow does not undo a live Worker on a pushed site.
if (-not $script:Stopped -and -not $script:SiteLive -and $script:Pushed) { $verdict = 'STAGE 1 IS ON' }

$r = New-Object System.Collections.ArrayList
[void]$r.Add('# STAGE 1 DEPLOY - RESULT')
[void]$r.Add('')
[void]$r.Add('**' + $stamp + '**')
[void]$r.Add('')
[void]$r.Add('## ' + $verdict)
[void]$r.Add('')
if (-not $script:Stopped) {
    [void]$r.Add('The request form on umbradomus.com now posts to a Worker you own. Every request')
    [void]$r.Add('gets a number, a record, its photos kept, a status link for the customer - and')
    [void]$r.Add('**the same email still lands in your inbox, exactly as before.** Two channels.')
} else {
    [void]$r.Add('Nothing is broken and nothing was lost. Read the reason above, do the one thing')
    [void]$r.Add('it asks for, and double-click **DEPLOY-STAGE-1.cmd** again - it picks up from')
    [void]$r.Add('where it stopped.')
}
[void]$r.Add('')
[void]$r.Add('---')
[void]$r.Add('')
[void]$r.Add('## THE THINGS YOU NEED')
[void]$r.Add('')
[void]$r.Add('| | |')
[void]$r.Add('|---|---|')
if ($adminUrlFull) {
    [void]$r.Add('| **Your list - bookmark this on your phone** | ' + $adminUrlFull + ' |')
} else {
    [void]$r.Add('| **Your list** | not available - the deploy stopped before this |')
}
if ($script:WorkerUrl) {
    [void]$r.Add('| The Worker | ' + $script:WorkerUrl + ' |')
} else {
    [void]$r.Add('| The Worker | not up yet |')
}
if ($script:NtfyTopic) {
    [void]$r.Add('| **Your ntfy topic** - subscribe to this exact name in the ntfy Android app | `' + $script:NtfyTopic + '` |')
}
if ($script:KvId)      { [void]$r.Add('| Record store (KV) id | `' + $script:KvId + '` |') }
if ($script:AccountId) { [void]$r.Add('| Cloudflare account | `' + $script:AccountId + '` |') }
[void]$r.Add('')
[void]$r.Add('The list address has the password in it. **That link is the password** - anyone')
[void]$r.Add('who has it can see your customers. Do not post it anywhere. Both passwords are')
[void]$r.Add('in `worker\.dev.vars`, which git ignores, so they never leave this computer')
[void]$r.Add('except into Cloudflare itself.')
[void]$r.Add('')
[void]$r.Add('**If you send this file to Claude, delete the `?k=...` part first.** Claude does')
[void]$r.Add('not need it, and a chat is not a place to keep a password. `DEPLOY-LOG.txt`')
[void]$r.Add('already has both blanked out, so that one is safe to send as it is.')
[void]$r.Add('')
if ($script:NtfyTopic) {
    [void]$r.Add('## THE ONE THING LEFT FOR YOU')
    [void]$r.Add('')
    [void]$r.Add('Install **ntfy** from the Play Store, tap Subscribe, and type in:')
    [void]$r.Add('')
    [void]$r.Add('    ' + $script:NtfyTopic)
    [void]$r.Add('')
    [void]$r.Add('That is where the 90-minute nudge lands. Until you do that, the clock still')
    [void]$r.Add('runs and the list still works - you just will not be poked.')
    [void]$r.Add('')
}
[void]$r.Add('---')
[void]$r.Add('')
[void]$r.Add('## EVERY STEP')
[void]$r.Add('')
[void]$r.Add('| step | what it was | result | detail |')
[void]$r.Add('|---|---|---|---|')
foreach ($s in $script:Steps) {
    $d = $s.Detail
    if (-not $d) { $d = '' }
    [void]$r.Add('| ' + $s.Number + ' | ' + $s.Name + ' | **' + $s.Status + '** | ' + ($d -replace '\|', '\|') + ' |')
}
[void]$r.Add('')
if ($script:Notes.Count -gt 0) {
    [void]$r.Add('## WORTH KNOWING')
    [void]$r.Add('')
    foreach ($n in $script:Notes) { [void]$r.Add('- ' + $n) }
    [void]$r.Add('')
}
[void]$r.Add('## STILL NOT IN GIT')
[void]$r.Add('')
[void]$r.Add('This deploy only committed `assets/umbra-endpoint.js` and `worker/wrangler.toml`,')
[void]$r.Add('because those are the two files it changed. **The rest of the `worker/` folder -')
[void]$r.Add('the Worker''s own source, its tests and its README - is still untracked in git.**')
[void]$r.Add('It is on this disk and it is what is running at Cloudflare, but it is not in the')
[void]$r.Add('repository history. That wants a separate commit; ask Claude for it.')
[void]$r.Add('')
[void]$r.Add('## IF SOMETHING LOOKS WRONG')
[void]$r.Add('')
[void]$r.Add('`worker\DEPLOY-LOG.txt` has every command and every reply from every run,')
[void]$r.Add('with the passwords blanked out. Send that file and this one to Claude.')
[void]$r.Add('')
[void]$r.Add('To put the site back exactly as it was, set the one line in')
[void]$r.Add('`assets\umbra-endpoint.js` back to two quote marks:')
[void]$r.Add('')
[void]$r.Add('    window.UMBRA_WORKER_BASE = '''';')
[void]$r.Add('')
[void]$r.Add('then commit and push. Nothing is lost by doing that - the Worker forwards every')
[void]$r.Add('request to the same email relay you use today.')
[void]$r.Add('')
[void]$r.Add('---')
[void]$r.Add('*Written by `worker\deploy-stage-1.ps1`. Nothing was deleted. Safe to run again.*')
[void]$r.Add('')

try {
    Write-TextFile $ResultPath ($r -join "`r`n")
    Log ''
    Log ('Written: ' + $ResultPath) 'Cyan'
} catch {
    Log ('could not write ' + $ResultPath + ' : ' + $_.Exception.Message) 'Red'
}

# ============================================================================
# THE SUMMARY ON SCREEN
# ============================================================================

Log ''
Log '============================================================' 'White'
if ($script:Stopped) {
    Log ('  STOPPED AT ' + $script:Stopped) 'Red'
} else {
    Log '  STAGE 1 IS ON' 'Green'
}
Log '============================================================' 'White'
Log ''
if (-not $script:Stopped) {
    Log 'Your list, with the password in it - bookmark it on your phone:' 'White'
    Log ('  ' + $adminUrlFull) 'Green'
    Log ''
    Log 'Your ntfy topic - subscribe to this exact name in the ntfy app:' 'White'
    Log ('  ' + $script:NtfyTopic) 'Green'
    Log ''
    if (-not $script:SiteLive) {
        Log 'umbradomus.com had not picked up the change yet. Usually just slow;' 'Yellow'
        Log 'check the site again in a few minutes.' 'Yellow'
        Log ''
    }
    Log 'Test it: open umbradomus.com/services, send yourself a request with a' 'White'
    Log 'photo, and watch it appear on your list - and in your email.' 'White'
} else {
    Log 'Nothing is broken. Do the one thing above, then double-click' 'Yellow'
    Log 'DEPLOY-STAGE-1.cmd again. It carries on from where it stopped.' 'Yellow'
}
Log ''
Log ('The full write-up: ' + $ResultPath) 'Gray'
Log ('Every command and reply: ' + $LogPath) 'Gray'
Log ''

Save-Log

if ($script:Stopped) { exit 1 }
exit 0
