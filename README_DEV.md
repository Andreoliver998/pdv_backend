# PDV Backend — Desenvolvimento (SmartPOS)

## Pré‑requisitos
- Node.js `>=20 <23`
- Banco configurado em `DATABASE_URL` (o schema atual é **PostgreSQL**, ver `backend/prisma/schema.prisma`)

## Rodar local (Windows / PowerShell)
1) Entre no backend:
- `cd backend`

2) Configure `backend/.env.local` (recomendado):
- `NODE_ENV=development`
- `PORT=3333`
- `DATABASE_URL="postgresql://USER:PASS@HOST:5432/DB?sslmode=disable"`
- `JWT_SECRET="uma_chave_forte"`
- `DEV_RESET_TOKEN="um_token_forte_para_reset_seed"`

3) Instale dependências:
- `npm install`

4) Aplique schema do Prisma e gere client:
- `npx prisma generate`
- `npx prisma migrate dev`

5) Suba o servidor:
- `npm run dev`

O servidor escuta em `0.0.0.0` e expõe `GET /health` e `GET /api/health`.

## Testar na maquininha (SmartPOS) pela rede LAN
1) Descubra o IP do PC (Windows):
- `ipconfig`

2) No app, use a base URL:
- `http://SEU_IP_DA_LAN:3333`

3) Garanta firewall liberando a porta `3333` (entrada).

## Headers de autenticação
- Painel (usuário): `Authorization: Bearer <token>`
- Terminal/PDV: `X-Terminal-Key: <terminalKey>`

## Fluxos principais (exemplos)

### 1) Login (painel/app)
Linux/Mac:
- `curl -X POST http://127.0.0.1:3333/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"demo@pdv.local\",\"password\":\"123456\"}"`

PowerShell:
- `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3333/api/auth/login -ContentType "application/json" -Body '{\"email\":\"demo@pdv.local\",\"password\":\"123456\"}'`

### 2) DEV seed (gera merchant demo + terminalKey + produtos)
PowerShell:
- `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3333/api/dev/seed -Headers @{\"x-dev-reset-token\"=\"$env:DEV_RESET_TOKEN\"}`

### 3) Terminal activate (via JWT do painel)
Linux/Mac:
- `curl -X POST http://127.0.0.1:3333/api/terminals/activate -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"name\":\"SmartPOS\",\"identifier\":\"DEVICE_SERIAL\"}"`

### 4) PDV products (via X-Terminal-Key)
Linux/Mac:
- `curl http://127.0.0.1:3333/api/pdv/products -H "X-Terminal-Key: <terminalKey>"`

### 5) PDV sales (via X-Terminal-Key)
Linux/Mac:
- `curl -X POST http://127.0.0.1:3333/api/pdv/sales -H "X-Terminal-Key: <terminalKey>" -H "Content-Type: application/json" -d "{\"paymentType\":\"PIX\",\"status\":\"PAID\",\"authorizationCode\":\"123\",\"transactionId\":\"tx_abc\",\"items\":[{\"productId\":1,\"quantity\":1}] }"`

### 6) Confirmar venda PENDING -> PAID
Linux/Mac:
- `curl -X PATCH http://127.0.0.1:3333/api/pdv/sales/1/status -H "X-Terminal-Key: <terminalKey>" -H "Content-Type: application/json" -d "{\"status\":\"PAID\",\"authorizationCode\":\"123\",\"transactionId\":\"tx_abc\",\"acquirer\":\"STONE\"}"`

## Debug (somente DEV)
- `GET /api/debug/echo` retorna requestId + preview de headers para depuração.

