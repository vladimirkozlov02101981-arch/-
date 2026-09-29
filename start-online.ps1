$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'start-game.ps1') -NoBrowser
    $sessionPath = Join-Path $PSScriptRoot 'dev/tunnel-session.json'
    if (Test-Path -LiteralPath $sessionPath) {
        try {
            $previous = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
            if ($previous.url -match '^https://[a-z0-9]+\.lhr\.life$') {
                $health = Invoke-RestMethod -Uri ($previous.url + '/health') -TimeoutSec 5
                if ($health.ok -and $health.transport -eq 'relay') { Start-Process $previous.url; exit 0 }
            }
        } catch { }
    }
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
                Write-Host $gameUrl
                Start-Process $gameUrl
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
