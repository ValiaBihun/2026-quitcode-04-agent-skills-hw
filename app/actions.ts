"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { parseLeadForm, type LeadFormField } from "@/lib/lead-form";
import { getCurrentUser, getLead, getWorkspace } from "@/lib/data";
import { triggerWorkflow } from "@/lib/n8n/client";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

const PUBLIC_FORM_WORKSPACE_ID = "ws_studio_nova";

export type SubmitLeadState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<LeadFormField, string>> }
  | { status: "ok" };

export async function submitLead(
  _prevState: SubmitLeadState,
  formData: FormData,
): Promise<SubmitLeadState> {
  const parsed = parseLeadForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors };
  }

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";
  const userAgent = requestHeaders.get("user-agent") ?? "";

  const lead = await db.insertLead({
    ...parsed.data,
    workspaceId: PUBLIC_FORM_WORKSPACE_ID,
    jobTitle: "",
    city: "",
    country: "",
    source: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    ipAddress,
    userAgent,
    rawPayload: {
      form: { id: "contact-main", version: "2026-07", fields: parsed.data },
      request: {
        ip: ipAddress,
        userAgent,
        acceptLanguage: requestHeaders.get("accept-language"),
        receivedAt: new Date().toISOString(),
      },
    },
  });

  // One key per submitted lead: every retry inside triggerWorkflow reuses it.
  const idempotencyKey = randomUUID();
  const correlationId = randomUUID();

  // The visitor never waits for n8n or the audit log (server-after-nonblocking).
  after(async () => {
    await Promise.allSettled([
      triggerWorkflow({
        event: "lead-created",
        // only what the workflow needs — no IP, user agent, raw payload or internal fields
        data: {
          leadId: lead.id,
          fullName: lead.fullName,
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          website: lead.website,
          budget: lead.budget,
          message: lead.message,
          consentMarketing: lead.consentMarketing,
          source: lead.source,
        },
        idempotencyKey,
        correlationId,
      }),
      logAudit("lead.created", lead.id),
    ]);
  });

  return { status: "ok" };
}

export type LeadMutationResult = { status: "ok" } | { status: "error" };

// Server Actions are public POST endpoints (server-auth-actions): the session and
// the lead's workspace are checked here, not only by proxy.ts and the page.
async function findOwnLead(id: unknown) {
  const user = await getCurrentUser(); // redirects to /login without a valid session
  if (typeof id !== "string") return null;
  const [workspace, lead] = await Promise.all([getWorkspace(user.workspaceSlug), getLead(id)]);
  return lead && lead.workspaceId === workspace.id ? lead : null;
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<LeadMutationResult> {
  const lead = await findOwnLead(id);
  if (!lead || !LEAD_STATUSES.includes(status)) return { status: "error" };

  await db.updateLeadStatus(lead.id, status);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/leads/${lead.id}`);
  return { status: "ok" };
}

export async function deleteLead(id: string): Promise<LeadMutationResult> {
  const lead = await findOwnLead(id);
  if (!lead) return { status: "error" };

  await db.deleteLead(lead.id);
  revalidatePath("/dashboard");
  return { status: "ok" };
}
