# Changelog

## Unreleased
- Adicionado `requestId` por requisição e logs HTTP estruturados (sem vazar segredos).
- `GET /health` e `GET /api/health` agora retornam `status`, `env` e `version`.
- `terminalAuth` passou a injetar `req.merchant` e bloquear terminal/merchant inativos.
- Ajustes no PDV:
  - `GET /api/pdv/products` retorna `imageUrl` absoluta.
  - `POST /api/pdv/sales` valida payload, calcula total no servidor e suporta metadados de autorização.
  - `PATCH /api/pdv/sales/:id/status` para fluxo PENDING -> PAID/DECLINED/CANCELLED.
- DEV-only:
  - `GET /api/debug/echo`
  - `POST /api/dev/reset` e `POST /api/dev/seed` (protegidos por `DEV_RESET_TOKEN`)
- Prisma:
  - `SaleStatus` inclui `DECLINED` e `CANCELLED`
  - `Sale` inclui `authorizationCode`, `transactionId`, `acquirer`

