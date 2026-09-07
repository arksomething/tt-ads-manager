export const ADMIN_STAFF_GRANT_CONFIRMATION_PREFIX = "GRANT ADMIN ACCESS TO ";

export function adminStaffGrantConfirmation(normalizedEmail: string) {
  return `${ADMIN_STAFF_GRANT_CONFIRMATION_PREFIX}${normalizedEmail}`;
}
