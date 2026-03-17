function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugifyOrganizationName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "organization";
}

export function normalizeOrganizationNameKey(name: string) {
  return name.trim().toLowerCase();
}

export function getOrganizationNameSequence(name: string, baseName: string) {
  const trimmedName = name.trim();
  const trimmedBaseName = baseName.trim();

  if (normalizeOrganizationNameKey(trimmedName) === normalizeOrganizationNameKey(trimmedBaseName)) {
    return 1;
  }

  const match = new RegExp(`^${escapeRegExp(trimmedBaseName)} (\\d+)$`, "i").exec(
    trimmedName,
  );

  if (!match) {
    return null;
  }

  const sequence = Number(match[1]);
  return Number.isInteger(sequence) && sequence > 1 ? sequence : null;
}

export function getOrganizationSlugSequence(slug: string, baseSlug: string) {
  if (slug === baseSlug) {
    return 1;
  }

  const match = new RegExp(`^${escapeRegExp(baseSlug)}-(\\d+)$`).exec(slug);

  if (!match) {
    return null;
  }

  const sequence = Number(match[1]);
  return Number.isInteger(sequence) && sequence > 1 ? sequence : null;
}

export function formatOrganizationName(baseName: string, sequence: number) {
  return sequence === 1 ? baseName : `${baseName} ${sequence}`;
}

export function formatOrganizationSlug(baseSlug: string, sequence: number) {
  return sequence === 1 ? baseSlug : `${baseSlug}-${sequence}`;
}

export function getOrganizationDisplayName(args: {
  name: string;
  slug: string;
  hasNameCollision: boolean;
}) {
  const { name, slug, hasNameCollision } = args;

  if (!hasNameCollision) {
    return name;
  }

  const baseSlug = slugifyOrganizationName(name);
  const sequence = getOrganizationSlugSequence(slug, baseSlug);

  if (sequence) {
    return formatOrganizationName(name, sequence);
  }

  return `${name} (${slug})`;
}
