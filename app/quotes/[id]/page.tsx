import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteStatusRefresh } from "@/components/quote-status-refresh";
import { db } from "@/lib/db";
import type { QuoteStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Статус кошторису — Studio Nova", robots: { index: false } };

const dateTimeFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" });
const usd = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STATUS_VIEW: Record<QuoteStatus, { label: string; hint: string; className: string }> = {
  queued: {
    label: "У черзі",
    hint: "Запит прийнято, передаємо його на підготовку.",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  processing: {
    label: "Готуємо кошторис",
    hint: "Зазвичай це займає до двох хвилин. Сторінка оновиться сама.",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  ready: {
    label: "Готово",
    hint: "Кошторис готовий.",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  failed: {
    label: "Не вдалося",
    hint: "Не вдалося підготувати кошторис автоматично. Менеджер зв'яжеться з вами на вказаний email.",
    className: "bg-red-50 text-red-700 ring-red-200",
  },
};

export default async function QuotePage({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  const quote = await db.getQuote(id);
  if (!quote) notFound();

  const view = STATUS_VIEW[quote.status];
  const inProgress = quote.status === "queued" || quote.status === "processing";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Studio Nova
          </Link>
          <Link href="/quotes/new" className="text-sm text-slate-500 hover:text-slate-900">
            Новий запит
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-6 py-12">
        {inProgress && <QuoteStatusRefresh />}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Кошторис для {quote.company}</h1>
            <p className="text-sm text-slate-500">Запит від {dateTimeFormat.format(new Date(quote.createdAt))}</p>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${view.className}`}
          >
            {view.label}
          </span>
        </div>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm" aria-live="polite">
          <p className="text-slate-700">{view.hint}</p>
          {quote.status === "ready" && quote.documentUrl && (
            <a
              href={quote.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
            >
              Завантажити PDF
            </a>
          )}
        </section>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Бюджет</dt>
            <dd className="font-medium">{quote.budget === null ? "Ще не визначились" : `${usd.format(quote.budget)} / міс.`}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Оновлено</dt>
            <dd className="font-medium">{dateTimeFormat.format(new Date(quote.updatedAt))}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Опис задачі</dt>
            <dd className="whitespace-pre-line break-words text-slate-700">{quote.description}</dd>
          </div>
        </dl>
      </main>
    </div>
  );
}
