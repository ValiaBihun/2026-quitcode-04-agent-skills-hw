# Контракт Next.js → n8n

## 1. Змінні середовища

Усі — лише серверні. Next.js вбудовує в клієнтський бандл тільки змінні з префіксом
`NEXT_PUBLIC_`, тож жодна `N8N_*` цього префікса не має.

| Змінна | Що це | Значення для локальної розробки (`.env.example`) |
|---|---|---|
| `N8N_WEBHOOK_BASE_URL` | База production-URL вебхуків, закінчується на `/webhook` | `http://127.0.0.1:5678/webhook` |
| `N8N_WEBHOOK_TOKEN` | Значення заголовка `x-n8n-token` = credential Header Auth в n8n | `change-me-webhook-token` |
| `N8N_CALLBACK_SECRET` | Секрет HMAC для колбеків = Hmac Secret у Crypto credential в n8n | `change-me-callback-secret` |
| `APP_BASE_URL` | Адреса застосунку, за якою n8n бачить ендпоінти колбеків | `http://127.0.0.1:3000` |

- Справжні значення — лише `.env.local` (у `.gitignore`) і налаштування хостингу.
- Секрет генерує людина: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- Секрет ніколи не йде в query string, у Client Component чи в журнал.
- Мок (`scripts/mock-n8n.mjs`) читає ті самі `N8N_WEBHOOK_TOKEN` і `N8N_CALLBACK_SECRET`, коли його
  запускають як `node --env-file=.env.local …`, і значень не друкує.

## 2. Виклик вебхука

**Модуль.** Лише `lib/n8n/client.ts`, перший рядок `import "server-only"` — тоді імпорт із Client
Component ламає збірку (у Next.js 16 пакет ставити не треба).

**URL.** `POST ${N8N_WEBHOOK_BASE_URL}/<event>`, `<event>` — kebab-case (`lead-created`,
`quote-request`). Одна подія — один шлях: n8n дозволяє лише один вебхук на пару «шлях + метод».

| Заголовок | Значення |
|---|---|
| `content-type` | `application/json` |
| `x-n8n-token` | `N8N_WEBHOOK_TOKEN` |
| `idempotency-key` | UUID, створений **один раз** на бізнес-операцію й збережений із записом; при повторі — той самий |
| `x-correlation-id` | UUID ланцюжка дій; його ж пишемо в журнали |

**Тіло (конверт):**

```json
{
  "version": 1,
  "event": "quote-request",
  "data": { "quoteId": "q_0042", "company": "Nova Dental", "budget": 1500 },
  "callbackUrl": "http://127.0.0.1:3000/api/n8n/quote-request"
}
```

- `version` — версія конверта: нове необов'язкове поле — та сама версія; перейменування чи зміна
  сенсу — нова версія (воркфлоу якийсь час приймає обидві).
- `data` — мінімум для воркфлоу. Не весь рядок з бази: IP, user agent, внутрішні нотатки, сирі дані
  форми n8n не потрібні.
- `callbackUrl` — лише для асинхронних воркфлоу: `${APP_BASE_URL}/api/n8n/<event>`.

**Таймаут.** Кожна спроба — `signal: AbortSignal.timeout(10_000)` (падає з `TimeoutError`). В
асинхронному режимі n8n відповідає одразу після отримання запиту, тож довга відповідь — це збій.

**Повтори.** Не більше двох (разом три спроби), пауза 1 с, потім 3 с, **лише** для мережевої
помилки, таймауту, 5xx і 524, завжди з тим самим `idempotency-key`. 4xx не повторюємо:
403 — неправильний токен, 404 — воркфлоу не опубліковано або це тестовий URL. Їх виправляють.

**Відповідь.** Дивимось лише на код статусу. Текст не парсимо: документація для Immediately пише
«Workflow got started», а n8n повертає `{"message":"Workflow was started"}`. У режимі Respond to
Webhook тіло — те, що задали в n8n (у нас `{"job_id": …}`).

**Хто викликає.**
- Дія з UI — Server Action: публічний POST-ендпоінт, автентифікація/права/валідація всередині
  (`server-auth-actions`). Зберігає запис (`status: "queued"`, `idempotencyKey`, `correlationId`),
  повертає `{ status, id }`, виклик n8n з повторами — в `after()` (`server-after-nonblocking`).
  Ще й тому, що Next.js виконує Server Actions по одній на клієнта: довге очікування блокує
  наступну дію того ж користувача.
- Не-React клієнт (інший сервіс, cron) — Route Handler.
- Ніколи `export const runtime = 'edge'`.

## 3. Режим відповіді

| Режим вузла Webhook | Що отримує Next.js | Коли |
|---|---|---|
| Immediately | 200 одразу | Подія «до відома»: `lead-created`, аналітика |
| When Last Node Finishes | Вихід останнього вузла | Швидка довідка (секунди), результат потрібен у відповіді |
| Using Respond to Webhook | Те, що задає Respond to Webhook | **Стандарт для довгих задач:** 202 `{"job_id"}` одразу, результат — колбеком |
| Streaming | Потік | Не використовуємо |

- Усе, що може наблизитися до **100 с**, — лише 202 + колбек. На n8n Cloud запит без відповіді
  за 100 с завершується **524**; воркфлоу працює далі, а Next.js про результат не дізнається.
- Не певні, скільки триває воркфлоу, — він асинхронний.
- Respond to Webhook спрацьовує один раз. Воркфлоу завершився, не дійшовши до нього, — 200 зі
  стандартним повідомленням; помилка до нього — 500.

## 4. Тестовий і production URL

| | Тестовий | Production |
|---|---|---|
| Шлях | `/webhook-test/<path>` | `/webhook/<path>` |
| Працює | 120 с після «Listen for test event» | Поки воркфлоу опублікований |
| Дані видно в редакторі | Так | Ні |

- У коді й `.env.example` — **лише** `/webhook`. Тестовий URL — тільки у власному `.env.local`
  людини, коли вона дивиться дані в редакторі n8n.
- n8n 2.x: production-виклики йдуть в опубліковану версію. Після змін — Publish знову.
- На self-hosted шляхи можна змінити (`N8N_ENDPOINT_WEBHOOK`, `N8N_ENDPOINT_WEBHOOK_TEST`) — тоді
  записати це в `docs/n8n-integrations.md` проєкту.

## 5. Ліміти

| Ліміт | Значення |
|---|---|
| Тіло запиту до вебхука n8n | 16 МБ (`N8N_PAYLOAD_SIZE_MAX`) |
| Тіло Server Action | 1 МБ (`serverActions.bodySizeLimit`) |
| Відповідь вебхука на n8n Cloud | 100 с, далі 524 |
| Тестовий URL | 120 с |
| Колбек у Next.js | 64 КБ, вікно часу 300 с (наше рішення) |

Файли не передаємо — лише посилання.

## 6. Журнали

| Пишемо | Не пишемо ніколи |
|---|---|
| подію, напрям, `x-correlation-id` | тіло запиту чи відповіді |
| код статусу, тривалість, номер спроби | ім'я, email, телефон, IP клієнта |
| довжину тіла і його sha256 | токен, підпис, секрет, повний URL з query string |

Відповіді з помилкою не містять внутрішніх подробиць (стек, SQL, URL n8n).
