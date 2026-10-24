$ErrorActionPreference = 'Stop'
# Ручное обновление игры («Обновить игру.cmd»): то же, что одобрил владелец для обновления ПК — git fetch + git reset --hard
# origin/claude/hopeful-dirac-byxv27, без git clean (неотслеживаемые файлы — профиль, свои копии игры — не трогаются).
# Нужно, если автообновление при запуске пропустило шаг (свои правки в файлах игры, свои коммиты). Сервер прежней версии
# останавливается — «Играть.cmd» запустит новый
function Invoke-Git {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $all = @(& $script:GitExe -c 'safe.directory=*' @args 2>&1); $script:GitCode = $LASTEXITCODE
        $script:GitErr = @($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.Exception.Message } | Where-Object { $_ -and $_.Trim() })
        return @($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() })
    } finally { $ErrorActionPreference = $prev }
}
function Get-DiskVersion {
    try { $t = [IO.File]::ReadAllText((Join-Path $game 'index.html'), [Text.Encoding]::UTF8); if ($t -match 'id="game-version">[^<]*?(\d{4}\.\d{2}\.\d{2}-\d+)') { return $Matches[1] } } catch { }
    return ''
}
$game = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $game
try {
    $script:GitExe = $null; $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCommand) { $script:GitExe = $gitCommand.Source }
    else { foreach ($c in @((Join-Path $env:ProgramFiles 'Git\cmd\git.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'))) { if ($c -and (Test-Path -LiteralPath $c)) { $script:GitExe = $c; break } } }
    if (-not $script:GitExe) { throw 'Не найден Git. Установите Git for Windows (git-scm.com) и повторите.' }
    if (-not (Test-Path -LiteralPath (Join-Path $game '.git'))) { throw 'Папка игры не связана с Git — обновить её так нельзя.' }
    $branch = 'claude/hopeful-dirac-byxv27'; $before = Get-DiskVersion
    Write-Host ('Сейчас версия ' + $before + '. Обновление до последней версии с GitHub.')
    Write-Host 'Свои правки в файлах игры будут заменены; профиль и другие личные файлы не трогаются.'
    if (-not $env:TW_UPDATE_NOASK) { [void](Read-Host 'Нажмите Enter, чтобы обновить (или закройте окно)') }
    [void](Invoke-Git fetch origin $branch)
    if ($script:GitCode -ne 0) { throw ('Не удалось скачать обновление: ' + ($script:GitErr -join ' ')) }
    [void](Invoke-Git reset --hard "origin/$branch")
    if ($script:GitCode -ne 0) { throw ('Не удалось обновить файлы: ' + ($script:GitErr -join ' ')) }
    try {   # сервер прежней версии останавливаем — при запуске игры поднимется новый
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2
        if ($health.ok -and $health.project -eq 'territory-war-copy1' -and $health.version -ne (Get-DiskVersion)) {
            $oldPid = $health.pid
            if (-not $oldPid) { $pidFile = Join-Path $game 'dev/server.pid'; if (Test-Path -LiteralPath $pidFile) { $oldPid = [int](Get-Content -LiteralPath $pidFile | Select-Object -First 1) } }
            $p = $null; if ($oldPid) { $p = Get-Process -Id $oldPid -ErrorAction SilentlyContinue }
            if ($p -and $p.ProcessName -like 'node*') { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
        }
    } catch { }
    Write-Host ('Готово: версия ' + (Get-DiskVersion) + '. Запускайте «Играть.cmd» или «Играть онлайн.cmd».') -ForegroundColor Green
    try { Add-Content -LiteralPath (Join-Path $game 'dev/update.log') -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  вручную: ' + $before + ' -> ' + (Get-DiskVersion)) -Encoding UTF8 } catch { }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
}
if (-not $env:TW_UPDATE_NOASK) { [void](Read-Host 'Нажмите Enter для закрытия') }
