"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLead, updateLeadStatus } from "@/app/actions";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";
import { STATUS_LABELS } from "./status-badge";

export function LeadActions({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const router = useRouter();
  const [current, setCurrent] = useState<LeadStatus>(status);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeStatus(next: LeadStatus) {
    const previous = current;
    setCurrent(next);
    setFailed(null);
    startTransition(async () => {
      const result = await updateLeadStatus(leadId, next);
      if (result.status === "ok") return; // the action already revalidates this page
      startTransition(() => {
        setCurrent(previous); // roll the optimistic value back
        setFailed("Не вдалося змінити статус. Можливо, лід уже видалено — оновіть сторінку.");
      });
    });
  }

  function remove() {
    if (!window.confirm("Видалити лід назавжди?")) return;
    setFailed(null);
    startTransition(async () => {
      const result = await deleteLead(leadId);
      if (result.status === "ok") {
        router.push("/dashboard");
        return;
      }
      startTransition(() => setFailed("Не вдалося видалити лід. Оновіть сторінку й спробуйте ще раз."));
    });
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5">
      <label className="text-sm font-medium">
        Статус
        <select
          value={current}
          disabled={pending}
          onChange={(event) => changeStatus(event.target.value as LeadStatus)}
          className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        Видалити лід
      </button>
      <p role="alert" className="w-full text-sm text-red-700 empty:hidden">
        {failed}
      </p>
    </div>
  );
}
