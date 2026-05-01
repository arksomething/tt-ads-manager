import { CampaignRole } from "@/lib/prisma-shim";

import {
  getCampaignWorkspaceDetail,
  type CampaignWorkspaceSummary,
} from "@/server/campaigns/queries";
import { formatPlatformLabel } from "@/server/dashboard/filters";
import { getCampaignColorTone } from "@/lib/campaign-colors";

import { CampaignSwatch } from "./campaign-badge";

type CampaignDetailAction = (formData: FormData) => Promise<void>;

type CampaignDetailPanelProps = {
  activeCampaignOwnerUserId: string | null | undefined;
  organizationSlug: string;
  activeCampaignSummary: CampaignWorkspaceSummary;
  canManageActiveCampaign: boolean;
  canDeleteActiveCampaign: boolean;
  canPermanentlyDeleteActiveCampaign: boolean;
  activeDeleteAvailabilityMessage: string | null;
  activeInviteRoleOptions: CampaignRole[];
  updateCampaignAction: CampaignDetailAction;
  deleteCampaignAction: CampaignDetailAction;
  inviteCampaignMemberAction: CampaignDetailAction;
  removeCampaignMemberAction: CampaignDetailAction;
  revokeCampaignInvitationAction: CampaignDetailAction;
  updateCampaignMemberRoleAction: CampaignDetailAction;
  viewerUserId: string;
};

type CampaignDetailPanelSkeletonProps = {
  activeCampaignSummary: CampaignWorkspaceSummary;
};

type CampaignDateValue = Date | string | null | undefined;

const campaignDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");

function formatCampaignDateLabel(
  value: CampaignDateValue,
  fallback = "Unknown",
) {
  if (!value) {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return campaignDateFormatter.format(date);
}

function formatViewsLabel(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "Views unavailable";
  }

  return `${wholeNumberFormatter.format(value)} views`;
}

export async function CampaignDetailPanel({
  activeCampaignOwnerUserId,
  organizationSlug,
  activeCampaignSummary,
  canManageActiveCampaign,
  canDeleteActiveCampaign,
  canPermanentlyDeleteActiveCampaign,
  activeDeleteAvailabilityMessage,
  activeInviteRoleOptions,
  updateCampaignAction,
  deleteCampaignAction,
  inviteCampaignMemberAction,
  removeCampaignMemberAction,
  revokeCampaignInvitationAction,
  updateCampaignMemberRoleAction,
  viewerUserId,
}: CampaignDetailPanelProps) {
  const activeCampaignDetails = await getCampaignWorkspaceDetail({
    organizationSlug,
    campaignId: activeCampaignSummary.id,
  });

  if (!activeCampaignDetails) {
    return (
      <article className="rounded-[1.7rem] border border-dashed border-white/[0.08] bg-white/[0.03] px-6 py-10 text-sm text-muted-foreground">
        The selected campaign could not be loaded. Pick another campaign from the
        list above.
      </article>
    );
  }

  const campaignTone = getCampaignColorTone(activeCampaignSummary.id);

  return (
    <article
      className="relative overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px"
        style={{ background: campaignTone.gradient }}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex items-start gap-4">
          <CampaignSwatch
            campaignId={activeCampaignSummary.id}
            className="h-12 w-12 rounded-[1.05rem]"
            label={activeCampaignSummary.name}
          />
          <div className="min-w-0">
            <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              Campaign
            </p>
            <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-foreground">
              {activeCampaignSummary.name}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                {activeCampaignSummary._count.memberships} members
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                {activeCampaignSummary._count.creators} creators
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                {activeCampaignSummary._count.videos} videos
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                {activeCampaignDetails.invitations.length} pending invites
              </span>
              {activeCampaignSummary._count.payouts > 0 ? (
                <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                  {activeCampaignSummary._count.payouts} payouts
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="text-sm text-muted-foreground xl:text-right">
          <p>
            Owner:{" "}
            <span className="text-foreground/86">
              {activeCampaignSummary.owner?.email ??
                activeCampaignSummary.owner?.name ??
                "Unassigned"}
            </span>
          </p>
          <p className="mt-1">
            Updated:{" "}
            <span className="text-foreground/86">
              {formatCampaignDateLabel(activeCampaignSummary.updatedAt)}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Campaign settings
          </p>

          {canManageActiveCampaign ? (
            <form
              action={updateCampaignAction}
              className="mt-3 space-y-3 rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4"
            >
              <input
                name="campaignId"
                type="hidden"
                value={activeCampaignSummary.id}
              />
              <label className="block">
                <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                  Campaign name
                </span>
                <input
                  className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.14]"
                  defaultValue={activeCampaignSummary.name}
                  name="name"
                  required
                  type="text"
                />
              </label>
              <button
                className="inline-flex items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-5 py-3 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Save name
              </button>
            </form>
          ) : (
            <div className="mt-3 rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-4 text-sm text-muted-foreground">
              You can view this campaign, but only owners and managers can rename
              it.
            </div>
          )}
        </div>

        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Delete campaign
          </p>
          <div className="mt-3 rounded-[1.2rem] border border-[#FF7E54]/16 bg-[#FF7E54]/[0.05] p-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Delete is only available once linked creators, videos, and payouts
              are cleared out.
            </p>
            {canDeleteActiveCampaign ? (
              <form action={deleteCampaignAction} className="mt-4">
                <input
                  name="campaignId"
                  type="hidden"
                  value={activeCampaignSummary.id}
                />
                <button
                  className={`inline-flex items-center justify-center rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                    canPermanentlyDeleteActiveCampaign
                      ? "border-[#FF7E54]/35 bg-[#FF7E54]/16 text-[#FFD5C8] hover:bg-[#FF7E54]/22"
                      : "cursor-not-allowed border-white/[0.08] bg-black/[0.12] text-muted-foreground"
                  }`}
                  disabled={!canPermanentlyDeleteActiveCampaign}
                  type="submit"
                >
                  Delete permanently
                </button>
              </form>
            ) : (
              <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-black/[0.12] px-4 py-3 text-sm text-muted-foreground">
                Only organization admins/owners and campaign owners can delete
                this campaign.
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {activeDeleteAvailabilityMessage}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Members
          </p>
          <div className="mt-3 space-y-2.5">
            {activeCampaignDetails.memberships.length > 0 ? (
              activeCampaignDetails.memberships.map((member: any) => (
                <div
                  key={member.id}
                  className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3"
                >
                  {(() => {
                    const isPrimaryOwner =
                      member.role === CampaignRole.OWNER ||
                      member.user.id === activeCampaignOwnerUserId;
                    const canManageMember =
                      canManageActiveCampaign &&
                      !isPrimaryOwner &&
                      member.user.id !== viewerUserId;

                    return (
                      <>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {member.user.name ??
                                member.user.email ??
                                "Campaign member"}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {member.user.email ?? "No email available"}
                            </p>
                          </div>
                          {canManageMember ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <form
                                action={updateCampaignMemberRoleAction}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input
                                  name="campaignId"
                                  type="hidden"
                                  value={activeCampaignSummary.id}
                                />
                                <input
                                  name="membershipId"
                                  type="hidden"
                                  value={member.id}
                                />
                                <select
                                  className="rounded-full border border-white/[0.08] bg-black/[0.24] px-3.5 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-foreground outline-none transition focus:border-white/[0.14]"
                                  defaultValue={member.role}
                                  name="role"
                                >
                                  {activeInviteRoleOptions.map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-black transition hover:bg-[#A4FF68]"
                                  type="submit"
                                >
                                  Save
                                </button>
                              </form>
                              <form action={removeCampaignMemberAction}>
                                <input
                                  name="campaignId"
                                  type="hidden"
                                  value={activeCampaignSummary.id}
                                />
                                <input
                                  name="membershipId"
                                  type="hidden"
                                  value={member.id}
                                />
                                <button
                                  className="rounded-full border border-[#FF7E54]/22 bg-[#FF7E54]/10 px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#FFD5C8] transition hover:bg-[#FF7E54]/16"
                                  type="submit"
                                >
                                  Remove
                                </button>
                              </form>
                            </div>
                          ) : (
                            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                              {member.role}
                            </span>
                          )}
                        </div>
                        {member.user.id === viewerUserId ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Ask another admin or manager if your own campaign access
                            needs to change.
                          </p>
                        ) : isPrimaryOwner ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            The primary campaign owner stays protected here. Use
                            managers for campaign-scoped access.
                          </p>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ))
            ) : (
              <div className="rounded-[1.05rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-sm text-muted-foreground">
                No one has campaign-level access yet.
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Invite to campaign
          </p>

          {canManageActiveCampaign ? (
            <form
              action={inviteCampaignMemberAction}
              className="mt-3 rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4"
            >
              <input
                name="campaignId"
                type="hidden"
                value={activeCampaignSummary.id}
              />
              <div className="grid gap-3 md:grid-cols-[1fr_11rem_auto]">
                <input
                  className="rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.14]"
                  name="email"
                  placeholder="teammate@example.com"
                  required
                  type="email"
                />
                <select
                  className="rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/[0.14]"
                  defaultValue={CampaignRole.MEMBER}
                  name="role"
                >
                  {activeInviteRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-5 py-3 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                  type="submit"
                >
                  Invite
                </button>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                If the person already has an account, access applies immediately.
                Otherwise the invite stays pending until they sign in with that
                exact email address.
              </p>
            </form>
          ) : (
            <div className="mt-3 rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-4 text-sm text-muted-foreground">
              You need organization-level management access or a campaign
              owner/manager role to invite people here.
            </div>
          )}

          <div className="mt-4 space-y-2.5">
            {activeCampaignDetails.invitations.length > 0 ? (
              activeCampaignDetails.invitations.map((invitation: any) => (
                <div
                  key={invitation.id}
                  className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {invitation.email}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Invited by{" "}
                        {invitation.invitedBy?.email ??
                          invitation.invitedBy?.name ??
                          "a campaign manager"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <div className="text-right">
                        <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                          {invitation.role}
                        </p>
                        <p className="mt-1 text-[0.56rem] uppercase tracking-[0.18em] text-[#B8FF86]">
                          Pending
                        </p>
                      </div>
                      {canManageActiveCampaign ? (
                        <form action={revokeCampaignInvitationAction}>
                          <input
                            name="campaignId"
                            type="hidden"
                            value={activeCampaignSummary.id}
                          />
                          <input
                            name="invitationId"
                            type="hidden"
                            value={invitation.id}
                          />
                          <button
                            className="rounded-full border border-white/[0.08] bg-black/[0.18] px-3 py-1.5 text-[0.58rem] font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                            type="submit"
                          >
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.05rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-sm text-muted-foreground">
                No pending campaign invites.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Recent creators
          </p>
          {activeCampaignSummary._count.creators >
          activeCampaignDetails.creators.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the latest {activeCampaignDetails.creators.length} of{" "}
              {activeCampaignSummary._count.creators} linked creators.
            </p>
          ) : null}
          <div className="mt-3 space-y-2.5">
            {activeCampaignDetails.creators.length > 0 ? (
              activeCampaignDetails.creators.map((campaignCreator: any) => (
                <div
                  key={campaignCreator.id}
                  className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3"
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {campaignCreator.creator.displayName}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Added {formatCampaignDateLabel(campaignCreator.createdAt)}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[1.05rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-sm text-muted-foreground">
                No creators are linked to this campaign yet.
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Recent videos
          </p>
          {activeCampaignSummary._count.videos > activeCampaignDetails.videos.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the latest {activeCampaignDetails.videos.length} of{" "}
              {activeCampaignSummary._count.videos} linked videos.
            </p>
          ) : null}
          <div className="mt-3 space-y-2.5">
            {activeCampaignDetails.videos.length > 0 ? (
              activeCampaignDetails.videos.map((video: any) => (
                <a
                  key={video.id}
                  className="block rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3 transition hover:border-white/[0.14] hover:bg-black/[0.22]"
                  href={video.videoUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {video.titleOrCaption?.trim() ||
                          `${video.creator.displayName} video`}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {video.creator.displayName}
                        {" · "}
                        {formatPlatformLabel(video.platform)}
                      </p>
                    </div>
                    <div className="min-w-[7.25rem] shrink-0 text-right">
                      <p className="whitespace-nowrap text-xs font-medium text-foreground/85">
                        {formatViewsLabel(video.views)}
                      </p>
                      <p className="mt-1 whitespace-nowrap text-[0.56rem] uppercase tracking-[0.14em] text-muted-foreground">
                        {formatCampaignDateLabel(
                          video.publishedAt ?? video.createdAt,
                        )}
                      </p>
                    </div>
                  </div>
                </a>
              ))
            ) : (
              <div className="rounded-[1.05rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-sm text-muted-foreground">
                No videos are linked to this campaign yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function CampaignDetailPanelSkeleton({
  activeCampaignSummary,
}: CampaignDetailPanelSkeletonProps) {
  return (
    <article className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-medium tracking-[-0.04em] text-foreground">
            {activeCampaignSummary.name}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
              {activeCampaignSummary._count.memberships} members
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
              {activeCampaignSummary._count.creators} creators
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
              {activeCampaignSummary._count.videos} videos
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3 animate-pulse">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] px-4 py-4"
          >
            <div className="h-4 w-44 rounded bg-white/[0.08]" />
            <div className="mt-3 h-3 w-full rounded bg-white/[0.05]" />
            <div className="mt-2 h-3 w-2/3 rounded bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </article>
  );
}
