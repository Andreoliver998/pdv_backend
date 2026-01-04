# Rotas do Backend (prefixo oficial: `/api`)

Base oficial (PROD): `https://www.paytech.app.br/api`

## Health
- `GET /health`
- `GET /api/health`

## DEV (somente NODE_ENV=development + header `x-dev-reset-token`)
- `POST /api/dev/reset`
- `POST /api/dev/seed`
- `POST /api/dev/verify-email` (body: `{ "email": "user@exemplo.com" }`)

## Auth (Painel / Merchant)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/enter`
- `GET  /api/auth/verify-email?token=...`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/google`
- `POST /api/auth/change-password` (Bearer JWT)
- `GET  /api/auth/me` (Bearer JWT)

## Terminais (Painel + App/SmartPOS)
- `GET  /api/terminals` (Bearer JWT)
- `POST /api/terminals` (Bearer JWT)
- `POST /api/terminals/:id/pairing-code` (Bearer JWT)
- `POST /api/terminals/:id/revoke` (Bearer JWT)
- `POST /api/terminals/pairing-codes` (Bearer JWT) → provisioning code (6 dígitos) + nome (opcional)
- `GET  /api/terminals/pairing-codes/:id` (Bearer JWT)
- `POST /api/terminals/claim` (App) → vincula provisioning/pairing code ao dispositivo e devolve `terminalKey`
- `POST /api/terminals/pair` (App legado) → pareia por pairingCode
- `GET  /api/terminals/me` (X-Terminal-Key)
- `POST /api/terminals/heartbeat` (X-Terminal-Key)

## PDV (App/SmartPOS)
- `GET  /api/pdv/products` (X-Terminal-Key)
- `POST /api/pdv/sales` (X-Terminal-Key)
- `PATCH /api/pdv/sales/:id/status` (X-Terminal-Key)

## Payments (Intent / Deep link)
- `POST /api/payments/intents` (Bearer JWT ou X-Terminal-Key)
- `GET  /api/payments/intents/:id` (Bearer JWT ou X-Terminal-Key)
- `POST /api/payments/intents/:id/confirm` (Bearer JWT ou X-Terminal-Key)
- `POST /api/payments/intents/:id/fail` (Bearer JWT ou X-Terminal-Key)
- `POST /api/payments/callback` (Bearer JWT ou X-Terminal-Key) – contrato simplificado para retorno do app

## Admin (Superdono)
- `POST /api/admin/auth/login`
- `POST /api/admin/auth/bootstrap` (primeiro SUPER_ADMIN; requer header `X-Bootstrap-Token`)
- `POST /api/admin/auth/forgot-password`
- `POST /api/admin/auth/reset-password`
- `POST /api/admin/dev/bootstrap` (DEV-only)
- `GET  /api/admin/me` (Bearer ADMIN JWT)
- `GET  /api/admin/health` (Bearer ADMIN JWT)
- `GET  /api/admin/merchants` (SUPER_ADMIN)
- `GET  /api/admin/merchants/:id` (SUPER_ADMIN)
- `PATCH /api/admin/merchants/:id/status` (SUPER_ADMIN)
- `PATCH /api/admin/merchants/:id/access` (SUPER_ADMIN)
- **Aliases:** `/api/admin/clients/*` (equivalente a `/api/admin/merchants/*`)
