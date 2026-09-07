import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260901090000_signwell_in_progress_resumable.sql",
  ),
  "utf8",
);

describe("SignWell in-progress state repair", () => {
  it("keeps signing-started evidence resumable while reserving acceptance for signed evidence", () => {
    expect(migration).toContain(
      "'when ''document_in_progress'' then ''creator_accepted''',",
    );
    expect(migration).toContain(
      "'when ''document_in_progress'' then ''viewed'''",
    );
    expect(migration).not.toContain(
      "'when ''document_signed'' then ''viewed'''",
    );
  });

  it("repairs only records without signed or completed evidence", () => {
    expect(migration).toContain("set status = 'viewed'");
    expect(migration).toContain("event_record.event_type = 'document_in_progress'");
    expect(migration).toContain(
      "event_record.event_type in ('document_signed', 'document_completed')",
    );
    expect(migration).toContain("event_record.processing_status = 'processed'");
  });
});
