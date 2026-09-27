# Інтеграції з n8n

Контракт — `.claude/skills/integrating-n8n-webhooks/`. Кожна інтеграція — рядок у таблиці.

| event | напрям | шлях n8n | режим | власник |
|---|---|---|---|---|
| `lead-created` | Next.js → n8n | `/webhook/lead-created` | Immediately (подія «до відома», без колбека) | ValiaBihun |
| `quote-request` | Next.js → n8n → колбек `POST /api/n8n/quote-request` | `/webhook/quote-request` | Respond to Webhook 202 `{"job_id"}` + підписаний колбек (воркфлоу 40–90 с) | ValiaBihun |

## `lead-created`

- Запуск: Server Action `submitLead` (`app/actions.ts`) з публічної форми `/`; виклик n8n — в `after()`
  разом із записом в аудит, відвідувач n8n не чекає.
- Дані для воркфлоу: `{ leadId, fullName, email, phone, company, website, budget, message,
  consentMarketing, source }` — без IP, user agent, `rawPayload` і внутрішніх полів.
- Відповідь n8n: дивимось лише на код статусу; колбека немає.

## `quote-request`

- Запуск: Server Action `requestQuote` (`app/quotes/actions.ts`) з форми `/quotes/new`; виклик n8n — в `after()`.
- Дані для воркфлоу: `{ quoteId, company, description, budget }` (email клієнта в n8n не передаємо).
- Колбек: `data.status` = `completed` + `result.documentUrl` (http/https) → `ready`; інакше → `failed`.
  Запис шукаємо за `data.requestIdempotencyKey`.
- Статуси запису: `queued` → `processing` → `ready` | `failed`; сторінка статусу — `/quotes/[id]`.
