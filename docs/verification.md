# Перевірка (Task A–C, бонус E3)

> Скопіюйте в `docs/verification.md` і заповніть. Сюди — лише те, що справді сталося: цитати,
> числа, імена файлів, SHA комітів. Порядок дій — у `docs/walkthrough.md`.
> Прогони A/B і фіча «запит на кошторис» — в окремому звіті `docs/ab-validation.md` (Task D).

- **Інструмент і версія, модель:** Claude Code (desktop app) · Opus 5.5
- **ОС і термінал, Node:** Windows 11 Pro · Git Bash (заміри), PowerShell (встановлення скіла) · Node 24.20.0

## Скіли видно у свіжій сесії

- Як перевіряли: нова сесія Claude Code (desktop app) у теці проєкту, запит про доступні скіли.
  Агент сам `/context` викликати не може (вбудована команда інтерфейсу); окремого CLI `claude`
  на машині немає. Відповідь сесії (після встановлення Vercel-скіла):
  > `vercel-react-best-practices` є в моєму списку доступних скілів, з повним описом («React and
  > Next.js performance optimization guidelines from Vercel Engineering…»)… Назва йде без префікса,
  > тоді як скіли з плагінів мають префікс на кшталт `anthropic-skills:…`… Це єдиний скіл у
  > `.claude/skills/`.

| Skill | Звідки (Project / Personal / вбудований) | Примітка |
|---|---|---|
| `vercel-react-best-practices` | Project (`.claude/skills/vercel-react-best-practices/SKILL.md`) | видно після встановлення; використано для рев'ю в Task A |
| `building-client-form` | Project (`.claude/skills/building-client-form/SKILL.md`) | викликаний сам у свіжій сесії (Task B) |
| `integrating-n8n-webhooks` | Project (`.claude/skills/integrating-n8n-webhooks/SKILL.md`) | додано в Task C; спрацювання — у прогоні B (Task D) |

- Особисті скіли, які теж видно (`~/.claude/skills/`…), і чи можуть вони вплинути на перевірки:
  CLI `skills@1.7.0` разом із Vercel-скілом поставив особистий `find-skills`
  (`~/.claude/skills/find-skills/`, `~/.agents/.skill-lock.json`). Його видалено до нової сесії:
  `~/.claude/skills` порожня, `~/.agents` немає. Інакше він був би видимий у кожній сесії, зокрема в
  прогоні A (Task D). Скіли з плагінів застосунку (`anthropic-skills:…`) видно завжди — до
  проєктних перевірок вони не стосуються.

## Task A — виправлення за скілом Vercel

Щонайменше 2 виправлення (досить двох); для **одного** (на ваш вибір) — числа до/після, для решти
досить id правила й пояснення.

**Як міряли (для виправлення з числами):** продакшн-збірка (`npm run build && npm start`), код
`main` (`01a7dd4`, без змін у `app/`, `components/`, `lib/`). Cookie `leaddesk_session=demo-u_olena`,
прогрів одним `curl`, потім 5 прогонів:

```bash
C="leaddesk_session=demo-u_olena"; U=http://localhost:3000/dashboard
curl -s -o /dev/null -b "$C" "$U"
for i in 1 2 3 4 5; do curl -s -o /dev/null -b "$C" -w "TTFB %{time_starttransfer}s, total %{time_total}s\n" "$U"; done
curl -s  -b "$C" "$U" | wc -c
curl -sL -b "$C" -H "RSC: 1" "$U" | wc -c
```

### Базова лінія (`main`, 27.09.2026)

**`/dashboard`, сервер:**

```
TTFB 2.271968s, total 2.272569s
TTFB 2.261842s, total 2.262480s
TTFB 2.265491s, total 2.266190s
TTFB 2.280122s, total 2.280734s
TTFB 2.272189s, total 2.272836s
HTML bytes: 424592
RSC bytes:  315197
```

| Метрика | Значення |
|---|---|
| TTFB `/dashboard` (медіана з 5) | **2,27 с** |
| Розмір HTML / RSC-відповіді | 424 592 / 315 197 байт |
| Поля ліда, що доходять у HTML | `rawPayload` ×172, `ipAddress` ×172, `userAgent` ×344 (`curl … \| grep -oE … \| uniq -c`) |
| Запити до «бази» на один `GET /dashboard` (приріст лічильників `db:` у журналі `npm start`) | `getUserBySession` ×3, `getWorkspace` ×3, `getLeads` ×1, `getLeadStats` ×1, `getSourceBreakdown` ×1 |

Затримки «бази» (`lib/db.ts`): user 100 мс + workspace 100 + leads 400 + stats 1200 + sources 400 =
2200 мс — у `app/dashboard/page.tsx` усі п'ять `await` ідуть один за одним, що й дає ~2,27 с.

**`/dashboard`, браузер** (вбудований браузер Claude Code, перше відкриття,
`performance.getEntriesByType('resource')`): 9 JS-файлів, **354 КБ передано / 1 718 КБ
розпаковано**. Найбільший чанк — 1 266 КБ, містить `recharts`, `exceljs` (з `JSZip`) і `lodash`:
графік і експорт вантажаться одразу, хоча потрібні лише після кліку.

**Форма `/` → «Надіслати заявку»** (мок `node tools/mock-n8n.mjs --mode last-node`,
`.env.local`: `N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/lead-created`): відповідь
`POST /` — **2 430 мс** (Resource Timing у браузері). Журнал мока на цю відправку:

```
POST /webhook/lead-created -> 200 in 2004 ms auth=none idempotency=absent | headers: accept,accept-language,content-type,user-agent | body 1233 B
```

(insertLead 120 мс + очікування n8n 2004 мс + insertAuditEntry 250 мс — усе до відповіді користувачу.)

Рев'ю зроблено в новій сесії запитом з інструкції:

> Зроби рев'ю app/, components/, lib/ за скілом vercel-react-best-practices. Для кожної проблеми —
> рядок таблиці: файл:рядок | id правила | що не так | виправлення для Next.js 16. Файли не змінюй.

Відповідь агента (файлів не змінював; затримки — з `lib/db.ts:25-38`; рядки за пріоритетом правил):

| файл:рядок | id правила | що не так | виправлення для Next.js 16 |
|---|---|---|---|
| `app/dashboard/page.tsx:14-18` | `async-parallel` / `server-parallel-fetching` | П'ять `await` один за одним: 100+100+400+1200+400 ≈ 2,2 с; `getLeads`, `getLeadStats`, `getSourceBreakdown` незалежні | Після `user` і `workspace` — `Promise.all([getLeads(id), getLeadStats(id), getSourceBreakdown(id)])` |
| `app/dashboard/page.tsx:17` | `async-suspense-boundaries` | `getLeadStats` (1200 мс) тримає всю сторінку, хоча таблиця готова за 400 мс | Async-компонент `<Stats>` у `<Suspense fallback={<StatsSkeleton/>}>`; `app/dashboard/loading.tsx` для першого кадру |
| `components/leads-toolbar.tsx:4` | `bundle-conditional` / `bundle-dynamic-imports` | `exceljs` (~1 МБ) статично в клієнтському бандлі, хоча потрібен лише після кліку «Експорт» | `const { default: ExcelJS } = await import("exceljs")` у `handleExport`; за бажанням прелоад на `onMouseEnter`/`onFocus` (`bundle-preload`) |
| `components/leads-toolbar.tsx:6` | `bundle-dynamic-imports` | `SourcesChart` тягне `recharts` у початковий бандл, хоча графік схований; `optimizePackageImports` лише прибирає зайві модулі, а не відкладає завантаження | `dynamic(() => import("./sources-chart").then(m => m.SourcesChart), { ssr: false, loading: … })` з `next/dynamic` |
| `components/lead-search.tsx:5` | `bundle-barrel-imports` | `import { debounce } from "lodash"` тягне весь CommonJS-пакет; у дефолтному `optimizePackageImports` лише `lodash-es` | `import debounce from "lodash/debounce"` або прибрати lodash (див. `useDeferredValue` нижче) |
| `app/actions.ts:68-77` | `server-auth-actions` | `updateLeadStatus`/`deleteLead` — публічні POST-ендпоінти без перевірки сесії й належності ліда до workspace; `status` не перевіряється | На початку дії: `getCurrentUser()` → `getWorkspace(…)` → `getLead(id)`, `if (!lead \|\| lead.workspaceId !== ws.id) throw …`; `LEAD_STATUSES.includes(status)` |
| `lib/data.ts:7` | `server-cache-react` | `getCurrentUser` не в `cache()`; його викликають layout, `DashboardHeader` і page — 3× `getUserBySession` | `export const getCurrentUser = cache(async () => { … })`; `redirect()` усередині працює |
| `lib/data.ts:18` | `server-cache-react` | `cache(async ({ slug }) => …)` отримує щоразу новий об'єкт — `Object.is` не збігається, кеш не спрацьовує: 3× `getWorkspace` | Приймати примітив: `cache(async (slug: string) => …)`, виклик `getWorkspace(user.workspaceSlug)` |
| `app/actions.ts:53-63` | `server-after-nonblocking` | Вебхук n8n і `logAudit` (250 мс) виконуються до відповіді користувачу | `after(async () => { await Promise.allSettled([fetch(…), logAudit(…)]) })` з `next/server`, одразу `return { status: "ok" }` |
| `app/dashboard/page.tsx:32` → `components/leads-table.tsx:12` | `server-serialization` | У клієнтський компонент іде повний `Lead[]` з `rawPayload`, `ipAddress`, `userAgent`, `internalNotes`, `message`, `tags`; таблиці треба 5 полів | На сервері `leads.map(({ id, fullName, company, status, createdAt }) => …)`, тип `LeadRow` у `LeadsTable` |
| `components/lead-search.tsx:20-24` | `client-swr-dedup` / `server-dedup-props` | Після гідрації ще раз вантажить `/api/leads`, хоча page уже має ліди; `leads-toolbar.tsx:26` робить той самий запит (≈600 мс); помилки не обробляються | Передати мінімальні рядки з page як проп; якщо клієнтський запит потрібен — спільний `useSWR("/api/leads")` |
| `components/lead-search.tsx:18,43-45` | `rerender-derived-state-no-effect` / `rerender-use-deferred-value` | `filtered` у стейті, оновлюється з ефекту через debounce: зайвий рендер і 250 мс затримки; debounce не скасовується при unmount | `useDeferredValue(query)` + `useMemo` для `filtered`, без обох ефектів |
| `app/dashboard/leads/[id]/page.tsx:12-16` | `async-api-routes` | `getLead(id)` не залежить від `user`, але стартує після `await getCurrentUser()` | `const leadPromise = getLead(id)` одразу після `await params`, потім `Promise.all` |
| `components/leads-table.tsx:17` | `js-tosorted-immutable` | `[...leads].sort(…)` на кожному рендері | `leads.toSorted(…)`, для великих списків — у `useMemo` |
| `components/leads-table.tsx:24`, `components/leads-toolbar.tsx:72` | `rerender-functional-setstate` | `setDescending(!descending)`, `setShowChart(!showChart)` беруть значення із замикання | `setDescending(d => !d)`, `setShowChart(s => !s)` |
| `components/leads-table.tsx:56-58` | `bundle-preload` | Перехід через `router.push` в `onClick` рядка: немає prefetch, рядок недоступний з клавіатури | `<Link href={…}>` на імені чи клітинці |
| `lib/db.ts:334-338` | `js-combine-iterations` | `getSourceBreakdown` проходить `store.leads` 6 разів (і `getLeadStats` — кілька); це мок БД, пріоритет низький | Один цикл з `Record<LeadSource, number>` |

Поза правилами скіла агент також помітив: у `components/lead-actions.tsx:15-18` після
`updateLeadStatus` (який уже викликає `revalidatePath`) зайвий `router.refresh()`, і стан не
відкочується, якщо дія впала (для цього є `useOptimistic`).

Застосовано два з цих рядків:

| Правило (id) | Коміт | Файли | Що змінилось | Було (`main`) | Стало | Як міряли |
|---|---|---|---|---|---|---|
| `async-parallel` | `948412b` | `app/dashboard/page.tsx` | `getLeads`, `getLeadStats`, `getSourceBreakdown` залежать лише від `workspace.id` — тепер ідуть разом через `Promise.all` замість трьох послідовних `await` | TTFB `/dashboard` **2,27 с** (2,262–2,280, 5 прогонів) | **1,44 с** (1,429–1,449, 5 прогонів) | `curl` вище, продакшн-збірка, після кожної збірки — перезапуск `npm start` |
| `server-cache-react` | `f1684de` | `lib/data.ts` + 4 місця виклику `getWorkspace` | `getCurrentUser` загорнуто в `cache()`; `getWorkspace` приймає рядок `slug` замість нового об'єкта `{ slug }`, з яким кеш ніколи не збігався (`Object.is`) | `db:` на один `GET /dashboard`: `getUserBySession` ×3, `getWorkspace` ×3 | ×1 і ×1 | (без заміру часу) приріст лічильників `db:` у журналі `npm start` за один `curl` |
| `server-auth-actions` | `0507d25` | `app/actions.ts` | `updateLeadStatus` і `deleteLead` тепер самі перевіряють сесію (`getCurrentUser()`), що лід належить workspace користувача, і статус проти `LEAD_STATUSES`; повертають лише `{ status }` | будь-хто, хто знає `lead_…`, міг змінити статус чи видалити будь-який лід | без сесії / з чужим лідом / з вигаданим статусом — нічого не змінюється | (без заміру часу) прямий виклик дій за `Next-Action`, див. нижче |

Сирий вивід після `async-parallel`:

```
TTFB 1.446286s, total 1.447080s
TTFB 1.449198s, total 1.450103s
TTFB 1.440850s, total 1.441493s
TTFB 1.437121s, total 1.437791s
TTFB 1.428993s, total 1.429588s
```

- Чому обрали для заміру `async-parallel`: це найбільша причина скарги клієнта (дашборд > 2 с) і
  ефект передбачуваний із таблиці затримок `lib/db.ts`: 100 + 100 + max(400, 1200, 400) = 1400 мс —
  виміряли 1,44 с.
- Друге виправлення, `server-cache-react`: layout, `DashboardHeader` і сторінка кожен окремо
  викликали `getCurrentUser()` і `getWorkspace()` — 6 запитів до «бази» замість 2. На час сторінки
  це майже не впливає (TTFB після нього 1,44–1,46 с): layout і сторінка рендеряться паралельно, тож
  дублі йшли одночасно, — але це вдвічі менше навантаження на справжню БД на кожне відкриття. Як
  переконались, що не зламали: без cookie `/dashboard` → 307 на `/login` (proxy), з невідомою
  сесією → 307 (`redirect()` усередині `cache()`), `/dashboard/leads/lead_0023` → 200 з ім'ям
  ліда; у браузері дашборд показує 172 рядки й картки статистики.
- Поради скіла, звірені з документацією Next.js 16 і **не** застосовані в Task A:
  - `server-after-nonblocking` для форми — `after()` у Next.js 16 є (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`),
    але виклик n8n з форми за інструкцією переробляємо за контрактом у Task D; зараз не чіпаємо,
    щоб не змішувати зміни;
  - `bundle-dynamic-imports` для `recharts` / `exceljs` — застосовна (`next/dynamic` і `import()` у
    клієнтському компоненті), лишили на потім: двох виправлень для Task A досить;
- Третє виправлення, `server-auth-actions` (`0507d25`, зроблене вже після Task D, перед здачею):
  знахідку з рев'ю вище (`app/actions.ts:68-77`, дії без перевірки сесії) бачили й агент у Task B, і
  наш скіл `building-client-form` вимагає такої перевірки. Порада звірена з Next.js 16
  (`01-app/02-guides/data-security.md`, «Authentication and authorization»: Server Actions — публічні
  ендпоінти, перевіряти права всередині). Як переконались, що працює й не зламали (продакшн-збірка,
  дії викликано напряму заголовком `Next-Action`, як це зробив би сторонній клієнт):

  | Виклик | Результат | `db:updateLeadStatus` / `db:deleteLead` |
  |---|---|---|
  | без сесії, `update` і `delete` свого ліда (через `/dashboard`) | 307 → `/login` (proxy) | не викликались |
  | вигадана сесія `forged-session`, `update` через `/login` (повз proxy) | `x-action-redirect: /login;push` від `getCurrentUser()` у самій дії | не викликались |
  | сесія Olena, `update` і `delete` ліда іншого workspace (`lead_0007`) | `{"status":"error"}` | не викликались |
  | сесія Olena, свій лід, статус `hacked` | `{"status":"error"}`, статус лишився `new` | не викликались |
  | сесія Olena, свій лід, статус `contacted` | `{"status":"ok"}`, статус `contacted` | 1 |
  | браузер: сторінка ліда `lead_0024`, зміна статусу в `select` | після перезавантаження — «Контакт» | 2 |

  `npm run lint`, `npm run build`, `check-contract.mjs` (0 FAIL) — без помилок.
- Якщо виміряне виправлення не змінило чисел — змінило: 2,27 с → 1,44 с.
- `npm run lint`, `npm run build` після кожного виправлення: без помилок.

## Task B — `building-client-form`

Скіл закомічено в `9986bb8`; код з перевірки лишили й закомітили окремо (`feat(leads)`, див. `git log`) (`name` = тека, `description` 832 символи, `SKILL.md` 125 рядків).

- Запит у свіжій сесії Claude Code (сесія «Форма додавання нотатки на сторінці ліда»; скіл не названо):
  > На сторінці ліда в дашборді (/dashboard/leads/[id]) додай форму «Додати нотатку»: одне текстове
  > поле до 500 символів; нотатка дописується до внутрішніх нотаток ліда.
- Чи спрацював скіл і як це видно: **так, з першої спроби.** У журналі сесії перша дія агента після
  запиту — `(called Skill)`, далі в контекст завантажено тіло скіла з рядком
  `Base directory for this skill: …\.claude\skills\building-client-form`. Фінальна відповідь агента:
  «Зроблено за скілом `building-client-form`».
- Якщо не з першого разу — що змінили в `description`: нічого, спрацював одразу.
- Що зроблено (файли):
  - `lib/db.ts` — `appendLeadNote(id, note)`: дописує рядок до `internalNotes`;
  - `lib/note-form.ts` — `parseNoteForm`: порожньо / > 500 символів → помилка поля; підмінений
    `leadId` (не `lead_NNNN`) → загальна помилка без подробиць;
  - `app/dashboard/actions.ts` — `addLeadNote`: `getCurrentUser()` → валідація → лід належить
    workspace користувача → запис → аудит в `after()` → `revalidatePath` → `{ status: "ok" }`;
  - `components/note-form.tsx` — `useActionState`, `action={formAction}`, `label`/`htmlFor`,
    `aria-invalid`, `aria-describedby`, підсумок у `role="alert"`, `aria-live="polite"`, кнопка
    «Зберігаємо…» з `disabled={pending}`, `defaultValue` з `state.values` після помилки;
  - `app/dashboard/leads/[id]/page.tsx` — форма під блоком нотаток.

  Агент також помітив поза задачею, що `updateLeadStatus` і `deleteLead` в `app/actions.ts` не
  перевіряють сесію (та сама знахідка `server-auth-actions`, що й у рев'ю Task A).

- Пункти Verify зі скіла — результат кожного. Агент у своїй сесії перевірив у браузері порожню
  відправку, нормальну відправку, чужий лід і журнал; «без JS» і «без сесії» пропустив — їх
  перевірено окремо на продакшн-збірці (`npm run build && npm start`). Відправка «без JS» — це
  звичайний `multipart/form-data` POST з тими прихованими полями (`$ACTION_REF_1`, `$ACTION_KEY`,
  `leadId`…), які сервер рендерить у `<form>`, — так форму надсилає браузер з вимкненим JavaScript:

  | Пункт Verify | Результат |
  |---|---|
  | `npm run lint`, `npm run build` | без помилок |
  | Порожня відправка | 200; у відповіді `role="alert"` «Перевірте поля: Напишіть текст нотатки» і `id="note-text-error"` під полем; `appendLeadNote` не викликався |
  | Введене не зникає після помилки | текст із 600 символів («KEEPME…»): 200, помилка «Не більше 500 символів», `aria-invalid="true"`, у `textarea` повернувся введений текст (обрізаний до 500) |
  | Відправка без JavaScript | 200 за 547 мс, сторінка з «Нотатку додано.», нотатка з'явилась у внутрішніх нотатках `lead_0023` |
  | Дія без сесії (без cookie) | 307 → `/login`, нотатки не додано |
  | Чужий лід (`leadId=lead_0007`, інший workspace) | 200 з «Не вдалося зберегти нотатку», `appendLeadNote` не викликався |
  | Журнал сервера | лише `db:…` лічильники: `appendLeadNote: 1` — рівно на одну валідну відправку; тексту нотатки, email, телефону немає |
  | Повільне після відповіді | `db:insertAuditEntry` (250 мс) з'являється в журналі після `appendLeadNote` і перерендеру — в `after()` |

  Попередження `Missing origin header from a forwarded Server Actions request` у журналі — від
  `curl`, який не надсилає `Origin`; браузер його надсилає.

## Task C — `integrating-n8n-webhooks`

Тут скіл лише пакують. Застосовує його агент у прогоні **B** (Task D) — доказ спрацювання, журнал
мока й час відповіді форми — у `docs/ab-validation.md`.

Структура (`.claude/skills/integrating-n8n-webhooks/`): `SKILL.md` (111 рядків, `description`
933 символи), `references/contract.md`, `references/callback.md`, `references/code-templates.md`,
`references/n8n-setup.md`, `scripts/check-contract.mjs`, `scripts/send-signed-callback.mjs`,
`scripts/mock-n8n.mjs` (байт-у-байт копія `tools/mock-n8n.mjs`, `cmp` без різниці). Скіл
самодостатній: жодних посилань на `materials/` чи `tools/` — у прогоні B їх не буде.

- Що лишили в `SKILL.md`, а що винесли в `references/` (і чому): у `SKILL.md` — те, що агент має
  **зробити**: 9 пунктів контракту одним-двома реченнями (змінні, один модуль, заголовки й конверт,
  таймаут і повтори, `after()` і 202 + колбек, порядок обробки колбека з кодами відповіді, журнали,
  заборона `edge`), чекліст на 10 пунктів, правила зупинки, Verify. У `references/` — «чому» й
  деталі, які потрібні лише під час написання конкретного шматка: таблиці змінних і режимів
  відповіді, тестовий vs production URL, ліміти (`contract.md`); покрокова обробка колбека з
  поясненнями «чому запис до відповіді», «чому звільняти ключ», «чому ключ звіряємо з тілом»
  (`callback.md`); налаштування вузлів n8n текстом, відомі пастки, реєстр інтеграцій, команди мока
  (`n8n-setup.md`); робочі шаблони `lib/n8n/client.ts`, `lib/n8n/idempotency.ts`,
  `app/api/n8n/[event]/route.ts`, `lib/n8n/callbacks.ts`, Server Action і `.env.example`
  (`code-templates.md`). Посилання з `SKILL.md` — прямі, один рівень. На правила Vercel —
  за id (`server-auth-actions`, `server-after-nonblocking`), без копіювання.
- Шаблони перевірено до коміту на тимчасовій копії проєкту поза репозиторієм (`../tmp-n8n-templates`,
  `git archive HEAD` + `npm ci`): `next build` і ESLint без помилок; `check-contract --changed-since base`
  — 13 PASS, 0 FAIL (Server Action із шаблону окремо — C13 PASS); з моком `--mode respond-202 --delay 2000` і згенерованими тестовими
  секретами: `POST /webhook/quote-request -> 202 … auth=ok idempotency=new`, через 2 с
  `callback POST …/api/n8n/quote-request -> 202 (try 1/3)`, запис перейшов у `ready` з
  `documentUrl`; матриця колбеків — 8/8 (нижче).
- Правила зупинки — перелік: тестовий URL у коді/`.env.example`/конфігурації; секрет чи токен у
  Client Component, `NEXT_PUBLIC_*`, query string, журналі чи git; потрібне справжнє значення
  секрету (не відкривати `.env.local`, не виводити `process.env`); синхронне очікування воркфлоу
  ≥ 100 с або невідомої тривалості; колбек без підпису / токен у query / «тимчасово вимкнути
  перевірку»; зміна воркфлоу в n8n, експорт/імпорт JSON, код для вузла Code; відповідь n8n чи
  колбек не збігається з контрактом — не підлаштовувати контракт мовчки.
- SHA коміту зі скілом (BASE для Task D): **`ff395fb`** (`skills(n8n): make check-contract catch
  code that ignores the contract names`). Перший коміт скіла — `5fd64c0`; до прогонів скрипт
  посилили (див. нижче «Перевірка на коді з іншими назвами»), тож BASE — другий коміт.
- Що скіл змінив у собі після прогонів (коміти й чому): `18a7ea0 fix(skills/n8n): check-contract
  reads CRLF files` — агент у прогоні B помітив, що C11 «не бачить» ключів, які він щойно додав:
  на Windows-копії (`core.autocrlf=true`) `.env.example` має CRLF, і регулярка рядка не збігалась.
  Стара версія пропускала й справжній токен у такому файлі (перевірено: `N8N_WEBHOOK_TOKEN=real-token`
  з CRLF → C11 PASS до виправлення, FAIL після). Тепер скрипт нормалізує переноси рядків; заодно
  переписано два цикли, на які скаржився ESLint. Код прогонів A і B міряли вже виправленою версією.
  Після рев'ю CodeRabbit (PR #8) — ще три коміти скілів: `cf97b0a` (скрипт: `файл:рядок` для
  кожного FAIL, точніший C8, C7 приймає потокове читання тіла), `e34208f` (шаблони n8n), `e869ccc`
  (патерн форми в `building-client-form`) — див. розділ «Після рев'ю CodeRabbit» наприкінці.

`check-contract.mjs`: Node без залежностей (`node:fs`, `node:path`, `node:child_process`,
`node:util`), 13 перевірок C1–C13 з PASS/FAIL, для FAIL — `файл:рядок`, код виходу 1 при FAIL
(2 — помилка аргументів), `--root`, `--changed-since <ref>` (змінені файли + нові неіндексовані,
у наявних — лише змінені рядки), `--help`. Коментарі в коді перед аналізом прибираються (номери
рядків не зсуваються); `.env.local` скрипт не читає.

**`check-contract.mjs` на коді `main`** (`git archive main | tar -x -C ../leaddesk-main`):

```
$ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs --root ../leaddesk-main; echo "exit=$?"
check-contract: root=…\leaddesk-main files=28
C1   FAIL  No test webhook URL (/webhook-test/) in code or .env.example
       .env.example:6  test URL /webhook-test/
C2   PASS  No N8N_* variable with the NEXT_PUBLIC_ prefix
C3   FAIL  N8N_* env vars (except N8N_CALLBACK_SECRET) are read only in lib/n8n/client.ts
       app/actions.ts:54  N8N_WEBHOOK_URL outside lib/n8n/client.ts
C4   FAIL  lib/n8n/client.ts exists for every n8n call and starts with import 'server-only'
       app/actions.ts:54  n8n call, but lib/n8n/client.ts does not exist
C5   FAIL  Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))
       app/actions.ts:54  fetch without signal/timeout
C6   FAIL  Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id
       app/actions.ts:54  headers missing: x-n8n-token, idempotency-key, x-correlation-id
C7   PASS  Callback route reads the raw body; no .json() / JSON.parse before the signature check (n/a: no callback route found under app/**/route.*)
C8   PASS  Callback signature compared with crypto.timingSafeEqual, never === / !== (n/a: no callback route found under app/**/route.*)
C9   PASS  Callback route checks x-n8n-timestamp and idempotency-key (n/a: no callback route found under app/**/route.*)
C10  PASS  No export const runtime = 'edge'
C11  FAIL  .env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook
       .env.example:1  N8N_WEBHOOK_BASE_URL is missing
       .env.example:1  N8N_WEBHOOK_TOKEN is missing
       .env.example:1  N8N_CALLBACK_SECRET is missing
       .env.example:1  APP_BASE_URL is missing
C12  PASS  No request bodies or personal data in console.* of n8n-related files
C13  FAIL  In "use server" files every n8n call runs inside after() — the user never waits for n8n
       app/actions.ts:54  fetch to n8n is awaited in the Server Action instead of inside after()
Summary: 6 PASS, 7 FAIL
exit=1
```

C13 пояснює 2,43 с відправки форми з бази Task A: дія чекає n8n до відповіді користувачу.

Це збігається з тим, що видно в журналі мока з розділу 0: форма шле `POST` без `x-n8n-token`,
`idempotency-key` і `x-correlation-id` (`auth=none idempotency=absent`), а з `/webhook-test/` із
`.env.example` мок відповідає 404, хоча форма пише «Дякуємо».

**Що скрипт побачив на навмисно поганому коді** (тимчасова тека `../tmp-n8n-bad`: колбек-роут із
`req.json()`, `console.log(body)`, підписом від `JSON.stringify(body)` і порівнянням через `!==`,
`export const runtime = "edge"`; Client Component з `NEXT_PUBLIC_N8N_WEBHOOK_URL` і
`/webhook-test/`; `.env.example` зі справжнім токеном і базою `/webhook-test`):

```
C1   FAIL  … components/quote-button.tsx:3  test URL /webhook-test/ · .env.example:1  test URL /webhook-test/
C2   FAIL  … components/quote-button.tsx:3  NEXT_PUBLIC_N8N_WEBHOOK_URL would be inlined into the client bundle
C3   PASS
C4   FAIL  … components/quote-button.tsx:3  n8n call, but lib/n8n/client.ts does not exist
C5   FAIL  … components/quote-button.tsx:3  fetch without signal/timeout
C6   FAIL  … components/quote-button.tsx:3  headers missing: x-n8n-token, idempotency-key, x-correlation-id
C7   FAIL  … app/api/n8n/cb/route.ts:4  request body parsed with .json() · app/api/n8n/cb/route.ts:3  raw body is never read (.text() / .arrayBuffer() / body.getReader())
C8   FAIL  … app/api/n8n/cb/route.ts:3  no crypto.timingSafeEqual · app/api/n8n/cb/route.ts:8  signature compared with ===/!== (signature … expected)
C9   FAIL  … app/api/n8n/cb/route.ts:3  header x-n8n-timestamp is never read · header idempotency-key is never read
C10  FAIL  … app/api/n8n/cb/route.ts:2  edge runtime is deprecated in Next.js 16 and has no node:crypto
C11  FAIL  … N8N_CALLBACK_SECRET is missing · APP_BASE_URL is missing · .env.example:2  N8N_WEBHOOK_TOKEN must be change-me-... (value not printed) · .env.example:1  N8N_WEBHOOK_BASE_URL must end in /webhook
C12  FAIL  … app/api/n8n/cb/route.ts:5  console.log logs "body"
C13  PASS  (n/a: no n8n calls in "use server" files)
Summary: 2 PASS, 11 FAIL
```

(C3 тут PASS правильно: поганий код читає `NEXT_PUBLIC_N8N_…`, а це ловить C2; C13 — n/a, бо
серверних дій у цьому шматку немає.) Під час цієї перевірки знайшли й виправили в скрипті три
речі: C1 не бачив `/webhook-test` без кінцевого слеша; C7 спрацьовував на коментар
`// never request.json() here`; C12 вважав порушенням `Buffer.byteLength(raw)`, хоча довжину тіла
контракт логувати дозволяє.

**Перевірка на коді з іншими назвами** — те, що міг би написати агент без скіла: `lib/n8n.ts` з
`process.env.N8N_QUOTE_WEBHOOK_URL` і `fetch` без таймауту й заголовків; колбек
`app/api/quotes/callback/route.ts` з `req.json()` і `x-webhook-secret !== process.env.QUOTE_SECRET`;
Server Action, що робить `await startQuote(…)`. Перша версія скрипта (`5fd64c0`) не побачила в цих
файлах **нічого**: знала лише назви з контракту (`N8N_WEBHOOK_*`, `x-n8n-signature`,
`N8N_CALLBACK_SECRET`), а перевірки «Server Action не чекає n8n» не мала. Для A/B це означало б,
що прогін A без скіла отримує менше FAIL, ніж заслуговує. Виправлено в `ff395fb`: C3 — будь-яка
`N8N_*`, крім секрету колбека; колбеком вважається й POST-роут, у шляху чи коді якого є
n8n / webhook / callback / signature / secret (але не роут, що лише запускає воркфлоу); нова C13.
Після виправлення — ті самі три файли:

```
C3   FAIL  lib/n8n.ts:1  N8N_QUOTE_WEBHOOK_URL outside lib/n8n/client.ts
C4   FAIL  lib/n8n.ts:3  n8n call, but lib/n8n/client.ts does not exist
C5   FAIL  lib/n8n.ts:3  fetch without signal/timeout
C6   FAIL  lib/n8n.ts:3  headers missing: x-n8n-token, idempotency-key, x-correlation-id
C7   FAIL  app/api/quotes/callback/route.ts:2  request body parsed with .json() — the signature needs the raw bytes
           app/api/quotes/callback/route.ts:1  raw body is never read (.text() / .arrayBuffer() / body.getReader())
C8   FAIL  app/api/quotes/callback/route.ts:1  no crypto.timingSafeEqual
           app/api/quotes/callback/route.ts:3  signature compared with ===/!== (req.headers.get("x-webhook-secret") … process.env.QUOTE_SECRET)
C9   FAIL  app/api/quotes/callback/route.ts:1  header x-n8n-timestamp is never read · header idempotency-key is never read
C13  FAIL  app/quote-actions.ts:4  startQuote() is awaited in the Server Action instead of inside after()
```

Шаблони скіла після виправлення — як і раніше 0 FAIL (13 PASS); тимчасовий роут, що лише
запускає воркфлоу, колбеком не вважається.

**`check-contract.mjs` на фінальному коді** (після перенесення прогону B — `8c78fdd` — і доведення
`3feee76`, `33fe391`; увесь код, без `--changed-since`):

```
$ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs; echo "exit=$?"
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

**Додатково (за бажанням):** матриця колбеків (`send-signed-callback.mjs`): випадок → очікуваний код → отриманий код.
Перший прогін — на шаблонному колбек-роуті з `references/code-templates.md` у тимчасовій копії:

```
send-signed-callback: POST http://127.0.0.1:3100/api/n8n/quote-request event=quote-request.completed
OK    valid             expected 202, got 202
OK    duplicate         expected 200, got 200
OK    bad-signature     expected 401, got 401
OK    old-timestamp     expected 401, got 401
OK    reformatted-body  expected 401, got 401
OK    key-mismatch      expected 400, got 400
OK    not-json          expected 415, got 415
OK    unknown-event     expected 404, got 404
Summary: 8/8 as expected
```

## Task E3 (бонус) — ті самі скіли в Cursor

Не виконувалось: Cursor у цій роботі не використовували, усі прогони — у Claude Code. Бонус Task E зроблено як E1 — `docs/skill-review-n8n.md`.

## Після рев'ю CodeRabbit (PR #8)

CodeRabbit залишив 13 коментарів і 1 невдалу передмерджеву перевірку («Task C — ⚠️: не кожен FAIL
має файл:рядок»). Кожен коментар звірено з кодом — чинні всі; два (URL документа і `queued` у
Server Action) стосувались лише шаблонів скіла: у перенесеному коді B це вже було.

| # | Коментар | Що зроблено | Коміт |
|---|---|---|---|
| — | Передмерджева перевірка Task C: FAIL без номера рядка | для «цілофайлових» FAIL — рядок обробника `POST` або `:1`; вивід у цьому звіті й у `docs/ab-validation.md` перезнято | `cf97b0a` |
| 1 | Шаблон клієнта повторює помилку конфігурації | env читається до циклу; повтори лише мережа/таймаут/5xx/524 | `e34208f`, код — `8d599e2` |
| 2, 8 | `request.text()` буферизує все тіло до ліміту 64 КБ | `readRawBody`: потокове читання, зупинка після 64 КБ → 413; `callback.md` і `SKILL.md` оновлено | `e34208f`, `8d599e2` |
| 3 | Шаблон ставить `ready` без придатного URL | шаблон = код B (`safeHttpUrl`, інакше `failed`) | `e34208f` |
| 4 | Шаблон Server Action без умови `queued` | шаблон = код B (`updateQuote(id, next, "queued")`) + опис compare-and-set | `e34208f` |
| 5 | C8 пропускає `===` у рядках з `.length`/`null` | перевіряються операнди кожного `===`/`!==`; запропонований у коментарі варіант не ловив `req.headers.get("x-webhook-secret") !== process.env.QUOTE_SECRET` — операндом тепер може бути й виклик | `cf97b0a` |
| 6 | `LeadActions` ігнорує результат дії | відкат оптимістичного статусу / лишитись на сторінці + повідомлення `role="alert"` | `52e457a` |
| 7 | Дії лідів повертають `ok`, хоча БД не знайшла лід | перевіряється результат `db.updateLeadStatus` / `db.deleteLead` | `52e457a` |
| 9 | Виняток у `after()` лишає кошторис у `queued` | `try/catch` → `failed`; клієнт повертає `misconfigured` без винятку | `8d599e2` |
| 10 | Нотатка: текст зникає після `error`; `defaultValue` ненадійний | `values` у кожному стані помилки, контрольована `textarea`, очищення лише після `ok`; патерн скіла виправлено | `e000dfe`, `e869ccc` |
| 11 | Кошторис: значення зникають після `invalid`; помилки не прив'язані до полів | `values` у стані, контрольовані поля, `label`/`htmlFor`, `aria-invalid`, `aria-describedby`, підсумок `role="alert"` | `e000dfe` |
| 12 | E1: Basic Auth дає 401 і на неправильні дані | уточнено (рядки 285 і 304; Bearer — 403, рядок 320) | цей коміт документів |
| 13 | E1: висновок про ключ Crypto неточний | переписано: пакет радить `httpCustomAuth` + вхід sub-workflow; для Crypto v2 це зайво й гірше | цей коміт документів |

Під час перевірки знайшлась ще одна помилка, про яку CodeRabbit не писав: React 19 перед кожною
дією форми викликає `requestFormReset` (видно в `react-dom-client.production.js`), і контрольований
`<select>` після цього лишається на першій опції — бюджет зникав навіть з контрольованими полями.
Форма кошторису тепер з JS відправляється через `onSubmit` + `startTransition(() => formAction(fd))`
(без автоматичного скидання), атрибут `action` лишився для шляху без JS.

Як перевірено (продакшн-збірка, мок `--mode respond-202 --delay 5000`):

| Перевірка | Результат |
|---|---|
| `npm run lint`, `npm run build`, `check-contract.mjs` на всьому коді | без помилок, 13 PASS / 0 FAIL |
| `check-contract`: `main` / поганий код / приклад «як A» / прогін A / прогін B / шаблони | 7 / 11 / 10 / 9 / 0 / 0 FAIL — як і до правок; нове C8 — див. під таблицею |
| Колбек: тіло 70 КБ | 413 `payload too large` (читання зупинено) |
| Колбек: невеликий непідписаний | 401 |
| Матриця `send-signed-callback.mjs` на гілці (ключ реального кошторису) | 8/8 |
| Кошторис з JS: погана адреса email | помилка під полем (`aria-invalid`, `aria-describedby`), підсумок `role="alert"`; компанія, опис і бюджет `1500` на місці |
| Кошторис з JS: виправлений email | відповідь за 146 мс → «У черзі» → колбек → «Готово» з PDF; бюджет «1 500 USD / міс.» |
| Кошторис без JS (`multipart` POST) з поганими даними | сервер повернув усі чотири значення, `aria-invalid` ×2, `role="alert"` |
| Нотатка: `leadId` підмінено на чужий лід | «Не вдалося зберегти нотатку», текст у полі лишився |
| Нотатка: свій лід | «Нотатку додано», поле очистилось, нотатка на сторінці |
| Лід видалено «в іншій вкладці», потім зміна статусу | повідомлення «Не вдалося змінити статус…», статус відкотився |

Нове C8 на тестовому роуті ловить `sig === expected || sig == null` і порівняння заголовка з
env-змінною (`req.headers.get("x-webhook-secret") !== process.env.QUOTE_SECRET`), але не чіпає
перевірок `.length`, `null` і `typeof`.

Не перевірено вживу: шлях `misconfigured` (застосунок без `N8N_WEBHOOK_TOKEN`) — для цього треба
змінити `.env.local`; перевірено лише типами й кодом.

### Другий раунд (рев'ю комітів `3cd15c1..ca0b1f4`)

Передмерджева перевірка Task C після першого раунду — ✅. Нове: 5 коментарів і ⚠️ у Task D. Усі чинні.

| # | Коментар | Що зроблено | Коміт |
|---|---|---|---|
| — | Task D: клієнт читає й парсить тіло відповіді n8n (`job_id`), хоча контракт — лише код статусу; колбек без `data.requestIdempotencyKey` дає 500 замість 400 | тіло відповіді не читається (`response.body?.cancel()`), `jobId` приходить лише в колбеку; `requestIdempotencyKey` обов'язковий у `parseCallback` → 400 зі звільненням ключа | `cb37e1d`, шаблони — `d94b1dd` |
| 1 | `LeadActions` не обробляє відхилення (виняток) серверної дії | `try/catch` в обох переходах: відкат статусу / повідомлення | `e8a2e02` |
| 2 | Без JS після успіху форми кошторису немає шляху до заявки | у стані `ok` — посилання «Відкрити статус запиту» на `/quotes/<id>` | `b22c4d0` |
| 3 | Оператор «або» (дві вертикальні риски) у клітинці таблиці ламає Markdown (MD056) | вираз винесено з таблиці в абзац | цей коміт документів |
| 4 | Workflow з колбеком стартує без `N8N_CALLBACK_SECRET` → колбек 401, запис «висить» у `processing` | `readConfig` вимагає ще й секрет, коли `withCallback` | `cb37e1d`, `d94b1dd` |
| 5 | Після помилки повертається обрізана до 120 символів назва компанії | задовге введення — помилка поля, а не мовчазне обрізання; `values` — повне введення | `b22c4d0` |

Як перевірено (продакшн-збірка, мок `--mode respond-202 --delay 5000`):

| Перевірка | Результат |
|---|---|
| `npx eslint .`, `npm run build`, `check-contract.mjs` на всьому коді | без помилок, 13 PASS / 0 FAIL |
| `check-contract`: `main` / поганий код / прогін A / прогін B | 7 / 11 / 9 / 0 FAIL — без змін |
| Підписаний колбек без `requestIdempotencyKey` | 400 `{"error":"bad request"}` |
| Матриця `send-signed-callback.mjs` (ключ реального кошторису) | 8/8 |
| Кошторис з JS | 142 мс → «Готуємо кошторис» → колбек `-> 202` → «Готово» з PDF; у журналі мока `POST /webhook/quote-request -> 202 … auth=ok idempotency=new` |
| Кошторис без JS, назва 130 символів + поганий email | повна назва повернулась, «Не довше 120 символів», бюджет `1500` на місці |
| Кошторис без JS, валідні дані | «Запит прийнято» + посилання `/quotes/q_…`; сторінка за посиланням — 200, «Готово» |

### Третій раунд (рев'ю комітів `ca0b1f4..d0fb856`)

Усі 11 передмерджевих перевірок — ✅ (зокрема Task C і Task D). Один коментар, чинний:

| Коментар | Що зроблено | Коміт |
|---|---|---|
| Для воркфлоу з колбеком успіхом рахується будь-який 2xx; 200 означає, що Respond to Webhook не спрацював і колбека не буде — заявка «зависає» в `processing` | з `withCallback` успіх — лише 202; інший 2xx → `no-callback`, запис одразу `failed`, без повторів; події без колбека (`lead-created`) і далі приймають будь-який 2xx. `SKILL.md`, `contract.md` і шаблон оновлено | `58ceb52`, скіл — `8b851e5` |

Як перевірено (продакшн-збірка): мок `--mode respond-202` → кошторис «Готуємо кошторис» → через 5 с
«Готово»; мок у режимі Immediately (відповідь 200) → `[n8n] -> quote-request status=200 attempt=1`, кошторис
за 1 с «Не вдалося», повторів немає; форма ліда з тим самим моком → `lead-created status=200`, «Дякуємо!»;
`npx eslint .`, `npm run build`, `check-contract.mjs` — без помилок, 13 PASS / 0 FAIL.

Помічено під час перевірки: мок у режимі Immediately однаково надсилає підписаний колбек, і він
переводить уже `failed` кошторис у `ready`. Так і лишили свідомо: 200 означає «на колбек не
розраховуємо», але справжній підписаний результат, якщо він усе ж прийшов, краще прийняти, ніж загубити.

