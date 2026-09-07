import { NextResponse, type NextRequest } from "next/server";

import { copySupabaseResponseState, createRouteHandlerClient } from "@/lib/supabase/server";
import { isUuid } from "@/server/content/http";
import { normalizeCreatorAssetDownload } from "@/server/content/library";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetId: string }> };

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return noStore(NextResponse.json({ error: "Asset was not recognized." }, { status: 404 }));
  const authResponse = NextResponse.next();
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", "/account/assets");
    return noStore(copySupabaseResponseState(authResponse, NextResponse.redirect(signIn, 303)));
  }
  const { data, error } = await supabase.rpc("get_own_creator_asset_download", {
    target_asset_id: assetId,
  });
  let asset = error ? null : normalizeCreatorAssetDownload(data);
  if (!asset) {
    const staffResult = await supabase.rpc("get_program_asset_download_staff", {
      target_asset_id: assetId,
    });
    asset = staffResult.error ? null : normalizeCreatorAssetDownload(staffResult.data);
  }
  if (!asset) return noStore(copySupabaseResponseState(authResponse, NextResponse.json({ error: "Asset is unavailable." }, { status: 404 })));

  let destination: string | null = null;
  if (asset.sourceType === "external_url" && asset.externalUrl) {
    try {
      const external = new URL(asset.externalUrl);
      if (external.protocol === "https:" && !external.username && !external.password) destination = external.toString();
    } catch {
      destination = null;
    }
  } else if (asset.storageBucket && asset.storagePath) {
    const signed = await supabase.storage.from(asset.storageBucket).createSignedUrl(
      asset.storagePath,
      60,
      { download: asset.downloadFilename },
    );
    destination = signed.data?.signedUrl ?? null;
  }
  if (!destination) return noStore(copySupabaseResponseState(authResponse, NextResponse.json({ error: "Asset download is unavailable." }, { status: 503 })));
  if (asset.assignmentId) {
    await supabase.rpc("set_program_asset_assignment_state", {
      target_assignment_id: asset.assignmentId,
      target_state: "viewed",
    });
  }
  return noStore(copySupabaseResponseState(authResponse, NextResponse.redirect(destination, 302)));
}
