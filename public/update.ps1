# OmniSearch 更新スクリプト（update.bat から呼ばれる）
# GitHub の最新リリースから zip を取得し、このフォルダを丸ごと置き換える。
param([string]$Dir)
$ErrorActionPreference = 'Stop'
$Url = 'https://github.com/chiepu3/omni-search/releases/latest/download/omni-search-chrome.zip'

function Done($msg) { Write-Host ''; Write-Host $msg; Write-Host ''; Read-Host 'Enter キーで閉じます' | Out-Null; exit }

try {
  $Dir = (Resolve-Path $Dir).Path.TrimEnd('\')
  $manifestPath = Join-Path $Dir 'manifest.json'
  # 別のフォルダを消してしまわないよう、OmniSearch のフォルダであることを確かめる
  if (-not (Test-Path $manifestPath)) { Done "manifest.json が見つかりません。update.bat は OmniSearch のフォルダ内で実行してください。`n$Dir" }
  $current = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
  if ($current.name -ne 'OmniSearch') { Done "このフォルダは OmniSearch ではありません（$($current.name)）。中止しました。" }

  Write-Host "OmniSearch を更新します（現在 $($current.version)）"
  Write-Host "取得元: $Url"

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  # 会社のプロキシ（Windows の設定）を認証つきで使う
  [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials

  $work = Join-Path $env:TEMP ('omni-search-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $zip = Join-Path $work 'omni-search-chrome.zip'
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    $src = Join-Path $work 'x'
    Expand-Archive -Path $zip -DestinationPath $src
    $next = Get-Content -Raw -Encoding UTF8 (Join-Path $src 'manifest.json') | ConvertFrom-Json
    if ($next.name -ne 'OmniSearch') { Done 'ダウンロードした zip の中身が OmniSearch ではありません。中止しました。' }
    if ($next.version -eq $current.version) { Done "すでに最新です（$($current.version)）。" }

    # 古いビルドの不要ファイルも消えるようミラーする（終了コード 8 以上が失敗）
    robocopy $src $Dir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Done "ファイルのコピーに失敗しました（robocopy $LASTEXITCODE）。Chrome を閉じてからもう一度試してください。" }
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
  Done ("$($current.version) → $($next.version) に更新しました。`n" +
        "Chrome の chrome://extensions で OmniSearch の「再読み込み」を押すか、`n" +
        "OmniSearch の設定画面 →「一般設定」→「拡張機能を再読み込み」を押してください。")
} catch {
  Done "更新に失敗しました: $($_.Exception.Message)"
}
