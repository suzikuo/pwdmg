<#
    Legacy forwarder to scripts\release\release_desktop.ps1
#>
$Target = Join-Path $PSScriptRoot "release\release_desktop.ps1"
& $Target @args
