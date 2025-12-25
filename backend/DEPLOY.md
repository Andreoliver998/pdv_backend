# Deploy no IP 46.202.149.12 (Front + API)

## Variáveis `.env`
- `NODE_ENV=production`
- `APP_URL="http://46.202.149.12"` (adicione outras origens se necessário)
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
    server_name 46.202.149.12;

    root /caminho/pdv-cliente/backend/public;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3333/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        alias /caminho/pdv-cliente/uploads/;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    try_files $uri $uri/ /index.html;
}
```

## Frontend
Em `backend/public/index.html`, `window.API_BASE = "/api"` para usar o proxy.
Se optar por expor a API diretamente em outra porta, altere para `http://46.202.149.12:3333/api`.

## Testes finais (externo)
- Painel: `http://46.202.149.12`
- Health via proxy: `http://46.202.149.12/api/health`
- Login deve bater em `/api/auth/login` e receber resposta da API (401 se credenciais erradas, 200 se corretas).
