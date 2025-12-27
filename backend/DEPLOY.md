# Deploy paytech.app.br (Front + API)

## Variáveis `.env`
- `NODE_ENV=production`
- `APP_URL="https://paytech.app.br,https://www.paytech.app.br"`
- `PORT=3333`
- `DATABASE_URL`, `JWT_SECRET` já definidos.

## Subir a API
```bash
cd /caminho/pdv-cliente/backend
npm install
npm start   # ou use pm2/systemd apontando para src/server.js
```
Teste local no host:
```bash
curl http://127.0.0.1:3333/api/health
```
Deve retornar JSON com ok=true.

## (Recomendado) Proxy reverso Nginx
Serve o front e encaminha `/api` para a API sem expor a porta 3333.
```
server {
    listen 80;
    server_name paytech.app.br www.paytech.app.br;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name paytech.app.br www.paytech.app.br;

    # ssl_certificate /etc/letsencrypt/live/paytech.app.br/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/paytech.app.br/privkey.pem;

    root /var/www/pdv_backend/backend/public;
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

## Frontend
Em `backend/public/index.html`, `window.API_BASE = "/api"` para usar o proxy.
Se optar por expor a API diretamente em outra porta, altere para `http://127.0.0.1:3333/api` (apenas DEV).

## Testes finais (externo)
- Painel: `https://paytech.app.br`
- Health via proxy: `https://paytech.app.br/api/health`
- Login deve bater em `/api/auth/login` e receber resposta da API (401 se credenciais erradas, 200 se corretas).
