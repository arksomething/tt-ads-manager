import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type CreatorAccountIdentity = {
  id: string;
  email: string | null;
};

function claimString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const getCurrentAccount = cache(async (): Promise<CreatorAccountIdentity | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const id = claimString(data?.claims?.sub);

  if (error || !id) {
    return null;
  }

  return {
    id,
    email: claimString(data?.claims?.email),
  };
});
