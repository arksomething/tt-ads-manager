import { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { normalizeInviteEmail } from "@/server/auth/invitations";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  canManageOrganization,
  mergeCampaignRoles,
  mergeOrganizationRoles,
} from "@/server/auth/roles";

import { getCampaignAccess } from "./queries";
import {
  createOrganizationCampaignSchema,
  inviteCampaignMemberSchema,
  removeCampaignMemberSchema,
  revokeCampaignInvitationSchema,
  updateCampaignSchema,
  updateCampaignMemberRoleSchema,
} from "./schemas";

type TikTokPreviewCsvRecord = {
  adId: string;
  adName: string | null;
  previewUrl: string;
  expiresAt: Date | null;
  rawPayload: Record<string, string>;
};

function revalidateCampaignWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);
}

function parseCsvRows(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(value);
      if (row.some((entry) => entry.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((entry) => entry.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findCsvColumn(headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map(normalizeCsvHeader);

  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(candidate);

    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function parsePreviewExpiry(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePreviewUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function parseTikTokPreviewCsv(csvText: string) {
  const rows = parseCsvRows(csvText);
  const [headers, ...dataRows] = rows;

  if (!headers || dataRows.length === 0) {
    throw new Error("The TikTok preview export is empty.");
  }

  const adIdIndex = findCsvColumn(headers, ["adid", "adidv2"]);
  const adNameIndex = findCsvColumn(headers, ["adname"]);
  const previewUrlIndex = findCsvColumn(headers, [
    "urlqrcode",
    "previewurl",
    "shareurl",
    "url",
    "qrcode",
  ]);
  const expiryIndex = findCsvColumn(headers, [
    "expirationdate",
    "expirydate",
    "expiresat",
    "expiretime",
    "expiration",
  ]);

  if (adIdIndex < 0 || previewUrlIndex < 0) {
    throw new Error(
      "The TikTok preview export must include Ad ID and URL/QR code columns.",
    );
  }

  const records: TikTokPreviewCsvRecord[] = [];
  let skipped = 0;

  for (const dataRow of dataRows) {
    const adId = dataRow[adIdIndex]?.trim() ?? "";
    const previewUrl = normalizePreviewUrl(dataRow[previewUrlIndex]);

    if (!adId || !previewUrl) {
      skipped += 1;
      continue;
    }

    records.push({
      adId,
      adName: dataRow[adNameIndex]?.trim() || null,
      previewUrl,
      expiresAt: parsePreviewExpiry(dataRow[expiryIndex]),
      rawPayload: Object.fromEntries(
        headers.map((header, index) => [header.trim(), dataRow[index]?.trim() ?? ""]),
      ),
    });
  }

  return {
    records,
    skipped,
  };
}

async function getActiveTikTokAccountForOrganization(organizationId: string) {
  const account = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
    },
  });

  if (account) {
    return account;
  }

  const latestAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
    },
  });

  if (!latestAccount) {
    throw new Error("Connect a TikTok advertiser account before importing previews.");
  }

  return latestAccount;
}

export async function createCampaignForOrganization(
  organizationSlug: string,
  input: unknown,
) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Only organization admins and owners can create campaigns.");
  }

  const values = createOrganizationCampaignSchema.parse(input);

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: membership.organizationId,
      ownerUserId: membership.userId,
      name: values.name,
      memberships: {
        create: {
          userId: membership.userId,
          role: CampaignRole.OWNER,
        },
      },
    },
  });

  revalidateCampaignWorkspace(organizationSlug);

  return campaign;
}

export async function importTikTokAdPreviewUrlsForOrganization(args: {
  organizationSlug: string;
  csvText: string;
  sourceFileName?: string | null;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Only organization admins and owners can import TikTok previews.");
  }

  const account = await getActiveTikTokAccountForOrganization(membership.organizationId);
  const parsed = parseTikTokPreviewCsv(args.csvText);

  if (parsed.records.length === 0) {
    throw new Error("No usable TikTok preview URLs were found in the export.");
  }

  for (const record of parsed.records) {
    await prisma.tikTokAdPreviewUrl.upsert({
      where: {
        organizationId_advertiserId_adId: {
          organizationId: membership.organizationId,
          advertiserId: account.advertiserId,
          adId: record.adId,
        },
      },
      update: {
        adName: record.adName,
        previewUrl: record.previewUrl,
        expiresAt: record.expiresAt,
        importedAt: new Date(),
        sourceFileName: args.sourceFileName ?? null,
        rawPayload: record.rawPayload,
      },
      create: {
        organizationId: membership.organizationId,
        advertiserId: account.advertiserId,
        adId: record.adId,
        adName: record.adName,
        previewUrl: record.previewUrl,
        expiresAt: record.expiresAt,
        importedAt: new Date(),
        sourceFileName: args.sourceFileName ?? null,
        rawPayload: record.rawPayload,
      },
    });
  }

  revalidateCampaignWorkspace(args.organizationSlug);

  return {
    imported: parsed.records.length,
    skipped: parsed.skipped,
  };
}

export async function updateCampaignForOrganization(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign) {
    throw new Error("Campaign edit access denied");
  }

  const values = updateCampaignSchema.parse(input);
  const campaign = await prisma.campaign.update({
    where: {
      id: campaignId,
    },
    data: {
      ...(values.name !== undefined ? { name: values.name } : {}),
    },
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return campaign;
}

export async function deleteCampaignForOrganization(args: {
  organizationSlug: string;
  campaignId: string;
}) {
  const { organizationSlug, campaignId } = args;
  const { membership, viewerCampaignRole } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );
  const canDeleteCampaign =
    canManageOrganization(membership.role) ||
    viewerCampaignRole === CampaignRole.OWNER;

  if (!canDeleteCampaign) {
    throw new Error("Campaign delete access denied");
  }

  const linkedRecordCounts = await prisma.campaign.findUnique({
    where: {
      id: campaignId,
    },
    select: {
      _count: {
        select: {
          creators: true,
          videos: true,
          payouts: true,
        },
      },
    },
  });

  if (!linkedRecordCounts) {
    throw new Error("Campaign not found");
  }

  if (
    linkedRecordCounts._count.creators > 0 ||
    linkedRecordCounts._count.videos > 0 ||
    linkedRecordCounts._count.payouts > 0
  ) {
    throw new Error(
      "Remove linked creators, videos, and payouts before deleting this campaign.",
    );
  }

  const deletedCampaign = await prisma.campaign.delete({
    where: {
      id: campaignId,
    },
  });

  revalidateCampaignWorkspace(organizationSlug);

  return deletedCampaign;
}

export async function inviteCampaignMember(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const {
    membership,
    campaign,
    canManageCampaign,
  } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign invite access denied");
  }

  const values = inviteCampaignMemberSchema.parse(input);
  const email = normalizeInviteEmail(values.email);

  if (values.role === CampaignRole.OWNER) {
    throw new Error(
      "Invite campaign leads as managers. The primary campaign owner stays the original creator.",
    );
  }

  const invitation = await prisma.$transaction(async (tx) => {
    const invitedUser = await tx.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    const acceptedAt = invitedUser ? new Date() : null;

    const upsertedInvitation = await tx.campaignInvitation.upsert({
      where: {
        campaignId_email: {
          campaignId,
          email,
        },
      },
      update: {
        role: values.role,
        invitedByUserId: membership.userId,
        acceptedAt,
        revokedAt: null,
      },
      create: {
        campaignId,
        email,
        role: values.role,
        invitedByUserId: membership.userId,
        acceptedAt,
      },
    });

    if (invitedUser) {
      const existingOrganizationMembership =
        await tx.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: membership.organizationId,
              userId: invitedUser.id,
            },
          },
          select: {
            role: true,
          },
        });

      if (existingOrganizationMembership) {
        await tx.organizationMembership.update({
          where: {
            organizationId_userId: {
              organizationId: membership.organizationId,
              userId: invitedUser.id,
            },
          },
          data: {
            role: mergeOrganizationRoles(
              existingOrganizationMembership.role,
              OrganizationRole.MEMBER,
            ),
          },
        });
      } else {
        await tx.organizationMembership.create({
          data: {
            organizationId: membership.organizationId,
            userId: invitedUser.id,
            role: OrganizationRole.MEMBER,
          },
        });
      }

      const existingCampaignMembership = await tx.campaignMembership.findUnique({
        where: {
          campaignId_userId: {
            campaignId,
            userId: invitedUser.id,
          },
        },
        select: {
          role: true,
        },
      });

      if (existingCampaignMembership) {
        await tx.campaignMembership.update({
          where: {
            campaignId_userId: {
              campaignId,
              userId: invitedUser.id,
            },
          },
          data: {
            role: mergeCampaignRoles(existingCampaignMembership.role, values.role),
          },
        });
      } else {
        await tx.campaignMembership.create({
          data: {
            campaignId,
            userId: invitedUser.id,
            role: values.role,
          },
        });
      }
    }

    return upsertedInvitation;
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return invitation;
}

export async function updateCampaignMemberRole(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign role access denied");
  }

  const values = updateCampaignMemberRoleSchema.parse(input);
  const updatedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.campaignMembership.findFirst({
      where: {
        id: values.membershipId,
        campaignId,
      },
    });

    if (!targetMembership) {
      throw new Error("Campaign member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another admin or manager to change your own campaign access.",
      );
    }

    if (
      targetMembership.role === CampaignRole.OWNER ||
      campaign.ownerUserId === targetMembership.userId
    ) {
      throw new Error("The primary campaign owner cannot be changed here.");
    }

    return tx.campaignMembership.update({
      where: {
        id: targetMembership.id,
      },
      data: {
        role: values.role,
      },
    });
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return updatedMembership;
}

export async function removeCampaignMember(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign removal access denied");
  }

  const values = removeCampaignMemberSchema.parse(input);
  const removedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.campaignMembership.findFirst({
      where: {
        id: values.membershipId,
        campaignId,
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!targetMembership) {
      throw new Error("Campaign member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another admin or manager to remove your own campaign access.",
      );
    }

    if (
      targetMembership.role === CampaignRole.OWNER ||
      campaign.ownerUserId === targetMembership.userId
    ) {
      throw new Error("The primary campaign owner cannot be removed here.");
    }

    if (targetMembership.user.email) {
      await tx.campaignInvitation.updateMany({
        where: {
          campaignId,
          email: normalizeInviteEmail(targetMembership.user.email),
          acceptedAt: null,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    return tx.campaignMembership.delete({
      where: {
        id: targetMembership.id,
      },
    });
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return removedMembership;
}

export async function revokeCampaignInvitation(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign invite access denied");
  }

  const values = revokeCampaignInvitationSchema.parse(input);
  const invitation = await prisma.campaignInvitation.findFirst({
    where: {
      id: values.invitationId,
      campaignId,
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new Error("Campaign invitation is no longer pending.");
  }

  const revokedInvitation = await prisma.campaignInvitation.update({
    where: {
      id: invitation.id,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return revokedInvitation;
}
