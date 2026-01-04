# Google Login (GIS) — Setup (DEV/PROD)

Este projeto usa **Google Identity Services (GIS)** no frontend para obter um **ID Token** e envia esse token para o backend em `POST /api/auth/google`, onde ele é validado com `google-auth-library`.

## 1) Google Cloud Console

1. Acesse **Google Cloud Console** → selecione/crie um **Project**.
2. Vá em **APIs & Services** → **OAuth consent screen** e configure o consentimento.
3. Vá em **Credentials** → **Create Credentials** → **OAuth client ID**.
4. Em **Application type**, selecione **Web application**.

### Authorized JavaScript origins (DEV)

Adicione exatamente:
- `http://127.0.0.1:5500`
- `http://localhost:5500`
- `http://127.0.0.1:3333`
- `http://localhost:3333`

Observação: o erro “Não é possível continuar com o google.com” normalmente acontece quando o **origin** não está autorizado ou o `client_id` não é do tipo **Web**.

### PRODUCTION

Adicione as origens reais do seu painel (exemplos):
- `https://paytech.app.br`
- `https://www.paytech.app.br`
- `https://admin.paytech.app.br`

## 2) Backend (.env / .env.local)

Defina no backend:

- `GOOGLE_CLIENT_ID` (obrigatório)
- `JWT_SECRET` (já existente no projeto)
- `APP_URL` (se você roda em PROD com CORS restrito)

Exemplo (DEV):

```env
GOOGLE_CLIENT_ID="SEU_CLIENT_ID.apps.googleusercontent.com"
APP_URL="http://127.0.0.1:5500"
```

## 3) Frontend

O `client_id` do GIS é carregado preferencialmente do backend:

- `GET /api/config/public` → `{ ok: true, googleClientId }`

Você pode manter `backend/public/config.js` com `GOOGLE_CLIENT_ID=""` e deixar o backend preencher.

## 4) Endpoint e payload

Frontend envia:

- `POST /api/auth/google`
- Body: `{ "credential": "<ID_TOKEN>" }`

O backend também aceita `{ "idToken": "<ID_TOKEN>" }` por compatibilidade.

## 5) Erros comuns

- **“Não é possível continuar com o google.com”**: `client_id` errado (não-Web) ou origin não autorizado.
- **`INVALID_GOOGLE_TOKEN` (401)**: token inválido/expirado/audience incorreta.
- **`EMAIL_NOT_VERIFIED` (401)**: conta Google com e-mail não verificado.

