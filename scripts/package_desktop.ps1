<#
    Legacy forwarder to scripts\build\package_desktop.ps1
#>
$Target = Join-Path $PSScriptRoot "build\package_desktop.ps1"
& $Target @args
