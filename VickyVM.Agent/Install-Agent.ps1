<# 
.SYNOPSIS
    Installs VickyVM Agent as a Windows Service

.DESCRIPTION
    This script installs the VickyVM Agent on a Windows VM. Supports downloading from:
    1. Cloudflare R2 (public bucket)
    2. GitHub Releases (private repo with PAT)
    3. Local exe file

.PARAMETER EnrollmentToken
    The enrollment token from the RDP Manager dashboard (required)

.PARAMETER ServerUrl
    The RDP Manager server URL (default: https://rdp-manager.vks95.workers.dev)

.PARAMETER DownloadSource
    Source type: "R2", "GitHub", "Local" (default: tries to auto-detect)

.PARAMETER R2PublicUrl
    Public R2 URL (e.g., https://<account>.r2.cloudflarestorage.com/bucket/VickyVM.Agent.exe)

.PARAMETER GitHubRepo
    GitHub repo in format "owner/repo" (e.g., "ervicky95/rdp_manager")

.PARAMETER GitHubTag
    Release tag (e.g., "v1.0.0")

.PARAMETER GitHubPat
    Fine-grained PAT with Contents:Read permission (for private repos)

.PARAMETER InstallDir
    Installation directory (default: C:\Program Files\VickyVM.Agent)

.PARAMETER DataDir
    Data directory for logs/credentials (default: C:\ProgramData\VickyVM.Agent)

.PARAMETER UseLocalExe
    Use VickyVM.Agent.exe placed next to this script

.EXAMPLE - Cloudflare R2 (public bucket)
    .\Install-Agent.ps1 -EnrollmentToken "abc123..." -DownloadSource R2 -R2PublicUrl "https://xxx.r2.cloudflarestorage.com/bucket/VickyVM.Agent.exe"

.EXAMPLE - GitHub Private Repo
    .\Install-Agent.ps1 -EnrollmentToken "abc123..." -DownloadSource GitHub -GitHubRepo "ervicky95/rdp_manager" -GitHubTag "v1.0.0" -GitHubPat "github_pat_xxx"

.EXAMPLE - Local exe
    .\Install-Agent.ps1 -EnrollmentToken "abc123..." -UseLocalExe
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$EnrollmentToken,

    [string]$ServerUrl = "https://rdp-manager.vks95.workers.dev",

    [ValidateSet("R2", "GitHub", "Local", "Auto")]
    [string]$DownloadSource = "Auto",

    [string]$R2PublicUrl = "",

    [string]$GitHubRepo = "ervicky95/rdp_manager",

    [string]$GitHubTag = "v1.0.0",

    [string]$GitHubPat = "",

    [string]$InstallDir = "C:\Program Files\VickyVM.Agent",

    [string]$DataDir = "C:\ProgramData\VickyVM.Agent",

    [switch]$UseLocalExe,

    [switch]$ForceReinstall
)

# Require Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}

$ErrorActionPreference = "Stop"

Write-Host "=== VickyVM Agent Installer ===" -ForegroundColor Cyan
Write-Host "Server: $ServerUrl"
Write-Host "Install Dir: $InstallDir"
Write-Host "Data Dir: $DataDir"
Write-Host ""

# Determine exe source
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$localExePath = Join-Path $scriptDir "VickyVM.Agent.exe"
$targetExePath = Join-Path $InstallDir "VickyVM.Agent.exe"

# Auto-detect source
if ($DownloadSource -eq "Auto") {
    if ($UseLocalExe -or (Test-Path $localExePath)) {
        $DownloadSource = "Local"
    }
    elseif ($env:AGENT_R2_URL) {
        $DownloadSource = "R2"
        $R2PublicUrl = $env:AGENT_R2_URL
    }
    elseif ($env:AGENT_GITHUB_PAT -and $env:AGENT_GITHUB_REPO) {
        $DownloadSource = "GitHub"
        $GitHubRepo = $env:AGENT_GITHUB_REPO
        $GitHubPat = $env:AGENT_GITHUB_PAT
        $GitHubTag = $env:AGENT_GITHUB_TAG ?? "v1.0.0"
    }
    else {
        Write-Warning "No download source configured. Checking for local exe..."
        if (Test-Path $localExePath) {
            $DownloadSource = "Local"
        }
        else {
            Write-Error "No executable source. Set DownloadSource or place exe next to script."
            exit 1
        }
    }
}

Write-Host "Download Source: $DownloadSource" -ForegroundColor Green

# Validate source-specific params
switch ($DownloadSource) {
    "R2" {
        if (-not $R2PublicUrl) { Write-Error "R2PublicUrl required for R2 source"; exit 1 }
        $downloadUrl = $R2PublicUrl
        $headers = @{}
    }
    "GitHub" {
        if (-not $GitHubPat) { Write-Error "GitHubPat required for GitHub source (fine-grained PAT with Contents:Read)"; exit 1 }
        $downloadUrl = "https://github.com/$GitHubRepo/releases/download/$GitHubTag/VickyVM.Agent.exe"
        $headers = @{ Authorization = "Bearer $GitHubPat"; Accept = "application/octet-stream" }
    }
    "Local" {
        if (-not (Test-Path $localExePath)) { Write-Error "Local exe not found at: $localExePath"; exit 1 }
    }
    default { Write-Error "Invalid DownloadSource: $DownloadSource"; exit 1 }
}

# Stop existing service if running
$serviceName = "VickyVM.Agent"
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping existing service..." -ForegroundColor Yellow
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if ($ForceReinstall) {
        Write-Host "Removing existing service..." -ForegroundColor Yellow
        sc.exe delete $serviceName 2>$null
    }
}

# Create directories
Write-Host "Creating directories..." -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "Logs") | Out-Null

# Download/Copy executable
if ($DownloadSource -ne "Local") {
    Write-Host "Downloading agent executable from $DownloadSource..." -ForegroundColor Green
    Write-Host "URL: $downloadUrl"
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $targetExePath -Headers $headers -UseBasicParsing
        Write-Host "Downloaded to: $targetExePath" -ForegroundColor Green
    }
    catch {
        Write-Error "Failed to download: $_"
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Error "Response: $body"
        }
        exit 1
    }
}
else {
    Write-Host "Copying local executable..." -ForegroundColor Green
    Copy-Item -Path $localExePath -Destination $targetExePath -Force
    Write-Host "Copied to: $targetExePath" -ForegroundColor Green
}

# Create appsettings.json
Write-Host "Creating configuration..." -ForegroundColor Green
$appsettings = @{
    Agent = @{
        ServerUrl = $ServerUrl
        PollIntervalSeconds = 60
        StartupGracePeriodMinutes = 5
        LogLevel = "Information"
        DataDirectory = $DataDir
        LogDirectory = Join-Path $DataDir "Logs"
        EnrollmentTokenPath = Join-Path $DataDir "enrollment.token"
        MaxLogAgeDays = 30
        MaxLogSizeMB = 100
        RequestTimeoutSeconds = 30
        MaxRetryAttempts = 3
        BaseRetryDelaySeconds = 5
        MaxRetryDelaySeconds = 300
    }
    Health = @{
        CpuWarningPercent = 80
        CpuCriticalPercent = 95
        MemoryWarningPercent = 80
        MemoryCriticalPercent = 90
        DiskWarningPercent = 80
        DiskCriticalPercent = 90
        TopProcessCount = 5
    }
    Rdp = @{
        MaxAutomaticChecksPerDay = 2
        AutoCheckIntervalHours = 12
        RecoveryWaitSeconds = 15
        PortCheckTimeoutSeconds = 2
        AutomaticChecksEnabled = $true
    }
    Logging = @{
        LogLevel = @{
            Default = "Information"
            Microsoft = "Warning"
            "Microsoft.Hosting.Lifetime" = "Information"
            "VickyVM.Agent" = "Information"
        }
        File = @{
            Path = Join-Path $DataDir "Logs\agent-.log"
            MinLogLevel = "Information"
            RollingInterval = "Day"
            RetainedFileCountLimit = 30
            FileSizeLimitBytes = 104857600
            MaxLogAgeDays = 30
        }
    }
} | ConvertTo-Json -Depth 10

$appsettings | Out-File -FilePath (Join-Path $InstallDir "appsettings.json") -Encoding utf8

# Write enrollment token (secured)
$tokenPath = Join-Path $DataDir "enrollment.token"
$EnrollmentToken | Out-File -FilePath $tokenPath -Encoding utf8 -NoNewline
$acl = Get-Acl $tokenPath
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM","FullControl","Allow")
$acl.AddAccessRule($rule)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","Allow")
$acl.AddAccessRule($rule)
Set-Acl $tokenPath $acl
Write-Host "Enrollment token saved (secured)" -ForegroundColor Green

# Install Windows Service
Write-Host "Installing Windows Service..." -ForegroundColor Green
$serviceDescription = "VickyVM Windows Agent - Outbound-only HTTPS agent for VM management"
$serviceDisplayName = "VickyVM Agent"

try {
    $cmd = "sc.exe create `"$serviceName`" binPath= `"$targetExePath`" DisplayName= `"$serviceDisplayName`" start= auto obj= `"`"LocalSystem`"`" Description= `"$serviceDescription`""
    Invoke-Expression $cmd
    Write-Host "Service created" -ForegroundColor Green
    sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>$null
}
catch {
    Write-Error "Failed to create service: $_"
    exit 1
}

# Start service
Write-Host "Starting service..." -ForegroundColor Green
Start-Service -Name $serviceName -ErrorAction Stop
Start-Sleep -Seconds 3

# Verify
$service = Get-Service -Name $serviceName
if ($service.Status -eq 'Running') {
    Write-Host ""
    Write-Host "=== INSTALLATION SUCCESSFUL ===" -ForegroundColor Cyan
    Write-Host "Service: $serviceName (Running)"
    Write-Host "Executable: $targetExePath"
    Write-Host "Config: $InstallDir\appsettings.json"
    Write-Host "Data: $DataDir"
    Write-Host ""
    Write-Host "Agent is enrolling with server... Check dashboard in ~60s." -ForegroundColor Green
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Cyan
    Write-Host "  Logs: Get-Content '$DataDir\Logs\agent-$(Get-Date -Format 'yyyy-MM-dd').log' -Wait"
    Write-Host "  Status: Get-Service $serviceName"
    Write-Host "  Restart: Restart-Service $serviceName"
    Write-Host "  Uninstall: sc.exe delete $serviceName"
}
else {
    Write-Error "Service failed to start. Status: $($service.Status)"
    Write-Host "Check logs: $DataDir\Logs\agent-$(Get-Date -Format 'yyyy-MM-dd').log"
    exit 1
}