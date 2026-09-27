# Налаштування на боці n8n (текстом, без JSON)

Воркфлоу клієнта — його власність: ми не експортуємо й не імпортуємо JSON воркфлоу, не пишемо код
для вузла Code. Налаштування передаємо людині текстом — ось так (приклад для `quote-request`).

1. **Webhook**: HTTP Method `POST`, Path — ім'я події (`quote-request`). Authentication —
   **Header Auth**, credential з Name `x-n8n-token` і Value = `N8N_WEBHOOK_TOKEN`. Неправильний чи
   відсутній заголовок → **403** «Authorization data is wrong!». Respond — `Using 'Respond to Webhook'
   Node` (для подій «до відома» — `Immediately`). Фіксовані IP хостингу — Options → IP(s) Allowlist
   (за reverse proxy — `N8N_PROXY_HOPS`). Далі вхідні дані — `$json.body`, заголовки —
   `$json.headers` (імена в нижньому регістрі).
2. **Remove Duplicates**: «Remove Items Processed in Previous Executions», значення
   `{{ $json.headers['idempotency-key'] }}`.
3. **Respond to Webhook**: Respond With JSON, Response Code `202`, тіло `{"job_id": "{{ $execution.id }}"}`.
4. … робота воркфлоу (генерація PDF тощо) …
5. **Edit Fields**: `ts` = `{{ Math.floor($now.toSeconds()) }}`, `body` =
   `{{ JSON.stringify({ version: 1, event: 'quote-request.completed', data: { jobId: $execution.id, … } }) }}`.
   Тіло підписуємо й відправляємо **одним і тим самим рядком**.
6. **Crypto** (v2): Action `Hmac`, Type `SHA256`, Encoding `HEX`, значення `{{ $json.ts + '.' + $json.body }}`,
   credential **Crypto** з Hmac Secret = `N8N_CALLBACK_SECRET`.
7. **HTTP Request**: `POST` на `{{ $('Webhook').item.json.body.callbackUrl }}`. Заголовки
   `x-n8n-timestamp`, `x-n8n-signature` (`sha256=` + результат Crypto), `idempotency-key`
   (`{{ $execution.id }}:quote-request.completed`), `x-correlation-id` (з вхідних заголовків). Body
   Content Type — **Raw**, Content Type `application/json`, Body — поле `body` (не «JSON → Using
   Fields Below»: серіалізація полів може дати інші байти, ніж підписані). Options → Timeout `10000`.
   Settings → Retry On Fail, Max Tries `3`, Wait Between Tries `1000`. n8n у Docker, застосунок на
   хості — `host.docker.internal`, не `localhost`.
8. **Save** і **Publish**. Після кожної зміни — Publish знову.

## Відомі пастки

- «Workflow got started» (документація) проти `Workflow was started` (код n8n) — текст відповіді не парсимо.
- Офіційний пакет скілів n8n пише, що Header Auth відхиляє з **401**; код n8n повертає **403**.
  401 — для Basic Auth і JWT.
- Той самий пакет пише, що секрет Crypto не прив'язується до credential. Для Crypto v2 це вже не так.
- Приклад вебхука в документації Next.js передає токен у `?token=` у GET і порівнює через `!==`.
  GET може кешуватись і потрапляти в журнали. Ми: токен у заголовку, підпис і `timingSafeEqual`.

## Реєстр інтеграцій проєкту

Кожна інтеграція — рядок у `docs/n8n-integrations.md` проєкту:

| event | напрям | шлях n8n | режим | власник |
|---|---|---|---|---|
| `quote-request` | Next.js → n8n → колбек | `/webhook/quote-request` | Respond to Webhook 202 + колбек | ім'я відповідального |

## Локальний мок

`scripts/mock-n8n.mjs` цього скіла поводиться як Webhook + Respond to Webhook + HTTP Request з
підписом (`--help` — усі режими):

```bash
node .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs                     # :5678, Immediately
node .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs --mode last-node    # відповідь через 2 с
node .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs --mode slow --cloud-timeout 5000   # 524
node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs --mode respond-202 --delay 5000
```

З `N8N_WEBHOOK_TOKEN` мок вимагає `x-n8n-token` (інакше 403), з `N8N_CALLBACK_SECRET` — через
`--delay` мс надсилає підписаний колбек на `callbackUrl` із запиту. `/webhook-test/` — лише з
`--listen` і 120 с. У журналі: метод, шлях, статус, тривалість, імена заголовків, розмір і sha256
тіла, `auth=`, `idempotency=new|repeat|absent`.
