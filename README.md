# pdv-cliente

Sistema de PDV com:
- Backend Node.js/Express + Prisma (PostgreSQL) em `backend/`
- Painel web estático em `backend/public/` (usado via Live Server ou servido pelo backend)

## Requisitos
- Node.js **20 LTS** (recomendado). O Prisma pode falhar em versões muito novas (ex.: Node 25).
- Banco PostgreSQL acessível (configure `DATABASE_URL`).

## Rodar local (DEV)
1) Backend:
```bash
cd backend
npm install
npm run dev
```

2) Variáveis locais (não commitar):
Crie/ajuste `backend/.env.local`:
```env
NODE_ENV=development
PORT=3333
SERVE_WEB=true
DATABASE_URL="postgresql://USER:PASS@HOST:5432/DB?sslmode=disable"
JWT_SECRET="troque_este_valor"
WEB_RESET_URL="http://127.0.0.1:5500/backend/public/reset-password.html"
```

3) Frontend (Live Server):
- Copie `backend/public/config.dev.js` -> `backend/public/config.js`
- Abra: `http://127.0.0.1:5500/backend/public/index.html`

## Configuração de runtime do painel (sem rebuild)
O painel lê a URL da API via `window.__APP_CONFIG__` carregado em `backend/public/config.js`.

- DEV: `backend/public/config.dev.js`
- PROD: `backend/public/config.prod.js`

No deploy, basta trocar o `config.js` (sem recompilar e sem alterar código-fonte).

## Testes rápidos (cURL)
Health:
```bash
curl.exe "http://127.0.0.1:3333/api/health"
```

Forgot password (sempre responde rápido e com mensagem genérica):
```bash
curl.exe -X POST "http://127.0.0.1:3333/api/auth/forgot-password" ^
  -H "Content-Type: application/json" ^
  --data-raw "{\"email\":\"seuemail@exemplo.com\"}"
```

Em DEV, se SMTP não estiver configurado, o backend loga:
`[MAIL DEV] Reset link: ...`

Reset password:
```bash
curl.exe -X POST "http://127.0.0.1:3333/api/auth/reset-password" ^
  -H "Content-Type: application/json" ^
  --data-raw "{\"token\":\"TOKEN_DO_LINK\",\"password\":\"nova_senha_aqui\"}"
```

## CORS (DEV vs PROD)
- DEV (qualquer `NODE_ENV` diferente de `production`): permite `localhost/127.0.0.1` em qualquer porta e LAN.
- PROD (`NODE_ENV=production`): permite somente as origens em `APP_URL` (separadas por vírgula).

## Produção (VPS)
Veja `backend/DEPLOY.md` e use `backend/.env.example` como referência.

