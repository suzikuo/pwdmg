<#
    Legacy forwarder to scripts\extension\install_native_host.ps1
#>
$Target = Join-Path $PSScriptRoot "extension\install_native_host.ps1"
& $Target @args
