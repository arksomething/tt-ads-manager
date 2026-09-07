import { NextResponse, type NextRequest } from "next/server";

import { parseAdminDealCreateInput } from "@/server/admin/deals";

import {
  adminDealRpcError,
  adminDealSuccess,
  dealJson,
  parseDealJsonBody,
  requireAdminDealSession,
  validateDealWriteRequest,
} from "./_shared";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const rejected = validateDealWriteRequest(request, authResponse);
  if (rejected) return rejected;

  const parsed = parseAdminDealCreateInput(await parseDealJsonBody(request));
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Provide a deal key, label, legal terms, and a structurally valid economics draft.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;

  const { data, error } = await session.supabase.rpc("create_admin_program_deal_draft", {
    deal_key_input: parsed.dealKey,
    label_input: parsed.label,
    terms_markdown_input: parsed.termsMarkdown,
    economics_input: parsed.economics,
    change_note_input: parsed.changeNote,
  });
  if (error) return adminDealRpcError(authResponse, error);
  return adminDealSuccess(authResponse, data, 201);
}
