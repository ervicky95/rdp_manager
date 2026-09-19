<#PSScriptInfo
.VERSION 1.0.0
.GUID 12345678-1234-1234-1234-123456789012
.AUTHOR VickyVM
.COPYRIGHT (c) 2024 VickyVM. All rights reserved.
.TAGS Windows, Service, Agent, VickyVM
.PROJECTURI https://github.com/vickykumar/rdp-manager
.DESCRIPTION
    Installs the VickyVM Agent as a normal visible Windows Service.
    - Automatic startup with Windows
    - Automatic recovery after service failure
    - Runs as LocalSystem, so it works without an RDP login
    - Outbound HTTPS only; no inbound management port
    Does not create hidden persistence, bypass Defender, or disable security controls.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SourcePath = $PSScriptRoot,

    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "C:\Program Files\VickyVM.Agent",

    [Parameter(Mandatory = $false)]
    [string]$DataPath = "C:\ProgramData\VickyVM.Agent",

    [Parameter(Mandatory = $false)]
    [string]$ServerUrl = "https://localhost:8787",

    [Parameter(Mandatory = $false)]
    [string]$EnrollmentToken,

    [Parameter(Mandatory = $false)]
    [ValidateSet('Information', 'Debug', 'Warning', 'Error')]
    [string]$LogLevel = "Information",

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Require Administrator privileges.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# Require an HTTPS server URL (outbound-only design; never plain HTTP).
if ($ServerUrl -notmatch "^https://") {
    Write-Error "Invalid ServerUrl. The agent communicates outbound via HTTPS only; ServerUrl must start with https://"
    exit 1
}

$serviceName = "VickyVM.Agent"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "VickyVM Agent Installer (enrollment)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Refuse to touch an unrelated service: only our exact service name is managed.
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService -and -not $Force) {
    Write-Warning "Service '$serviceName' already exists. Use -Force to reinstall."
    exit 1
}

if ($existingService -and $Force) {
    Write-Host "Removing existing service..." -ForegroundColor Yellow
    & "$PSScriptRoot\uninstall.ps1" -Force
    Start-Sleep -Seconds 2
}

# Create directories.
Write-Host "Creating directories..." -ForegroundColor Green
foreach ($dir in @($InstallPath, $DataPath, "$DataPath\Logs")) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  Created: $dir"
    }
}

# Restrict data directory to SYSTEM and Administrators.
Write-Host "Setting directory permissions..." -ForegroundColor Green
$acl = Get-Acl $DataPath
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule(
    [System.Security.AccessControl.FileSystemAccessRule]::new("SYSTEM", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"))
$acl.AddAccessRule(
    [System.Security.AccessControl.FileSystemAccessRule]::new("Administrators", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"))
Set-Acl $DataPath $acl

# Copy published agent files into the install directory.
Write-Host "Copying agent files from $SourcePath..." -ForegroundColor Green
Get-ChildItem -Path $SourcePath -File | Where-Object {
    $_.Extension -in ".exe", ".dll", ".json", ".config"
} | ForEach-Object {
    Copy-Item $_.FullName -Destination $InstallPath -Force
    Write-Host "  Copied: $($_.Name)"
}

# Write appsettings.json so this machine runs against the intended server and paths.
Write-Host "Writing configuration..." -ForegroundColor Green
$config = @{
    Agent = @{
        ServerUrl = $ServerUrl
        PollIntervalSeconds = 60
        StartupGracePeriodMinutes = 5
        LogLevel = $LogLevel
        DataDirectory = $DataPath
        LogDirectory = "$DataPath\Logs"
        EnrollmentTokenPath = "$DataPath\enrollment.token"
        MaxLogAgeDays = 30
        MaxLogSizeMB = 100
        RequestTimeoutSeconds = 30
        MaxRetryAttempts = 3
        BaseRetryDelaySeconds = 5
        MaxRetryDelaySeconds = 300
    }
    Logging = @{
        LogLevel = @{
            Default = $LogLevel
            Microsoft = "Warning"
            "Microsoft.Hosting.Lifetime" = "Information"
            "VickyVM.Agent" = $LogLevel
        }
        File = @{
            Path = "$DataPath\Logs\agent-.log"
            MinLogLevel = $LogLevel
            RollingInterval = "Day"
            RetainedFileCountLimit = 30
            FileSizeLimitBytes = 104857600
            MaxLogAgeDays = 30
        }
    }
}
$config | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $InstallPath "appsettings.json") -Encoding UTF8
Write-Host "  Configuration written with ServerUrl: $ServerUrl"

# Persist the enrollment token in the restriction-protected data directory.
# The agent reads it once, enrolls, and deletes it. Only SYSTEM/Administrators
# can read it (inherited from the data directory ACL above). Never echoed.
if ($EnrollmentToken) {
    $tokenPath = Join-Path $DataPath "enrollment.token"
    $EnrollmentToken | Set-Content -Path $tokenPath -Encoding UTF8 -NoNewline
    Write-Host "  Enrollment token saved (single-use; consumed on first enrollment)" -ForegroundColor Green
}
else {
    Write-Warning "No -EnrollmentToken provided. The agent will wait for a token; pass -EnrollmentToken to enroll now."
}

# Install as a normal visible Windows Service.
# LocalSystem account (New-Service default) -> works without any RDP login.
# StartupType Automatic -> starts with Windows.
Write-Host "Installing Windows Service..." -ForegroundColor Green
$servicePath = Join-Path $InstallPath "VickyVM.Agent.exe"
try {
    New-Service -Name $serviceName `
        -BinaryPathName "`"$servicePath`"" `
        -DisplayName "VickyVM Agent" `
        -Description "VickyVM Windows Agent - Outbound HTTPS agent for VM management" `
        -StartupType Automatic `
        -ErrorAction Stop
    Write-Host "  Service installed (automatic startup, LocalSystem)"
}
catch {
    Write-Error "Failed to install service: $($_.Exception.Message)"
    exit 1
}

# Automatic recovery after failure: restart 1m, 2m, 5m; reset counters after 24h.
Write-Host "Configuring service recovery..." -ForegroundColor Green
sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
Write-Host "  Recovery configured: restart on failure (1m, 2m, 5m delays)"

# Start the service immediately (unless -NoStart).
if (-not $NoStart) {
    Write-Host "Starting service..." -ForegroundColor Green
    Start-Service -Name $serviceName -ErrorAction Stop
    Start-Sleep -Seconds 3

    $service = Get-Service -Name $serviceName
    if ($service.Status -eq "Running") {
        Write-Host "  Service started" -ForegroundColor Green
    }
    else {
        Write-Warning "  Service state: $($service.Status). Check logs at $DataPath\Logs"
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Installation Complete!" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Name:  $serviceName" -ForegroundColor White
Write-Host "Install Path:  $InstallPath" -ForegroundColor White
Write-Host "Data Path:     $DataPath" -ForegroundColor White
Write-Host "Server URL:    $ServerUrl" -ForegroundColor White
Write-Host ""
Write-Host "Management:" -ForegroundColor Yellow
Write-Host "  Start:   Start-Service -Name $serviceName" -ForegroundColor White
Write-Host "  Stop:    Stop-Service -Name $serviceName" -ForegroundColor White
Write-Host "  Status:  Get-Service -Name $serviceName" -ForegroundColor White
Write-Host "  Logs:    Get-Content (Join-Path '$DataPath\Logs' 'agent-*.log') -Tail 50" -ForegroundColor White
Write-Host ""
Write-Host "Uninstall: & `"$PSScriptRoot\uninstall.ps1`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "The agent communicates outbound via HTTPS only and opens no inbound port." -ForegroundColor Gray