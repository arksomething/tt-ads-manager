import { createClient } from "@/lib/supabase/server";
import { adminStaffGrantConfirmation } from "@/lib/admin-staff-access";

type UnknownRecord = Record<string, unknown>;

export const adminStaffRoles = ["reviewer", "admin"] as const;
export type AdminStaffRole = (typeof adminStaffRoles)[number];

export type AdminStaffMember = {
  email: string;
  role: AdminStaffRole;
  active: boolean;
  emailConfirmed: boolean;
};

export const adminStaffRequestOutcomes = ["added", "reactivated", "already_active"] as const;
export type AdminStaffRequestOutcome = (typeof adminStaffRequestOutcomes)[number];

export type AdminStaffAccessEvent = {
  actor: string;
  targetEmail: string;
  priorRole: AdminStaffRole | null;
  priorActive: boolean | null;
  newRole: AdminStaffRole;
  newActive: true;
  outcome: "added" | "reactivated";
  createdAt: string;
};

export type AdminStaffDirectory = {
  staffMembers: AdminStaffMember[];
  recentEvents: AdminStaffAccessEvent[];
};

export type AdminStaffAccessInput = {
  email: string;
  role: AdminStaffRole;
  confirmation: string | null;
};

export type AdminStaffMutation = {
  staffMember: AdminStaffMember;
  requestOutcome: AdminStaffRequestOutcome;
};

const emailPattern = /^[^\s@]+@[^\s@]+$/u;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && emailPattern.test(email)
    ? email
    : null;
}

function roleValue(value: unknown): AdminStaffRole | null {
  return adminStaffRoles.find((role) => role === value) ?? null;
}

function timestampValue(value: unknown) {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function auditActor(value: unknown) {
  if (value === "Restricted service-role recovery" || value === "Restricted DB-owner recovery") {
    return value;
  }
  const email = normalizedEmail(value);
  return email && value === email ? email : null;
}

export function normalizeAdminStaffMember(value: unknown): AdminStaffMember | null {
  const record = recordValue(value);
  const email = normalizedEmail(record?.email);
  const role = roleValue(record?.role);
  if (
    !record || !email || record.email !== email || !role ||
    typeof record.active !== "boolean" || typeof record.emailConfirmed !== "boolean"
  ) return null;

  return {
    email,
    role,
    active: record.active,
    emailConfirmed: record.emailConfirmed,
  };
}

export function normalizeAdminStaffDirectory(value: unknown): AdminStaffDirectory | null {
  const record = recordValue(firstValue(value));
  if (
    !record || !Array.isArray(record.staffMembers) || !Array.isArray(record.recentEvents)
  ) return null;

  const staffMembers = record.staffMembers.map(normalizeAdminStaffMember);
  if (staffMembers.some((member) => member === null)) return null;

  const recentEvents = record.recentEvents.map(normalizeAdminStaffAccessEvent);
  if (recentEvents.some((event) => event === null)) return null;

  const normalized = staffMembers as AdminStaffMember[];
  if (new Set(normalized.map((member) => member.email)).size !== normalized.length) return null;
  return {
    staffMembers: normalized,
    recentEvents: recentEvents as AdminStaffAccessEvent[],
  };
}

export function normalizeAdminStaffAccessEvent(value: unknown): AdminStaffAccessEvent | null {
  const record = recordValue(value);
  if (!record) return null;
  const actor = auditActor(record.actor);
  const targetEmail = normalizedEmail(record.targetEmail);
  const priorRole = record.priorRole === null ? null : roleValue(record.priorRole);
  const priorActive = record.priorActive === null ? null : record.priorActive;
  const newRole = roleValue(record.newRole);
  const createdAt = timestampValue(record.createdAt);
  const outcome = record.outcome === "added" || record.outcome === "reactivated"
    ? record.outcome
    : null;
  if (
    !actor || !targetEmail || record.targetEmail !== targetEmail || !newRole ||
    record.newActive !== true || !outcome || !createdAt ||
    (record.priorRole !== null && !priorRole) ||
    (record.priorActive !== null && typeof priorActive !== "boolean") ||
    (outcome === "added" && (priorRole !== null || priorActive !== null)) ||
    (outcome === "reactivated" && (priorRole !== newRole || priorActive !== false))
  ) return null;

  return {
    actor,
    targetEmail,
    priorRole,
    priorActive: priorActive as boolean | null,
    newRole,
    newActive: true,
    outcome,
    createdAt,
  };
}

export function normalizeAdminStaffMutation(
  value: unknown,
  expected: Pick<AdminStaffAccessInput, "email" | "role">,
): AdminStaffMutation | null {
  const record = recordValue(firstValue(value));
  const staffMember = normalizeAdminStaffMember(record?.staffMember);
  const requestOutcome = adminStaffRequestOutcomes.find(
    (outcome) => outcome === record?.requestOutcome,
  );
  return staffMember
    && staffMember.email === expected.email
    && staffMember.role === expected.role
    && staffMember.active
    && staffMember.emailConfirmed
    && requestOutcome
    ? { staffMember, requestOutcome }
    : null;
}

export function parseAdminStaffAccessInput(value: unknown): AdminStaffAccessInput | null {
  const record = recordValue(value);
  if (!record) return null;
  const keys = Object.keys(record);

  const email = normalizedEmail(record.email);
  const role = roleValue(record.role);
  if (!email || !role) return null;

  if (role === "admin") {
    if (
      keys.length !== 3 || !keys.includes("email") || !keys.includes("role") ||
      !keys.includes("confirmation") ||
      record.confirmation !== adminStaffGrantConfirmation(email)
    ) return null;
    return { email, role, confirmation: record.confirmation };
  }

  if (keys.length !== 2 || !keys.includes("email") || !keys.includes("role")) return null;
  return { email, role, confirmation: null };
}

export async function getAdminStaffDirectory(): Promise<AdminStaffDirectory> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_staff_directory");
  if (error) throw error;

  const directory = normalizeAdminStaffDirectory(data);
  if (!directory) throw new Error("Staff directory returned invalid data.");
  return directory;
}
