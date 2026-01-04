$ErrorActionPreference = "Stop"

param(
  [string]$BaseUrl = "http://127.0.0.1:3333",
  [string]$ApiPrefix = "/api"
)

function Join-Url([string]$a, [string]$b) {
  $a2 = $a.TrimEnd("/")
  $b2 = $b.TrimStart("/")
  return "$a2/$b2"
}

$ApiBase = Join-Url $BaseUrl $ApiPrefix

Write-Host "== PayTech Backend Smoke Tests ==" -ForegroundColor Cyan
Write-Host ("BaseUrl  : {0}" -f $BaseUrl)
Write-Host ("ApiBase  : {0}" -f $ApiBase)
Write-Host ""

Write-Host "1) Health" -ForegroundColor Cyan
curl.exe -sS (Join-Url $ApiBase "health") | Out-Host
Write-Host ""

Write-Host "2) Auth (painel) - exemplo" -ForegroundColor Cyan
Write-Host "Edite as variáveis abaixo antes de rodar login real."
$Email = "SEU_EMAIL_AQUI"
$Password = "SUA_SENHA_AQUI"

if ($Email -ne "SEU_EMAIL_AQUI") {
  $body = @{ email=$Email; password=$Password } | ConvertTo-Json -Compress
  $resp = curl.exe -sS -X POST (Join-Url $ApiBase "auth/login") -H "Content-Type: application/json" --data-raw $body
  $resp | Out-Host
} else {
  Write-Host "SKIP: configure Email/Senha no script." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "3) Admin (Superdono) - rota existe?" -ForegroundColor Cyan
Write-Host "Esperado: 401 Token not provided (se existir)."
curl.exe -sS -i (Join-Url $ApiBase "admin/me") | Select-String -Pattern "HTTP/|Token not provided|Not Found" | Out-Host
Write-Host ""

Write-Host "4) Terminals - gerar provisioning code (requer JWT do painel)" -ForegroundColor Cyan
Write-Host "Use (depois do login) com Authorization: Bearer <token> :"
Write-Host ("curl.exe -X POST `"{0}`" -H `"Authorization: Bearer <TOKEN>`" -H `"Content-Type: application/json`" --data-raw `"{1}`"" -f (Join-Url $ApiBase "terminals/pairing-codes"), '{"name":"Caixa 01"}')
Write-Host ""

Write-Host "5) Claim do terminal (app) - exemplo" -ForegroundColor Cyan
Write-Host ("curl.exe -X POST `"{0}`" -H `"Content-Type: application/json`" --data-raw `"{1}`"" -f (Join-Url $ApiBase "terminals/claim"), '{"code":"123456","identifier":"DEVICE_ABC","name":"Caixa 01"}')
Write-Host ""

Write-Host "Done." -ForegroundColor Green

