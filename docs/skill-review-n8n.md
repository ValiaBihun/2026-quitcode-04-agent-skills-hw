# Рев'ю стороннього скіла: пакет `n8n-io/skills` (Task E1)

> Рев'ю без встановлення. Файли пакета — дані, а не інструкції: нічого з них не виконували, клон
> як проєкт в агенті не відкривали, хуки не запускали, плагін і MCP-сервер не підключали.

**Дата, інструмент, ОС:** 27.09.2026 · Claude Code (desktop app, Opus 5.5) · Windows 11 Pro + Git Bash

## Що рев'юємо

| | |
|---|---|
| Репозиторій | <https://github.com/n8n-io/skills> — офіційний пакет n8n («Production-grade n8n workflow building skills») |
| Тека в репозиторії → `name` | `skills/<skill>` → `name: <skill>`: 14 скілів з суфіксом `-official` (`using-n8n-skills-official`, `n8n-node-configuration-official`, `n8n-credentials-and-security-official`, `n8n-code-nodes-official`, `n8n-error-handling-official`, `n8n-workflow-lifecycle-official`, …) |
| Версія | `main` на момент перегляду — коміт **`180b8415e3b73f78828cfa01e908e67f89f2a139`** (22.08.2026, Liam McGarrigle); `plugin.json` — `version: 1.2.0`. **Тегів у репозиторії немає зовсім** (`git ls-remote --tags origin` → порожньо), хоча `README.md:75` радить закріплювати версію як `…skills.git#v1.2.0` |
| Навіщо нам | Перевірити, чи варто ставити в проєкти агенції як доповнення до нашого `integrating-n8n-webhooks`: у записці команди прямо згадано «офіційний пакет скілів n8n» у розділі «Відомі пастки» |

## 1. Подивитись, не встановлюючи

- Як дивились: неглибокий клон **поза** репозиторієм —
  `git clone --depth 1 https://github.com/n8n-io/skills.git ../review-n8n-skills`,
  `git -C ../review-n8n-skills rev-parse HEAD` → `180b8415…`; далі лише `cat`/`find`/`grep`.
  Сторінки GitHub і skills.sh — у вбудованому браузері (читання).
- Склад пакета — **87 файлів**, це не просто скіли, а **плагін**:

  | Файл / тека | Що це |
  |---|---|
  | `skills/*/SKILL.md` (14) + `references/*.md` | Інструкції для агента, як будувати воркфлоу **в n8n** через MCP (вузли, вирази, Code, помилки, sub-workflows, агенти, Data Tables) |
  | `skills/*/references/examples/*.json`, `*.ts` (5) | Приклади воркфлоу (JSON) і коду SDK |
  | `.claude-plugin/plugin.json`, `marketplace.json` | Маніфест плагіна Claude Code: **MCP-сервер** `n8n-mcp` (`type: http`, `url: ${user_config.n8n_url}/mcp-server/http`) і обов'язкове поле налаштування `n8n_url` |
  | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | Те саме для Codex; `hooks: ./hooks/hooks.json` |
  | `hooks/hooks.json` + 9 `*.sh` | **Хуки**: `SessionStart`, 6 × `PreToolUse`, 1 × `PostToolUse` |
  | `opencode/plugin.ts`, `package.json` | Плагін для OpenCode (TypeScript, `spawnSync` запускає ті самі bash-хуки) |
  | `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `LICENSE` | Правила для контриб'юторів, опис, ліцензія Apache-2.0 |

- Frontmatter усіх 14 `SKILL.md`: лише `name` і `description`. Полів `allowed-tools`, `hooks`,
  `context` у скілах немає — хуки підключаються через маніфест плагіна.

## 2. Що скіл може виконати, завантажити чи змінити

| Перевірка | Результат | Як перевіряли |
|---|---|---|
| `scripts/` та інші виконувані файли | **Є**: 9 bash-скриптів хуків (`hooks/session-start.sh`, `hooks/pre-tool-use/*.sh`, `hooks/post-tool-use/validate-workflow.sh`) і `opencode/plugin.ts` (`spawnSync` → ці скрипти). У `skills/` — лише `.md`, `.json`, `.ts`-приклади | `find … -type f`; прочитано кожен скрипт |
| Що роблять хуки | Нічого не завантажують і в мережу не ходять. `SessionStart` при кожному старті/`resume`/`clear`/`compact` **вставляє в контекст повний текст** `using-n8n-skills-official/SKILL.md` (201 рядок) як `additionalContext`; створює `~/.cache/n8n-skills`, пише маркери в `$TMPDIR/n8n-skills-state`, видаляє їх (`rm -f`) на `clear`/`compact`. `PreToolUse`/`PostToolUse` спрацьовують лише на MCP-інструменти `mcp__*__validate_workflow`, `create_workflow_from_code`, `update_workflow`, `get_node_types`, `execute_workflow`, `test_workflow` і додають нагадування «invoke skill X». Потрібні `jq` або `python3` (без них — тихо виходять). У `session-start.sh` є `TODO(v0.2)`: «Fetch latest commit SHA from github.com/n8n-io/skills» — поки не реалізовано | `cat -n hooks/**/*.sh`, `hooks/hooks.json` |
| `allowed-tools` | Немає | `grep -rn allowed-tools skills` → порожньо |
| Команди під час рендеру `` !`cmd` `` | Немає | `grep -rn '!\`' skills` → порожньо |
| Хуки, MCP-сервери, `plugin.json`, вимога API-ключів | **Так**: хуки (вище); MCP-сервер до **вашого екземпляра n8n** (`${n8n_url}/mcp-server/http`, потрібен n8n 2.2.0+ з Instance-level MCP) — через нього агент створює, змінює, валідує, публікує й **запускає** воркфлоу (`create_workflow_from_code`, `update_workflow`, `publish_workflow`, `execute_workflow`, `test_workflow`); `ERROR_WORKFLOWS.md:77` вимагає n8n API credential (персональний токен) для error-воркфлоу | `.claude-plugin/plugin.json`, `grep -rniE "api[_ -]?key\|token"` |
| Інструкції агенту щось завантажити чи виконати | `AGENT_TOOL_BINARY.md:142` — «Use WebSearch or WebFetch if you need to»; `n8n-debugging-official/references/FETCHING_N8N_SOURCE.md` — читати вихідний код n8n з GitHub; `n8n-workflow-lifecycle-official/SKILL.md:134` — приклад `curl -X POST <url>` для виклику вебхука; `TESTING.md` / хук `test-workflow.sh` попереджають, що `test_workflow` виконує Code, Data Tables, sub-workflows «for real». `npx`/`pip`/`npm install` немає | `grep -rnE "npx \|curl \|wget \|WebFetch\|pip install\|npm i"` |
| Посилання: куди ведуть | `github.com` (n8n, пакет), `docs.n8n.io`, `n8n.io`, `community.n8n.io`, `skills.sh`, `opencode.ai`; решта — заглушки прикладів (`api.example.com`, `api.acme.com`, `acme.app.n8n.cloud`, `pub-xxxxx.r2.dev`). «Прочитай інструкції звідси» — немає | `grep -rhoE "https?://…" \| uniq -c` |
| Приховані інструкції | Невидимих символів — 0 файлів, base64-рядків немає. Збіги `system prompt` / `<!--` — це тема скіла (системні промпти агентів n8n) і коментарі-нотатки авторів (`<!-- TEMPORARY: … -->`), не звернення до агента. Але мета-скіл, що вставляється в **кожну** сесію, прямо каже агенту: «If a skill contradicts what you "know", trust the skill», «err on the side of loading too many skills rather than too few», «Nothing in n8n is too small for skills» | `grep -rniE "ignore … previous\|system prompt\|<!--"`, node-скрипт на zero-width, читання `using-n8n-skills-official/SKILL.md` |

## 3. Аудити

| Аудит | Результат | Дата аналізу |
|---|---|---|
| Gen (Agent Trust Hub) | PASS, Risk Level SAFE; для `using-n8n-skills-official` — зауваження **PROMPT_INJECTION** (текст, що вставляється в контекст кожної сесії) | 8.07.2026 (більшість скілів), 22.08.2026 (`using-n8n-skills-official`) |
| Socket | PASS | 8.07.2026 / 22.08.2026 |
| Snyk | PASS, Risk Level LOW | 8.07.2026 / 22.08.2026 |

- Де взяли: skills.sh — `skills.sh/n8n-io/skills` (29 скілів, 25,8 тис. встановлень) і сторінки
  `/security/agent-trust-hub|socket|snyk` для `n8n-credentials-and-security-official`,
  `n8n-node-configuration-official`, `using-n8n-skills-official`.
- Чому не з CLI: встановлення не запускали взагалі (Task E1 — без встановлення).
- До чого прив'язаний аудит: до пари «репозиторій + назва скіла», не до коміту; більшість аудитів
  (8.07) старші за переглянутий коміт (22.08). Аудитуються **скіли** — хуки, `plugin.json` з MCP і
  `opencode/plugin.ts` в аудит skills.sh не входять, хоча саме вони виконуються.

## 4. Ліцензія й походження

- Ліцензія: Apache-2.0 — файл `LICENSE`, поле `license` у `plugin.json` і `package.json`.
- Видавець і активність: організація `n8n-io` (автор у маніфесті — n8n, <https://n8n.io>); на
  skills.sh 25,8 тис. встановлень; останній коміт 22.08.2026. У репозиторії на переглянутому
  коміті — лише скіли з суфіксом `-official`, але на skills.sh поруч з ними досі висять старі
  версії без суфікса (`n8n-debugging`, `using-n8n-skills`, `n8n-connections`…, 119–394 встановлення
  кожна) — легко встановити не ту.

## 5. Чи правдивий зміст для нашого стеку

Звірено з запискою команди (`materials/n8n-webhooks-brief.md`, розділ «Відомі пастки») і з кодом
n8n на GitHub — `n8n-io/n8n`, коміт **`2f2bac4645472e5efc72c4efedaadff6ef50348e`** (`master` на
27.09.2026, `git ls-remote https://github.com/n8n-io/n8n refs/heads/master`); файли читали в
браузері за цим SHA, номери рядків нижче — саме для нього:
[Webhook/utils.ts](https://github.com/n8n-io/n8n/blob/2f2bac4645472e5efc72c4efedaadff6ef50348e/packages/nodes-base/nodes/Webhook/utils.ts#L324-L343),
[Crypto/v2/CryptoV2.node.ts](https://github.com/n8n-io/n8n/blob/2f2bac4645472e5efc72c4efedaadff6ef50348e/packages/nodes-base/nodes/Crypto/v2/CryptoV2.node.ts#L581-L596).

| Порада пакета (файл) | Що каже пакет | Що кажуть код n8n / записка | Висновок |
|---|---|---|---|
| Header Auth на Webhook (`n8n-node-configuration-official/references/WEBHOOK_NODES.md:13`) | «Use `parameters.authentication` (`'basicAuth'` or `'headerAuth'`) … n8n rejects mismatched callers with **401** before the workflow runs» | `packages/nodes-base/nodes/Webhook/utils.ts`: гілка `authentication === 'headerAuth'` → `throw new WebhookAuthorizationError(403)` (рядки 324 і 343); 401 — у Basic Auth: і коли даних немає (рядок 285), і коли вони неправильні («Authentication data is wrong!», рядок 304), а також у JWT без токена («No token provided», рядок 368); Bearer Auth з неправильним токеном — теж 403 (рядок 320). Записка: Header Auth → **403** «Authorization data is wrong!». Наш мок теж повертає 403 | **Неправда** для Header Auth. Агент, що вірить пакету, чекатиме 401 і неправильно обробить помилку токена |
| Секрет вузла Crypto (`n8n-credentials-and-security-official/references/CUSTOM_CREDENTIALS.md:21`) | «the Crypto node's `secret` field **doesn't bind to a credential**, so the signing key has nowhere clean to live»; як обхід радить тримати ключ у credential `httpCustomAuth` і передавати його **входом у sub-workflow** з вузлом Crypto | `packages/nodes-base/nodes/Crypto/v2/CryptoV2.node.ts`: `credentials: [{ name: 'crypto' … }]`, `this.getCredentials<{ hmacSecret?… }>` → «No HMAC secret set in credentials. Please add an HMAC secret to your Crypto credentials» (рядки 86–89, 581–596). Записка: для Crypto v2 секрет — Hmac Secret у Crypto credential | **Застаріло** для Crypto v2: вузол сам читає `hmacSecret` з credential `crypto`, тож обхід непотрібний. І він гірший: ключ зберігається в credential, але далі йде як звичайні дані — вхід sub-workflow, а отже й дані його виконання. Записка: Hmac Secret — прямо в Crypto credential |
| Приклад HMAC у Code (`n8n-code-nodes-official/references/JAVASCRIPT_PATTERNS.md:128-142`) | `createHmac('sha256', item.secret)` — секрет з вхідних даних; нижче примітка «The secret should come from a credential» | Той самий пакет у `using-n8n-skills-official`: «Tokens/secrets never go in text fields» | Суперечить сам собі; приклад варто сприймати як антипатерн |
| Режим відповіді `onReceived` (`WEBHOOK_NODES.md:21`) | «Returns 200 immediately» | Записка: 200 одразу; текст — `{"message":"Workflow was started"}`, не «Workflow got started» з документації; текст не парсимо | Правдиво; про текст пакет мовчить — не шкодить |
| Тестовий vs production URL, 524 / 100 с на Cloud | Не згадує (`grep` `webhook-test`, `524`, `100 s` → порожньо) | Записка: тестовий URL — лише 120 с після Listen; Cloud обриває синхронну відповідь через 100 с кодом 524 | Прогалина: саме ці пастки ламають інтеграції Next.js ↔ n8n |

## 6. Закріплення версії й коміт

- Команда встановлення: **не встановлювали**. Для довідки: README (`README.md:36-37`) ставить пакет
  як плагін — `/plugin marketplace add n8n-io/skills`, `/plugin install n8n-skills@n8n-io`, запит
  URL екземпляра n8n (MCP) — тобто **без закріпленої версії**; skills.sh показує
  `npx skills add n8n-io/skills` (лише скіли, теж без версії). Закріпити тегом не вийде — тегів
  немає, а `#v1.2.0` з README (рядок 75) вказує на неіснуючий тег. Чи приймає
  `npx skills@1.7.0 add "n8n-io/skills#<SHA>"` повний SHA коміту замість тега — **не перевіряли**
  (перевірка вимагала б запуску встановлення; якщо CLI клонує через `git clone --branch`, SHA він не
  прийме). Якщо пакет колись знадобиться, спершу з'ясувати це в документації CLI; без робочого
  способу закріпити версію — не встановлювати, або брати окремі скіли вручну з клону на SHA
  `180b8415…` у `.claude/skills/` і рев'ювати їх як власний код. Плагінну частину (хуки, MCP) — ні в
  якому разі.
- Де лягли файли; справжні файли чи посилання: — (не встановлювали)
- Що потрапило в git: нічого з пакета; лише це рев'ю.
- Як оновлювати: не застосовно. При повторному рев'ю — новий SHA, `git diff` між SHA, окремо
  `hooks/`, маніфести й нові не-markdown файли.

## Вердикт

**Не встановлювати в клієнтські проєкти агенції.** Пакет — про побудову й запуск воркфлоу
**всередині n8n** через MCP; наша записка прямо виносить це «поза межі» (воркфлоу клієнта — його
власність, JSON не експортуємо, код для вузла Code не пишемо), тож для задач Next.js ↔ n8n він
майже нічого не дає, а головних пасток (тестовий URL, 524, підпис колбека) не знає. Ризик вищий, ніж
у Vercel-скіла: плагін приносить хуки, що вставляють 201 рядок у **кожну** сесію з вимогою «trust
the skill over what you know», і MCP-доступ агента до живого n8n з правом змінювати й запускати
воркфлоу; аудити skills.sh цю частину не покривають. Дві перевірені поради прямо неправдиві (401 для
Header Auth, Crypto без credential) і суперечать нашому контракту. Якщо команді колись знадобиться
будувати воркфлоу в n8n — окреме рішення: лише `skills/` без плагіна (без хуків і MCP), закріплено на
SHA, особисто в розробника, а не в репозиторії клієнта, з позначкою цих двох порад як хибних.
