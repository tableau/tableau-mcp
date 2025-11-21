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

  $choice = Read-Host "Enter your choice [1-$($menuItems.Length)] or [Q] to quit"
  if ($choice -ieq 'Q' -or $choice -eq '') {
    Write-Host "Goodbye!`n" -ForegroundColor Yellow
    exit
  }

  $menuItems[$choice - 1].action.Invoke()
}

function Use-NodeJS {
  Write-Host "`nStage: Node.js installation check" -ForegroundColor Magenta
  $choice = Read-Host "Do you already have Node.js installed? (Y/n)"
  if ($choice -ine 'n') {
    Write-Host "Node.js is already installed" -ForegroundColor Green
  }
  else {
    Write-Host "How do you want to install Node.js?" -ForegroundColor Yellow
    Show-Menu @(
      @{
        label  = "Download from nodejs.org"
        action = {
          $nodejsVersion = "latest-v22.x"
          $nodejsFilename = "node-v22.21.1-x64.msi"
          $nodejsMsi = Join-Path -Path $env:TEMP -ChildPath $nodejsFilename

          if (Test-Path $nodejsMsi) {
            $choice = Read-Host "$($nodejsMsi) already exists, skip re-download? (Y/n)"
            if ($choice -ieq 'n') {
              Get-NodeJS -nodejsVersion $nodejsVersion -nodejsFilename $nodejsFilename -nodejsMsi $nodejsMsi
            }
          }
          else {
            Get-NodeJS -nodejsVersion $nodejsVersion -nodejsFilename $nodejsFilename -nodejsMsi $nodejsMsi
          }

          $logPath = Join-Path -Path $env:TEMP -ChildPath "$nodejsFilename.log"
          Write-Host "Installing Node.js from $nodejsMsi" -ForegroundColor Magenta
          Write-Host "Logging to $logPath" -ForegroundColor Magenta
          $arguments = @(
            "/i"
            "`"$nodejsMsi`""
            "/quiet"
            "/norestart"
            "/l*v"
            "`"$logPath`""
          )

          $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -NoNewWindow -Wait -PassThru

          if ($process.ExitCode -eq 0) {
            Write-Host "Installation completed successfully!" -ForegroundColor Green
            $choice = Read-Host "Do you want to delete the MSI and the installation log file? (Y/n)"
            if ($choice -ine 'n') {
              Remove-Item -Path $nodejsMsi
              Remove-Item -Path $logPath
            }
          }
          else {
            Write-Host "Installation failed with exit code: $($process.ExitCode)" -ForegroundColor Red
            exit 1
          }
        }
      }
      @{
        label  = "Use NVM for Windows"
        action = {
          $nodejsVersion = "22.21.1"
          Write-Host "nvm install $nodejsVersion" -ForegroundColor Magenta
          Start-Process -FilePath "nvm" -ArgumentList "install $nodejsVersion" -NoNewWindow -Wait -PassThru

          Write-Host "nvm use $nodejsVersion" -ForegroundColor Magenta
          $process = Start-Process -FilePath "nvm" -ArgumentList "use $nodejsVersion" -NoNewWindow -Wait -PassThru
          if ($process.ExitCode -ne 0) {
            Write-Host "Failed to use Node.js version $nodejsVersion" -ForegroundColor Red
            exit 1
          }
        }
      }
    )
  }

  Get-TableauMCP
  Expand-TableauMCP
  New-EnvFile
  Start-Node
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

  $server = Read-Host "Enter the URL of your Tableau Server"
  $port = Read-Host "What port do you want to use for the Tableau MCP Server? (default: 3927)"
  if ($port -eq "") {
    $port = "3927"
  }
  $envContent = @"
SERVER=$server
AUTH=cookie
TRANSPORT=http
PORT=$port
DANGEROUSLY_DISABLE_OAUTH=true
"@

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

function Start-Node {
  Write-Host "`nStage: Start Node.js server" -ForegroundColor Magenta
  $process = Start-Process -FilePath "node" -ArgumentList "build/index.js" -NoNewWindow -PassThru
  if ($process.ExitCode -ne 0) {
    Write-Host "Failed to start the Node.js server`n`n" -ForegroundColor Red
    exit 1
  }
  else {
    Write-Host "Node.js server started successfully! Enjoy!!" -ForegroundColor Green
  }
}



function Get-NodeJS {
  param(
    [string]$nodejsVersion,
    [string]$nodejsFilename,
    [string]$nodejsMsi
  )
  $nodejsUrl = "https://nodejs.org/dist/$nodejsVersion/$nodejsFilename"
  Write-Host "Downloading Node.js from $nodejsUrl" -ForegroundColor Magenta
  Write-Host "Downloading to $nodejsMsi" -ForegroundColor Magenta
  Invoke-WebRequest -Uri $nodejsUrl -OutFile $nodejsMsi
}

function Use-Docker {
  Write-Host "`nStage: Check if Docker is installed" -ForegroundColor Magenta
  if (Get-Command docker) {
    Write-Host "Docker is already installed" -ForegroundColor Green
    Get-TableauMCP
    Expand-TableauMCP
    New-EnvFile
    New-Dockerfile
  }
  else {
    Write-Host "Docker is not installed. Please install Docker Desktop from https://docs.docker.com/desktop/setup/install/windows-install/" -ForegroundColor Red
    exit 1
  }
}

function New-Dockerfile {
  Write-Host "`nStage: Create Dockerfile" -ForegroundColor Magenta
  $dockerfile = Join-Path -Path $PWD -ChildPath "Dockerfile"
  if (Test-Path $dockerfile) {
    $choice = Read-Host "$($dockerfile) already exists, skip re-creation? (Y/n)"
    if ($choice -ine 'n') {
      Start-Docker
      return
    }
  }

  $dockerfileContent = @"
FROM node:22-alpine
COPY ./build /build
COPY ./node_modules /node_modules
RUN chmod +x build/index.js
ENTRYPOINT ["node", "build/index.js"]
"@

  Write-Host "Contents of the Dockerfile:" -ForegroundColor Magenta
  Write-Host "--------------------------------" -ForegroundColor Magenta
  Write-Host $dockerfileContent -ForegroundColor Magenta
  Write-Host "--------------------------------" -ForegroundColor Magenta
  Write-Host ""
  $choice = Read-Host "Do you want to create the Dockerfile? (Y/n)"
  if ($choice -ine 'n') {
    Set-Content -Path $dockerfile -Value $dockerfileContent
  }
  else {
    Write-Host "No Dockerfile created" -ForegroundColor Red
    exit 1
  }

  Start-Docker
}

function Start-Docker {
  Write-Host "`nStage: Build Docker image" -ForegroundColor Magenta
  Start-Process -FilePath "docker" -ArgumentList "build -t tableau-mcp ." -NoNewWindow -Wait -PassThru | Out-Null

  Write-Host "`nStage: Run Docker container" -ForegroundColor Magenta
  Start-Process -FilePath "docker" -ArgumentList "run -p 3927:3927 -i --rm --env-file .env tableau-mcp" -NoNewWindow -Wait -PassThru | Out-Null
}

function Get-TableauMCP {
  Write-Host "`nStage: Download Tableau MCP from GitHub" -ForegroundColor Magenta

  $tableauMCPUrl = "https://github.com/tableau/tableau-mcp/releases/latest/download/tableau-mcp.zip"
  $tableauMCPZip = Join-Path -Path $PWD -ChildPath "tableau-mcp.zip"

  if (Test-Path $tableauMCPZip) {
    $choice = Read-Host "$($tableauMCPZip) already exists, skip re-download? (Y/n)"
    if ($choice -ine 'n') {
      return
    }
  }

  Write-Host "Downloading Tableau MCP from $tableauMCPUrl..." -ForegroundColor Magenta
  Write-Host "Downloading to $tableauMCPZip" -ForegroundColor Magenta
  Invoke-WebRequest -Uri $tableauMCPUrl -OutFile $tableauMCPZip
}

function Expand-TableauMCP {
  Write-Host "`nStage: Expand Tableau MCP ZIP file" -ForegroundColor Magenta

  $tableauMCPZip = Join-Path -Path $PWD -ChildPath "tableau-mcp.zip"

  $buildPath = Join-Path -Path $PWD -ChildPath "build"
  $nodeModulesPath = Join-Path -Path $PWD -ChildPath "node_modules"

  if ((Test-Path $buildPath) -and (Test-Path $nodeModulesPath)) {
    $choice = Read-Host "It looks like the Tableau MCP has already been extracted. Do you want to delete the existing files and extract it again? (y/N)"
    if ($choice -ine 'y') {
      return
    }
  }

  Remove-Item -Path $buildPath -Recurse -Force
  Remove-Item -Path $nodeModulesPath -Recurse -Force

  Write-Host "Expanding archive to $PWD..." -ForegroundColor Magenta
  Expand-Archive -Path $tableauMCPZip -DestinationPath $PWD

  Write-Host "Tableau MCP extracted successfully!" -ForegroundColor Green
}

Clear-Host
Write-Host "Tableau MCP Server Installer v$installerVersion" -ForegroundColor Cyan
Write-Host

Write-Host "Tableau MCP requires Node.js >= 22.7.5 or Docker to be installed" -ForegroundColor Yellow
Write-Host "How do you plan to run the Tableau MCP Server?" -ForegroundColor Yellow
Show-Menu @(
  @{
    label  = "Node.js"
    action = { Use-NodeJS }
  }
  @{
    label  = "Docker"
    action = { Use-Docker }
  }
)