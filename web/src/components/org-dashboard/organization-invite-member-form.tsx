"use client";

import { useId, useMemo, useState } from "react";

type OrganizationRoleValue = "OWNER" | "ADMIN" | "MEMBER" | "BLAZIE";

type CampaignOption = {
  id: string;
  name: string;
};

type OrganizationInviteMemberFormProps = {
  campaignOptions: CampaignOption[];
  inviteMemberAction: (formData: FormData) => Promise<void>;
  inviteRoleOptions: OrganizationRoleValue[];
};

function formatRoleLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getSummaryLabel(args: {
  campaignOptions: CampaignOption[];
  campaignAccessMode: "all" | "selected";
  hasOrgWideCampaignAccess: boolean;
  role: OrganizationRoleValue;
  selectedCampaigns: CampaignOption[];
}) {
  const {
    campaignOptions,
    campaignAccessMode,
    hasOrgWideCampaignAccess,
    role,
  selectedCampaigns,
} = args;

  if (role === "BLAZIE") {
    return "Blazie tab only";
  }

  if (hasOrgWideCampaignAccess) {
    return `${formatRoleLabel(role)} includes all campaigns`;
  }

  if (campaignAccessMode === "all") {
    return campaignOptions.length > 0
      ? `All campaigns (${campaignOptions.length})`
      : "No campaigns yet";
  }

  if (selectedCampaigns.length === 0) {
    return "No campaign access selected";
  }

  if (selectedCampaigns.length <= 2) {
    return selectedCampaigns.map((campaign) => campaign.name).join(", ");
  }

  return `${selectedCampaigns.length} campaigns selected`;
}

export function OrganizationInviteMemberForm({
  campaignOptions,
  inviteMemberAction,
  inviteRoleOptions,
}: OrganizationInviteMemberFormProps) {
  const [role, setRole] = useState<OrganizationRoleValue>("MEMBER");
  const [campaignAccessMode, setCampaignAccessMode] = useState<"all" | "selected">(
    "all",
  );
  const [isCampaignPickerOpen, setIsCampaignPickerOpen] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const campaignPickerId = useId();
  const hasOrgWideCampaignAccess = role === "OWNER" || role === "ADMIN";
  const hasBlazieOnlyAccess = role === "BLAZIE";
  const selectedCampaigns = useMemo(() => {
    const selectedCampaignIdSet = new Set(selectedCampaignIds);

    return campaignOptions.filter((campaign) =>
      selectedCampaignIdSet.has(campaign.id),
    );
  }, [campaignOptions, selectedCampaignIds]);
  const campaignSummaryLabel = getSummaryLabel({
    campaignOptions,
    campaignAccessMode,
    hasOrgWideCampaignAccess,
    role,
    selectedCampaigns,
  });

  function toggleCampaign(campaignId: string) {
    setCampaignAccessMode("selected");
    setSelectedCampaignIds((current) =>
      current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId],
    );
  }

  return (
    <form
      action={inviteMemberAction}
      className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_minmax(280px,360px)_auto]"
    >
      <label className="block">
        <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
          Email
        </span>
        <input
          className="w-full rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.14]"
          name="email"
          placeholder="operator@example.com"
          required
          type="email"
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
          Org role
        </span>
        <select
          className="w-full rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/[0.14]"
          defaultValue="MEMBER"
          name="role"
          onChange={(event) =>
            setRole(event.target.value as OrganizationRoleValue)
          }
        >
          {inviteRoleOptions.map((inviteRole) => (
            <option key={inviteRole} value={inviteRole}>
              {formatRoleLabel(inviteRole)}
            </option>
          ))}
        </select>
      </label>

      <div className="block">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Campaign access
          </span>
          {!hasOrgWideCampaignAccess ? (
            <span className="text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              {campaignAccessMode === "all"
                ? "All current campaigns"
                : `${selectedCampaignIds.length} selected`}
            </span>
          ) : null}
        </div>

        <input
          name="campaignAccessScope"
          type="hidden"
          value={
            hasBlazieOnlyAccess
              ? "selected"
              : hasOrgWideCampaignAccess
                ? "all"
                : campaignAccessMode
          }
        />
        {!hasBlazieOnlyAccess &&
        !hasOrgWideCampaignAccess &&
        campaignAccessMode === "selected"
          ? selectedCampaignIds.map((campaignId) => (
              <input
                key={campaignId}
                name="campaignIds"
                type="hidden"
                value={campaignId}
              />
            ))
          : null}

        <button
          aria-controls={campaignPickerId}
          aria-expanded={isCampaignPickerOpen}
          className="flex w-full items-center justify-between gap-3 rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-left transition hover:border-white/[0.14]"
          onClick={() => setIsCampaignPickerOpen((current) => !current)}
          type="button"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">
              {campaignSummaryLabel}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {hasBlazieOnlyAccess
                ? "This profile only sees the Blazie tab."
                : hasOrgWideCampaignAccess
                  ? "Admins and owners automatically get access to every campaign."
                  : "Choose all campaigns or narrow access before sending the invite."}
            </span>
          </span>
          <svg
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-muted-foreground transition ${
              isCampaignPickerOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 16 16"
          >
            <path
              d="M4.25 6.5L8 10.25L11.75 6.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
          </svg>
        </button>

        {isCampaignPickerOpen ? (
          <div
            className="mt-3 rounded-[1rem] border border-white/[0.08] bg-black/[0.18] p-3.5"
            id={campaignPickerId}
          >
            {hasBlazieOnlyAccess ? (
              <p className="text-sm leading-6 text-muted-foreground">
                This profile only gets the Blazie tab, so no campaign selection
                is needed.
              </p>
            ) : hasOrgWideCampaignAccess ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {formatRoleLabel(role)} access already includes every campaign in
                this organization, so no separate campaign selection is needed.
              </p>
            ) : campaignOptions.length > 0 ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    className={`rounded-[0.95rem] border px-3 py-3 text-left transition ${
                      campaignAccessMode === "all"
                        ? "border-[#90FF4D]/28 bg-[#90FF4D]/10"
                        : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]"
                    }`}
                    onClick={() => setCampaignAccessMode("all")}
                    type="button"
                  >
                    <span className="block text-sm font-medium text-foreground">
                      All campaigns
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Give this member access to every current campaign.
                    </span>
                  </button>

                  <button
                    className={`rounded-[0.95rem] border px-3 py-3 text-left transition ${
                      campaignAccessMode === "selected"
                        ? "border-[#90FF4D]/28 bg-[#90FF4D]/10"
                        : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]"
                    }`}
                    onClick={() => setCampaignAccessMode("selected")}
                    type="button"
                  >
                    <span className="block text-sm font-medium text-foreground">
                      Choose campaigns
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Pick only the campaigns this member should be able to open.
                    </span>
                  </button>
                </div>

                {campaignAccessMode === "selected" ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                        onClick={() =>
                          setSelectedCampaignIds(
                            campaignOptions.map((campaign) => campaign.id),
                          )
                        }
                        type="button"
                      >
                        Select all listed
                      </button>
                      <button
                        className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                        onClick={() => setSelectedCampaignIds([])}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {campaignOptions.map((campaign) => {
                        const isSelected = selectedCampaignIds.includes(campaign.id);

                        return (
                          <label
                            key={campaign.id}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-[0.95rem] border px-3 py-2.5 transition ${
                              isSelected
                                ? "border-[#90FF4D]/28 bg-[#90FF4D]/8"
                                : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]"
                            }`}
                          >
                            <input
                              checked={isSelected}
                              className="sr-only"
                              onChange={() => toggleCampaign(campaign.id)}
                              type="checkbox"
                            />
                            <span className="min-w-0 truncate text-sm text-foreground">
                              {campaign.name}
                            </span>
                            <span
                              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                isSelected
                                  ? "border-[#90FF4D]/45 bg-[#90FF4D]/18 text-[#B8FF86]"
                                  : "border-white/[0.12] bg-black/[0.24] text-transparent"
                              }`}
                            >
                              <svg
                                aria-hidden="true"
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 16 16"
                              >
                                <path
                                  d="M3.75 8.25L6.5 11L12.25 5.25"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="1.4"
                                />
                              </svg>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      Selected campaigns are invited with member-level campaign
                      access. Promote campaign managers from the campaigns screen if
                      needed.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    This invite will include every current campaign with member-level
                    campaign access.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                No campaigns exist yet. Create one first, then you can narrow invite
                access here.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex items-end">
        <button
          className="inline-flex w-full items-center justify-center rounded-full border border-[#90FF4D]/28 bg-[#90FF4D]/92 px-5 py-3 text-sm font-semibold text-black shadow-[0_18px_45px_rgba(144,255,77,0.22)] transition hover:bg-[#A4FF68] lg:w-auto"
          type="submit"
        >
          Add member
        </button>
      </div>
    </form>
  );
}
