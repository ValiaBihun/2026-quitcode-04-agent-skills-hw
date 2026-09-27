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
| `building-client-form` | | |
| `integrating-n8n-webhooks` | | |

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

Рев'ю зроблено в новій сесії запитом з інструкції («Зроби рев'ю app/, components/, lib/ за скілом
vercel-react-best-practices… Файли не змінюй.») — 17 рядків таблиці з id правил. Застосовано два:

| Правило (id) | Коміт | Файли | Що змінилось | Було (`main`) | Стало | Як міряли |
|---|---|---|---|---|---|---|
| `async-parallel` | `948412b` | `app/dashboard/page.tsx` | `getLeads`, `getLeadStats`, `getSourceBreakdown` залежать лише від `workspace.id` — тепер ідуть разом через `Promise.all` замість трьох послідовних `await` | TTFB `/dashboard` **2,27 с** (2,262–2,280, 5 прогонів) | **1,44 с** (1,429–1,449, 5 прогонів) | `curl` вище, продакшн-збірка, після кожної збірки — перезапуск `npm start` |
| `server-cache-react` | `f1684de` | `lib/data.ts` + 4 місця виклику `getWorkspace` | `getCurrentUser` загорнуто в `cache()`; `getWorkspace` приймає рядок `slug` замість нового об'єкта `{ slug }`, з яким кеш ніколи не збігався (`Object.is`) | `db:` на один `GET /dashboard`: `getUserBySession` ×3, `getWorkspace` ×3 | ×1 і ×1 | (без заміру часу) приріст лічильників `db:` у журналі `npm start` за один `curl` |

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
- Поради скіла, звірені з документацією Next.js 16 і **поки не** застосовані:
  - `server-after-nonblocking` для форми — `after()` у Next.js 16 є (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`),
    але виклик n8n з форми за інструкцією переробляємо за контрактом у Task D; зараз не чіпаємо,
    щоб не змішувати зміни;
  - `bundle-dynamic-imports` для `recharts` / `exceljs` — застосовна (`next/dynamic` і `import()` у
    клієнтському компоненті), лишили на потім: двох виправлень для Task A досить;
  - `server-auth-actions` (`app/actions.ts:68-77`, дії без перевірки сесії) — справжня діра, але це
    патерн форми з Task B; окремо фіксуємо тут як знахідку.
- Якщо виміряне виправлення не змінило чисел — змінило: 2,27 с → 1,44 с.
- `npm run lint`, `npm run build` після кожного виправлення: без помилок.

## Task B — `building-client-form`

- Запит у свіжій сесії (скіл не названо):
  > <запит>
- Чи спрацював скіл і як це видно: <виклик `Skill` з `building-client-form` / читання `SKILL.md` / ні>
- Якщо не з першого разу — що змінили в `description`, і результат другої спроби: <…>
- Що зроблено (файли): <…>
- Пункти Verify зі скіла — результат кожного: <…>

## Task C — `integrating-n8n-webhooks`

Тут скіл лише пакують. Застосовує його агент у прогоні **B** (Task D) — доказ спрацювання, журнал
мока й час відповіді форми — у `docs/ab-validation.md`.

- Що лишили в `SKILL.md`, а що винесли в `references/` (і чому): <…>
- Правила зупинки — перелік: <…>
- SHA коміту зі скілом (BASE для Task D): <…>
- Що скіл змінив у собі після прогонів (коміти й чому): <… або «нічого»>

**`check-contract.mjs` на коді `main`** (id + PASS/FAIL, код виходу):

```
<вивід>
```

**За бажанням: що скрипт побачив на навмисно поганому коді** (яку перевірку ламали, що вона
сказала). До рубрики це не входить, але бали знімає скрипт, який завжди PASS:

```
<вивід>
```

**`check-contract.mjs` на фінальному коді** (після перенесення прогону B — 0 FAIL):

```
<вивід>
```

**Додатково (за бажанням):** матриця колбеків (`send-signed-callback.mjs`): випадок → очікуваний код → отриманий код.

## Task E3 (бонус) — ті самі скіли в Cursor

- Версія Cursor, модель: <…>
- Які скіли Cursor побачив: <…>
- Ті самі запити, що в Task B, і запит із `materials/ab-task.md`: спрацювали скіли чи ні: <…>
- Чим поведінка відрізнялась від Claude Code: <…>
