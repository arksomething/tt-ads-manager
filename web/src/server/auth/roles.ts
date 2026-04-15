import { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";

const organizationRoleWeight: Record<OrganizationRole, number> = {
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
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
];

const campaignAssignableRoles = [CampaignRole.MANAGER, CampaignRole.MEMBER];

export function canManageOrganization(role: OrganizationRole) {
  return role === OrganizationRole.OWNER || role === OrganizationRole.ADMIN;
}

export function canManageOrganizationRole(
  viewerRole: OrganizationRole,
  targetRole: OrganizationRole,
) {
  if (!canManageOrganization(viewerRole)) {
    return false;
  }

  if (targetRole === OrganizationRole.OWNER) {
    return viewerRole === OrganizationRole.OWNER;
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

  if (nextRole === OrganizationRole.OWNER) {
    return viewerRole === OrganizationRole.OWNER;
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
  return role === CampaignRole.OWNER || role === CampaignRole.MANAGER;
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
