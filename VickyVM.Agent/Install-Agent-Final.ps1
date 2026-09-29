<# 
.SYNOPSIS
    One-command VickyVM Agent installer - downloads, installs, starts service

.DESCRIPTION
    Run this single command on Windows VM (PowerShell Admin):
    
    irm "https://raw.githubusercontent.com/ervicky95/rdp_manager/main/VickyVM.Agent/Install-Agent-Final.ps1" | iex -ArgumentList @("-EnrollmentToken","YOUR_TOKEN")

    The script will:
    1. Download agent exe from Netlify (permanent free hosting)
    2. Install as Windows Service (auto-start)
    3. Write enrollment token securely
    4. Start service
    5. Agent appears in dashboard within 60s

.PARAMETER EnrollmentToken
    Token from RDP Manager dashboard (+ Add VM)

.PARAMETER ServerUrl
    Server URL (default: https://rdp-manager.vks95.workers.dev)

.PARAMETER AgentUrl
    Direct download URL for VickyVM.Agent.exe (default: Netlify mirror)

.EXAMPLE
    irm "https://raw.githubusercontent.com/ervicky95/rdp_manager/main/VickyVM.Agent/Install-Agent-Final.ps1" | iex -ArgumentList @("-EnrollmentToken","abc123...")

.EXAMPLE
    .\Install-Agent-Final.ps1 -EnrollmentToken "abc123..." -AgentUrl "https://my-host.com/agent.exe"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$EnrollmentToken,

    [string]$ServerUrl = "https://rdp-manager.vks95.workers.dev",

    # DEFAULT: Netlify mirror (update this when you upload to Netlify Drop)
    [string]$AgentUrl = "https://vickym-agent.netlify.app/VickyVM.Agent.exe",

    [string]$InstallDir = "C:\Program Files\VickyVM.Agent",
    [string]$DataDir = "C:\ProgramData\VickyVM.Agent",
    [switch]$ForceReinstall
)

# Require Admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run as Administrator (right-click PowerShell → Run as Administrator)"
    exit 1
}
$ErrorActionPreference = "Stop"

Write-Host "=== VickyVM Agent Quick Install ===" -ForegroundColor Cyan
Write-Host "Server: $ServerUrl"
Write-Host "Source: $AgentUrl"
Write-Host ""

# Stop existing
$svc = "VickyVM.Agent"
if (Get-Service $svc -ea 0) { Stop-Service $svc -Force; sleep 2; if ($ForceReinstall) { sc.exe delete $svc 2>$null } }

# Dirs
$exePath = Join-Path $InstallDir "VickyVM.Agent.exe"
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir, (Join-Path $DataDir "Logs") | Out-Null

# Download
Write-Host "Downloading agent..." -ForegroundColor Green
try { Invoke-WebRequest $AgentUrl -OutFile $exePath -UseBasicParsing; Write-Host "OK" -Fore Green }
catch { Write-Error "Download failed: $_`nCheck AgentUrl or upload to Netlify Drop first"; exit 1 }

# Config
@{
    Agent = @{ ServerUrl=$ServerUrl; PollIntervalSeconds=60; StartupGracePeriodMinutes=5; LogLevel="Information"; DataDirectory=$DataDir; LogDirectory=Join-Path $DataDir "Logs"; EnrollmentTokenPath=Join-Path $DataDir "enrollment.token"; MaxLogAgeDays=30; MaxLogSizeMB=100; RequestTimeoutSeconds=30; MaxRetryAttempts=3; BaseRetryDelaySeconds=5; MaxRetryDelaySeconds=300 }
    Health = @{ CpuWarningPercent=80; CpuCriticalPercent=95; MemoryWarningPercent=80; MemoryCriticalPercent=90; DiskWarningPercent=80; DiskCriticalPercent=90; TopProcessCount=5 }
    Rdp = @{ MaxAutomaticChecksPerDay=2; AutoCheckIntervalHours=12; RecoveryWaitSeconds=15; PortCheckTimeoutSeconds=2; AutomaticChecksEnabled=$true }
    Logging = @{ LogLevel=@{ Default="Information"; Microsoft="Warning"; "Microsoft.Hosting.Lifetime"="Information"; "VickyVM.Agent"="Information" }; File=@{ Path=Join-Path $DataDir "Logs\agent-.log"; MinLogLevel="Information"; RollingInterval="Day"; RetainedFileCountLimit=30; FileSizeLimitBytes=104857600; MaxLogAgeDays=30 } }
} | ConvertTo-Json -Depth 10 | Out-File (Join-Path $InstallDir "appsettings.json") -Enc utf8

# Token (secured)
$tokenPath = Join-Path $DataDir "enrollment.token"
$EnrollmentToken | Out-File $tokenPath -Enc utf8 -NoNewline
$acl = Get-Acl $tokenPath; $acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule("SYSTEM","FullControl","Allow")))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","Allow")))
Set-Acl $tokenPath $acl

# Service
Write-Host "Installing service..." -Fore Green
sc.exe create $svc binPath= "`"$exePath`"" DisplayName= "VickyVM Agent" start= auto obj= "LocalSystem" Description= "VickyVM Windows Agent" 2>$null
sc.exe failure $svc reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>$null
Start-Service $svc -ea Stop; sleep 3

# Verify
if ((Get-Service $svc).Status -eq 'Running') {
    Write-Host "`n=== DONE ===" -Fore Cyan
    Write-Host "Service: $svc (Running)" -Fore Green
    Write-Host "Check dashboard: $ServerUrl" -Fore Green
    Write-Host "Logs: gc '$DataDir\Logs\agent-$(date -f yyyy-MM-dd).log' -Wait" -Fore Cyan
} else { Write-Error "Service failed"; gc "$DataDir\Logs\agent-$(date -f yyyy-MM-dd).log" -ea 0; exit 1 }