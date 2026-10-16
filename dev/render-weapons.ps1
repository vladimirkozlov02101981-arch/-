# Рендер оружия в настоящем Blender на видеокарте этого ПК (запускается из «Рендер оружия в Blender.cmd»).
# Шаги: обновить игру → скачать фотосканы 4K (Poly Haven, CC0) → отрендерить все модели (512 сэмплов, GPU) прямо в игру
# → сохранить сцену-витрину и открыть её в Blender → сохранить результат в git и отправить (если есть доступ).
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
Set-Location ..
$root = (Get-Location).Path
function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }

Step 'Обновление игры'
if (Get-Command git -ErrorAction SilentlyContinue) {
  $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
  & git fetch --quiet origin $branch 2>$null
  & git merge --ff-only --quiet "origin/$branch" 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host 'Перемотка не удалась (есть свои изменения) — работаю с текущей версией.' -ForegroundColor Yellow }
  Write-Host ('Версия: ' + (& git log -1 --format='%h %s' 2>$null))
}

Step 'Поиск Blender'
$bl = 'D:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
if (-not (Test-Path -LiteralPath $bl)) {
  $bl = $null
  foreach ($base in @('C:\Program Files\Blender Foundation', 'D:\Program Files\Blender Foundation', "$env:ProgramFiles\Blender Foundation")) {
    if (Test-Path -LiteralPath $base) { $f = Get-ChildItem -LiteralPath $base -Recurse -Filter blender.exe -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1; if ($f) { $bl = $f.FullName; break } }
  }
}
if (-not $bl) { Write-Host 'Blender не найден. Установите Blender 4.2+ или 5.x.' -ForegroundColor Red; Read-Host 'Enter — закрыть'; exit 1 }
Write-Host $bl

Step 'Фотосканы материалов 4K (уже скачанные пропускаются)'
& $bl --background --python (Join-Path $root 'dev\blender\fetch_pbr.py') -- 4k 2>&1 | Where-Object { $_ -match '^(OK|нет|CATALOG)' }

Step 'Рендер всех моделей оружия на видеокарте (несколько минут)'
$env:WPN_OUT = Join-Path $root 'assets\tex'
$env:WPN_SAMPLES = '512'
$t0 = Get-Date
& $bl --background --python (Join-Path $root 'dev\blender\make_weapons.py') 2>&1 | Where-Object { $_ -match '^(GPU|WROTE)|Error' }
Write-Host ('Время: {0:N0} с' -f ((Get-Date) - $t0).TotalSeconds)

Step 'Сцена-витрина для Blender'
$scenes = Join-Path $root 'dev\blender\scenes'; New-Item -ItemType Directory -Force -Path $scenes | Out-Null
$blend = Join-Path $scenes 'weapons.blend'
& $bl --background --python (Join-Path $root 'dev\blender\make_weapons.py') -- blend $blend 2>&1 | Where-Object { $_ -match 'SAVED|Error' }

Step 'Сохранение результата'
if (Get-Command git -ErrorAction SilentlyContinue) {
  & git add assets/tex/wpn_*.png
  & git commit -m 'Оружие: рендер на видеокарте (512 сэмплов) с фотосканами Poly Haven' 2>&1 | Select-Object -First 2
  & git push origin (& git rev-parse --abbrev-ref HEAD) 2>&1 | Select-Object -Last 2
}

Step 'Открываю сцену в Blender'
Start-Process -FilePath $bl -ArgumentList ('"' + $blend + '"')
Write-Host ''
Write-Host 'Готово. Новые спрайты уже в игре (assets\tex\wpn_*.png) — запустите «Играть.cmd».' -ForegroundColor Green
Read-Host 'Enter — закрыть'
