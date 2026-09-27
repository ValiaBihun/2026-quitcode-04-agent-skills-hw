# A/B-перевірка скіла `integrating-n8n-webhooks` (Task D)

> Протокол — `materials/ab-task.md`, команди — `docs/walkthrough.md`, Task D. **A — без скіла, B — зі
> скілом.** Числа й цитати — з журналів сесій, мока й сервера від 27.09.2026.

- **Інструмент і версія:** Claude Code (desktop app, Windows 11)
- **Модель і рівень міркування (effort), однакові в обох прогонах:** `claude-opus-5-5`, effort `medium`
  (метадані обох сесій — `get_session`: `"model": "claude-opus-5-5", "effort": "medium"`)
- **Код:** BASE = `ff395fb` (коміт після Task C: три скіли, виправлення Task A, форма нотатки з Task B;
  ще без `/quotes` і змін у виклику n8n) · скіл `integrating-n8n-webhooks` для копії B — з `HEAD` на той
  момент (`9c70ee9`); `git diff --quiet ff395fb HEAD -- .claude/skills/integrating-n8n-webhooks` — без різниці
- **Копії:** `../leaddesk-ab-a` (без жодного скіла), `../leaddesk-ab-b` (лише `integrating-n8n-webhooks`);
  у кожній — `git init`, один коміт `start` з тегом `base`, `npm install` (494 пакети)
- **Що видалено з обох копій:** `tools/`, `materials/`, `docs/`, `README.md`, `.coderabbit.yaml`,
  `.github/` і всі скіли (у B повернуто лише `integrating-n8n-webhooks`) — `git archive ff395fb | tar -x
  --exclude=…`. Перевірено:
  - `find ../leaddesk-ab-a ../leaddesk-ab-b -name SKILL.md -not -path "*/node_modules/*"` → рівно один рядок,
    `../leaddesk-ab-b/.claude/skills/integrating-n8n-webhooks/SKILL.md`;
  - `ls -A … | grep -xE 'tools|materials|docs|README.md|.coderabbit.yaml|.github'` → «no hints - ok»;
  - `grep -rlE "x-n8n-token|timingSafeEqual|idempotency-key" ../leaddesk-ab-a --exclude-dir=node_modules`
    → «no contract - ok» (у B поза `.claude/` — теж);
  - `diff -rq --exclude=node_modules --exclude=.git --exclude=.claude` між копіями — ідентичні.
  - В обох копіях лишився `skills-lock.json` (запис про Vercel-скіл, без слова про n8n) — однаково.
- **Особисті копії скіла** (`~/.claude/skills`, `~/.cursor/skills`, `~/.agents/skills`, `~/.codex/skills`):
  перевірено — `~/.claude/skills` порожня, решти тек немає; особистого `~/.claude/CLAUDE.md` немає.
- **Запит:** `materials/ab-task.md` без змін, нова сесія на кожен прогін (A — сесія
  `local_280c742f…`, 10:32–10:38; B — `local_f41c2b75…`, 10:41–10:51).
- **Відповідь на уточнення, однакова в обох:** агент не питав ні в A, ні в B (у журналах сесій немає
  жодного повідомлення людини після запиту). Доступ поза текою копії жоден агент не просив: пошук
  `2026-quitcode-04-agent-skills-hw` у журналах обох сесій знаходить лише поле `name` у їхньому
  власному `package.json`.
- **Мок, однаковий для обох** (з робочого репозиторію, термінал у теці копії, після
  `npm run build && npm start` копії на :3000):
  `node --env-file=.env.local ../2026-quitcode-04-agent-skills-hw/tools/mock-n8n.mjs --mode respond-202 --delay 5000`
  — Header Auth (`x-n8n-token required`), 202, підписаний колбек через 5 с на `callbackUrl` із запиту.
  `.env.local` кожної копії: змінні, які додав агент, зі значеннями для мока, плюс `N8N_WEBHOOK_TOKEN`
  і `N8N_CALLBACK_SECRET` мока (згенеровані `crypto.randomBytes(32)`, не друкувались).
- **Базова лінія `check-contract.mjs` на копії до прогону** (увесь код, без `--changed-since`):
  6 PASS, 7 FAIL — C1 (`.env.example:6` `/webhook-test/`), C3, C4, C5, C6, C13 (усі —
  `app/actions.ts:54`, старий виклик n8n із форми ліда), C11 (у `.env.example` немає ключів контракту).
  Однаково в A і B. Це старий код — в оцінку прогонів він не йде; до прогонів
  `--changed-since base` на копії давав 13 PASS, 0 FAIL.

> Код прогонів перевірено версією скрипта з `18a7ea0`. Прогін B знайшов у скрипті помилку: у
> `.env.example` з CRLF (Windows, `core.autocrlf=true`) C11 не бачив жодного ключа. Виправлено до
> замірів, окремим комітом у скілі (див. «Що скіл змінив у собі» в `docs/verification.md`).

## A — без скіла

- Які скіли бачив агент (окрема сесія «Які skills тобі доступні? Не відкривай файлів.»): лише
  вбудовані/плагінні (`anthropic-skills:*`, `artifact-*`, `code-review`, `run`, …). Цитата:
  > У `AGENTS.md` сказано, що скіли проєкту лежать у `.claude/skills/`, але в моєму списку їх немає.
- Що зробив агент — своїми словами: форма `/quotes/new` (`useActionState`, валідація на сервері),
  Server Action `requestQuote` зберігає запит (`queued`) і **сам чекає** відповіді вебхука (`fetch` з
  `AbortSignal.timeout`, 10 с), ставить `processing`/`failed` і робить `redirect`. Вебхук —
  `N8N_QUOTE_WEBHOOK_URL`, у тілі весь розпарсений запит плюс `callbackUrl` і разовий `callbackToken`,
  без заголовків контракту. Колбек `POST /api/quotes/[id]/callback`: `Authorization: Bearer
  <callbackToken>` (хеш токена в записі, після першого виклику токен анулюється), `request.json()`,
  власний формат `{"status":"ready","pdfUrl":…}`. Сторінка `/quotes/[id]` з автооновленням кожні 5 с.
  Перевіряв на власному макеті n8n у scratchpad.
- Звідки агент узяв домовленості: скіла не було (у журналі сесії немає виклику `Skill`); контракт
  команди ніде не згадано. Рішення — із загальних знань і наявного коду (`lib/lead-form.ts`,
  `lib/db.ts`, форма ліда); формат n8n агент, за його словами, «придумав сам, бо формат воркфлоу
  клієнта мені невідомий» і попросив його звірити.
- Запитання агента і фінальна відповідь (скорочено):
  > Воркфлоу триває 40–90 секунд, тому Server Action не чекає на його завершення … Для кожного запиту
  > створюється разовий токен … n8n має повернути його в заголовку `Authorization` … Webhook-вузол
  > має бути в режимі «Respond: Immediately» … Вхідний формат я придумав сам … Звірте його.

  Запитань не було.
- Змінені файли (`git diff --cached --stat base`): 11 файлів, +549 / −1 — `.env.example`,
  `app/api/quotes/[id]/callback/route.ts`, `app/quotes/[id]/page.tsx`, `app/quotes/actions.ts`,
  `app/quotes/new/page.tsx`, `components/quote-form.tsx`, `components/quote-status-poller.tsx`,
  `lib/db.ts`, `lib/quote-form.ts`, `lib/quotes.ts`, `lib/types.ts`; діф: `docs/ab/a-without-skill.diff`
- Змінні середовища, які додав агент: `N8N_QUOTE_WEBHOOK_URL`, `APP_URL` (старий `N8N_WEBHOOK_URL` з
  `/webhook-test/` лишився)
- `check-contract.mjs --root ../leaddesk-ab-a --changed-since base` — лише код прогону:
  ```
  check-contract: root=…\leaddesk-ab-a files=39 changed-since=base (11 changed file(s))
  C1   PASS  No test webhook URL (/webhook-test/) in code or .env.example
  C2   PASS  No N8N_* variable with the NEXT_PUBLIC_ prefix
  C3   FAIL  N8N_* env vars (except N8N_CALLBACK_SECRET) are read only in lib/n8n/client.ts
         app/quotes/actions.ts:40  N8N_QUOTE_WEBHOOK_URL outside lib/n8n/client.ts
         app/quotes/actions.ts:42  N8N_QUOTE_WEBHOOK_URL outside lib/n8n/client.ts
  C4   FAIL  lib/n8n/client.ts exists for every n8n call and starts with import 'server-only'
         app/quotes/actions.ts:48  n8n call, but lib/n8n/client.ts does not exist
  C5   PASS  Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))
  C6   FAIL  Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id
         app/quotes/actions.ts:48  headers missing: x-n8n-token, idempotency-key, x-correlation-id
  C7   FAIL  Callback route reads the raw body; no .json() / JSON.parse before the signature check
         app/api/quotes/[id]/callback/route.ts:59  request body parsed with .json() — the signature needs the raw bytes
         app/api/quotes/[id]/callback/route.ts  raw body is never read (.text() / .arrayBuffer())
  C8   FAIL  Callback signature compared with crypto.timingSafeEqual, never === / !==
         app/api/quotes/[id]/callback/route.ts  no crypto.timingSafeEqual
  C9   FAIL  Callback route checks x-n8n-timestamp and idempotency-key
         app/api/quotes/[id]/callback/route.ts  header x-n8n-timestamp is never read
         app/api/quotes/[id]/callback/route.ts  header idempotency-key is never read
  C10  PASS  No export const runtime = 'edge'
  C11  FAIL  .env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook
         .env.example  N8N_WEBHOOK_BASE_URL is missing
         .env.example  N8N_WEBHOOK_TOKEN is missing
         .env.example  N8N_CALLBACK_SECRET is missing
         .env.example  APP_BASE_URL is missing
  C12  FAIL  No request bodies or personal data in console.* of n8n-related files
         app/api/quotes/[id]/callback/route.ts:73  console.error logs "body"
  C13  FAIL  In "use server" files every n8n call runs inside after() — the user never waits for n8n
         app/quotes/actions.ts:48  fetch to n8n is awaited in the Server Action instead of inside after()
  Summary: 4 PASS, 9 FAIL
  ```
  Ручна звірка: FAIL C3/C4/C6/C7/C8/C9/C11/C13 підтверджуються кодом. C12 — **спірний**: у рядку 73
  логується `body.error` — текст помилки, який надіслав n8n, а не персональні дані клієнта. C1 PASS:
  рядок `/webhook-test/` у `.env.example` — старий, агент його не змінював.
- Журнал мока (форма → колбек → `/quotes/<id>`):
  ```
  [mock-n8n] … header auth: x-n8n-token required (N8N_WEBHOOK_TOKEN is set)
  [mock-n8n] … callbacks: signed, sent to the request's callbackUrl after 5000 ms (async modes)
  [mock-n8n] 2026-09-27T10:58:43.804Z POST /webhook/quote-request -> 403 in 1 ms auth=missing | headers: accept,accept-language,content-type,user-agent | body 407 B sha256=10ccaec7…
  ```
  URL — `/webhook/`; без `x-n8n-token` n8n (Header Auth) відхиляє з 403, `idempotency-key` немає;
  воркфлоу не запустився, колбека не було.
- Час від «Надіслати» до відповіді форми: **405 мс** (`POST /quotes/new`, Resource Timing у браузері;
  дія чекала відповіді вебхука — з моком вона миттєва, з n8n «Immediately» теж, але до 10 с таймауту).
- Що показала `/quotes/<id>`: «Не вдалося підготувати кошторис автоматично. Ваш запит збережено —
  менеджер підготує кошторис вручну.»
- Журнал сервера: `db:insertQuote: 1`, `Failed to start quote-request workflow for quote q_86d5… Error:
  n8n responded with 403` зі **стеком** (шлях до чанка `.next/server/…`), `db:updateQuote: 1`,
  `db:getQuote: 1`. Email, назви компанії, тексту задачі, токенів немає
  (`grep -icE "example\.test|Nova Dental|Сайт-візитка"` → 0).

## B — зі скілом

- Які скіли бачив агент (окрема сесія): вбудовані/плагінні і один проєктний:
  > Скіл цього проєкту (лежить у `.claude/skills/`): integrating-n8n-webhooks: правила команди для
  > зв'язку Next.js 16 з n8n…
- **Чи викликав агент скіл:** так, першою дією — у журналі сесії одразу після запиту `(called Skill)` і
  завантажене тіло з `Base directory for this skill: …\leaddesk-ab-b\.claude\skills\integrating-n8n-webhooks`.
  Далі: «Now the n8n modules, following the team templates», запуск `scripts/check-contract.mjs`,
  мока скіла й `scripts/send-signed-callback.mjs` (8/8), посилання на `references/n8n-setup.md` у
  фінальній відповіді.
- Що зробив агент — своїми словами: `lib/n8n/client.ts` (`server-only`, `x-n8n-token`,
  `idempotency-key`, `x-correlation-id`, конверт, 10 с, 3 спроби), `lib/n8n/idempotency.ts`,
  `lib/n8n/callbacks.ts`, колбек `app/api/n8n/[event]/route.ts` за шаблоном скіла; Server Action
  зберігає `queued` і викликає n8n в `after()`; `/quotes/[id]` з автооновленням кожні 5 с. Від себе
  додав захист від гонки статусів (колбек раніше за `processing` не перезаписується), в n8n не
  передає email, створив `docs/n8n-integrations.md`.
- Запитання агента і фінальна відповідь (скорочено):
  > Кошторис готовий від початку до кінця … контракт-чекер для моїх змін дає 13/13 PASS, матриця
  > підписаних колбеків — 8/8 … Стара інтеграція `lead-created` … порушує контракт … Я її не чіпав …
  > Помилка в чекері скіла: якщо в `.env.example` Windows-переноси рядків (CRLF), він не бачить змінних.

  Запитань не було.
- Змінені файли (`git diff --cached --stat base`): 14 файлів, +634 / −1 — `.env.example`,
  `app/api/n8n/[event]/route.ts`, `app/quotes/[id]/page.tsx`, `app/quotes/actions.ts`,
  `app/quotes/new/page.tsx`, `components/quote-form.tsx`, `components/quote-status-refresh.tsx`,
  `docs/n8n-integrations.md`, `lib/db.ts`, `lib/n8n/callbacks.ts`, `lib/n8n/client.ts`,
  `lib/n8n/idempotency.ts`, `lib/quote-form.ts`, `lib/types.ts`; діф: `docs/ab/b-with-skill.diff`
- Змінні середовища, які додав агент: `N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_TOKEN`,
  `N8N_CALLBACK_SECRET`, `APP_BASE_URL` (у `.env.example` — `change-me-…` і локальні адреси; старий
  `N8N_WEBHOOK_URL` не чіпав)
- `check-contract.mjs --root ../leaddesk-ab-b --changed-since base` — лише код прогону:
  ```
  check-contract: root=…\leaddesk-ab-b files=41 changed-since=base (14 changed file(s))
  C1   PASS  No test webhook URL (/webhook-test/) in code or .env.example
  C2   PASS  No N8N_* variable with the NEXT_PUBLIC_ prefix
  C3   PASS  N8N_* env vars (except N8N_CALLBACK_SECRET) are read only in lib/n8n/client.ts
  C4   PASS  lib/n8n/client.ts exists for every n8n call and starts with import 'server-only'
  C5   PASS  Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))
  C6   PASS  Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id
  C7   PASS  Callback route reads the raw body; no .json() / JSON.parse before the signature check
  C8   PASS  Callback signature compared with crypto.timingSafeEqual, never === / !==
  C9   PASS  Callback route checks x-n8n-timestamp and idempotency-key
  C10  PASS  No export const runtime = 'edge'
  C11  PASS  .env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook
  C12  PASS  No request bodies or personal data in console.* of n8n-related files
  C13  PASS  In "use server" files every n8n call runs inside after() — the user never waits for n8n
  Summary: 13 PASS, 0 FAIL
  ```
- Журнал мока (форма → колбек → `/quotes/<id>`):
  ```
  [mock-n8n] … header auth: x-n8n-token required (N8N_WEBHOOK_TOKEN is set)
  [mock-n8n] … callbacks: signed, sent to the request's callbackUrl after 5000 ms (async modes)
  [mock-n8n] 2026-09-27T10:59:59.976Z POST /webhook/quote-request -> 202 in 2 ms auth=ok idempotency=new | headers: accept,accept-language,cache-control,content-type,idempotency-key,pragma,user-agent,x-correlation-id,x-n8n-token | body 321 B sha256=4ef489db…
  [mock-n8n] 2026-09-27T11:00:00.011Z workflow e8519289-a56e-4acb-a9fb-43a7a0c20db4 running for 5000 ms, then callback event=quote-request.completed
  [mock-n8n] 2026-09-27T11:00:05.226Z callback POST http://127.0.0.1:3000/api/n8n/quote-request -> 202 in 209 ms (try 1/3) event=quote-request.completed body 382 B sha256=5cb5c920…
  ```
- Час від «Надіслати» до відповіді форми: **158 мс** (`POST /quotes/new`, Resource Timing)
- Що показала `/quotes/<id>`: одразу «У черзі — Запит прийнято, передаємо його на підготовку»,
  після колбека (≈ 5 с, автооновлення) — «Готово. Кошторис готовий. Завантажити PDF»
  (`https://files.example.test/n8n/e8519289-….pdf`).
- Журнал сервера: `db:insertQuote: 1`, `[n8n] -> quote-request status=202 attempt=1 ms=55 bytes=321
  sha256=4ef489dbdeabd162 cid=10b2aa9e-…`, `db:updateQuote`, `db:getQuoteByIdempotencyKey: 1`,
  `[n8n] <- quote-request status=202 bytes=382 cid=10b2aa9e-…`. Тіл, email, назви компанії, токенів,
  підписів немає (`grep` → 0).

## Порівняння

| Що дивимось | A — без скіла | B — зі скілом |
|---|---|---|
| Скіл викликано | — | так, першою дією (`Skill`), далі `references/` і `scripts/` |
| `check-contract.mjs --changed-since base`: FAIL (id) | **9 FAIL**: C3, C4, C6, C7, C8, C9, C11, C12 (спірний), C13 | **0 FAIL** (13 PASS) |
| URL вебхука | `/webhook/` (у своїй змінній `N8N_QUOTE_WEBHOOK_URL`) | `/webhook/` (`N8N_WEBHOOK_BASE_URL` + `/quote-request`) |
| `auth=` / `idempotency=` у журналі мока | `auth=missing` → **403**, `idempotency-key` немає | `auth=ok`, `idempotency=new` → **202** |
| Колбек дійшов; код відповіді застосунку | ні — воркфлоу не стартував; власний колбек A чекає `Authorization: Bearer`, а не HMAC, тож підписаний колбек n8n клієнта отримав би 401 | так, підписаний, **202** |
| Час відповіді форми | 405 мс (дія чекає вебхука, до 10 с) | 158 мс (n8n — в `after()`) |
| `/quotes/<id>` | «Не вдалося підготувати кошторис автоматично» | «Готово» з PDF |
| Тіла чи персональні дані в журналі сервера | немає; є стек помилки | немає |
| Змінених файлів | 11 (+549) | 14 (+634) |
| Запитання агента | немає | немає |

## Перенесення прогону B у гілку (фіча)

- Як переносили: `git apply --3way docs/ab/b-with-skill.diff` на гілці `ws04/ValiaBihun` (код гілки =
  BASE: після `ff395fb` змінювались лише скіл і `docs/`), без конфліктів. Перевірка, що в гілку
  потрапило рівно те, що зробив агент: `+/-` рядки `git diff --cached` збігаються з діфом прогону B.
  Коміт: `8c78fdd feat(quotes): quote request feature carried over from A/B run B` (без ручних змін).
  `.env.local` і `node_modules/` не переносились; нових залежностей прогін не додавав.
- Що довелось доробити руками після перенесення (і чому скіл цього не дав):
  - `3feee76 fix(leads): send lead-created through lib/n8n/client in after()` — стара форма ліда
    (`app/actions.ts`) і далі слала весь лід з IP і user agent без токена й таймауту та чекала n8n.
    Агент B це помітив, але свідомо не чіпав: задача була про кошторис. Скіл не каже «приведи до
    контракту всі наявні інтеграції», лише описує, як робити нову.
  - `33fe391 fix(env): drop the test webhook URL from .env.example` — прибрано
    `N8N_WEBHOOK_URL=…/webhook-test/lead-created`.
  - До скіла: `18a7ea0 fix(skills/n8n): check-contract reads CRLF files` — знахідка прогону B.
- Ключі контракту в `.env.example`: `N8N_WEBHOOK_BASE_URL=http://127.0.0.1:5678/webhook`,
  `N8N_WEBHOOK_TOKEN=change-me-webhook-token`, `N8N_CALLBACK_SECRET=change-me-callback-secret`,
  `APP_BASE_URL=http://127.0.0.1:3000`; `/webhook-test/` немає.
- `npm run lint`, `npm run build` на гілці: без помилок.
- `check-contract.mjs` на фінальному коді (увесь код, без прапорця):
  ```
  C1   PASS  No test webhook URL (/webhook-test/) in code or .env.example
  C2   PASS  No N8N_* variable with the NEXT_PUBLIC_ prefix
  C3   PASS  N8N_* env vars (except N8N_CALLBACK_SECRET) are read only in lib/n8n/client.ts
  C4   PASS  lib/n8n/client.ts exists for every n8n call and starts with import 'server-only'
  C5   PASS  Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))
  C6   PASS  Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id
  C7   PASS  Callback route reads the raw body; no .json() / JSON.parse before the signature check
  C8   PASS  Callback signature compared with crypto.timingSafeEqual, never === / !==
  C9   PASS  Callback route checks x-n8n-timestamp and idempotency-key
  C10  PASS  No export const runtime = 'edge'
  C11  PASS  .env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook
  C12  PASS  No request bodies or personal data in console.* of n8n-related files
  C13  PASS  In "use server" files every n8n call runs inside after() — the user never waits for n8n
  Summary: 13 PASS, 0 FAIL
  exit=0
  ```
- Сценарій «форма → колбек → `/quotes/<id>`» ще раз, уже на гілці (`npm run build && npm start`,
  `.env.local` з ключами контракту — значення згенеровані, не друкувались; мок
  `node --env-file=.env.local tools/mock-n8n.mjs --mode respond-202 --delay 5000`):
  форма відповіла за **160 мс**, `/quotes/q_cfd2…` — «У черзі», через ≈ 5 с — «Готово. Кошторис
  готовий» з PDF. Заодно — форма ліда на `/` після доведення `3feee76`: «Дякуємо! Заявку отримано» за
  **141 мс** (у базовій лінії Task A було 2 430 мс).
  ```
  [mock-n8n] 2026-09-27T11:06:16.981Z POST /webhook/quote-request -> 202 in 2 ms auth=ok idempotency=new | headers: accept,accept-language,cache-control,content-type,idempotency-key,pragma,user-agent,x-correlation-id,x-n8n-token | body 303 B sha256=efea4e5d…
  [mock-n8n] 2026-09-27T11:06:22.198Z callback POST http://127.0.0.1:3000/api/n8n/quote-request -> 202 in 209 ms (try 1/3) event=quote-request.completed body 382 B sha256=aa18eefa…
  [mock-n8n] 2026-09-27T11:06:46.128Z POST /webhook/lead-created -> 202 in 1 ms auth=ok idempotency=new | headers: accept,accept-language,cache-control,content-type,idempotency-key,pragma,user-agent,x-correlation-id,x-n8n-token | body 319 B sha256=136b3df7…
  ```
  Журнал сервера гілки:
  ```
  db:insertQuote: 1
  db:getQuote: 1
  [n8n] -> quote-request status=202 attempt=1 ms=57 bytes=303 sha256=efea4e5dbdd1e367 cid=449eca2b-68d0-47c6-8cc2-c775d44ee952
  db:updateQuote: 1
  db:getQuoteByIdempotencyKey: 1
  db:updateQuote: 2
  db:getQuote: 2
  [n8n] <- quote-request status=202 bytes=382 cid=449eca2b-68d0-47c6-8cc2-c775d44ee952
  db:insertLead: 1
  db:insertAuditEntry: 1
  [n8n] -> lead-created status=202 attempt=1 ms=4 bytes=319 sha256=136b3df7d2b2f685 cid=81a64bbe-c950-4c14-9c62-3a46d2851a7f
  ```
  Тіл, email, телефонів, токенів і підписів у журналі немає. Матрицю підписаних колбеків
  (`send-signed-callback.mjs`, 8/8) агент B прогнав на цьому ж коді у своїй копії; у гілці код колбека
  не змінювався.
- Рядок у `docs/n8n-integrations.md`: створив агент B (`quote-request`); після перенесення додано `lead-created` і власника (ValiaBihun).

## Висновок

Скіл змінив результат, і це видно не з враження, а з виводу `check-contract.mjs` і журналу мока.
Агент без скіла зробив акуратну, робочу на власному макеті фічу, але з власним контрактом
(`N8N_QUOTE_WEBHOOK_URL`, Bearer-токен на запит, `request.json()`, дія чекає вебхука) — 9 FAIL, і з
n8n, налаштованим за записками команди, вона не працює: 403 на вебхуку, колбек не прийшов. Агент зі
скілом викликав його сам, першою дією, пішов за шаблонами й сам перевірив себе скриптами скіла:
0 FAIL, 202 з `auth=ok`, підписаний колбек прийнято, форма відповідає за 158 мс. Після перенесення
прогону B довелось доробити лише старий код поза задачею (форма ліда, `.env.example`), а сам прогін
знайшов помилку в скрипті скіла (CRLF), яку виправлено окремим комітом.
