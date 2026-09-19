<#PSScriptInfo
.VERSION 1.0.0
.GUID 12345678-1234-1234-1234-123456789013
.AUTHOR VickyVM
.COPYRIGHT (c) 2024 VickyVM. All rights reserved.
.TAGS Windows, Service, Agent, VickyVM, Uninstall
.PROJECTURI https://github.com/vickykumar/rdp-manager
.DESCRIPTION
    Uninstalls the VickyVM Agent Windows Service.
    Removes ONLY this application's service, files, and configuration.
    Never removes user files, Windows system files, or other applications.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "C:\Program Files\VickyVM.Agent",

    [Parameter(Mandatory = $false)]
    [string]$DataPath = "C:\ProgramData\VickyVM.Agent",

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [switch]$KeepData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Require Administrator privileges.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

$serviceName = "VickyVM.Agent"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "VickyVM Agent Uninstaller" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Stop and remove only our service.
Write-Host "Removing Windows Service..." -ForegroundColor Green
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($service) {
    if ($service.Status -ne "Stopped") {
        Write-Host "  Stopping service..." -ForegroundColor Yellow
        try {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
            Write-Host "  Service stopped"
        }
        catch {
            Write-Warning "  Failed to stop service: $($_.Exception.Message)"
            if (-not $Force) {
                Write-Error "Service could not be stopped. Use -Force to force removal."
                exit 1
            }
        }
    }

    Write-Host "  Removing service..." -ForegroundColor Yellow
    try {
        Remove-Service -Name $serviceName -ErrorAction Stop
        Write-Host "  Service removed"
    }
    catch {
        Write-Warning "  Remove-Service failed, trying sc.exe delete..."
        sc.exe delete $serviceName | Out-Null
        Write-Host "  Service removed via sc.exe"
    }
}
else {
    Write-Host "  Service not found (already removed)"
}

# Remove our service registry key, if anything remains.
$regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
if (Test-Path $regPath) {
    Write-Host "Removing service registry key..." -ForegroundColor Green
    try {
        Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Registry key removed"
    }
    catch {
        Write-Warning "  Failed to remove registry key: $($_.Exception.Message)"
    }
}

# Clear any VickyVM environment variables that earlier installer versions may have set.
[Environment]::SetEnvironmentVariable("VICKYVM_ENROLLMENT_TOKEN", $null, "Machine")
[Environment]::SetEnvironmentVariable("VICKYVM_SERVER_URL", $null, "Machine")

# Remove the installation directory.
if (Test-Path $InstallPath) {
    Write-Host "Removing installation directory..." -ForegroundColor Green
    try {
        Remove-Item -Path $InstallPath -Recurse -Force -ErrorAction Stop
        Write-Host "  Removed: $InstallPath"
    }
    catch {
        Write-Warning "  Failed to remove installation directory: $($_.Exception.Message)"
    }
}
else {
    Write-Host "  Installation directory not found: $InstallPath"
}

# Remove the data directory (logs, state) unless -KeepData was given.
if (-not $KeepData -and (Test-Path $DataPath)) {
    Write-Host "Removing data directory..." -ForegroundColor Green
    try {
        Remove-Item -Path $DataPath -Recurse -Force -ErrorAction Stop
        Write-Host "  Removed: $DataPath"
    }
    catch {
        Write-Warning "  Failed to remove data directory: $($_.Exception.Message)"
    }
}
elseif ($KeepData) {
    Write-Host "Keeping data directory (per -KeepData): $DataPath" -ForegroundColor Yellow
}
else {
    Write-Host "  Data directory not found: $DataPath"
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Uninstall Complete!" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Removed (this application only):" -ForegroundColor White
Write-Host "  - Windows Service: $serviceName" -ForegroundColor White
Write-Host "  - Installation directory: $InstallPath" -ForegroundColor White
if (-not $KeepData) {
    Write-Host "  - Data directory: $DataPath" -ForegroundColor White
}
else {
    Write-Host "  - Data directory: $DataPath (KEPT per -KeepData)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "User files, Windows system files, and other applications were NOT affected." -ForegroundColor Green