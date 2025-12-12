$managerVersion = "1.0.0"

function Show-Menu {
  param(
    [array]$menuItems
  )
  for ($i = 0; $i -lt $menuItems.Length; $i++) {
    $item = $menuItems[$i]
    Write-Host "  [$($i + 1)] $($item.label)" -ForegroundColor Green
  }
  Write-Host "  [Q] Quit" -ForegroundColor Red
  Write-Host ""

  if ($menuItems.Length -eq 1) {
    $choice = Read-Host "Enter your choice [1] or [Q] to quit"
  }
  else {
    $choice = Read-Host "Enter your choice [1-$($menuItems.Length)] or [Q] to quit"
  }

  if ($choice -ieq 'Q' -or $choice -eq '') {
    Write-Host "Goodbye!`n" -ForegroundColor Yellow
    exit
  }

  $menuItems[$choice - 1].action.Invoke()
}

function Use-NodeJS {
  param(
    [string]$assetUrl
  )

  Get-TableauMCP $assetUrl
  Expand-TableauMCP
  New-EnvFile
  Start-Server
  Get-ServerStatus
}

function New-EnvFile {
  Write-Host "`nStage: Create .env file" -ForegroundColor Magenta

  $envFile = Join-Path -Path $PWD -ChildPath ".env"
  if (Test-Path $envFile) {
    $choice = Read-Host "$($envFile) already exists, skip re-creation? (Y/n)"
    if ($choice -ine 'n') {
      return
    }
  }

  $envContent = Get-EnvContent

  Write-Host "Contents of the .env file:" -ForegroundColor Magenta
  Write-Host "--------------------------------" -ForegroundColor Magenta
  Write-Host $envContent -ForegroundColor Magenta
  Write-Host "--------------------------------" -ForegroundColor Magenta
  Write-Host ""
  $choice = Read-Host "Do you want to create the .env file? (Y/n)"
  if ($choice -ine 'n') {
    Set-Content -Path $envFile -Value $envContent
  }
  else {
    Write-Host "No .env file created" -ForegroundColor Red
    exit 1
  }
}

function Get-EnvContent {
  $server = Read-Host "Enter the URL of your Tableau Server"
  $port = Read-Host "What port do you want to use for the Tableau MCP Server? (default: 3927)"
  if ($port -eq "") {
    $port = "3927"
  }

  Write-Host "What authentication method do you want to use for the MCP server?" -ForegroundColor Yellow
  Show-Menu @(
    @{
      label  = "PAT"
      action = {
        $patName = Read-Host "PAT Name"
        $patValue = Read-Host "PAT Value"
        return @"
SERVER=$server
TRANSPORT=http
PORT=$port
AUTH=pat
PAT_NAME=$patName
PAT_VALUE=$patValue
DANGEROUSLY_DISABLE_OAUTH=true
"@
      }
    }
    @{
      label  = "Direct Trust"
      action = {
        $username = Read-Host "Username for JWT sub claim"
        $clientId = Read-Host "Connected App Client ID"
        $secretId = Read-Host "Connected App Secret ID"
        $secretValue = Read-Host "Connected App Secret Value"
        return @"
SERVER=$server
TRANSPORT=http
PORT=$port
AUTH=direct-trust
JWT_SUB_CLAIM=$username
CONNECTED_APP_CLIENT_ID=$clientId
CONNECTED_APP_SECRET_ID=$secretId
CONNECTED_APP_SECRET_VALUE=$secretValue
DANGEROUSLY_DISABLE_OAUTH=true
"@
      }
    }
    @{
      label  = "OAuth (Tableau Server 2025.3+ only)"
      action = {
        $oauthIssuer = Read-Host "OAuth Issuer"
        $oauthRedirectUri = Read-Host "OAuth Redirect URI ([ENTER] to use default)"
        $oauthJwePrivateKey = Read-Host "OAuth JWE Private Key ([ENTER] to provide path instead)"
        $oauthJwePrivateKeyPath = Read-Host "OAuth JWE Private Key Path"
        $oauthJwePrivateKeyPassphrase = Read-Host "OAuth JWE Private Key Passphrase ([ENTER] to leave blank)"
        $oauthAuthzCodeTimeoutMs = Read-Host "OAuth Authz Code Timeout MS ([ENTER] to use default)"
        $oauthAccessTokenTimeoutMs = Read-Host "OAuth Access Token Timeout MS ([ENTER] to use default)"
        $oauthRefreshTokenTimeoutMs = Read-Host "OAuth Refresh Token Timeout MS ([ENTER] to use default)"
        $oauthClientIdSecretPairs = Read-Host "OAuth Client ID Secret Pairs ([ENTER] to leave blank)"
        return @"
SERVER=$server
TRANSPORT=http
PORT=$port
AUTH=oauth
OAUTH_ISSUER=$oauthIssuer
OAUTH_REDIRECT_URI=$oauthRedirectUri
OAUTH_JWE_PRIVATE_KEY=$oauthJwePrivateKey
OAUTH_JWE_PRIVATE_KEY_PATH=$oauthJwePrivateKeyPath
OAUTH_JWE_PRIVATE_KEY_PASSPHRASE=$oauthJwePrivateKeyPassphrase
OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS=$oauthAuthzCodeTimeoutMs
OAUTH_ACCESS_TOKEN_TIMEOUT_MS=$oauthAccessTokenTimeoutMs
OAUTH_REFRESH_TOKEN_TIMEOUT_MS=$oauthRefreshTokenTimeoutMs
OAUTH_CLIENT_ID_SECRET_PAIRS=$oauthClientIdSecretPairs
"@
      }
    }
  )
}

function Start-Server {
  Write-Host "`nStage: Start MCP server" -ForegroundColor Magenta
  Write-Host "Starting MCP server" -ForegroundColor Magenta
  $path = Join-Path -Path $PWD -ChildPath "tableau-mcp.exe"
  $process = Start-Process -FilePath $path -NoNewWindow -PassThru
  Start-Sleep -Seconds 2
  if ($process.HasExited -and $process.ExitCode -ne 0) {
    Write-Host "MCP server failed to start" -ForegroundColor Red
    exit 1
  }

  Write-Host "MCP server process started successfully" -ForegroundColor Green
  $pidFile = Join-Path -Path $PWD -ChildPath "pid.txt"
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-Server {
  param(
    [switch]$Silent
  )
  $pidFile = Join-Path -Path $PWD -ChildPath "pid.txt"
  $process = Get-Process -Name "tableau-mcp" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    if (Test-Path $pidFile) {
      $nodePid = Get-Content -Path $pidFile
      $process = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    }
  }
  else {
    $nodePid = $process.Id
    Set-Content -Path $pidFile -Value $nodePid
  }

  if ($process) {
    Write-Host "The MCP server is already running" -ForegroundColor Green
    Write-Host ""

    $choice = Read-Host "Do you want to stop the server? (Y/n)"
    if ($choice -ine 'n') {
      Write-Host "Stopping MCP server..." -ForegroundColor Magenta
      Stop-Process -Id $nodePid
      Write-Host "MCP server stopped successfully" -ForegroundColor Green
      Remove-Item -Path $pidFile
    }
    else {
      exit 1
    }
  }
  else {
    if (-not $Silent) {
      Write-Host "The MCP server is not running" -ForegroundColor Yellow
    }

    if (Test-Path $pidFile) {
      Remove-Item -Path $pidFile
    }
  }
}


function Get-TableauMCP {
  param(
    [string]$assetUrl
  )
  Write-Host "`nStage: Download Tableau MCP from GitHub" -ForegroundColor Magenta
  $tableauMCPZip = Join-Path -Path $PWD -ChildPath "tableau-mcp.zip"

  if (Test-Path $tableauMCPZip) {
    $choice = Read-Host "$($tableauMCPZip) already exists, skip re-download? (Y/n)"
    if ($choice -ine 'n') {
      return
    }
  }

  Write-Host "Downloading Tableau MCP from $assetUrl..." -ForegroundColor Magenta
  Write-Host "Downloading to $tableauMCPZip" -ForegroundColor Magenta
  Invoke-WebRequest -Uri $assetUrl -OutFile $tableauMCPZip
}

function Expand-TableauMCP {
  Write-Host "`nStage: Expand Tableau MCP ZIP file" -ForegroundColor Magenta

  $tableauMCPZip = Join-Path -Path $PWD -ChildPath "tableau-mcp.zip"

  Write-Host "Expanding archive to $PWD..." -ForegroundColor Magenta
  Expand-Archive -Path $tableauMCPZip -DestinationPath $PWD

  Write-Host "Tableau MCP extracted successfully!" -ForegroundColor Green
}

function Get-GitHubReleases {
  $headers = @{
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }

  if ($env:GITHUB_TOKEN) {
    $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
  }

  Write-Progress -Activity "Fetching Tableau MCP releases" -Status "Fetching releases" -PercentComplete 0
  $response = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/tableau/tableau-mcp/releases" `
    -Headers $headers `
    -Method Get
  Write-Progress -Activity "Fetching Tableau MCP releases" -Status "Fetching releases" -Completed

  $releases = $response `
  | Select-Object tag_name, assets `
  | Where-Object { $_.assets.name -eq "tableau-mcp.zip" } `
  | ForEach-Object {
    @{
      version  = $_.tag_name -replace 'v', '';
      assetUrl = $_.assets | Where-Object { $_.name -eq "tableau-mcp.zip" } | Select-Object -ExpandProperty browser_download_url
    }
  } `
  | Sort-Object { [Version]$_.version } -Descending `
  | Select-Object -First 10

  return @($releases)
}

function Install-TableauMCP {
  Stop-Server -Silent

  Write-Host "Which version of the Tableau MCP Server do you want to install?" -ForegroundColor Yellow
  [Array]$releases = Get-GitHubReleases

  Show-Menu @(
    for ($i = 0; $i -lt $releases.Length; $i++) {
      $label = ""
      if ($i -eq 0) {
        $label = " (Latest)"
      }

      $version = $releases[$i].version
      $assetUrl = $releases[$i].assetUrl
      @{
        label  = "$version$label"
        action = { Use-NodeJS -assetUrl $assetUrl }
      }
    }
  )
}

function Get-ServerStatus {
  $port = $env:PORT
  if ($port -eq "" -or $null -eq $port) {
    $envFile = Join-Path -Path $PWD -ChildPath ".env"
    $envContent = Get-Content -Path $envFile
    $port = $envContent | Select-String -Pattern "PORT=([0-9]+)" | ForEach-Object { $_.Matches.Groups[1].Value }
  }

  if ($port -eq "" -or $null -eq $port) {
    $port = 3927
  }

  try {
    Write-Host ""
    Write-Host "Checking MCP server status on port $port..." -ForegroundColor Magenta
    $uri = "http://localhost:$port/tableau-mcp"
    $body = @{jsonrpc = "2.0"; id = "1"; method = "ping" }

    Write-Host "Uri: $uri" -ForegroundColor Magenta
    Write-Host "Body: $($body | ConvertTo-Json -Compress)" -ForegroundColor Magenta
    Write-Host ""

    $response = Invoke-WebRequest -Uri "http://localhost:$port/tableau-mcp" `
      -Method Post `
      -Body (@{jsonrpc = "2.0"; id = "1"; method = "ping" }) `
      -TimeoutSec 5 `

  }
  catch {
    Write-Host "MCP server is not running" -ForegroundColor Red
    Write-Host "$($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }


  if ($response.StatusCode -eq 200 -and $response.Content -eq '{"jsonrpc":"2.0","id":"1","result":{}}') {
    Write-Host "StatusCode: $($response.StatusCode)" -ForegroundColor Magenta
    Write-Host "Response: $($response.Content)" -ForegroundColor Magenta
    Write-Host "MCP server is healthy" -ForegroundColor Green
  }
  else {
    Write-Host "MCP server is not running" -ForegroundColor Red
    Write-Host "StatusCode: $($response.StatusCode)" -ForegroundColor Red
    Write-Host "Response: $($response.Content)" -ForegroundColor Red
  }

}

# =========================================================================================
Clear-Host

Write-Host "Tableau MCP Server Manager v$managerVersion" -ForegroundColor Cyan
Write-Host

Show-Menu @(
  @{
    label  = "Install/Upgrade Tableau MCP Server"
    action = { Install-TableauMCP }
  }
  @{
    label  = "Check Server Status"
    action = { Get-ServerStatus }
  }
  @{
    label  = "Start/Restart Server"
    action = {
      Stop-Server -Silent
      Start-Server
      Get-ServerStatus
    }
  }
  @{
    label  = "Stop Server"
    action = { Stop-Server }
  }
)
