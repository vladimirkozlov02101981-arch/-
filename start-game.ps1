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
# git без обрыва запуска: в Windows PowerShell 5.1 при ErrorActionPreference = Stop любая строка git в stderr (предупреждение
# о переводах строк, ошибка сети) при перенаправлении 2> становилась прерывающей ошибкой — игра не запускалась.
# Вывод — строки stdout; stderr — в $script:GitErr, код выхода — в $script:GitCode. safe.directory — папка игры своя
# (на диске D: владельцем папки бывает группа «Администраторы», и git отказывался работать)
function Invoke-Git {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $all = @(& $script:GitExe -c 'safe.directory=*' @args 2>&1); $script:GitCode = $LASTEXITCODE
        $script:GitErr = @($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.Exception.Message } | Where-Object { $_ -and $_.Trim() })
        return @($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() })
    } finally { $ErrorActionPreference = $prev }
}
# версия игры на диске (index.html, «ВЕРСИЯ ГГГГ.ММ.ДД-N»)
function Get-DiskVersion {
    try { $t = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'index.html'), [Text.Encoding]::UTF8); if ($t -match 'id="game-version">[^<]*?(\d{4}\.\d{2}\.\d{2}-\d+)') { return $Matches[1] } } catch { }
    return ''
}
function Write-UpdateLog([string]$text) {
    try { [void](New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'dev') -Force); Add-Content -LiteralPath (Join-Path $PSScriptRoot 'dev/update.log') -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $text) -Encoding UTF8 } catch { }
}
Set-Location -LiteralPath $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    # Автообновление (разрешено владельцем 19.10): только перемотка вперёд до origin/claude/hopeful-dirac-byxv27, без reset/clean.
    # Есть свои изменения в отслеживаемых файлах или ветка разошлась — пропуск с сообщением; неотслеживаемые файлы не трогаются.
    # Итог каждого запуска — в dev/update.log
    $updated = $false; $updateNote = ''; $versionBefore = Get-DiskVersion
    $script:GitExe = $null; $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCommand) { $script:GitExe = $gitCommand.Source }
    else {
        foreach ($candidate in @((Join-Path $env:ProgramFiles 'Git\cmd\git.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'))) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) { $script:GitExe = $candidate; break }
        }
    }
    if (-not $script:GitExe) { $updateNote = 'Обновление пропущено: не найден Git (нужен Git for Windows: git-scm.com).' }
    elseif (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git'))) { $updateNote = 'Обновление пропущено: папка игры не связана с Git.' }
    else {
        $branch = 'claude/hopeful-dirac-byxv27'
        $cur = Invoke-Git rev-parse --abbrev-ref HEAD | Select-Object -First 1
        $dirty = @(Invoke-Git status --porcelain --untracked-files=no | Where-Object { $_ -match '^[ MADRCUT]{2} ' })
        if (-not $cur -or $cur -eq 'HEAD') { $updateNote = 'Обновление пропущено: в папке игры не выбрана ветка Git. ' + ($script:GitErr -join ' ') }
        elseif ($dirty.Count) { $updateNote = 'Обновление пропущено: в папке есть свои изменения в файлах игры: ' + (($dirty | Select-Object -First 4 | ForEach-Object { $_.Substring(3) }) -join ', ') }
        else {
            Write-Host 'Проверяем обновления игры...'
            $before = Invoke-Git rev-parse HEAD | Select-Object -First 1
            [void](Invoke-Git fetch --quiet origin $branch)
            if ($script:GitCode -ne 0) { $updateNote = 'Не удалось проверить обновления (нет связи с GitHub): ' + ($script:GitErr -join ' ') }
            else {
                [void](Invoke-Git merge --ff-only --quiet "origin/$branch")
                if ($script:GitCode -ne 0) { $updateNote = 'Обновление не применено (в папке свои коммиты или правки): ' + ($script:GitErr -join ' ') }
                $after = Invoke-Git rev-parse HEAD | Select-Object -First 1
                if ($before -and $after -and $before -ne $after) {
                    $updated = $true
                    Write-Host ('Игра обновлена: версия ' + $versionBefore + ' -> ' + (Get-DiskVersion)) -ForegroundColor Green
                    if (Invoke-Git diff --name-only $before $after -- package-lock.json) { & npm.cmd ci --omit=dev --no-audit --no-fund }
                }
            }
        }
    }
    Write-UpdateLog $(if ($updated) { 'обновлено: ' + $versionBefore + ' -> ' + (Get-DiskVersion) } elseif ($updateNote) { $updateNote } else { 'версия актуальна: ' + (Get-DiskVersion) })
    if ($updateNote) { Write-Host $updateNote -ForegroundColor Yellow; Write-Host 'Игра запускается в текущей версии. Подробности — dev/update.log' -ForegroundColor Yellow; Start-Sleep -Seconds 4 }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/ws/package.json'))) {
        & npm.cmd ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости.' }
    }
    # сервер этой папки: запущенный в другой версии (старый лаунчер, обновление, ручной git) останавливается — версию и
    # номер процесса он сообщает в /health; у совсем старых серверов их нет — тогда номер из dev/server.pid или по порту 3001
    $diskVersion = Get-DiskVersion; $running = $false
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2
        $ours = $health.ok -and $health.project -eq 'territory-war-copy1'
        if ($health.ok -and -not $ours) { throw 'Порт 3001 занят другой игрой. Закройте её перед запуском копии.' }
        if ($ours -and $health.version -and $health.version -eq $diskVersion) { $running = $true }
        elseif ($ours) {
            $oldPid = $health.pid
            if (-not $oldPid) { $pidFile = Join-Path $PSScriptRoot 'dev/server.pid'; if (Test-Path -LiteralPath $pidFile) { $oldPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) } }
            if (-not $oldPid) { try { $oldPid = (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess } catch { } }
            $old = $null; if ($oldPid) { $old = Get-Process -Id $oldPid -ErrorAction SilentlyContinue }
            if ($old -and $old.ProcessName -like 'node*') {
                Write-Host ('Перезапускаем сервер игры (была версия ' + $(if ($health.version) { $health.version } else { 'старая' }) + ')...')
                Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
                for ($attempt = 0; $attempt -lt 25; $attempt++) { Start-Sleep -Milliseconds 200; try { [void](Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 1) } catch { break } }
            }
        }
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
