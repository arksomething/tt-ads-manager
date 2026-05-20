import type { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";

const organizationRoleWeight: Record<OrganizationRole, number> = {
  BLAZIE: -1,
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

const campaignRoleWeight: Record<CampaignRole, number> = {
  MEMBER: 0,
  MANAGER: 1,
  OWNER: 2,
};

const organizationRolesInPriorityOrder = [
  "OWNER",
  "ADMIN",
  "MEMBER",
  "BLAZIE",
] as OrganizationRole[];

const campaignAssignableRoles = ["MANAGER", "MEMBER"] as CampaignRole[];

export function canManageOrganization(role: OrganizationRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function isBlazieOnlyOrganizationRole(role: OrganizationRole | string) {
  return role === "BLAZIE";
}

export function canReadOrganizationCampaignData(role: OrganizationRole) {
  return canManageOrganization(role) || isBlazieOnlyOrganizationRole(role);
}

export function canManageOrganizationRole(
  viewerRole: OrganizationRole,
  targetRole: OrganizationRole,
) {
  if (!canManageOrganization(viewerRole)) {
    return false;
  }

  if (targetRole === "OWNER") {
    return viewerRole === "OWNER";
  }

  return true;
}

export function canAssignOrganizationRole(
  viewerRole: OrganizationRole,
  nextRole: OrganizationRole,
) {
  if (!canManageOrganization(viewerRole)) {
    return false;
  }

  if (nextRole === "OWNER") {
    return viewerRole === "OWNER";
  }

  return true;
}

export function getManageableOrganizationRoles(
  viewerRole: OrganizationRole,
  targetRole: OrganizationRole,
) {
  if (!canManageOrganizationRole(viewerRole, targetRole)) {
    return [];
  }

  return organizationRolesInPriorityOrder.filter((role) =>
    canAssignOrganizationRole(viewerRole, role),
  );
}

export function mergeOrganizationRoles(
  currentRole: OrganizationRole,
  invitedRole: OrganizationRole,
) {
  return organizationRoleWeight[currentRole] >= organizationRoleWeight[invitedRole]
    ? currentRole
    : invitedRole;
}

export function canManageCampaign(role: CampaignRole) {
  return role === "OWNER" || role === "MANAGER";
}

export function getAssignableCampaignRoles() {
  return campaignAssignableRoles;
}

export function mergeCampaignRoles(
  currentRole: CampaignRole,
  invitedRole: CampaignRole,
) {
  return campaignRoleWeight[currentRole] >= campaignRoleWeight[invitedRole]
    ? currentRole
    : invitedRole;
}
