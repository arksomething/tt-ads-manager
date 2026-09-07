import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type ContentAssignment = {
  id: string;
  enrollmentId: string;
  creatorName: string;
  state: string;
  dueAt: string | null;
};

export type ContentCreator = {
  enrollmentId: string;
  name: string;
  email: string;
  status: string;
};

export type AdminScript = {
  id: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  status: "draft" | "published" | "archived";
  revision: number;
  publishedAt: string | null;
  updatedAt: string;
  assignments: ContentAssignment[];
};

export type AdminAsset = {
  id: string;
  title: string;
  description: string;
  assetKind: string;
  sourceType: "upload" | "external_url";
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  status: "draft" | "published" | "archived";
  revision: number;
  publishedAt: string | null;
  updatedAt: string;
  assignments: ContentAssignment[];
};

export type ContentAdminOverview = {
  scripts: AdminScript[];
  assets: AdminAsset[];
  creators: ContentCreator[];
};

export type CreatorScript = {
  assignmentId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  revision: number;
  note: string;
  dueAt: string | null;
  state: "assigned" | "viewed" | "used";
  assignedAt: string;
};

export type CreatorAsset = {
  assignmentId: string;
  assetId: string;
  title: string;
  description: string;
  assetKind: string;
  sourceType: "upload" | "external_url";
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  revision: number;
  note: string;
  state: "assigned" | "viewed";
  assignedAt: string;
};

export type CreatorContentLibrary = {
  scripts: CreatorScript[];
  assets: CreatorAsset[];
};

export type CreatorAssetDownload = {
  sourceType: "upload" | "external_url";
  externalUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  downloadFilename: string;
  assignmentId: string | null;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function firstRecord(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value);
}

function array(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => {
    const itemRecord = record(item);
    return itemRecord ? [itemRecord] : [];
  }) : [];
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown) {
  const valueText = textValue(value).trim();
  return valueText || null;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown) {
  const candidate = nullableText(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function assignment(value: UnknownRecord): ContentAssignment | null {
  const id = nullableText(value.id);
  const enrollmentId = nullableText(value.enrollment_id);
  const creatorName = nullableText(value.creator_name);
  const state = nullableText(value.state);
  const dueAt = value.due_at === null || value.due_at === undefined
    ? null
    : timestamp(value.due_at);
  if (
    !id || !enrollmentId || !creatorName ||
    !state || !["assigned", "viewed", "used"].includes(state) ||
    (value.due_at !== null && value.due_at !== undefined && !dueAt)
  ) return null;
  return {
    id,
    enrollmentId,
    creatorName,
    state,
    dueAt,
  };
}

function adminScript(value: UnknownRecord): AdminScript | null {
  const id = nullableText(value.id);
  const title = nullableText(value.title);
  const summary = typeof value.summary === "string" ? value.summary : null;
  const bodyMarkdown = nullableText(value.body_markdown);
  const status = textValue(value.status);
  const revision = positiveInteger(value.revision);
  const publishedAt = value.published_at === null ? null : timestamp(value.published_at);
  const updatedAt = timestamp(value.updated_at);
  if (
    !id || !title || summary === null || !bodyMarkdown ||
    (status !== "draft" && status !== "published" && status !== "archived") ||
    !revision || (value.published_at !== null && !publishedAt) || !updatedAt ||
    !Array.isArray(value.assignments)
  ) return null;

  const assignments = value.assignments.map((item) => {
    const itemRecord = record(item);
    return itemRecord ? assignment(itemRecord) : null;
  });
  if (assignments.some((item) => !item)) return null;

  return {
    id,
    title,
    summary,
    bodyMarkdown,
    status,
    revision,
    publishedAt,
    updatedAt,
    assignments: assignments as ContentAssignment[],
  };
}

function adminAsset(value: UnknownRecord): AdminAsset | null {
  const id = nullableText(value.id);
  const title = nullableText(value.title);
  const description = typeof value.description === "string" ? value.description : null;
  const assetKind = nullableText(value.asset_kind);
  const sourceType = textValue(value.source_type);
  const status = textValue(value.status);
  const revision = positiveInteger(value.revision);
  const publishedAt = value.published_at === null ? null : timestamp(value.published_at);
  const updatedAt = timestamp(value.updated_at);
  const sizeBytes = value.size_bytes === null ? null : nonnegativeInteger(value.size_bytes);
  if (
    !id || !title || description === null || !assetKind ||
    (sourceType !== "upload" && sourceType !== "external_url") ||
    (status !== "draft" && status !== "published" && status !== "archived") ||
    !revision || (value.published_at !== null && !publishedAt) || !updatedAt ||
    (value.size_bytes !== null && sizeBytes === null) || !Array.isArray(value.assignments)
  ) return null;

  const assignments = value.assignments.map((item) => {
    const itemRecord = record(item);
    return itemRecord ? assignment(itemRecord) : null;
  });
  if (assignments.some((item) => !item)) return null;

  return {
    id,
    title,
    description,
    assetKind,
    sourceType,
    originalFilename: nullableText(value.original_filename),
    mimeType: nullableText(value.mime_type),
    sizeBytes,
    externalUrl: nullableText(value.external_url),
    status,
    revision,
    publishedAt,
    updatedAt,
    assignments: assignments as ContentAssignment[],
  };
}

function contentCreator(value: UnknownRecord): ContentCreator | null {
  const enrollmentId = nullableText(value.enrollment_id);
  const name = nullableText(value.name);
  const email = nullableText(value.email);
  const status = nullableText(value.status);
  return enrollmentId && name && email && status
    ? { enrollmentId, name, email, status }
    : null;
}

export function normalizeContentAdminOverview(value: unknown): ContentAdminOverview | null {
  const row = firstRecord(value);
  if (!row) return null;
  const overview = "overview" in row ? record(row.overview) : row;
  if (
    !overview || !Array.isArray(overview.scripts) ||
    !Array.isArray(overview.assets) || !Array.isArray(overview.creators)
  ) return null;

  const scripts = overview.scripts.map((item) => {
    const itemRecord = record(item);
    return itemRecord ? adminScript(itemRecord) : null;
  });
  const assets = overview.assets.map((item) => {
    const itemRecord = record(item);
    return itemRecord ? adminAsset(itemRecord) : null;
  });
  const creators = overview.creators.map((item) => {
    const itemRecord = record(item);
    return itemRecord ? contentCreator(itemRecord) : null;
  });
  if (
    scripts.some((item) => !item) || assets.some((item) => !item) ||
    creators.some((item) => !item)
  ) return null;

  return {
    scripts: scripts as AdminScript[],
    assets: assets as AdminAsset[],
    creators: creators as ContentCreator[],
  };
}

export function normalizeCreatorContentLibrary(value: unknown): CreatorContentLibrary {
  const row = firstRecord(value);
  const library = record(row?.library) ?? row ?? {};
  return {
    scripts: array(library.scripts).flatMap((script) => {
      const assignmentId = nullableText(script.assignment_id);
      const state = textValue(script.state);
      if (!assignmentId || (state !== "assigned" && state !== "viewed" && state !== "used")) return [];
      return [{
        assignmentId,
        title: textValue(script.title, "Untitled script"),
        summary: textValue(script.summary),
        bodyMarkdown: textValue(script.body_markdown),
        revision: numberValue(script.revision, 1),
        note: textValue(script.note),
        dueAt: nullableText(script.due_at),
        state,
        assignedAt: textValue(script.assigned_at),
      }];
    }),
    assets: array(library.assets).flatMap((asset) => {
      const assignmentId = nullableText(asset.assignment_id);
      const assetId = nullableText(asset.asset_id);
      const sourceType = textValue(asset.source_type);
      const state = textValue(asset.state);
      if (!assignmentId || !assetId || (sourceType !== "upload" && sourceType !== "external_url")
        || (state !== "assigned" && state !== "viewed")) return [];
      return [{
        assignmentId,
        assetId,
        title: textValue(asset.title, "Untitled asset"),
        description: textValue(asset.description),
        assetKind: textValue(asset.asset_kind, "other"),
        sourceType,
        originalFilename: nullableText(asset.original_filename),
        mimeType: nullableText(asset.mime_type),
        sizeBytes: asset.size_bytes === null ? null : numberValue(asset.size_bytes),
        revision: numberValue(asset.revision, 1),
        note: textValue(asset.note),
        state,
        assignedAt: textValue(asset.assigned_at),
      }];
    }),
  };
}

export function normalizeCreatorAssetDownload(value: unknown): CreatorAssetDownload | null {
  const row = firstRecord(value);
  if (!row) return null;
  const sourceType = textValue(row.source_type);
  const assignmentId = nullableText(row.assignment_id);
  if (sourceType !== "upload" && sourceType !== "external_url") return null;
  return {
    sourceType,
    externalUrl: nullableText(row.external_url),
    storageBucket: nullableText(row.storage_bucket),
    storagePath: nullableText(row.storage_path),
    downloadFilename: textValue(row.download_filename, "creator-asset")
      .replace(/[\\/\r\n]+/gu, "-")
      .slice(0, 180) || "creator-asset",
    assignmentId,
  };
}

export async function getContentAdminOverview() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_content_admin_overview");
  if (error) throw error;
  const overview = normalizeContentAdminOverview(data);
  if (!overview) throw new Error("The content administration overview returned invalid data.");
  return overview;
}

export async function getOwnCreatorContentLibrary() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_creator_content_library");
  if (error) throw error;
  return normalizeCreatorContentLibrary(data);
}

export async function getOwnCreatorAssetDownload(assetId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_creator_asset_download", {
    target_asset_id: assetId,
  });
  if (error) throw error;
  return normalizeCreatorAssetDownload(data);
}
