param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/ws/package.json'))) {
        & npm.cmd ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости.' }
    }
    $running = $false
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 2
        $running = $health.ok -and $health.transport -eq 'relay'
    } catch { }
    if (-not $running) {
        $logDir = Join-Path $PSScriptRoot 'dev'
        [void](New-Item -ItemType Directory -Path $logDir -Force)
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server-out.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
        $serverProcess.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 1; if ($health.ok) { $running = $true; break } } catch { }
        }
    }
    if (-not $running) { throw 'Сервер не запустился. Подробности: dev/server-error.log' }
    if (-not $NoBrowser) { Start-Process 'http://localhost:3000' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Установите Node.js 20+ и повторите запуск. Инструкция: README.md'
    Read-Host 'Нажмите Enter для закрытия'
    exit 1
}
