$installerVersion = "1.0.0"

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
  Write-Host "`nStage: Start Node.js server" -ForegroundColor Magenta
  Write-Host "Starting Node.js server" -ForegroundColor Magenta
  $path = Join-Path -Path $PWD -ChildPath "tableau-mcp.exe"
  $process = Start-Process -FilePath $path -NoNewWindow -PassThru
  Write-Host "Node.js server started successfully! Enjoy!!" -ForegroundColor Green

  $pidFile = Join-Path -Path $PWD -ChildPath "pid.txt"
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-Server {
  $process = Get-Process -Name "tableau-mcp.exe" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    $pidFile = Join-Path -Path $PWD -ChildPath "pid.txt"
    if (Test-Path $pidFile) {
      $nodePid = Get-Content -Path $pidFile
      $process = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    }
  }

  if ($process) {
    Write-Host "Looks like the MCP server is already running with PID $nodePid. You should stop it before starting a new one." -ForegroundColor Green
    $choice = Read-Host "Do you want to stop the server? (Y/n)"
    if ($choice -ine 'n') {
      Write-Host "Stopping Node.js server with PID $nodePid" -ForegroundColor Magenta
      Stop-Process -Id $nodePid
      Write-Host "Node.js server stopped successfully" -ForegroundColor Green
      Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
    }
    else {
      exit 1
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

Clear-Host

Write-Host "Tableau MCP Server Installer v$installerVersion" -ForegroundColor Cyan
Write-Host

Stop-Server



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