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
  if ($choice -ieq 'Q') {
    Write-Host "Goodbye!" -ForegroundColor Yellow
    exit
  }

  $menuItems[$choice - 1].action.Invoke()
}

function Install-NodeJS {
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
          Write-Host "Using NVM for Windows" -ForegroundColor Magenta
          Start-Process -FilePath "nvm.exe" -ArgumentList "install $nodejsVersion" -NoNewWindow -Wait -PassThru
          Start-Process -FilePath "nvm.exe" -ArgumentList "list" -NoNewWindow -Wait -PassThru
          Start-Process -FilePath "nvm.exe" -ArgumentList "use $nodejsVersion" -NoNewWindow -Wait -PassThru
        }
      }
    )
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

Clear-Host
Write-Host "Tableau MCP Server Installer v$installerVersion" -ForegroundColor Cyan
Write-Host

Write-Host "Tableau MCP requires Node.js >= 22.7.5 or Docker to be installed" -ForegroundColor Yellow
Write-Host "How do you plan to run the Tableau MCP Server?" -ForegroundColor Yellow
Show-Menu @(
  @{
    label  = "Node.js"
    action = { Install-NodeJS }
  }
  @{
    label  = "Docker"
    action = { Install-Docker }
  }
)