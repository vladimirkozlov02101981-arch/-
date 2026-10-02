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
        if ($exe -and (Test-Path -LiteralPath $exe)) { Start-Process -FilePath $exe -ArgumentList ('--app=' + $url); return }
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
    # Автообновление: при каждом запуске подтягиваем последнюю версию игры из репозитория
    $updated = $false
    if ((Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        $prevPref = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            Write-Host 'Проверяем обновления игры...'
            $before = (& git rev-parse HEAD 2>$null)
            $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
            & git fetch --quiet origin $branch 2>$null
            if ($LASTEXITCODE -eq 0) {
                # только перемотка вперёд: локальные коммиты и правки в рабочей папке никогда не стираются
                & git merge --ff-only --quiet "origin/$branch" 2>$null
                if ($LASTEXITCODE -ne 0) { Write-Host 'Здесь есть свои изменения — автообновление пропущено, запускаем локальную версию.' }
            }
            $after = (& git rev-parse HEAD 2>$null)
            $updated = ($before -ne $after)
            if ($updated) { Write-Host 'Игра обновлена до последней версии.' -ForegroundColor Green } else { Write-Host 'Установлена последняя версия.' }
        } catch { Write-Host 'Не удалось проверить обновления — запускаем текущую версию.' }
        $ErrorActionPreference = $prevPref
    }
    $running = $false
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 2
        $running = $health.ok -and $health.transport -eq 'relay'
    } catch { }
    if ($running -and $updated) {
        # сервер старой версии — перезапускаем, чтобы и он был новым
        $prevPref = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch { }
        $pidFile = Join-Path $PSScriptRoot 'dev/server.pid'
        if (Test-Path -LiteralPath $pidFile) { try { Stop-Process -Id ([int](Get-Content -LiteralPath $pidFile -Raw)) -Force -ErrorAction SilentlyContinue } catch { } }
        $ErrorActionPreference = $prevPref
        Start-Sleep -Milliseconds 500
        $running = $false
    }
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
    if (-not $NoBrowser) { Open-Game 'http://localhost:3000' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Установите Node.js 20+ и повторите запуск. Инструкция: README.md'
    Read-Host 'Нажмите Enter для закрытия'
    exit 1
}
