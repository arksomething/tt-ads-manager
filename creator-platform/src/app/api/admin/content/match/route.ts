import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  contentMutationError,
  contentRedirect,
  formText,
  isAcceptedContentOrigin,
  isUuid,
} from "@/server/content/http";

export const dynamic = "force-dynamic";

function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048;
  } catch {
    return false;
  }
}

function utcTimestamp(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)) return undefined;
  const timestamp = `${value}${value.length === 16 ? ":00" : ""}Z`;
  return Number.isNaN(Date.parse(timestamp)) ? undefined : timestamp;
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, "/admin/content", {
      error: "Request origin was not accepted.",
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return contentRedirect(request, "/admin/content", {
      error: "The attribution update was too large.",
    });
  }

  const formData = await request.formData();
  const submissionId = formText(formData, "submissionId", 40);
  const canonicalUrl = formText(formData, "canonicalUrl", 2048);
  const nativePostId = formText(formData, "nativePostId", 191);
  const provider = formText(formData, "provider", 80).toLowerCase();
  const providerPostId = formText(formData, "providerPostId", 191);
  const providerAccountId = formText(formData, "providerAccountId", 191);
  const publishedAt = utcTimestamp(formText(formData, "publishedAt", 24));
  const reviewNote = formText(formData, "reviewNote", 1000);

  if (!isUuid(submissionId) || !httpsUrl(canonicalUrl)) {
    return contentRedirect(request, "/admin/content", {
      error: "Choose an open submission and confirm its HTTPS canonical URL.",
    });
  }
  if (nativePostId && !/^[A-Za-z0-9._:-]+$/u.test(nativePostId)) {
    return contentRedirect(request, "/admin/content", {
      error: "The native post ID contains unsupported characters.",
    });
  }
  if (publishedAt === undefined) {
    return contentRedirect(request, "/admin/content", {
      error: "Enter the publication timestamp in UTC or leave it blank.",
    });
  }
  if ((provider && !providerPostId) || (!provider && providerPostId)) {
    return contentRedirect(request, "/admin/content", {
      error: "Provider and provider post ID must be supplied together.",
    });
  }
  if (provider && !/^[a-z][a-z0-9._-]{1,79}$/u.test(provider)) {
    return contentRedirect(request, "/admin/content", {
      error: "The provider key is not valid.",
    });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return contentRedirect(request, "/auth/sign-in", {
      error: "Sign in with a staff account before attributing content.",
    }, authResponse);
  }

  const { error } = await supabase.rpc("match_creator_content_submission", {
    target_submission_id: submissionId,
    match_input: {
      canonicalUrl,
      nativePostId: nativePostId || null,
      publishedAt,
      provider: provider || null,
      providerPostId: providerPostId || null,
      providerAccountId: providerAccountId || null,
      reviewNote: reviewNote || null,
    },
  });
  if (error) {
    return contentRedirect(request, "/admin/content", {
      error: contentMutationError(error),
    }, authResponse);
  }

  return contentRedirect(request, "/admin/content", {
    notice: "Submission matched to a canonical attributed post.",
  }, authResponse);
}
