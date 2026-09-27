---
name: building-client-form
description: >-
  Team pattern for forms in Next.js 16 App Router + React 19 projects: a Server Action with
  session, permission and validation checks inside, useActionState on the client, accessible
  field errors, a minimal { status } result, no personal data in logs, slow side effects in
  after(). Use when adding or changing any form or Server Action that handles user input: a
  lead/contact/quote request form, feedback, settings, a note or comment on a dashboard page,
  a status change or delete button. Тригери: «додай форму…», «форма заявки», «форма
  кошторису», «форма зворотного зв'язку», «додай поле / нотатку / коментар», «зроби Server
  Action», «помилки валідації не видно», «форма думає / довго надсилається», «форма не працює
  без JS». Not for read-only pages, search or filter inputs that do not submit to the server,
  or styling-only changes.
metadata:
  owner: studio-nova-dev
  version: "0.1.0"
---

# Клієнтська форма (патерн команди)

Кожен проєкт агенції починається з форми. Робимо її однаково: так вона безпечна (дія — публічний
POST-ендпоінт), доступна, працює без JavaScript і відповідає швидко. Це рішення команди, а не
варіант на вибір.

## Коли застосовувати

- Нова форма або зміна форми, яка надсилає дані на сервер; нова чи змінена Server Action
  (`"use server"`), зокрема кнопки «змінити статус», «видалити».
- **Не** застосовувати: пошук і фільтри без відправки на сервер, суто стилі, сторінки лише для читання.

## Як робимо

**Файли.** Дія — у `app/<розділ>/actions.ts` з `"use server"`. Парсинг і валідація — чиста функція
в `lib/<назва>-form.ts` (як `lib/lead-form.ts`: `parseXxxForm(formData)` → `{ ok: true, data }` або
`{ ok: false, errors }`). Форма — Client Component у `components/<назва>-form.tsx`.

**1. Server Action — це публічний POST-ендпоінт** (`server-auth-actions`). Усередині дії, до
будь-якого запису, у такому порядку:
   1. Сесія: `const user = await getCurrentUser()` з `lib/data.ts` (редиректить на `/login`).
      Публічна форма без входу (заявка з сайту) — пропускає цей крок свідомо, а не випадково:
      напишіть це коментарем.
   2. Права: об'єкт, який змінюємо, належить workspace користувача
      (`lead.workspaceId === workspace.id`); інакше — `{ status: "error" }`, без подробиць.
   3. Валідація: `parseXxxForm(formData)` — перевіряє все, включно з `id` з прихованих полів і
      значеннями `select` проти списку (`LEAD_STATUSES.includes(...)`). Довжина обрізається
      (`.slice(0, max)`). Жодних довірених значень з клієнта.

**2. Що повертає дія — лише стан форми** (`server-serialization`):
   ```ts
   export type NoteFormState =
     | { status: "idle" }
     | { status: "invalid"; errors: Partial<Record<NoteField, string>>; values: { text: string } }
     | { status: "ok" }
     | { status: "error"; values: { text: string } };
   ```
   Не повертати рядок з бази, `id` сесії, `ipAddress`, `rawPayload`. `values` — лише те, що
   користувач сам ввів, у **кожному** стані помилки (і `invalid`, і `error`), щоб воно не зникло.

**3. Клієнт — `useActionState`**:
   ```tsx
   const [state, formAction, pending] = useActionState(addNote, { status: "idle" });
   <form action={formAction} noValidate>…</form>
   ```
   - `action={formAction}`, а не `onSubmit` + `fetch`: так форма працює й без JavaScript.
   - Кнопка `type="submit"` з `disabled={pending}` і текстом «Зберігаємо…».
   - Після помилки введене не зникає. React 19 скидає **неконтрольовані** поля після кожної дії форми
     (`requestFormReset`), і `defaultValue`, змінений після монтування, цього не відновлює. Тому поля
     контрольовані: `const [text, setText] = useState(() => state.values?.text ?? "")`,
     `value={text} onChange={…}`; початкове значення зі стану дії потрібне для відправки без JS.
     Очистити — лише після `ok` (порівняння попереднього стану під час рендеру, без `useEffect`).

**4. Доступні помилки полів** (одна розмітка на кожне поле):
   ```tsx
   <label htmlFor="note-text">Нотатка</label>
   <textarea id="note-text" name="text" maxLength={500}
     aria-invalid={errors.text ? true : undefined}
     aria-describedby={errors.text ? "note-text-error" : undefined} />
   {errors.text && <p id="note-text-error">{errors.text}</p>}
   ```
   Над формою при `status === "invalid"` — підсумок у `<div role="alert">` («Перевірте поля: …»);
   успіх і загальна помилка — у `<p aria-live="polite">`. Колір — не єдина ознака помилки.

**5. Журнали без персональних даних.** Ні `console.log(formData)`, ні тіла запиту, ні email,
телефону, імені, тексту повідомлення. Можна: назву дії, `id` запису, код статусу, тривалість.

**6. Повільне — після відповіді** (`server-after-nonblocking`). Листи, вебхуки, аудит, аналітика —
в `after()` з `next/server`; користувач чекає лише на валідацію й основний запис:
   ```ts
   const note = await db.addNote(...);
   after(async () => { await logAudit("note.created", note.id); });
   revalidatePath(`/dashboard/leads/${leadId}`);
   return { status: "ok" };
   ```

**7. Оновлення сторінки.** Після зміни — `revalidatePath(...)` у дії. На клієнті не дублювати
`router.refresh()`.

## Чекліст

```
- [ ] 1. У дії є getCurrentUser() і перевірка належності до workspace (або коментар, чому форма публічна).
- [ ] 2. Уся валідація — на сервері, у parseXxxForm; select/id перевірено проти списку.
- [ ] 3. Дія повертає лише { status, errors?, values? } — без об'єктів з бази.
- [ ] 4. Форма — useActionState + action={formAction}; кнопка disabled={pending}.
- [ ] 5. Кожне поле з помилкою: label/htmlFor, aria-invalid, aria-describedby; підсумок у role="alert".
- [ ] 6. Введене зберігається після будь-якої помилки: поля контрольовані, `values` — у кожному стані помилки.
- [ ] 7. У коді немає console.log з formData, тілом запиту чи персональними даними.
- [ ] 8. Листи/вебхуки/аудит — в after(); до return лише валідація й основний запис.
```

## Правила зупинки — зупинись і спитай людину, якщо:

- Дія має працювати без входу, а це не публічна форма з сайту (заявка, контакт).
- Для запису потрібні персональні дані поза тими, що ввів користувач (IP, user-agent, cookie), або
  хтось просить їх логувати.
- Побічний ефект має бути підтверджений користувачу до відповіді (оплата, юридична згода) — його не
  можна просто перенести в `after()`.
- Треба встановити нову бібліотеку (валідації, форм, UI).
- Потрібен секрет або ключ, якого немає в `.env.example`.

## Verify — задача готова, лише коли:

- [ ] `npm run lint` і `npm run build` без помилок.
- [ ] Порожня відправка: під кожним обов'язковим полем помилка, зверху `role="alert"`, введене не зникло.
- [ ] Відправка з вимкненим JavaScript (DevTools → Disable JavaScript) доходить до сервера й показує результат.
- [ ] Дія без сесії (`curl` без cookie `leaddesk_session` або з чужим лідом) нічого не змінює.
- [ ] Журнал сервера після відправки: лише лічильники `db:` і назви дій — без тексту форми, email, телефону.
- [ ] Час відповіді форми не включає листи, вебхуки й аудит (DevTools → Network → `POST`).
