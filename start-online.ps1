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
    & (Join-Path $PSScriptRoot 'start-game.ps1') -NoBrowser
    $sessionPath = Join-Path $PSScriptRoot 'dev/tunnel-session.json'
    # хост играет с локального сервера (мгновенно), другу уходит публичная ссылка туннеля; адрес бесплатного туннеля
    # иногда меняется — сервер (/public) всегда знает последний, его же показывает «Ссылка другу» в комнате
    function Show-Link($url) {
        try { Set-Clipboard -Value $url } catch { }
        Write-Host ''
        Write-Host ('Ссылка для друга (уже скопирована): ' + $url) -ForegroundColor Green
        Write-Host 'Друг открывает её в браузере (первая загрузка через бесплатный туннель медленная)'
        Write-Host 'или вставляет в свой файл Territory-War.html: «По сети» -> поле «Ссылка от друга».'
        Write-Host 'В игре: «По сети» -> «Создать комнату» -> «Ссылка другу». Не закрывайте ПК, пока играете.'
        Open-Game 'http://localhost:3000'
    }
    try {
        $current = (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/public' -TimeoutSec 3).url
        if ($current -match '^https://[a-z0-9]+\.lhr\.life$') {
            $health = Invoke-RestMethod -Uri ($current + '/health') -TimeoutSec 8
            if ($health.ok -and $health.transport -eq 'relay') { Show-Link $current; Start-Sleep -Seconds 8; exit 0 }
        }
    } catch { }
    $sshCommand = Get-Command ssh -ErrorAction Stop
    $outputPath = Join-Path $PSScriptRoot 'dev/tunnel-ssh-out.txt'
    $errorPath = Join-Path $PSScriptRoot 'dev/tunnel-ssh-error.txt'
    $tunnelProcess = Start-Process -FilePath $sshCommand.Source -ArgumentList '-F','NUL','-o','IdentityFile=none','-o','IdentityAgent=none','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile=dev/tunnel-knownhosts','-o','ServerAliveInterval=30','-o','ConnectTimeout=20','-o','ExitOnForwardFailure=yes','-R','80:127.0.0.1:3000','nokey@localhost.run' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath -PassThru
    $tunnelProcess.Id | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'dev/tunnel.pid')
    Write-Host 'Создаём временную ссылку для игры с другом...'
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path -LiteralPath $outputPath) {
            $tunnelText = Get-Content -LiteralPath $outputPath -Raw
            if ($tunnelText -match 'https://[a-z0-9]+\.lhr\.life') {
                $gameUrl = $Matches[0]
                @{ url=$gameUrl; pid=$tunnelProcess.Id; created=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $sessionPath
                Show-Link $gameUrl
                Start-Sleep -Seconds 8
                exit 0
            }
        }
        if ($tunnelProcess.HasExited) { break }
    }
    throw 'Не удалось получить внешний адрес. Подробности: dev/tunnel-ssh-error.txt. Локальная игра доступна на http://localhost:3000.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Нажмите Enter для закрытия'
    exit 1
}
