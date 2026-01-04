# QA Checklist (DEV + PROD) — PayTech PDV

Base oficial (PROD): `https://www.paytech.app.br/api`

## 0) Pré-requisitos (DEV)
- Rode os comandos Prisma **dentro** de `backend/` (ou passe `--schema .\\prisma\\schema.prisma`).
- Tenha Postgres rodando e `DATABASE_URL` configurada em `backend/.env.local` (recomendado).
- Node suportado pelo backend: **>=20 <23** (Node 25 tende a quebrar Prisma).

## 1) Health (DEV e PROD)
```powershell
curl.exe -i "http://127.0.0.1:3333/api/health"
curl.exe -i "http://127.0.0.1:3333/api"
curl.exe -i "http://127.0.0.1:3333/api/"

curl.exe -i "https://www.paytech.app.br/api/health"
curl.exe -i "https://www.paytech.app.br/api"
curl.exe -i "https://www.paytech.app.br/api/"
```

## 2) Banco e migrations (DEV)
```powershell
cd backend
npx prisma generate
npx prisma migrate reset --force
node prisma/seed.js
```

## 3) Seed DEV via endpoint (opcional)
Requer `DEV_RESET_TOKEN` em `backend/.env.local`.
```powershell
$token = "dev_reset_token_change_me"
curl.exe -i -X POST "http://127.0.0.1:3333/api/dev/seed" -H "x-dev-reset-token: $token"
```

## 4) Login (Painel / app)
PowerShell (evita erro de JSON):
```powershell
$body = @{ email="SEU_EMAIL"; password="SUA_SENHA" } | ConvertTo-Json -Compress
curl.exe -i -X POST "http://127.0.0.1:3333/api/auth/login" -H "Content-Type: application/json" --data-raw $body
```

## 5) Pairing code com nome (Painel)
```powershell
$body = @{ name="Caixa 01" } | ConvertTo-Json -Compress
curl.exe -i -X POST "http://127.0.0.1:3333/api/terminals/pairing-codes" -H "Content-Type: application/json" --data-raw $body
```
Guarde o `code`.

## 6) Claim do terminal (Android/SmartPOS)
Regra: `body.name` (se vier) > `provisioningCode.name` > fallback.
```powershell
$body = @{ code="SEU_CODE"; identifier="DEVICE_SERIAL_OU_ANDROID_ID"; name="Caixa 01 (opcional)" } | ConvertTo-Json -Compress
curl.exe -i -X POST "http://127.0.0.1:3333/api/terminals/claim" -H "Content-Type: application/json" --data-raw $body
```
Espera: `terminalId` + `terminalKey`.

## 7) Listar terminais (Painel)
```powershell
curl.exe -i "http://127.0.0.1:3333/api/terminals"
```
Verifique se `name` do terminal está correto.

## 8) Produtos (PDV — X-Terminal-Key)
```powershell
$terminalKey = "COLE_AQUI"
curl.exe -i "http://127.0.0.1:3333/api/pdv/products" -H "X-Terminal-Key: $terminalKey"
```

## 9) Venda (PDV — CASH)
```powershell
$terminalKey = "COLE_AQUI"
$body = @{
  items = @(@{ productId = 1; qty = 1 })
  paymentType = "CASH"
} | ConvertTo-Json -Compress
curl.exe -i -X POST "http://127.0.0.1:3333/api/pdv/sales" -H "Content-Type: application/json" -H "X-Terminal-Key: $terminalKey" --data-raw $body
```

## 10) Admin/Superdono (existência de rotas)
Em PROD, `404` em `/api/admin/*` indica deploy antigo (Nginx ok, Node desatualizado).
```powershell
curl.exe -i "http://127.0.0.1:3333/api/admin/health"
curl.exe -i "https://www.paytech.app.br/api/admin/health"
```

