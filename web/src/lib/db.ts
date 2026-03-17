import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaDatasourceUrl: string | undefined;
};

type PrismaClientWithDelegates = PrismaClient & Record<string, unknown>;

const expectedDelegateKeys = Object.values(Prisma.ModelName).map((modelName) => {
  const [firstCharacter = "", ...rest] = modelName;
  return `${firstCharacter.toLowerCase()}${rest.join("")}`;
});

function createPrismaClient(datasourceUrl?: string) {
  return new PrismaClient({
    ...(datasourceUrl
      ? {
          datasources: {
            db: {
              url: datasourceUrl,
            },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getDatasourceUrl() {
  const rawUrl = process.env.DATABASE_URL;

  if (!rawUrl) {
    return undefined;
  }

  try {
    const datasourceUrl = new URL(rawUrl);
    const isSupabasePooler = datasourceUrl.hostname.endsWith(
      ".pooler.supabase.com",
    );

    if (!isSupabasePooler) {
      return rawUrl;
    }

    // Supabase pooler URLs can hit session client caps quickly with Prisma's
    // default pool size, so keep the client pool intentionally small.
    if (!datasourceUrl.searchParams.has("connection_limit")) {
      datasourceUrl.searchParams.set("connection_limit", "1");
    }

    if (
      datasourceUrl.port === "6543" &&
      !datasourceUrl.searchParams.has("pgbouncer")
    ) {
      datasourceUrl.searchParams.set("pgbouncer", "true");
    }

    return datasourceUrl.toString();
  } catch {
    return rawUrl;
  }
}

function hasAllExpectedDelegates(client: PrismaClientWithDelegates) {
  return expectedDelegateKeys.every((delegateKey) => client[delegateKey] !== undefined);
}

const datasourceUrl = getDatasourceUrl();
const cachedPrisma = globalForPrisma.prisma as PrismaClientWithDelegates | undefined;
const canReuseCachedPrisma =
  cachedPrisma &&
  hasAllExpectedDelegates(cachedPrisma) &&
  globalForPrisma.prismaDatasourceUrl === datasourceUrl;

if (cachedPrisma && !canReuseCachedPrisma) {
  void cachedPrisma.$disconnect().catch(() => undefined);
}

export const prisma =
  canReuseCachedPrisma
    ? cachedPrisma
    : createPrismaClient(datasourceUrl);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatasourceUrl = datasourceUrl;
}
