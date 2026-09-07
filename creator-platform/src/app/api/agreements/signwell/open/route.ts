import { NextResponse, type NextRequest } from "next/server";

import { getAppOrigin } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  createSignWellAgreementDraft,
  getSignWellAgreementSigningUrl,
  getSignWellReadiness,
  sendSignWellAgreement,
  SignWellError,
} from "@/lib/agreements/signwell";
import {
  assertDealTemplateSourceIntegrity,
  DealTemplateSourceIntegrityError,
} from "@/server/admin/deal-template-source-integrity";
import {
  isAgreementProvisioningLeaseExpired,
  normalizeAgreementProvisioningLease,
  normalizeCreatorAgreementContext,
} from "@/server/accounts/agreement";
import { formRedirect, isSameOrigin } from "@/server/forms";

export const runtime = "nodejs";

function externalRedirect(url: string, authResponse: NextResponse) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  for (const cookie of authResponse.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isSameOrigin(request)) {
    return formRedirect(request, "/onboarding/agreement", {
      error: "Request origin was not accepted.",
    });
  }

  const readiness = getSignWellReadiness();
  if (!readiness.readyToSend) {
    return formRedirect(request, "/onboarding/agreement", {
      error: "Agreement signing is waiting for the approved template and production credential gate.",
    });
  }
  const environment = readiness.testMode ? "test" : "production";

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return formRedirect(request, "/auth/sign-in", {
      error: "Sign in before opening your agreement.",
    }, authResponse);
  }
  const accountId = claims.claims.sub;
  const admin = createAdminClient();

  const { data: contextData, error: contextError } = await supabase.rpc(
    "get_own_agreement_signing_context",
  );
  const context = normalizeCreatorAgreementContext(contextData);
  if (contextError || !context) {
    return formRedirect(request, "/onboarding/agreement", {
      error: "Your assigned agreement is not ready yet.",
    }, authResponse);
  }

  try {
    const expiredPreparation = context.status === "preparing"
      && isAgreementProvisioningLeaseExpired(context.provisioningStartedAt);

    if (context.status === "completed") {
      return formRedirect(request, "/account", {
        notice: "Your completed agreement is already confirmed.",
      }, authResponse);
    }

    if (context.status === "creator_accepted") {
      return formRedirect(request, "/onboarding/agreement", {
        notice: "Your signing step was submitted. Completion confirmation is still processing.",
      }, authResponse);
    }

    if (["declined", "voided"].includes(context.status)) {
      return formRedirect(request, "/onboarding/agreement", {
        error: "This agreement can’t be opened from its current state.",
      }, authResponse);
    }

    if (context.status === "preparing" && !expiredPreparation) {
      return formRedirect(request, "/onboarding/agreement", {
        notice: "Agreement preparation is already running. Refresh in a moment.",
      }, authResponse);
    }

    const reopensExistingDocument = Boolean(
      context.externalAgreementId && ["sent", "viewed"].includes(context.status),
    );
    const canPrepareDocument = ["assigned", "pending", "error"].includes(context.status)
      || expiredPreparation;

    if (!reopensExistingDocument && !canPrepareDocument) {
      return formRedirect(request, "/onboarding/agreement", {
        error: "This agreement can’t be prepared from its current state.",
      }, authResponse);
    }

    if (
      !context.verifiedDealSnapshotSha256 ||
      !context.verifiedProviderTemplateId
    ) {
      return formRedirect(request, "/onboarding/agreement", {
        error: "Your agreement template binding needs staff review before it can be opened.",
      }, authResponse);
    }

    if (reopensExistingDocument && (
      context.provider !== "signwell" ||
      context.providerEnvironment !== environment ||
      !context.dealSnapshotSha256 ||
      !context.providerTemplateId ||
      context.dealSnapshotSha256 !== context.verifiedDealSnapshotSha256 ||
      context.providerTemplateId !== context.verifiedProviderTemplateId
    )) {
      return formRedirect(request, "/onboarding/agreement", {
        error: "Your agreement template binding needs staff review before it can be reopened.",
      }, authResponse);
    }

    // Every operation that can mutate provisioning state or call SignWell first
    // re-downloads the private source and validates its exact size, structure,
    // SHA-256, snapshot, and template identity.
    const checkedArtifact = await assertDealTemplateSourceIntegrity({
      dealVersionId: context.dealVersionId,
      snapshotHash: context.verifiedDealSnapshotSha256,
      templateId: context.verifiedProviderTemplateId,
    }, admin);

    if (reopensExistingDocument && context.externalAgreementId) {
      const url = await getSignWellAgreementSigningUrl(
        context.externalAgreementId,
        context.signerEmail,
        context.verifiedDealSnapshotSha256,
        context.verifiedProviderTemplateId,
      );
      return externalRedirect(url, authResponse);
    }

    const { data: leaseData, error: leaseError } = await admin.rpc(
      "begin_own_signwell_agreement_provisioning",
      { target_account_id: accountId, target_environment: environment },
    );
    const lease = normalizeAgreementProvisioningLease(leaseData);
    if (leaseError || !lease) {
      return formRedirect(request, "/onboarding/agreement", {
        error: leaseError?.code === "55P03"
          ? "Agreement preparation is already running. Refresh in a moment."
          : "Your agreement could not be prepared yet.",
      }, authResponse);
    }
    if (
      lease.dealVersionId !== checkedArtifact.dealVersionId ||
      lease.dealSnapshotSha256 !== checkedArtifact.snapshotHash ||
      lease.providerTemplateId !== checkedArtifact.templateId
    ) {
      await admin.rpc("fail_own_signwell_agreement_provisioning", {
        target_account_id: accountId,
        target_agreement_id: lease.agreementId,
        target_provisioning_token: lease.provisioningToken,
        provider_error_code: "template_source_integrity_race",
      });
      throw new SignWellError("invalid_verified_template_binding", 503);
    }

    try {
      const redirectUrl = `${getAppOrigin(request.url)}/onboarding/agreement?notice=Agreement+submitted.+Verified+completion+may+take+a+moment.`;
      let documentId = lease.externalAgreementId;

      if (!documentId) {
        const draft = await createSignWellAgreementDraft({
          agreementId: lease.agreementId,
          enrollmentId: lease.enrollmentId,
          dealVersionId: lease.dealVersionId,
          dealSnapshotSha256: lease.dealSnapshotSha256,
          providerTemplateId: lease.providerTemplateId,
          signerName: lease.signerName,
          signerEmail: lease.signerEmail,
          redirectUrl,
        });
        documentId = draft.documentId;
        const { error: attachError } = await admin.rpc(
          "attach_own_signwell_agreement_document",
          {
            target_account_id: accountId,
            target_agreement_id: lease.agreementId,
            target_provisioning_token: lease.provisioningToken,
            signwell_document_id: documentId,
            signwell_template_id: draft.templateId,
            bound_deal_snapshot_sha256: draft.dealSnapshotSha256,
          },
        );
        if (attachError) {
          // The document is still an unsent provider draft. Keep the lease in
          // place for staff reconciliation and never create a live request that
          // the application cannot identify.
          return formRedirect(request, "/onboarding/agreement", {
            error: "An unsent agreement draft was created but could not be attached to your account. The creator team must reconcile it before retrying.",
          }, authResponse);
        }
      }

      let signingUrl: string | null = null;
      try {
        signingUrl = await getSignWellAgreementSigningUrl(
          documentId,
          lease.signerEmail,
          lease.dealSnapshotSha256,
          lease.providerTemplateId,
        );
      } catch (error) {
        if (!(error instanceof SignWellError) || error.safeCode !== "missing_signing_url") {
          throw error;
        }
      }

      signingUrl ??= await sendSignWellAgreement({
        documentId,
        dealSnapshotSha256: lease.dealSnapshotSha256,
        providerTemplateId: lease.providerTemplateId,
        signerEmail: lease.signerEmail,
        redirectUrl,
      });

      const { error: completeError } = await admin.rpc(
        "complete_own_signwell_agreement_provisioning",
        {
          target_account_id: accountId,
          target_agreement_id: lease.agreementId,
          target_provisioning_token: lease.provisioningToken,
          signwell_document_id: documentId,
        },
      );
      if (completeError) {
        return formRedirect(request, "/onboarding/agreement", {
          error: "The known signing document opened, but its sent state could not be finalized. The creator team has been alerted; do not create another document.",
        }, authResponse);
      }
      return externalRedirect(signingUrl, authResponse);
    } catch (error) {
      const safeCode = error instanceof SignWellError ? error.safeCode : "provider_error";
      await admin.rpc("fail_own_signwell_agreement_provisioning", {
        target_account_id: accountId,
        target_agreement_id: lease.agreementId,
        target_provisioning_token: lease.provisioningToken,
        provider_error_code: safeCode,
      });
      throw error;
    }
  } catch (error) {
    const message = error instanceof DealTemplateSourceIntegrityError
      ? "The archived agreement source failed its server integrity check. No signing action was taken."
      : error instanceof SignWellError && error.safeCode === "provider_rate_limit"
        ? "Agreement signing is busy. Try again in a minute."
        : "SignWell could not open the agreement right now. No completion was recorded.";
    return formRedirect(request, "/onboarding/agreement", { error: message }, authResponse);
  }
}
