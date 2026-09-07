"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { adminStaffGrantConfirmation } from "@/lib/admin-staff-access";
import type { AdminStaffMember } from "@/server/admin/staff";

import styles from "./staff.module.css";

type ApiResult = {
  staffMember?: AdminStaffMember;
  requestOutcome?: "added" | "reactivated" | "already_active";
  error?: string;
};

function resultMutation(
  value: ApiResult | null,
  expectedEmail: string,
  expectedRole: AdminStaffMember["role"],
) {
  const member = value?.staffMember;
  if (
    !member || typeof member.email !== "string" ||
    (member.role !== "reviewer" && member.role !== "admin") ||
    member.email !== expectedEmail || member.role !== expectedRole ||
    member.active !== true || member.emailConfirmed !== true ||
    !["added", "reactivated", "already_active"].includes(value?.requestOutcome ?? "")
  ) return null;
  return {
    staffMember: member,
    requestOutcome: value?.requestOutcome as "added" | "reactivated" | "already_active",
  };
}

function roleLabel(role: AdminStaffMember["role"]) {
  return role === "admin" ? "Administrator" : "Reviewer";
}

export function StaffAccessForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<"reviewer" | "admin">("reviewer");
  const [confirmationInput, setConfirmationInput] = useState("");
  const normalizedEmail = emailInput.trim().toLowerCase();
  const requiredAdminConfirmation = adminStaffGrantConfirmation(normalizedEmail);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const formElement = event.currentTarget;
    const email = normalizedEmail;
    const role = roleInput;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(role === "admin"
          ? { email, role, confirmation: confirmationInput }
          : { email, role }),
      });
      const result = await response.json().catch(() => null) as ApiResult | null;
      const mutation = resultMutation(result, email, role);
      if (!response.ok || !mutation) {
        setError(result?.error ?? "Staff access could not be saved.");
        return;
      }

      const outcomeCopy = mutation.requestOutcome === "already_active"
        ? "already has"
        : "now has";
      setNotice(`${mutation.staffMember.email} ${outcomeCopy} active ${roleLabel(mutation.staffMember.role).toLowerCase()} access.`);
      formElement.reset();
      setEmailInput("");
      setRoleInput("reviewer");
      setConfirmationInput("");
      router.refresh();
    } catch {
      setError("The staff service could not be reached. No access change is being claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>Existing account email</span>
        <input
          autoComplete="off"
          inputMode="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmailInput(event.currentTarget.value)}
          placeholder="person@example.com"
          required
          spellCheck={false}
          type="email"
          value={emailInput}
        />
        <small>The account must already exist in this app and have a confirmed email.</small>
      </label>
      <label>
        <span>Access role</span>
        <select
          name="role"
          onChange={(event) => {
            const role = event.currentTarget.value === "admin" ? "admin" : "reviewer";
            setRoleInput(role);
            if (role === "reviewer") setConfirmationInput("");
          }}
          value={roleInput}
        >
          <option value="reviewer">Reviewer</option>
          <option value="admin">Administrator</option>
        </select>
        <small>Administrators can grant staff access. Reviewers cannot.</small>
      </label>
      {roleInput === "admin" ? (
        <label>
          <span>Type to confirm administrator access</span>
          <code className={styles.confirmation}>{requiredAdminConfirmation}</code>
          <input
            autoComplete="off"
            name="confirmation"
            onChange={(event) => setConfirmationInput(event.currentTarget.value)}
            required
            spellCheck={false}
            type="text"
            value={confirmationInput}
          />
          <small>Copy the phrase exactly. It is checked again by the API and database.</small>
        </label>
      ) : null}
      <button className="button button--ink" disabled={saving} type="submit">
        {saving ? "Saving access…" : "Add or reactivate staff"}
      </button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    </form>
  );
}
