param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
# окно игры в Chrome или Edge (режим приложения, без вкладок): только они в полном экране отдают клавишу Esc игре,
# и мышь в бою не отпускается. Нет ни того, ни другого — обычный браузер по умолчанию
function Open-Game([string]$url) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
    foreach ($exe in $candidates) {
        if ($exe -and (Test-Path -LiteralPath $exe)) { $gameBrowserPath = Join-Path $PSScriptRoot 'dev/browser-profile'
            Start-Process -FilePath $exe -ArgumentList '--start-fullscreen','--no-first-run','--no-default-browser-check',('--user-data-dir="' + $gameBrowserPath + '"'),('--app=' + $url); return }
    }
    Start-Process $url
}
Set-Location -LiteralPath $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/ws/package.json'))) {
        & npm.cmd ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости.' }
    }
    # Отдельная рабочая копия: запускаем только её сервер, без обновления из Git.
    $running = $false
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2
        $running = $health.ok -and $health.project -eq 'territory-war-copy1'
        if ($health.ok -and -not $running) { throw 'Порт 3001 занят другой игрой. Закройте её перед запуском копии.' }
    } catch {
        if ($_.Exception.Message -like 'Порт 3001*') { throw }
    }
    if (-not $running) {
        $logDir = Join-Path $PSScriptRoot 'dev'
        [void](New-Item -ItemType Directory -Path $logDir -Force)
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server-out.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
        $serverProcess.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 1; if ($health.ok) { $running = $true; break } } catch { }
        }
    }
    if (-not $running) { throw 'Сервер не запустился. Подробности: dev/server-error.log' }
    if (-not $NoBrowser) { Open-Game 'http://localhost:3001' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Установите Node.js 20+ и повторите запуск. Инструкция: README.md'
    Read-Host 'Нажмите Enter для закрытия'
    exit 1
}
