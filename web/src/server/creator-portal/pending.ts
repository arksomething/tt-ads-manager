export function hasPendingCreatorPortalData(warnings: string[]) {
  return warnings.some(
    (warning) =>
      warning.startsWith("Singular is still preparing the report") ||
      warning.startsWith("Singular report status is ") ||
      warning.startsWith("Singular is still preparing one or more report exports") ||
      warning.startsWith("Singular source proceeds report status is ") ||
      warning.startsWith("Singular is still preparing the source proceeds report"),
  );
}
