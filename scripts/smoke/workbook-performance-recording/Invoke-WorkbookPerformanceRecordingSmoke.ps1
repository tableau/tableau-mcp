#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('direct', 'agent-backend', 'agent-ui', 'all')]
    [string]$Scenario = 'all',
    [string]$TableauExe,
    [string]$TableauMcpEntry = 'D:\dev\tableau-mcp3\tableau-mcp\build\index.desktop.js',
    [string]$MonolithRepo = 'D:\dev\monolith3\monolith',
    [string]$TableauMcpRepo = 'D:\dev\tableau-mcp3\tableau-mcp',
    [string]$TabAgentSouthRepo = 'D:\dev\tab-agent-south',
    [string]$TabAgentSouthExe,
    [string]$TabAgentSouthUiRepo = 'D:\dev\tab-agent-south-ui',
    [string]$AgentChatUiRepo = 'D:\dev\agent-chat-ui',
    [string]$WorkbookPath,
    [string[]]$WorkbookDependencies = @(),
    [string]$WorksheetName = 'se-eval-scratch',
    [string]$DesktopDiscoveryDirectory = "$env:LOCALAPPDATA\Tableau\Tableau\ExternalApi",
    [string]$DesktopLogPath = "$env:USERPROFILE\Documents\My Tableau Repository\Logs\log.txt",
    [string]$OutputDirectory = "$env:TEMP\tableau-workbook-performance-recording-smoke",
    [ValidateRange(1024, 65535)][int]$BackendWsPort = 51200,
    [ValidateRange(1024, 65535)][int]$BackendHealthPort = 51201,
    [ValidateRange(1024, 65535)][int]$UiAgentWsPort = 51100,
    [ValidateRange(1024, 65535)][int]$UiAgentHealthPort = 51101,
    [ValidateRange(1024, 65535)][int]$UiPort = 8081,
    [ValidateRange(1024, 65535)][int]$CdpPort = 9337,
    [ValidateRange(5, 600)][int]$StartupTimeoutSeconds = 90,
    [ValidateRange(5, 3600)][int]$OperationTimeoutSeconds = 600,
    [ValidateRange(5, 7200)][int]$AgentTurnTimeoutSeconds = 900
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SharedPrompt = 'Optimize the open workbook for performance. Before analysis, call start-performance-recording. Inspect the workbook, make or recommend a concrete performance optimization and verify the result, then call stop-performance-recording and report its filePath.'
$StartTool = 'start-performance-recording'
$StopTool = 'stop-performance-recording'
$StartRoute = '/v0/workbook:startPerformanceRecording'
$StopRoute = '/v0/workbook:stopPerformanceRecording'
$RequiredApiVersion = [version]'0.2.14'
$ScriptDirectory = $PSScriptRoot
$RunId = '{0}-{1}' -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$RunDirectory = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) $RunId
$RawRunDirectory = Join-Path ([IO.Path]::GetTempPath()) "tableau-workbook-performance-recording-smoke-raw-$RunId"
$ScenarioResults = [Collections.Generic.List[object]]::new()

function ConvertTo-RedactedText {
    param([AllowEmptyString()][string]$Text)
    $redacted = $Text -replace '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]'
    $redacted = $redacted -replace '\b(sk-ant-|sk-)[A-Za-z0-9_-]{8,}\b', '[REDACTED]'
    $redacted = $redacted -replace '(?i)("(?:authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pat[_-]?(?:name|value)|password|secret)"\s*:\s*)"(?:\\.|[^"\\])*"', '$1"[REDACTED]"'
    return $redacted -replace '(?i)((?:authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pat[_-]?(?:name|value)|password|secret)\s*[=:]\s*)[^\s,;]+', '$1[REDACTED]'
}

function Write-SafeJson {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    $json = $Value | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($Path, (ConvertTo-RedactedText $json) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Assert-File {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not [IO.File]::Exists($resolved)) { throw "$Label does not exist: $resolved" }
    return $resolved
}

function Assert-Directory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not [IO.Directory]::Exists($resolved)) { throw "$Label does not exist: $resolved" }
    return $resolved
}

function Resolve-TableauExecutable {
    if ($TableauExe) { return Assert-File $TableauExe 'Tableau executable' }
    $candidates = @(
        (Join-Path $MonolithRepo 'build\win\x64\Debug\Tableau.exe'),
        (Join-Path $MonolithRepo 'build\win\x64\Release\Tableau.exe'),
        (Join-Path $MonolithRepo 'build\Debug\Tableau.exe'),
        (Join-Path $MonolithRepo 'build\Release\Tableau.exe')
    )
    $found = $candidates | Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
    if (-not $found) {
        $buildRoot = Join-Path $MonolithRepo 'build'
        if ([IO.Directory]::Exists($buildRoot)) {
            $found = Get-ChildItem -LiteralPath $buildRoot -Filter Tableau.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if (-not $found) { throw 'Tableau.exe was not found under the monolith build output; pass -TableauExe explicitly.' }
    return [IO.Path]::GetFullPath($found)
}

function Invoke-GitText {
    param([string]$Repo, [string[]]$GitArguments)
    $lines = & git -C $Repo @GitArguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (@($lines) -join "`n").TrimEnd()
}

function Get-TextSha256 {
    param([AllowEmptyString()][string]$Text)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Get-GitProvenance {
    param([string]$Repo, [string]$BaseRef)
    if (-not [IO.Directory]::Exists((Join-Path $Repo '.git'))) { return $null }
    $head = Invoke-GitText $Repo @('rev-parse', 'HEAD')
    $mergeHead = Invoke-GitText $Repo @('rev-parse', '--verify', 'MERGE_HEAD')
    $baseTip = Invoke-GitText $Repo @('rev-parse', '--verify', $BaseRef)
    $diffBase = if ($mergeHead) { $mergeHead } else { $BaseRef }
    $status = Invoke-GitText $Repo @('status', '--porcelain=v1', '--untracked-files=all')
    $stagedDiff = Invoke-GitText $Repo @('diff', '--cached', '--binary', $diffBase)
    $worktreeDiff = Invoke-GitText $Repo @('diff', '--binary')
    $stagedNames = Invoke-GitText $Repo @('diff', '--cached', '--name-status', $diffBase)
    $worktreeNames = Invoke-GitText $Repo @('diff', '--name-status')
    return [ordered]@{
        branch = Invoke-GitText $Repo @('branch', '--show-current')
        head = $head
        mergeHead = $mergeHead
        baseRef = $BaseRef
        baseTip = $baseTip
        statusLineCount = if ($status) { @($status -split "`n").Count } else { 0 }
        statusSha256 = if ($null -ne $status) { Get-TextSha256 $status } else { $null }
        stagedNameStatus = if ($stagedNames) { @($stagedNames -split "`n") } else { @() }
        worktreeNameStatus = if ($worktreeNames) { @($worktreeNames -split "`n") } else { @() }
        stagedDiffSha256 = if ($null -ne $stagedDiff) { Get-TextSha256 $stagedDiff } else { $null }
        worktreeDiffSha256 = if ($null -ne $worktreeDiff) { Get-TextSha256 $worktreeDiff } else { $null }
    }
}

function Get-FileProvenance {
    param([string]$Path)
    $item = Get-Item -LiteralPath (Assert-File $Path 'Provenance file')
    return [ordered]@{
        path = $item.FullName
        length = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Test-PortAvailable {
    param([int]$Port)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Assert-PortsAvailable {
    param([int[]]$Ports)
    foreach ($port in $Ports) {
        if (-not (Test-PortAvailable $port)) { throw "required task-owned port is already in use: $port" }
    }
}

function New-ProcessRecord {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][Diagnostics.Process]$Process,
        [Parameter(Mandatory)][Collections.Generic.List[object]]$Owned,
        [string]$StdoutPath,
        [string]$StderrPath,
        $StdoutTask,
        $StderrTask
    )
    $executable = try { $Process.MainModule.FileName } catch { $null }
    $record = [pscustomobject]@{
        name = $Name
        pid = $Process.Id
        startTimeUtc = $Process.StartTime.ToUniversalTime().ToString('o')
        executable = $executable
        process = $Process
        stdoutPath = $StdoutPath
        stderrPath = $StderrPath
        stdoutTask = $StdoutTask
        stderrTask = $StderrTask
    }
    $Owned.Add($record)
    return $record
}

function Start-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$LogDirectory,
        [Parameter(Mandatory)][Collections.Generic.List[object]]$Owned,
        [hashtable]$Environment = @{}
    )
    [IO.Directory]::CreateDirectory($LogDirectory) | Out-Null
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    foreach ($key in $Environment.Keys) { $info.Environment[$key] = [string]$Environment[$key] }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "failed to start $Name" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    return New-ProcessRecord -Name $Name -Process $process -Owned $Owned -StdoutPath (Join-Path $LogDirectory "$Name.stdout.log") -StderrPath (Join-Path $LogDirectory "$Name.stderr.log") -StdoutTask $stdoutTask -StderrTask $stderrTask
}

function Start-DesktopProcess {
    param([string]$Executable, [string]$Workbook, [Collections.Generic.List[object]]$Owned)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $true
    $info.ArgumentList.Add($Workbook)
    $process = [Diagnostics.Process]::Start($info)
    if (-not $process) { throw 'failed to launch Tableau Desktop' }
    return New-ProcessRecord -Name 'tableau-desktop' -Process $process -Owned $Owned
}

function Save-ProcessOutput {
    param($Record)
    foreach ($kind in @('stdout', 'stderr')) {
        $task = $Record."${kind}Task"
        $path = $Record."${kind}Path"
        if ($task -and $path -and $task.IsCompleted) {
            try {
                $text = $task.GetAwaiter().GetResult()
                [IO.File]::WriteAllText($path, (ConvertTo-RedactedText $text), [Text.UTF8Encoding]::new($false))
            } catch {}
        }
    }
}

function Wait-CapturedProcess {
    param($Record, [int]$TimeoutSeconds)
    if (-not $Record.process.WaitForExit($TimeoutSeconds * 1000)) { throw "$($Record.name) timed out after $TimeoutSeconds seconds" }
    Save-ProcessOutput $Record
    if ($Record.process.ExitCode -ne 0) { throw "$($Record.name) exited with code $($Record.process.ExitCode); see $($Record.stderrPath)" }
}

function Stop-OwnedProcesses {
    param([Collections.Generic.List[object]]$Owned)
    $errors = [Collections.Generic.List[string]]::new()
    foreach ($record in @($Owned.ToArray()) | Sort-Object { $_.startTimeUtc } -Descending) {
        try {
            $current = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
            if ($current) {
                $expected = [DateTime]::Parse($record.startTimeUtc).ToUniversalTime()
                $actual = $current.StartTime.ToUniversalTime()
                if ([Math]::Abs(($actual - $expected).TotalSeconds) -gt 2) {
                    throw "PID $($record.pid) was reused; refusing cleanup"
                }
                & taskkill.exe /PID $record.pid /T /F *> $null
                Start-Sleep -Milliseconds 300
                if (Get-Process -Id $record.pid -ErrorAction SilentlyContinue) { throw "PID $($record.pid) survived taskkill" }
            }
        } catch { $errors.Add("$($record.name): $($_.Exception.Message)") }
        Save-ProcessOutput $record
    }
    return $errors.ToArray()
}

function Get-ProcessSummaries {
    param([Collections.Generic.List[object]]$Owned)
    return @($Owned | ForEach-Object { [pscustomobject]@{ name = $_.name; pid = $_.pid; startTimeUtc = $_.startTimeUtc; executable = $_.executable } })
}

function Get-DiscoverySnapshot {
    param([string]$Directory)
    if (-not [IO.Directory]::Exists($Directory)) { return @() }
    $items = @()
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter '*.json' -File -ErrorAction SilentlyContinue) {
        try {
            $data = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
            $pid = [int]$data.pid
            if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) { continue }
            $items += [pscustomobject]@{
                key = "$pid|$($data.instanceId)"
                pid = $pid
                instanceId = [string]$data.instanceId
                apiVersion = [string]$data.apiVersion
                startedAt = [string]$data.startedAt
                discoveryFile = $file.FullName
            }
        } catch {}
    }
    return $items
}

function Wait-NewDesktopInstance {
    param([object[]]$Before, [int]$TimeoutSeconds, [Collections.Generic.List[object]]$Owned)
    $beforeKeys = [Collections.Generic.HashSet[string]]::new([string[]]@($Before.key))
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $new = @(Get-DiscoverySnapshot $DesktopDiscoveryDirectory | Where-Object { -not $beforeKeys.Contains($_.key) })
        if ($new.Count -eq 1) {
            $instance = $new[0]
            if (-not $instance.apiVersion) { throw 'new Desktop discovery entry omitted apiVersion' }
            if ([version]$instance.apiVersion -lt $RequiredApiVersion) { throw "Desktop API $($instance.apiVersion) is below required $RequiredApiVersion" }
            if (-not ($Owned | Where-Object pid -eq $instance.pid)) {
                $process = Get-Process -Id $instance.pid -ErrorAction Stop
                New-ProcessRecord -Name 'tableau-desktop-instance' -Process $process -Owned $Owned | Out-Null
            }
            return $instance
        }
        if ($new.Count -gt 1) { throw 'more than one new live Desktop discovery entry appeared; attribution is ambiguous' }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "no new live Desktop External Client API instance appeared within $TimeoutSeconds seconds"
}

function Stage-Workbook {
    param([string]$Name, [string]$ScenarioDirectory)
    $source = if ($WorkbookPath) { Assert-File $WorkbookPath 'Workbook' } else { Assert-File (Join-Path $TabAgentSouthRepo 'evals\stages\e1-revenue-by-region\anchor.twb') 'Default e1 workbook' }
    $extension = [IO.Path]::GetExtension($source)
    if ($extension -notin @('.twb', '.twbx')) { throw "workbook must be .twb or .twbx: $source" }
    $staging = Join-Path $ScenarioDirectory 'workbook'
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    $destination = Join-Path $staging ("workbook-performance-{0}{1}" -f $Name, $extension)
    Copy-Item -LiteralPath $source -Destination $destination
    $dependencies = @($WorkbookDependencies)
    if (-not $WorkbookPath) { $dependencies += (Join-Path $TabAgentSouthRepo 'evals\stages\e1-revenue-by-region\e1-revenue-by-region.csv') }
    foreach ($dependency in $dependencies) {
        $resolved = Assert-File $dependency 'Workbook dependency'
        Copy-Item -LiteralPath $resolved -Destination (Join-Path $staging ([IO.Path]::GetFileName($resolved)))
    }
    return $destination
}

function Start-ScenarioDesktop {
    param([string]$Name, [string]$ScenarioDirectory, [Collections.Generic.List[object]]$Owned)
    $workbook = Stage-Workbook $Name $ScenarioDirectory
    $before = @(Get-DiscoverySnapshot $DesktopDiscoveryDirectory)
    if ($before.Count -gt 0) {
        $instances = @($before | ForEach-Object { "$($_.pid)/$($_.instanceId)" }) -join ', '
        throw "live Desktop External API instance(s) already exist ($instances); close them so scenario log and process attribution is unambiguous"
    }
    $launcher = Start-DesktopProcess -Executable $script:ResolvedTableauExe -Workbook $workbook -Owned $Owned
    $instance = Wait-NewDesktopInstance -Before $before -TimeoutSeconds $StartupTimeoutSeconds -Owned $Owned
    $logOffset = if ([IO.File]::Exists($DesktopLogPath)) { (Get-Item -LiteralPath $DesktopLogPath).Length } else { 0L }
    return [pscustomobject]@{
        workbook = $workbook
        instance = $instance
        launcherPid = $launcher.pid
        logOffset = $logOffset
        startedAtUtc = [DateTime]::UtcNow
    }
}

function Get-DesktopLogSlice {
    param([long]$Offset, [string]$Destination)
    if (-not [IO.File]::Exists($DesktopLogPath)) { throw "Desktop log does not exist: $DesktopLogPath" }
    $length = (Get-Item -LiteralPath $DesktopLogPath).Length
    if ($length -lt $Offset) { throw 'Desktop log was truncated or rotated during the scenario' }
    $stream = [IO.File]::Open($DesktopLogPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        [void]$stream.Seek($Offset, [IO.SeekOrigin]::Begin)
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 4096, $true)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    $safe = ConvertTo-RedactedText $text
    [IO.File]::WriteAllText($Destination, $safe, [Text.UTF8Encoding]::new($false))
    return $safe
}

function Get-CombinedLogs {
    param([string]$Directory, [string]$Destination, [string]$FilePattern = '*')
    $parts = foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $FilePattern -and $_.Extension -in @('.log', '.jsonl') } | Sort-Object FullName) {
        "===== $($file.Name) =====`n" + (Get-Content -LiteralPath $file.FullName -Raw)
    }
    $safe = ConvertTo-RedactedText ($parts -join "`n")
    [IO.File]::WriteAllText($Destination, $safe, [Text.UTF8Encoding]::new($false))
    return $safe
}

function Remove-OwnedRawDirectory {
    param([string]$Path)
    if (-not [IO.Directory]::Exists($Path)) { return }
    $root = [IO.Path]::GetFullPath($RawRunDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $descendantPrefix = $root + [IO.Path]::DirectorySeparatorChar
    if ($candidate -ne $root -and -not $candidate.StartsWith($descendantPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "refusing to remove non-owned raw path: $candidate"
    }
    Remove-Item -LiteralPath $candidate -Recurse -Force
    if ([IO.Directory]::Exists($candidate)) { throw "owned raw path survived cleanup: $candidate" }
}

function Finalize-RawLogEvidence {
    param([string]$RawScenarioDirectory, [string]$ScenarioDirectory)
    if (-not [IO.Directory]::Exists($RawScenarioDirectory)) { return }
    Get-CombinedLogs $RawScenarioDirectory (Join-Path $ScenarioDirectory 'native-logs-redacted.log') | Out-Null
    Get-CombinedLogs $RawScenarioDirectory (Join-Path $ScenarioDirectory 'mcp-combined.log') 'desktop-mcp-*.log' | Out-Null
    Remove-OwnedRawDirectory $RawScenarioDirectory
}

function Assert-CorrelatedLogs {
    param([string]$McpLog, [string]$DesktopLog, [DateTime]$StartedAtUtc, [DateTime]$FinishedAtUtc)
    foreach ($needle in @($StartTool, $StopTool)) { if (-not $McpLog.Contains($needle)) { throw "MCP fileLogger evidence is missing $needle" } }
    foreach ($needle in @($StartRoute, $StopRoute)) { if (-not $DesktopLog.Contains($needle)) { throw "Desktop log slice is missing $needle" } }
    $correlated = $false
    foreach ($match in [regex]::Matches($McpLog, '\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b')) {
        $timestamp = [DateTime]::Parse($match.Value).ToUniversalTime()
        if ($timestamp -ge $StartedAtUtc.AddMinutes(-1) -and $timestamp -le $FinishedAtUtc.AddMinutes(1)) { $correlated = $true; break }
    }
    if (-not $correlated) { throw 'MCP logs contain no timestamp correlated to the scenario window' }
}

function Find-PackagePath {
    param($Preferred, [string[]]$EvidenceFiles)
    if ($Preferred -and [IO.File]::Exists([string]$Preferred)) { return [IO.Path]::GetFullPath([string]$Preferred) }
    foreach ($file in $EvidenceFiles) {
        if (-not [IO.File]::Exists($file)) { continue }
        $text = (Get-Content -LiteralPath $file -Raw) -replace '\\\\', '\'
        $match = [regex]::Match($text, '(?i)([A-Za-z]:\\[^\r\n"'']+?\.twbx)')
        if ($match.Success -and [IO.File]::Exists($match.Groups[1].Value)) { return [IO.Path]::GetFullPath($match.Groups[1].Value) }
    }
    throw 'no existing same-machine .twbx path could be resolved from the successful stop evidence'
}

function Test-RecorderPackage {
    param([string]$Path, [string]$EvidenceDirectory)
    $item = Get-Item -LiteralPath (Assert-File $Path 'Recorder package')
    if ($item.Extension -ne '.twbx' -or $item.Length -le 0) { throw "recorder output is not a non-empty .twbx: $Path" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($item.FullName)
    try {
        $entry = $archive.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq 'Data/Performance/perf_gantt.tab' } | Select-Object -First 1
        if (-not $entry -or $entry.Length -le 0) { throw 'recorder package is missing non-empty Data/Performance/perf_gantt.tab' }
        $entryLength = $entry.Length
    } finally { $archive.Dispose() }
    $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $copy = Join-Path $EvidenceDirectory 'recorder-package.twbx'
    Copy-Item -LiteralPath $item.FullName -Destination $copy
    return [pscustomobject]@{ sourcePath = $item.FullName; evidenceCopy = $copy; length = $item.Length; sha256 = $hash; perfGanttLength = $entryLength }
}

function Get-TsxPath {
    $path = Join-Path $TableauMcpRepo 'node_modules\tsx\dist\cli.mjs'
    return Assert-File $path 'tsx CLI (run npm ci before the approved smoke run)'
}

function Invoke-TsxDriver {
    param([string]$Name, [string]$Script, [string[]]$Arguments, [string]$ScenarioDirectory, [Collections.Generic.List[object]]$Owned, [int]$TimeoutSeconds)
    $record = Start-CapturedProcess -Name $Name -FilePath (Get-Command node -ErrorAction Stop).Source -Arguments @((Get-TsxPath), $Script) + $Arguments -WorkingDirectory $TableauMcpRepo -LogDirectory (Join-Path $ScenarioDirectory 'process-logs') -Owned $Owned
    Wait-CapturedProcess $record $TimeoutSeconds
    return $record
}

function Wait-Health {
    param([int]$Port, [int]$TimeoutSeconds, $ProcessRecord)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if ($ProcessRecord.process.HasExited) { throw "$($ProcessRecord.name) exited before health became ready" }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
            if ($health.status -eq 'ok') { return $health }
        } catch {}
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "agent /healthz on port $Port did not report status=ok within $TimeoutSeconds seconds"
}

function Wait-Http {
    param([string]$Url, [int]$TimeoutSeconds, $ProcessRecord)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if ($ProcessRecord.process.HasExited) { throw "$($ProcessRecord.name) exited before $Url became ready" }
        try { $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2; if ($response.StatusCode -eq 200) { return } } catch {}
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Url did not become ready within $TimeoutSeconds seconds"
}

function Start-AgentProcess {
    param([string]$Name, [string]$ScenarioDirectory, [string]$RawScenarioDirectory, [int]$WsPort, [int]$HealthPort, [string]$Session, [Collections.Generic.List[object]]$Owned, [string]$AllowedOrigin)
    $agentData = Join-Path $RawScenarioDirectory 'agent-data'
    $agentLogs = Join-Path $agentData 'logs'
    [IO.Directory]::CreateDirectory($agentData) | Out-Null
    [IO.Directory]::CreateDirectory($agentLogs) | Out-Null
    $arguments = @(
        "--ws-port=$WsPort", "--health-port=$HealthPort", "--mcp-path=$TableauMcpEntry",
        "--log-dir=$agentLogs", "--db-path=$(Join-Path $ScenarioDirectory 'chat.db')",
        "--agent-data-dir=$agentData", '--dev'
    )
    $environment = @{
        TABLEAU_EXTERNAL_API_DISCOVERY_DIR = $DesktopDiscoveryDirectory
        TABLEAU_DESKTOP_SESSION_ID = $Session
        TABLEAU_DESKTOP_CALL_TIMEOUT_MS = [string]($OperationTimeoutSeconds * 1000)
        TOOL_PROFILE = 'dynamic-authoring'
        TAB_AGENT_ALLOWED_ORIGINS = $AllowedOrigin
    }
    if ($TabAgentSouthExe) {
        return Start-CapturedProcess -Name $Name -FilePath (Assert-File $TabAgentSouthExe 'tab-agent-south executable') -Arguments $arguments -WorkingDirectory $TabAgentSouthRepo -LogDirectory (Join-Path $ScenarioDirectory 'process-logs') -Owned $Owned -Environment $environment
    }
    $uv = (Get-Command uv -ErrorAction Stop).Source
    return Start-CapturedProcess -Name $Name -FilePath $uv -Arguments @('run', 'tab-agent-south') + $arguments -WorkingDirectory $TabAgentSouthRepo -LogDirectory (Join-Path $ScenarioDirectory 'process-logs') -Owned $Owned -Environment $environment
}

function Complete-Evidence {
    param(
        [string]$ScenarioDirectory,
        $DesktopContext,
        $PreferredPath,
        [string[]]$EvidenceFiles,
        [string]$McpLogDirectory = (Join-Path $ScenarioDirectory 'mcp-logs')
    )
    Start-Sleep -Milliseconds 750
    $finished = [DateTime]::UtcNow
    $mcpLogPath = Join-Path $ScenarioDirectory 'mcp-combined.log'
    $desktopLogSlicePath = Join-Path $ScenarioDirectory 'desktop-log-slice.log'
    $mcpLog = Get-CombinedLogs $McpLogDirectory $mcpLogPath 'desktop-mcp-*.log'
    $desktopLog = Get-DesktopLogSlice $DesktopContext.logOffset $desktopLogSlicePath
    Assert-CorrelatedLogs $mcpLog $desktopLog $DesktopContext.startedAtUtc $finished
    $packagePath = Find-PackagePath $PreferredPath ($EvidenceFiles + @($mcpLogPath, $desktopLogSlicePath))
    $package = Test-RecorderPackage $packagePath $ScenarioDirectory
    return [pscustomobject]@{ finishedAtUtc = $finished.ToString('o'); mcpLog = $mcpLogPath; desktopLogSlice = $desktopLogSlicePath; package = $package }
}

function New-ScenarioResult {
    param([string]$Name, [string]$Directory, [Collections.Generic.List[object]]$Owned)
    return [ordered]@{ name = $Name; success = $false; startedAtUtc = [DateTime]::UtcNow.ToString('o'); finishedAtUtc = $null; directory = $Directory; errors = [Collections.Generic.List[string]]::new(); processes = @(); desktop = $null; evidence = $null }
}

function Invoke-DirectScenario {
    $name = 'direct'; $directory = Join-Path $RunDirectory $name; $raw = Join-Path $RawRunDirectory $name
    [IO.Directory]::CreateDirectory($directory) | Out-Null; [IO.Directory]::CreateDirectory($raw) | Out-Null
    $owned = [Collections.Generic.List[object]]::new(); $result = New-ScenarioResult $name $directory $owned
    try {
        $desktop = Start-ScenarioDesktop $name $directory $owned; $result.desktop = $desktop
        $mcpLogs = Join-Path $raw 'mcp-logs'; [IO.Directory]::CreateDirectory($mcpLogs) | Out-Null
        $driverResult = Join-Path $directory 'mcp-direct-result.json'; $transcript = Join-Path $directory 'mcp-client-transcript.jsonl'
        Invoke-TsxDriver 'mcp-direct' (Join-Path $ScriptDirectory 'mcp-direct.mts') @(
            '--mcp-entry', $TableauMcpEntry, '--output', $driverResult, '--transcript', $transcript,
            '--log-directory', $mcpLogs, '--discovery-directory', $DesktopDiscoveryDirectory,
            '--session', [string]$desktop.instance.pid, '--worksheet', $WorksheetName,
            '--timeout-ms', [string]($OperationTimeoutSeconds * 1000)
        ) $directory $owned ($OperationTimeoutSeconds * 3) | Out-Null
        $driver = Get-Content -LiteralPath $driverResult -Raw | ConvertFrom-Json
        if (-not $driver.success) { throw "direct MCP driver failed: $($driver.error)" }
        $result.evidence = Complete-Evidence $directory $desktop $driver.filePath @($driverResult, $transcript) $mcpLogs
        $result.success = $true
    } catch { $result.errors.Add($_.Exception.Message) } finally {
        foreach ($error in Stop-OwnedProcesses $owned) { $result.errors.Add("cleanup: $error") }
        try { Finalize-RawLogEvidence $raw $directory } catch { $result.errors.Add("cleanup: $($_.Exception.Message)") }
        if ($result.errors.Count -gt 0) { $result.success = $false }
        $result.processes = Get-ProcessSummaries $owned; $result.finishedAtUtc = [DateTime]::UtcNow.ToString('o'); Write-SafeJson $result (Join-Path $directory 'scenario-summary.json')
    }
    $ScenarioResults.Add([pscustomobject]$result)
}

function Invoke-AgentBackendScenario {
    $name = 'agent-backend'; $directory = Join-Path $RunDirectory $name; $raw = Join-Path $RawRunDirectory $name
    [IO.Directory]::CreateDirectory($directory) | Out-Null; [IO.Directory]::CreateDirectory($raw) | Out-Null
    $owned = [Collections.Generic.List[object]]::new(); $result = New-ScenarioResult $name $directory $owned
    try {
        Assert-PortsAvailable @($BackendWsPort, $BackendHealthPort)
        $desktop = Start-ScenarioDesktop $name $directory $owned; $result.desktop = $desktop
        $agent = Start-AgentProcess 'tab-agent-south-backend' $directory $raw $BackendWsPort $BackendHealthPort ([string]$desktop.instance.pid) $owned 'http://localhost'
        $result.health = Wait-Health $BackendHealthPort $StartupTimeoutSeconds $agent
        $driverResult = Join-Path $directory 'agent-backend-result.json'; $transcript = Join-Path $directory 'agent-frames.jsonl'
        Invoke-TsxDriver 'agent-backend-client' (Join-Path $ScriptDirectory 'agent-backend.mts') @(
            '--url', "ws://127.0.0.1:$BackendWsPort", '--output', $driverResult, '--transcript', $transcript,
            '--prompt', $SharedPrompt, '--chat-id', ([guid]::NewGuid().ToString()),
            '--timeout-ms', [string]($AgentTurnTimeoutSeconds * 1000)
        ) $directory $owned ($AgentTurnTimeoutSeconds + 30) | Out-Null
        $driver = Get-Content -LiteralPath $driverResult -Raw | ConvertFrom-Json
        if (-not $driver.success) { throw "agent backend driver failed: $($driver.error)" }
        $result.prompt = $SharedPrompt
        $result.evidence = Complete-Evidence $directory $desktop $driver.filePath @($driverResult, $transcript) (Join-Path $raw 'agent-data\logs')
        $result.success = $true
    } catch { $result.errors.Add($_.Exception.Message) } finally {
        foreach ($error in Stop-OwnedProcesses $owned) { $result.errors.Add("cleanup: $error") }
        foreach ($port in @($BackendWsPort, $BackendHealthPort)) { if (-not (Test-PortAvailable $port)) { $result.errors.Add("cleanup: task-owned port $port remains in use") } }
        try { Finalize-RawLogEvidence $raw $directory } catch { $result.errors.Add("cleanup: $($_.Exception.Message)") }
        if ($result.errors.Count -gt 0) { $result.success = $false }
        $result.processes = Get-ProcessSummaries $owned; $result.finishedAtUtc = [DateTime]::UtcNow.ToString('o'); Write-SafeJson $result (Join-Path $directory 'scenario-summary.json')
    }
    $ScenarioResults.Add([pscustomobject]$result)
}

function Invoke-AgentUiScenario {
    $name = 'agent-ui'; $directory = Join-Path $RunDirectory $name; $raw = Join-Path $RawRunDirectory $name
    [IO.Directory]::CreateDirectory($directory) | Out-Null; [IO.Directory]::CreateDirectory($raw) | Out-Null
    $owned = [Collections.Generic.List[object]]::new(); $result = New-ScenarioResult $name $directory $owned
    try {
        if ($UiAgentWsPort -ne 51100 -or $UiAgentHealthPort -ne 51101 -or $UiPort -ne 8081) { throw 'the existing #live-dev producer contract requires UI/backend ports 8081/51100/51101' }
        Assert-PortsAvailable @($UiAgentWsPort, $UiAgentHealthPort, $UiPort, $CdpPort)
        $desktop = Start-ScenarioDesktop $name $directory $owned; $result.desktop = $desktop
        $agent = Start-AgentProcess 'tab-agent-south-ui-backend' $directory $raw $UiAgentWsPort $UiAgentHealthPort ([string]$desktop.instance.pid) $owned "http://localhost:$UiPort"
        $result.health = Wait-Health $UiAgentHealthPort $StartupTimeoutSeconds $agent
        $ui = Start-CapturedProcess -Name 'tab-agent-south-ui' -FilePath $env:ComSpec -Arguments @('/d', '/s', '/c', 'yarn dev:live') -WorkingDirectory $TabAgentSouthUiRepo -LogDirectory (Join-Path $directory 'process-logs') -Owned $owned
        $uiUrl = "http://localhost:$UiPort/#live-dev"; Wait-Http $uiUrl $StartupTimeoutSeconds $ui
        $spec = Join-Path $directory 'ui-cdp-spec.json'; $cdpResult = Join-Path $directory 'ui-cdp-result.json'
        Invoke-TsxDriver 'ui-spec-generator' (Join-Path $ScriptDirectory 'ui-cdp-spec.mts') @('--output', $spec, '--url', $uiUrl, '--prompt', $SharedPrompt, '--timeout-ms', [string]($AgentTurnTimeoutSeconds * 1000)) $directory $owned 30 | Out-Null
        $screenshots = Join-Path $directory 'screenshots'; [IO.Directory]::CreateDirectory($screenshots) | Out-Null
        $cdp = Start-CapturedProcess -Name 'cdp-driver' -FilePath (Get-Command node -ErrorAction Stop).Source -Arguments @(
            (Join-Path $TabAgentSouthUiRepo 'scripts\dev\cdp-drive.js'), '--spec', $spec, '--headed', '--port', [string]$CdpPort, '--screenshot-dir', $screenshots
        ) -WorkingDirectory $TabAgentSouthUiRepo -LogDirectory (Join-Path $directory 'process-logs') -Owned $owned
        Wait-CapturedProcess $cdp ($AgentTurnTimeoutSeconds + 90)
        Invoke-TsxDriver 'ui-report-parser' (Join-Path $ScriptDirectory 'ui-cdp-spec.mts') @('--parse-report', $cdp.stdoutPath, '--output', $cdpResult, '--prompt', $SharedPrompt) $directory $owned 30 | Out-Null
        $parsed = Get-Content -LiteralPath $cdpResult -Raw | ConvertFrom-Json
        if (-not $parsed.success) { throw "UI CDP validation failed: $($parsed.evidence.errors -join '; ')" }
        $agentLog = Get-CombinedLogs (Join-Path $raw 'agent-data\logs') (Join-Path $directory 'agent-combined.log')
        foreach ($tool in @($StartTool, $StopTool)) { if (-not $agentLog.Contains($tool)) { throw "agent log is missing UI turn evidence for $tool" } }
        $result.prompt = $SharedPrompt
        $result.uiUrl = $uiUrl
        $result.evidence = Complete-Evidence $directory $desktop $parsed.evidence.filePath @($cdpResult, $cdp.stdoutPath, (Join-Path $directory 'agent-combined.log')) (Join-Path $raw 'agent-data\logs')
        $result.success = $true
    } catch { $result.errors.Add($_.Exception.Message) } finally {
        foreach ($error in Stop-OwnedProcesses $owned) { $result.errors.Add("cleanup: $error") }
        foreach ($port in @($UiAgentWsPort, $UiAgentHealthPort, $UiPort, $CdpPort)) { if (-not (Test-PortAvailable $port)) { $result.errors.Add("cleanup: task-owned port $port remains in use") } }
        try { Finalize-RawLogEvidence $raw $directory } catch { $result.errors.Add("cleanup: $($_.Exception.Message)") }
        if ($result.errors.Count -gt 0) { $result.success = $false }
        $result.processes = Get-ProcessSummaries $owned; $result.finishedAtUtc = [DateTime]::UtcNow.ToString('o'); Write-SafeJson $result (Join-Path $directory 'scenario-summary.json')
    }
    $ScenarioResults.Add([pscustomobject]$result)
}

trap {
    $failure = $_.Exception.Message
    $summaryPath = Join-Path $RunDirectory 'summary.json'
    try { Remove-OwnedRawDirectory $RawRunDirectory } catch { $failure += "; raw cleanup: $($_.Exception.Message)" }
    try {
        Write-SafeJson ([ordered]@{ runId = $RunId; success = $false; requestedScenario = $Scenario; prompt = $SharedPrompt; finishedAtUtc = [DateTime]::UtcNow.ToString('o'); failures = @("preflight: $failure"); scenarios = $ScenarioResults }) $summaryPath
    } catch {}
    [Console]::Error.WriteLine($failure)
    exit 1
}

if ($env:OS -ne 'Windows_NT') { throw 'This smoke harness supports Windows only.' }
[IO.Directory]::CreateDirectory($RunDirectory) | Out-Null
[IO.Directory]::CreateDirectory($RawRunDirectory) | Out-Null
$MonolithRepo = Assert-Directory $MonolithRepo 'Monolith repository'
$TableauMcpRepo = Assert-Directory $TableauMcpRepo 'Tableau MCP repository'
$TabAgentSouthRepo = Assert-Directory $TabAgentSouthRepo 'tab-agent-south repository'
$TabAgentSouthUiRepo = Assert-Directory $TabAgentSouthUiRepo 'tab-agent-south-ui repository'
$AgentChatUiRepo = Assert-Directory $AgentChatUiRepo 'agent-chat-ui repository'
$TableauMcpEntry = Assert-File $TableauMcpEntry 'Built Tableau MCP Desktop entry'
$DesktopDiscoveryDirectory = [IO.Path]::GetFullPath($DesktopDiscoveryDirectory)
$script:ResolvedTableauExe = Resolve-TableauExecutable
Get-TsxPath | Out-Null

$monolithGit = Get-GitProvenance $MonolithRepo 'origin/main'
$tableauMcpGit = Get-GitProvenance $TableauMcpRepo 'upstream/feature/desktop'
$provenance = [ordered]@{
    runId = $RunId
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    requestedScenario = $Scenario
    prompt = $SharedPrompt
    requiredApiVersion = $RequiredApiVersion.ToString()
    paths = [ordered]@{ tableauExe = $script:ResolvedTableauExe; tableauMcpEntry = $TableauMcpEntry; monolithRepo = $MonolithRepo; tableauMcpRepo = $TableauMcpRepo; tabAgentSouthRepo = $TabAgentSouthRepo; tabAgentSouthExe = $TabAgentSouthExe; tabAgentSouthUiRepo = $TabAgentSouthUiRepo; agentChatUiRepo = $AgentChatUiRepo; workbook = $WorkbookPath; desktopDiscoveryDirectory = $DesktopDiscoveryDirectory; desktopLogPath = $DesktopLogPath; outputDirectory = $RunDirectory; transientRawDirectory = $RawRunDirectory }
    ports = [ordered]@{ backendWs = $BackendWsPort; backendHealth = $BackendHealthPort; uiAgentWs = $UiAgentWsPort; uiAgentHealth = $UiAgentHealthPort; ui = $UiPort; cdp = $CdpPort }
    timeoutsSeconds = [ordered]@{ startup = $StartupTimeoutSeconds; operation = $OperationTimeoutSeconds; agentTurn = $AgentTurnTimeoutSeconds }
    components = [ordered]@{
        monolith = [ordered]@{ git = $monolithGit; executable = Get-FileProvenance $script:ResolvedTableauExe }
        tableauMcp = [ordered]@{ git = $tableauMcpGit; version = (Get-Content -LiteralPath (Join-Path $TableauMcpRepo 'package.json') -Raw | ConvertFrom-Json).version; entry = Get-FileProvenance $TableauMcpEntry }
        tabAgentSouth = [ordered]@{ git = Get-GitProvenance $TabAgentSouthRepo 'HEAD' }
        tabAgentSouthUi = [ordered]@{ git = Get-GitProvenance $TabAgentSouthUiRepo 'HEAD'; version = (Get-Content -LiteralPath (Join-Path $TabAgentSouthUiRepo 'package.json') -Raw | ConvertFrom-Json).version }
        agentChatUi = [ordered]@{ git = Get-GitProvenance $AgentChatUiRepo 'HEAD' }
    }
}
Write-SafeJson $provenance (Join-Path $RunDirectory 'provenance.json')
Write-Host "Workbook performance recording smoke run: $RunDirectory"
Write-Host "Scenario=$Scenario Tableau=$script:ResolvedTableauExe MCP=$TableauMcpEntry Discovery=$DesktopDiscoveryDirectory"
Write-Host "Ports: backend=$BackendWsPort/$BackendHealthPort ui-backend=$UiAgentWsPort/$UiAgentHealthPort ui=$UiPort cdp=$CdpPort"

switch ($Scenario) {
    'direct' { Invoke-DirectScenario }
    'agent-backend' { Invoke-AgentBackendScenario }
    'agent-ui' { Invoke-AgentUiScenario }
    'all' { Invoke-DirectScenario; Invoke-AgentBackendScenario; Invoke-AgentUiScenario }
}

$failures = @($ScenarioResults | Where-Object { -not $_.success } | ForEach-Object { $name = $_.name; $_.errors | ForEach-Object { "$name`: $_" } })
try { Remove-OwnedRawDirectory $RawRunDirectory } catch { $failures += "raw cleanup: $($_.Exception.Message)" }
$summary = [ordered]@{ runId = $RunId; success = $failures.Count -eq 0; requestedScenario = $Scenario; prompt = $SharedPrompt; startedFromProvenance = 'provenance.json'; finishedAtUtc = [DateTime]::UtcNow.ToString('o'); failures = $failures; scenarios = $ScenarioResults }
$summaryPath = Join-Path $RunDirectory 'summary.json'
Write-SafeJson $summary $summaryPath
Write-Host "Summary: $summaryPath"
if ($failures.Count -gt 0) { $failures | ForEach-Object { [Console]::Error.WriteLine($_) }; exit 1 }
exit 0
