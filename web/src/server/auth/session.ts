import { cache } from "react";

import {
  applyPendingInvitationsForUser,
  normalizeInviteEmail,
} from "./invitations";

const INVITATION_SYNC_COOLDOWN_MS = 30_000;

const globalForInvitationSync = globalThis as typeof globalThis & {
  invitationSyncPromises?: Map<string, Promise<void>>;
  invitationSyncTimestamps?: Map<string, number>;
};

const invitationSyncPromises =
  globalForInvitationSync.invitationSyncPromises ?? new Map<string, Promise<void>>();
const invitationSyncTimestamps =
  globalForInvitationSync.invitationSyncTimestamps ?? new Map<string, number>();

globalForInvitationSync.invitationSyncPromises = invitationSyncPromises;
globalForInvitationSync.invitationSyncTimestamps = invitationSyncTimestamps;

async function syncPendingInvitationsIfNeeded({
  userId,
  email,
}: {
  userId: string;
  email?: string | null;
}) {
  const normalizedEmail = normalizeInviteEmail(email ?? "");

  if (!normalizedEmail) {
    return;
  }

  const cacheKey = `${userId}:${normalizedEmail}`;
  const activeSync = invitationSyncPromises.get(cacheKey);

  if (activeSync) {
    await activeSync;
    return;
  }

  const lastSyncedAt = invitationSyncTimestamps.get(cacheKey);

  if (
    lastSyncedAt &&
    Date.now() - lastSyncedAt < INVITATION_SYNC_COOLDOWN_MS
  ) {
    return;
  }

  const syncPromise = applyPendingInvitationsForUser({
    userId,
    email: normalizedEmail,
  }).finally(() => {
    invitationSyncPromises.delete(cacheKey);
    invitationSyncTimestamps.set(cacheKey, Date.now());
  });

  invitationSyncPromises.set(cacheKey, syncPromise);
  await syncPromise;
}

export const getCurrentUser = cache(async () => {
  const { auth } = await import("@/auth");
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  await syncPendingInvitationsIfNeeded({
    userId: session.user.id,
    email: session.user.email,
  });

  return session.user;
});

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user?.id) {
    throw new Error("Unauthorized");
  }

  return user;
}
