# Checklist de Homologação (SmartPOS / Stone/Ton-like)

## Segurança de transporte
- [ ] Produção usa **HTTPS** com **TLS >= 1.2** (terminação em proxy/load balancer).
- [ ] (Opcional) `REQUIRE_HTTPS=true` no backend para rejeitar HTTP quando estiver atrás de proxy.
- [ ] `trust proxy` habilitado (já está) para respeitar `X-Forwarded-Proto`/IP.

## Comunicação
- [ ] Sem WebSockets/MQTT: apenas HTTP(S).
- [ ] Healthcheck disponível: `GET /health` e `GET /api/health`.

## Autenticação e autorização
- [ ] Painel: `Authorization: Bearer <JWT>`
- [ ] Terminal/PDV: `X-Terminal-Key: <terminalKey>`
- [ ] Rotas PDV exigem terminal válido e merchant ativo.
- [ ] Terminal bloqueado/inativo retorna `403`.

## Logs e privacidade
- [ ] Logs estruturados por request (requestId, status, duration).
- [ ] Não logar segredos: `Authorization`, `X-Terminal-Key`, chaves completas, senhas, SMTP_PASS.
- [ ] Erros 500 retornam `errorId` para rastreio interno.

## Regras de venda / pagamentos
- [ ] `POST /api/pdv/sales` valida itens e `paymentType`.
- [ ] Para pagamentos não‑cash, só marcar `PAID` quando vier `authorizationCode`/`transactionId` (política).
- [ ] Baixa de estoque acontece em transação quando a venda é `PAID` (conforme settings).
- [ ] Endpoint opcional de confirmação: `PATCH /api/pdv/sales/:id/status`.

## Endpoints DEV
- [ ] `POST /api/dev/reset` e `POST /api/dev/seed` existem apenas com `NODE_ENV=development`.
- [ ] Ambos exigem header `x-dev-reset-token` com `DEV_RESET_TOKEN`.

## Whitelist / variáveis de ambiente relevantes
- `APP_URL` (origens CORS em produção)
- `API_URL`/`API_PUBLIC_URL` (se usado para QR/pairing)
- `DATABASE_URL`
- `JWT_SECRET`
- `DEV_RESET_TOKEN` (somente DEV)
- `REQUIRE_HTTPS` (somente produção, opcional)

