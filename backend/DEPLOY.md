# Deploy (Front + API)

Este projeto possui:
- API Node.js/Express em `backend/src/server.js`
- Painel web estático em `backend/public/` (opcionalmente servido pelo backend via `SERVE_WEB=true`)
- Configuração de runtime do painel via `backend/public/config.js` (sem rebuild)

## Variáveis `.env` (produção)
Use `backend/.env.example` como base.

Obrigatório:
- `NODE_ENV=production`
- `PORT=3333`
- `DATABASE_URL`
- `JWT_SECRET`

CORS (produção):
- `APP_URL="https://seu-dominio.com,https://www.seu-dominio.com"`

Reset de senha (produção):
- `WEB_RESET_URL="https://seu-dominio.com/reset-password.html"`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## Subir a API
```bash
cd /caminho/pdv-cliente/backend
npm install
npm start
```

Teste:
```bash
curl http://127.0.0.1:3333/api/health
```

## Rodar local (Live Server)
1) No terminal, em `backend/`:
```bash
npm install
npm run dev
```
2) Garanta `backend/.env.local` (somente no seu PC) com:
```env
NODE_ENV=development
PORT=3333
SERVE_WEB=true
WEB_RESET_URL="http://127.0.0.1:5500/backend/public/reset-password.html"
```
3) No painel (Live Server), use `backend/public/config.dev.js` como `backend/public/config.js`.
4) Abra com Live Server:
- `http://127.0.0.1:5500/backend/public/index.html`

## Proxy reverso (recomendado) Nginx
Serve o front e encaminha `/api` para a API sem expor a porta 3333.

```nginx
server {
  listen 80;
  server_name seu-dominio.com www.seu-dominio.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name seu-dominio.com www.seu-dominio.com;

  # ssl_certificate /etc/letsencrypt/live/seu-dominio.com/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com/privkey.pem;

  root /var/www/pdv-cliente/backend/public;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3333/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:3333/uploads/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store, no-cache, must-revalidate";
  }

  try_files $uri $uri/ /index.html;
}
```

## Frontend (runtime config)
O ambiente é definido em `backend/public/config.js` (carregado pelo `index.html` antes do `app.js`).

- DEV (Live Server): copie `backend/public/config.dev.js` -> `backend/public/config.js` e ajuste `API_BASE_URL` (ex.: `http://127.0.0.1:3333`)
- PROD (VPS): copie `backend/public/config.prod.js` -> `backend/public/config.js` (normalmente `API_BASE_URL: "/api"` com proxy reverso)

