---
name: integrating-n8n-webhooks
description: >-
  Team contract for connecting a Next.js 16 App Router app to n8n workflows: calling an n8n
  Webhook from the server (one server-only client module, Header Auth token, idempotency-key,
  correlation id, envelope, 10 s timeout, retries), choosing the response mode (202 + signed
  callback for anything long), and receiving the n8n callback in a Route Handler (raw body,
  HMAC-SHA256 signature with timingSafeEqual, 300 s window, idempotency). Use when code sends
  data to n8n or receives a request from n8n: a form or Server Action that starts a workflow,
  a webhook or callback endpoint, N8N_* env vars, a workflow that returns a result later
  (quote, PDF, report). Тригери: «запусти воркфлоу n8n», «відправ у n8n», «вебхук n8n»,
  «n8n повідомить, коли готово», «колбек від n8n», «ендпоінт, який викличе n8n», «статус
  запиту після воркфлоу». Not for building or editing workflows in the n8n editor, workflow
  JSON, or code for the n8n Code node.
metadata:
  owner: studio-nova-dev
  version: "0.1.0"
---

# Інтеграція Next.js ↔ n8n (контракт команди)

Форма запускає воркфлоу n8n, n8n повідомляє, коли результат готовий. Контракт нижче — узгоджене
рішення команди; відхилятися від нього можна лише свідомо й письмово (у PR з поясненням).

```
Server Action ── lib/n8n/client.ts ── POST {N8N_WEBHOOK_BASE_URL}/<event> ──▶ n8n Webhook (Header Auth)
                 x-n8n-token, idempotency-key, x-correlation-id          └─ 202 {"job_id"} … воркфлоу …
app/api/n8n/[event]/route.ts ◀── POST, x-n8n-timestamp + x-n8n-signature ── n8n HTTP Request
```

## Як робимо

1. **Змінні — лише серверні**, без `NEXT_PUBLIC_`: `N8N_WEBHOOK_BASE_URL` (закінчується на `/webhook`),
   `N8N_WEBHOOK_TOKEN`, `N8N_CALLBACK_SECRET`, `APP_BASE_URL`. У `.env.example` секрети — лише
   `change-me-…`, адреси локальні. Справжні значення — у `.env.local`, який агент **не відкриває**.
   → [references/contract.md](references/contract.md#1-змінні-середовища)
2. **Один модуль виклику** `lib/n8n/client.ts`, перший рядок `import "server-only"`. Прямих `fetch` до
   n8n поза ним немає. → шаблон: [references/code-templates.md](references/code-templates.md#libn8nclientts)
3. **Запит:** `POST ${N8N_WEBHOOK_BASE_URL}/<event>` (event у kebab-case: `quote-request`), заголовки
   `content-type: application/json`, `x-n8n-token`, `idempotency-key` (UUID, створений **один раз**
   на операцію й збережений із записом), `x-correlation-id`. Тіло — конверт
   `{ version: 1, event, data, callbackUrl? }`, у `data` — **мінімум** для воркфлоу.
4. **Таймаут і повтори:** кожна спроба `signal: AbortSignal.timeout(10_000)`; до 2 повторів (1 с, 3 с)
   лише на мережеву помилку, таймаут, 5xx, 524 — з тим самим `idempotency-key`. 4xx не повторюємо.
   Дивимось лише на **код статусу**, текст відповіді n8n не парсимо. Для воркфлоу з колбеком успіх —
   **лише 202**: 200 означає, що Respond to Webhook не спрацював і колбека не буде (запис → `failed`).
5. **Користувач не чекає на n8n.** Server Action перевіряє права й дані (`server-auth-actions`),
   зберігає запис зі статусом `queued`, повертає `{ status, id }`, а виклик n8n — в `after()`
   (`server-after-nonblocking`). Воркфлоу, що може тривати ≥ 100 с або тривалість невідома, — лише
   асинхронно: 202 + колбек. → [references/contract.md](references/contract.md#3-режим-відповіді)
6. **Колбек** `app/api/n8n/[event]/route.ts`, порядок саме такий: невідома подія → 404; не JSON →
   415; сирі байти тіла потоком з обмеженням 64 КБ (`readRawBody`; ніякого `request.json()` чи
   `JSON.parse` до підпису) → більше 64 КБ — 413; `x-n8n-timestamp` поза ±300 с → 401; HMAC-SHA256 від `` `${ts}.${raw}` `` через
   `timingSafeEqual` (спершу довжини; не `===`) → 401; «застовпити» `idempotency-key` → вже був:
   200 `{"duplicate":true}`; `JSON.parse` + перевірка форми, `idempotency-key` ===
   `` `${data.jobId}:${event}` `` з тіла → інакше 400 і звільнити ключ; зберегти стан **до**
   відповіді → 202 `{"ok":true}`; повільне — в `after()`.
   → [references/callback.md](references/callback.md) · шаблон: [references/code-templates.md](references/code-templates.md#appapin8neventroutets)
7. **Журнали:** подія, напрям, `x-correlation-id`, статус, тривалість, спроба, довжина й sha256 тіла.
   Ніколи — тіло, ім'я, email, телефон, IP, токен, підпис, секрет. Помилки у відповіді — без
   подробиць. → [references/contract.md](references/contract.md#6-журнали)
8. **Ніколи** `export const runtime = 'edge'` (застарілий у Next.js 16, немає `node:crypto`).
9. Налаштування воркфлоу для клієнта — текстом, не JSON: [references/n8n-setup.md](references/n8n-setup.md).

## Чекліст

```
- [ ] 1. Жодного /webhook-test/ у коді й .env.example; жодної NEXT_PUBLIC_N8N_*.
- [ ] 2. fetch до n8n — лише в lib/n8n/client.ts з import "server-only".
- [ ] 3. Кожен виклик: x-n8n-token, idempotency-key (збережений із записом), x-correlation-id, конверт version/event/data.
- [ ] 4. AbortSignal.timeout(10_000); повтори лише на мережу/таймаут/5xx/524, той самий ключ.
- [ ] 5. Server Action повертає { status, id }, виклик n8n — в after(); довгий воркфлоу — 202 + колбек.
- [ ] 6. Колбек: 404/415 → сирі байти з лімітом 64 КБ (інакше 413) → час ±300 с → timingSafeEqual → ключ → JSON.parse і звірка ключа з тілом → запис → 202.
- [ ] 7. Після claim і збою обробки ключ звільняється.
- [ ] 8. У журналах немає тіл, персональних даних і секретів.
- [ ] 9. .env.example: N8N_WEBHOOK_BASE_URL=…/webhook, N8N_WEBHOOK_TOKEN і N8N_CALLBACK_SECRET = change-me-…, APP_BASE_URL.
- [ ] 10. scripts/check-contract.mjs — 0 FAIL.
```

## Правила зупинки — зупинись і спитай людину, якщо:

- Потрібен тестовий URL (`/webhook-test/`) у коді, `.env.example` чи конфігурації — лише людина може
  тимчасово поставити його у свій `.env.local`.
- Секрет чи токен мав би потрапити в Client Component, `NEXT_PUBLIC_*`, query string, журнал або в git.
- Потрібне справжнє значення секрету — не відкривай `.env.local`/`.env`, не виводь `process.env`; спитай.
- Задача вимагає синхронно чекати воркфлоу, який може тривати ≥ 100 с або чия тривалість невідома.
- Просять колбек без підпису, з перевіркою токена в query або «тимчасово вимкнути перевірку».
- Треба змінити воркфлоу в n8n, експортувати чи імпортувати його JSON, написати код для вузла Code.
- Відповідь n8n чи колбек не збігається з контрактом (інший код, інші заголовки) — не підлаштовуй
  контракт під факт мовчки.

## Verify — задача готова, лише коли:

- [ ] `npm run lint` і `npm run build` без помилок.
- [ ] `node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs` — 0 FAIL
      (для власних змін: `--changed-since <ref>`; `--help` — список перевірок).
- [ ] Мок: `node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs --mode respond-202 --delay 5000`
      → надіслати форму: відповідь форми < 1 с; у журналі мока `POST /webhook/<event> -> 202`,
      `auth=ok`, `idempotency=new`; через 5 с `callback POST … -> 202`; сторінка статусу показує результат.
- [ ] Матриця колбеків: `node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/send-signed-callback.mjs --event <event> --request-key <idempotency-key запису>`
      → 8/8 (202 валідний, 200 повтор, 401 підпис/час/переформатоване тіло, 400 чужий ключ, 415, 404).
- [ ] У журналі сервера немає тіл запитів, email, телефонів, токенів.

## Файли скіла

- [references/contract.md](references/contract.md) — змінні, запит до n8n, режими відповіді, тестовий vs production URL, ліміти, журнали.
- [references/callback.md](references/callback.md) — обробка колбека крок за кроком і чому саме так; ідемпотентність з обох боків.
- [references/code-templates.md](references/code-templates.md) — шаблони `lib/n8n/client.ts`, `lib/n8n/idempotency.ts`, колбек-роуту, Server Action, `.env.example`.
- [references/n8n-setup.md](references/n8n-setup.md) — що налаштувати в n8n (текстом), відомі пастки, реєстр інтеграцій.
- `scripts/check-contract.mjs` — статична перевірка C1–C13; `--root <тека>`, `--changed-since <ref>`, `--help`; код виходу 1 при FAIL.
- `scripts/send-signed-callback.mjs` — матриця підписаних колбеків проти запущеного застосунку з очікуваним кодом на кожен випадок; `--help`.
- `scripts/mock-n8n.mjs` — офлайн-мок n8n (Webhook, Header Auth, 202, підписаний колбек); `--help`.
