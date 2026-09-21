<#
    Legacy forwarder to scripts\release\write_update_manifest.ps1
#>
$Target = Join-Path $PSScriptRoot "release\write_update_manifest.ps1"
& $Target @args
