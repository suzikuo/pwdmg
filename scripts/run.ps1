<#
.SYNOPSIS
    My Password Manager - 统一控制中心 (All-in-One CLI & Interactive Manager)
.DESCRIPTION
    一键运行开发、构建打包、多端测试、插件注册、版本发布和清理任务。
.EXAMPLE
    .\run.ps1                     # 启动交互式菜单
    .\run.ps1 -Task test          # 执行全部测试
    .\run.ps1 -Task package       # 打包桌面端绿色包、ZIP 与 NSIS 安装包
    .\run.ps1 -Task dev           # 运行桌面端开发模式
#>

param(
    [string] $Task = "",
    [string] $ExtensionId = "",
    [switch] $Clean,
    [switch] $SkipFrontend,
    [switch] $NoZip,
    [switch] $NoSetup,
    [switch] $NoExtension,
    [switch] $Help
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
if (-not $Root) {
    $Root = (Resolve-Path ".").Path
}
$RootPath = $Root.TrimEnd("\")

function Show-Help {
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "     My Password Manager - 控制中心命令行帮助" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "用法:"
    Write-Host "  .\run.ps1                  启动交互式选择菜单"
    Write-Host "  .\run.ps1 -Task <任务名>   直接执行指定任务"
    Write-Host ""
    Write-Host "可用任务 (-Task):"
    Write-Host "  test            运行全量测试套件 (Frontend + Extension + Rust)"
    Write-Host "  test-front      仅运行前端测试 (266 项)"
    Write-Host "  test-ext        仅运行浏览器扩展测试 (43 项)"
    Write-Host "  test-rust       仅运行 Rust 核心测试"
    Write-Host "  package         打包桌面端 (绿色包 + ZIP + NSIS 安装包 + 浏览器扩展)"
    Write-Host "  build-front     仅构建前端资源"
    Write-Host "  build-android   编译 Android Release APK"
    Write-Host "  dev             启动桌面端开发调试"
    Write-Host "  dev-front       启动前端 Vite 开发服务"
    Write-Host "  install-host    注册 Native Host (-ExtensionId <ID>)"
    Write-Host "  release         启动版本发布流程"
    Write-Host "  clean           清理编译缓存和产物"
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Invoke-FrontendBuildAll {
    Write-Host "`n==> 构建全部前端资源 (Android / Desktop / Web)..." -ForegroundColor Cyan
    Push-Location (Join-Path $RootPath "front")
    try {
        npm run build:all
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build:all failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

if ($Help) {
    Show-Help
    exit 0
}

function Invoke-Task {
    param([string] $SelectedTask)

    switch ($SelectedTask.ToLowerInvariant()) {
        "dev" {
            Write-Host "`n==> 启动桌面端调试 (Cargo Run)..." -ForegroundColor Cyan
            Push-Location (Join-Path $RootPath "src-tauri")
            try { cargo run } finally { Pop-Location }
        }
        "dev-front" {
            Write-Host "`n==> 启动前端开发服务器 (Vite Dev)..." -ForegroundColor Cyan
            Push-Location (Join-Path $RootPath "front")
            try { npm run dev } finally { Pop-Location }
        }
        "package" {
            Write-Host "`n==> 执行桌面端完整打包 (Rust + Tauri v2)..." -ForegroundColor Cyan
            $PackageScript = Join-Path $RootPath "scripts\build\package_desktop.ps1"
            $ArgsList = @()
            if ($Clean) { $ArgsList += "-Clean" }
            if ($SkipFrontend) { $ArgsList += "-SkipFrontend" }
            if ($NoZip) { $ArgsList += "-NoZip" }
            if ($NoSetup) { $ArgsList += "-NoSetup" }
            if ($NoExtension) { $ArgsList += "-NoExtension" }
            & $PackageScript @ArgsList
        }
        "build-front" {
            Write-Host "`n==> 编译前端静态资源..." -ForegroundColor Cyan
            Invoke-FrontendBuildAll
        }
        "build-android" {
            Write-Host "`n==> 先更新 Android 前端资源..." -ForegroundColor Cyan
            Invoke-FrontendBuildAll
            Write-Host "`n==> 编译 Android Release APK..." -ForegroundColor Cyan
            & (Join-Path $RootPath "scripts\build\build_android.ps1")
        }
        "test" {
            & (Join-Path $RootPath "scripts\test\test_all.ps1")
        }
        "test-front" {
            Write-Host "`n==> 运行前端测试套件..." -ForegroundColor Cyan
            & (Join-Path $RootPath "scripts\test\test_frontend.ps1")
        }
        "test-ext" {
            Write-Host "`n==> 运行浏览器扩展测试套件..." -ForegroundColor Cyan
            & (Join-Path $RootPath "scripts\test\test_extension.ps1")
        }
        "test-rust" {
            Write-Host "`n==> 运行 Rust 核心测试套件..." -ForegroundColor Cyan
            & (Join-Path $RootPath "scripts\test\test_rust.ps1")
        }
        "install-host" {
            $TargetExtensionId = $ExtensionId
            if (-not $TargetExtensionId) {
                $TargetExtensionId = Read-Host "请输入浏览器扩展 ID (Extension ID)"
            }
            if (-not $TargetExtensionId.Trim()) {
                Write-Host "错误: 扩展 ID 不能为空。" -ForegroundColor Red
                return
            }
            & (Join-Path $RootPath "scripts\extension\install_native_host.ps1") -ExtensionId $TargetExtensionId.Trim()
        }
        "release" {
            Write-Host "`n==> 启动桌面端与多端版本发布流水线..." -ForegroundColor Cyan
            & (Join-Path $RootPath "scripts\release\release_desktop.ps1")
        }
        "clean" {
            & (Join-Path $RootPath "scripts\clean.ps1")
        }
        default {
            Write-Host "未知任务: $SelectedTask。请使用 -Help 查看帮助。" -ForegroundColor Red
            exit 1
        }
    }
}

if ($Task) {
    Invoke-Task $Task
    exit 0
}

function Show-Menu {
    Clear-Host
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "        My Password Manager - 控制中心 (Task Manager)      " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 开发调试 (Dev)" -ForegroundColor Yellow
    Write-Host "      11. 启动桌面端调试 (Tauri Dev / Cargo Run)"
    Write-Host "      12. 启动前端调试服务器 (Vite Dev)"
    Write-Host ""
    Write-Host "  [2] 构建打包 (Build & Package)" -ForegroundColor Yellow
    Write-Host "      21. 打包 Windows 桌面端 (绿色包 + ZIP + NSIS 安装包 + 浏览器扩展)"
    Write-Host "      22. 仅构建前端静态资源 (Desktop / Android / Web)"
    Write-Host "      23. 编译 Android Release APK"
    Write-Host ""
    Write-Host "  [3] 运行测试 (Run Tests)" -ForegroundColor Yellow
    Write-Host "      31. 运行全部测试套件 (Frontend + Extension + Rust)"
    Write-Host "      32. 仅运行前端测试 (Vue 3 / 266 项)"
    Write-Host "      33. 仅运行浏览器扩展测试 (43 项)"
    Write-Host "      34. 仅运行 Rust 核心测试 (8 项)"
    Write-Host ""
    Write-Host "  [4] 浏览器扩展工具 (Extension)" -ForegroundColor Yellow
    Write-Host "      41. 注册 Native Host 到 Chrome / Edge 注册表"
    Write-Host ""
    Write-Host "  [5] 版本发布 (Release)" -ForegroundColor Yellow
    Write-Host "      51. 交互式多端版本发布 (版本递增 / 打包 / GitHub Release)"
    Write-Host ""
    Write-Host "  [6] 清理缓存 (Clean)" -ForegroundColor Yellow
    Write-Host "      61. 清理 Rust target、前端 dist 及 Release 临时产物"
    Write-Host ""
    Write-Host "  [0] 退出控制中心" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Cyan
}

while ($true) {
    Show-Menu
    $Choice = Read-Host "`n请输入选项编号"
    $Choice = $Choice.Trim()

    if ($Choice -in @("0", "q", "exit", "quit")) {
        Write-Host "`n再见！" -ForegroundColor Green
        break
    }

    try {
        switch ($Choice) {
            "11" { Invoke-Task "dev" }
            "12" { Invoke-Task "dev-front" }
            "21" { Invoke-Task "package" }
            "22" { Invoke-Task "build-front" }
            "23" { Invoke-Task "build-android" }
            "31" { Invoke-Task "test" }
            "32" { Invoke-Task "test-front" }
            "33" { Invoke-Task "test-ext" }
            "34" { Invoke-Task "test-rust" }
            "41" { Invoke-Task "install-host" }
            "51" { Invoke-Task "release" }
            "61" { Invoke-Task "clean" }
            default {
                Write-Host "无效选项: $Choice，请重新输入。" -ForegroundColor Red
            }
        }
    } catch {
        Write-Host "`n[错误] 执行失败: $_" -ForegroundColor Red
    }

    Write-Host "`n按回车键返回主菜单..." -ForegroundColor Gray
    [void][System.Console]::ReadLine()
}
