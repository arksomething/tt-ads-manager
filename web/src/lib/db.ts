import { randomUUID } from "node:crypto";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { modelSchema, type ModelName } from "@/lib/db-schema.generated";
import { getSupabaseDatabaseEnv } from "@/lib/server-env";

type RecordValue = Record<string, unknown>;

type QueryArgs = {
  by?: string[];
  data?: RecordValue;
  include?: RecordValue;
  orderBy?: RecordValue | RecordValue[];
  select?: RecordValue;
  skip?: number;
  take?: number;
  update?: RecordValue;
  where?: RecordValue;
  _avg?: RecordValue;
  _count?: RecordValue | boolean;
  _max?: RecordValue;
  _min?: RecordValue;
  _sum?: RecordValue;
};

type QueryContext = {
  rowCache: Map<ModelName, Promise<RecordValue[]>>;
  tableStatus: Map<ModelName, "ready" | "missing">;
};

type FieldMeta = {
  kind: "scalar" | "enum" | "relation";
  type: string;
  isList: boolean;
  isOptional: boolean;
};

type RelationMeta = {
  model: ModelName;
  isList: boolean;
  localFields: readonly string[];
  remoteFields: readonly string[];
};

type ModelMeta = {
  table: string;
  fields: Record<string, FieldMeta>;
  relations: Record<string, RelationMeta>;
};

type DbDelegate = {
  aggregate: (args: QueryArgs) => Promise<any>;
  count: (args?: QueryArgs) => Promise<number>;
  create: (args: QueryArgs) => Promise<any>;
  delete: (args: QueryArgs) => Promise<any>;
  deleteMany: (args: QueryArgs) => Promise<{ count: number }>;
  findFirst: (args?: QueryArgs) => Promise<any | null>;
  findMany: (args?: QueryArgs) => Promise<any[]>;
  findUnique: (args?: QueryArgs) => Promise<any | null>;
  groupBy: (args: QueryArgs) => Promise<any[]>;
  update: (args: QueryArgs) => Promise<any | null>;
  updateMany: (args: QueryArgs) => Promise<{ count: number }>;
  upsert: (args: QueryArgs & { create?: RecordValue }) => Promise<any>;
};

type ModelDelegates = {
  [K in ModelName as Uncapitalize<K>]: DbDelegate;
};

export type DbClient = ModelDelegates & {
  $disconnect: () => Promise<void>;
  $transaction: <T>(callback: (tx: DbClient) => Promise<T>) => Promise<T>;
};

const modelSchemaMap = modelSchema as unknown as Record<ModelName, ModelMeta>;
const modelNames = Object.keys(modelSchemaMap) as ModelName[];
const modelDelegateNames = Object.fromEntries(
  modelNames.map((modelName) => [
    `${modelName.slice(0, 1).toLowerCase()}${modelName.slice(1)}`,
    modelName,
  ]),
) as Record<string, ModelName>;

const SCALAR_OPERATORS = new Set([
  "equals",
  "in",
  "notIn",
  "contains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "not",
  "has",
  "hasEvery",
  "hasSome",
  "isEmpty",
  "mode",
]);

const globalForDb = globalThis as typeof globalThis & {
  supabaseDbClient?: SupabaseClient;
};

export class SchemaUnavailableError extends Error {
  constructor(message = "Workspace database schema is unavailable.") {
    super(message);
    this.name = "SchemaUnavailableError";
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

function isSupabaseMissingTableError(error: PostgrestError | null | undefined) {
  return error?.code === "PGRST205";
}

function createQueryContext(): QueryContext {
  return {
    rowCache: new Map<ModelName, Promise<RecordValue[]>>(),
    tableStatus: new Map<ModelName, "ready" | "missing">(),
  };
}

function getModelMeta(modelName: ModelName) {
  return modelSchemaMap[modelName];
}

function getFieldMeta(modelName: ModelName, fieldName: string) {
  return getModelMeta(modelName).fields[fieldName];
}

function getRelationMeta(modelName: ModelName, fieldName: string) {
  return getModelMeta(modelName).relations[fieldName];
}

function getSupabaseDbClient() {
  if (globalForDb.supabaseDbClient) {
    return globalForDb.supabaseDbClient;
  }

  try {
    const env = getSupabaseDatabaseEnv();
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVER_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    globalForDb.supabaseDbClient = client;
    return client;
  } catch {
    return null;
  }
}

function cloneValue<T>(value: T): T {
  if (isDate(value)) {
    return new Date(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }

  return value;
}

function coerceFieldValue(field: FieldMeta | undefined, value: unknown): unknown {
  if (value == null || !field) {
    return value ?? null;
  }

  if (field.isList) {
    return Array.isArray(value)
      ? value.map((entry) => coerceFieldValue({ ...field, isList: false }, entry))
      : [];
  }

  switch (field.type) {
    case "DateTime":
      return typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : value;
    case "Int":
    case "Float":
    case "Decimal": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
      }

      return value;
    }
    default:
      return value;
  }
}

function normalizeRow(modelName: ModelName, row: RecordValue) {
  const fields = getModelMeta(modelName).fields;

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, coerceFieldValue(fields[key], value)]),
  );
}

function serializeFieldValue(field: FieldMeta | undefined, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFieldValue(field ? { ...field, isList: false } : undefined, entry));
  }

  if (isDate(value)) {
    return value.toISOString();
  }

  if (field?.type === "Json") {
    return value;
  }

  return value;
}

function isPushdownPrimitive(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isDate(value)
  );
}

function isPushdownPrimitiveArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((entry) => isPushdownPrimitive(entry));
}

function canPushDownScalarCondition(condition: unknown): boolean {
  if (!isRecord(condition) || !isOperatorObject(condition)) {
    return isPushdownPrimitive(condition);
  }

  for (const [operator, operand] of Object.entries(condition)) {
    switch (operator) {
      case "mode":
        if (operand !== "insensitive") {
          return false;
        }
        break;
      case "equals":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        if (!isPushdownPrimitive(operand)) {
          return false;
        }
        break;
      case "in":
      case "notIn":
        if (!isPushdownPrimitiveArray(operand)) {
          return false;
        }
        break;
      case "contains":
      case "startsWith":
      case "endsWith":
        if (typeof operand !== "string") {
          return false;
        }
        break;
      default:
        return false;
    }
  }

  return true;
}

function canPushDownWhere(modelName: ModelName, where: unknown): boolean {
  if (!where) {
    return true;
  }

  if (!isRecord(where)) {
    return false;
  }

  const andConditions = Array.isArray(where.AND)
    ? where.AND
    : where.AND
      ? [where.AND]
      : [];
  const orConditions = Array.isArray(where.OR)
    ? where.OR
    : where.OR
      ? [where.OR]
      : [];
  const notConditions = Array.isArray(where.NOT)
    ? where.NOT
    : where.NOT
      ? [where.NOT]
      : [];

  if (orConditions.length > 0 || notConditions.length > 0) {
    return false;
  }

  if (!andConditions.every((condition) => canPushDownWhere(modelName, condition))) {
    return false;
  }

  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND" || key === "OR" || key === "NOT") {
      return true;
    }

    if (getRelationMeta(modelName, key)) {
      return false;
    }

    return canPushDownScalarCondition(condition);
  });
}

function getPushdownSelectColumns(modelName: ModelName, args: QueryArgs | undefined) {
  if (args?.include) {
    return null;
  }

  if (!args?.select) {
    return "*";
  }

  const columns: string[] = [];

  for (const [fieldName, fieldSelection] of Object.entries(args.select)) {
    if (!fieldSelection) {
      continue;
    }

    if (fieldName === "_count") {
      return null;
    }

    const field = getFieldMeta(modelName, fieldName);

    if (!field || field.kind === "relation" || fieldSelection !== true) {
      return null;
    }

    columns.push(fieldName);
  }

  return columns.length > 0 ? columns.join(",") : "*";
}

function getPushdownOrderSpecs(
  modelName: ModelName,
  orderBy: RecordValue | RecordValue[] | undefined,
) {
  const orderSpecs = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  return orderSpecs.map((orderSpec) => {
    const [fieldName, direction] = Object.entries(orderSpec)[0] ?? [];

    if (
      !fieldName ||
      getRelationMeta(modelName, fieldName) ||
      (direction !== "asc" && direction !== "desc")
    ) {
      return null;
    }

    const field = getFieldMeta(modelName, fieldName);

    if (!field || field.kind === "relation") {
      return null;
    }

    return {
      fieldName,
      ascending: direction === "asc",
    };
  });
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function applyPushdownEquals(
  query: any,
  fieldName: string,
  field: FieldMeta | undefined,
  value: unknown,
  insensitive = false,
) {
  if (value === null) {
    return query.is(fieldName, null);
  }

  const serialized = serializeFieldValue(field, value);

  if (insensitive && typeof serialized === "string") {
    return query.ilike(fieldName, escapeLikePattern(serialized));
  }

  return query.eq(fieldName, serialized);
}

function applyPushdownScalarCondition(
  query: any,
  modelName: ModelName,
  fieldName: string,
  condition: unknown,
) {
  const field = getFieldMeta(modelName, fieldName);

  if (!isRecord(condition) || !isOperatorObject(condition)) {
    return applyPushdownEquals(query, fieldName, field, condition);
  }

  const insensitive = condition.mode === "insensitive";
  let nextQuery = query;

  for (const [operator, operand] of Object.entries(condition)) {
    switch (operator) {
      case "mode":
        break;
      case "equals":
        nextQuery = applyPushdownEquals(nextQuery, fieldName, field, operand, insensitive);
        break;
      case "in":
        nextQuery = nextQuery.in(
          fieldName,
          (operand as unknown[]).map((value) => serializeFieldValue(field, value)),
        );
        break;
      case "notIn":
        nextQuery = nextQuery.not(
          fieldName,
          "in",
          `(${(operand as unknown[])
            .map((value) => JSON.stringify(serializeFieldValue(field, value)))
            .join(",")})`,
        );
        break;
      case "contains":
        nextQuery = insensitive
          ? nextQuery.ilike(fieldName, `%${escapeLikePattern(String(operand))}%`)
          : nextQuery.like(fieldName, `%${escapeLikePattern(String(operand))}%`);
        break;
      case "startsWith":
        nextQuery = insensitive
          ? nextQuery.ilike(fieldName, `${escapeLikePattern(String(operand))}%`)
          : nextQuery.like(fieldName, `${escapeLikePattern(String(operand))}%`);
        break;
      case "endsWith":
        nextQuery = insensitive
          ? nextQuery.ilike(fieldName, `%${escapeLikePattern(String(operand))}`)
          : nextQuery.like(fieldName, `%${escapeLikePattern(String(operand))}`);
        break;
      case "gt":
        nextQuery = nextQuery.gt(fieldName, serializeFieldValue(field, operand));
        break;
      case "gte":
        nextQuery = nextQuery.gte(fieldName, serializeFieldValue(field, operand));
        break;
      case "lt":
        nextQuery = nextQuery.lt(fieldName, serializeFieldValue(field, operand));
        break;
      case "lte":
        nextQuery = nextQuery.lte(fieldName, serializeFieldValue(field, operand));
        break;
      default:
        return null;
    }
  }

  return nextQuery;
}

function applyPushdownWhere(
  query: any,
  modelName: ModelName,
  where: unknown,
) {
  if (!where) {
    return query;
  }

  if (!isRecord(where)) {
    return null;
  }

  let nextQuery = query;
  const andConditions = Array.isArray(where.AND)
    ? where.AND
    : where.AND
      ? [where.AND]
      : [];

  for (const condition of andConditions) {
    nextQuery = applyPushdownWhere(nextQuery, modelName, condition);

    if (!nextQuery) {
      return null;
    }
  }

  for (const [key, condition] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      continue;
    }

    nextQuery = applyPushdownScalarCondition(nextQuery, modelName, key, condition);

    if (!nextQuery) {
      return null;
    }
  }

  return nextQuery;
}

async function tryExecuteFindManyViaSupabase(
  modelName: ModelName,
  args: QueryArgs | undefined,
  context: QueryContext,
  baseRows?: RecordValue[],
) {
  if (baseRows || !canPushDownWhere(modelName, args?.where)) {
    return null;
  }

  const selectColumns = getPushdownSelectColumns(modelName, args);

  if (!selectColumns) {
    return null;
  }

  const orderSpecs = getPushdownOrderSpecs(modelName, args?.orderBy);

  if (orderSpecs.some((orderSpec) => !orderSpec)) {
    return null;
  }

  if ((args?.skip ?? 0) > 0 && typeof args?.take !== "number") {
    return null;
  }

  if (args?.take === 0) {
    context.tableStatus.set(modelName, "ready");
    return [];
  }

  const client = getSupabaseDbClient();

  if (!client) {
    return null;
  }

  let query: any = client.from(getModelMeta(modelName).table).select(selectColumns);
  query = applyPushdownWhere(query, modelName, args?.where);

  if (!query) {
    return null;
  }

  for (const orderSpec of orderSpecs) {
    query = query.order(orderSpec!.fieldName, { ascending: orderSpec!.ascending });
  }

  if (typeof args?.take === "number") {
    const from = args?.skip ?? 0;
    const to = Math.max(from, from + Math.max(args.take, 0) - 1);
    query = query.range(from, to);
  }

  const { data, error } = await query;

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      context.tableStatus.set(modelName, "missing");
      return [];
    }

    throw new Error(`Failed to read ${modelName}: ${error.message}`);
  }

  context.tableStatus.set(modelName, "ready");
  return (data ?? []).map((row: unknown) => normalizeRow(modelName, row as RecordValue));
}

async function tryExecuteCountViaSupabase(
  modelName: ModelName,
  args: QueryArgs | undefined,
  context: QueryContext,
) {
  if (!canPushDownWhere(modelName, args?.where)) {
    return null;
  }

  const client = getSupabaseDbClient();

  if (!client) {
    return null;
  }

  let query: any = client
    .from(getModelMeta(modelName).table)
    .select("*", { count: "exact", head: true });
  query = applyPushdownWhere(query, modelName, args?.where);

  if (!query) {
    return null;
  }

  const { count, error } = await query;

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      context.tableStatus.set(modelName, "missing");
      return 0;
    }

    throw new Error(`Failed to count ${modelName}: ${error.message}`);
  }

  context.tableStatus.set(modelName, "ready");
  return count ?? 0;
}

async function loadRows(modelName: ModelName, context: QueryContext): Promise<RecordValue[]> {
  const cachedRows = context.rowCache.get(modelName);

  if (cachedRows) {
    return cachedRows;
  }

  const loadPromise = (async () => {
    const client = getSupabaseDbClient();

    if (!client) {
      context.tableStatus.set(modelName, "missing");
      return [];
    }

    const rows: RecordValue[] = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from(getModelMeta(modelName).table)
        .select("*")
        .range(from, from + pageSize - 1);

      if (error) {
        if (isSupabaseMissingTableError(error)) {
          context.tableStatus.set(modelName, "missing");
          return [];
        }

        throw new Error(`Failed to read ${modelName}: ${error.message}`);
      }

      context.tableStatus.set(modelName, "ready");
      const normalizedRows = (data ?? []).map((row) => normalizeRow(modelName, row as RecordValue));
      rows.push(...normalizedRows);

      if (normalizedRows.length < pageSize) {
        break;
      }
    }

    return rows;
  })();

  context.rowCache.set(modelName, loadPromise);
  return loadPromise;
}

async function ensureTableAvailable(modelName: ModelName, context: QueryContext) {
  await loadRows(modelName, context);

  if (context.tableStatus.get(modelName) === "missing") {
    throw new SchemaUnavailableError(
      `${modelName} is not available in the current Supabase project.`,
    );
  }
}

async function resolveRelation(
  modelName: ModelName,
  row: RecordValue,
  relationName: string,
  context: QueryContext,
) {
  const relation = getRelationMeta(modelName, relationName);

  if (!relation) {
    return null;
  }

  const relatedRows = await loadRows(relation.model, context);
  const matches = relatedRows.filter((candidate) =>
    relation.localFields.every((localField, index) =>
      areValuesEqual(
        row[localField],
        candidate[relation.remoteFields[index] ?? relation.remoteFields[0]],
      ),
    ),
  );

  return relation.isList ? matches : (matches[0] ?? null);
}

function areValuesEqual(left: unknown, right: unknown, insensitive = false) {
  if (isDate(left) || isDate(right)) {
    const leftDate = isDate(left) ? left.getTime() : new Date(left as string).getTime();
    const rightDate = isDate(right) ? right.getTime() : new Date(right as string).getTime();
    return leftDate === rightDate;
  }

  if (insensitive && typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }

  if (Array.isArray(left) || Array.isArray(right) || isRecord(left) || isRecord(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return left === right;
}

function compareValues(left: unknown, right: unknown) {
  const normalizedLeft = isDate(left)
    ? left.getTime()
    : typeof left === "string"
      ? left.toLowerCase()
      : left;
  const normalizedRight = isDate(right)
    ? right.getTime()
    : typeof right === "string"
      ? right.toLowerCase()
      : right;

  if (normalizedLeft == null && normalizedRight == null) {
    return 0;
  }

  if (normalizedLeft == null) {
    return 1;
  }

  if (normalizedRight == null) {
    return -1;
  }

  if (normalizedLeft < normalizedRight) {
    return -1;
  }

  if (normalizedLeft > normalizedRight) {
    return 1;
  }

  return 0;
}

function isOperatorObject(value: unknown) {
  return isRecord(value) && Object.keys(value).some((key) => SCALAR_OPERATORS.has(key));
}

function matchesScalarCondition(value: unknown, condition: unknown): boolean {
  if (!isRecord(condition) || !isOperatorObject(condition)) {
    return areValuesEqual(value, condition);
  }

  const modeInsensitive = condition.mode === "insensitive";

  if (condition.equals !== undefined && !areValuesEqual(value, condition.equals, modeInsensitive)) {
    return false;
  }

  if (Array.isArray(condition.in) && !condition.in.some((entry) => areValuesEqual(value, entry, modeInsensitive))) {
    return false;
  }

  if (
    Array.isArray(condition.notIn) &&
    condition.notIn.some((entry) => areValuesEqual(value, entry, modeInsensitive))
  ) {
    return false;
  }

  if (typeof condition.contains === "string") {
    if (typeof value !== "string") {
      return false;
    }

    const haystack = modeInsensitive ? value.toLowerCase() : value;
    const needle = modeInsensitive
      ? condition.contains.toLowerCase()
      : condition.contains;

    if (!haystack.includes(needle)) {
      return false;
    }
  }

  if (typeof condition.startsWith === "string") {
    if (typeof value !== "string") {
      return false;
    }

    const haystack = modeInsensitive ? value.toLowerCase() : value;
    const needle = modeInsensitive
      ? condition.startsWith.toLowerCase()
      : condition.startsWith;

    if (!haystack.startsWith(needle)) {
      return false;
    }
  }

  if (typeof condition.endsWith === "string") {
    if (typeof value !== "string") {
      return false;
    }

    const haystack = modeInsensitive ? value.toLowerCase() : value;
    const needle = modeInsensitive ? condition.endsWith.toLowerCase() : condition.endsWith;

    if (!haystack.endsWith(needle)) {
      return false;
    }
  }

  if (condition.gt !== undefined && compareValues(value, condition.gt) <= 0) {
    return false;
  }

  if (condition.gte !== undefined && compareValues(value, condition.gte) < 0) {
    return false;
  }

  if (condition.lt !== undefined && compareValues(value, condition.lt) >= 0) {
    return false;
  }

  if (condition.lte !== undefined && compareValues(value, condition.lte) > 0) {
    return false;
  }

  if (condition.has !== undefined) {
    if (!Array.isArray(value) || !value.some((entry) => areValuesEqual(entry, condition.has))) {
      return false;
    }
  }

  if (Array.isArray(condition.hasSome)) {
    if (
      !Array.isArray(value) ||
      !condition.hasSome.some((entry) => value.some((candidate) => areValuesEqual(candidate, entry)))
    ) {
      return false;
    }
  }

  if (Array.isArray(condition.hasEvery)) {
    if (
      !Array.isArray(value) ||
      !condition.hasEvery.every((entry) => value.some((candidate) => areValuesEqual(candidate, entry)))
    ) {
      return false;
    }
  }

  if (condition.isEmpty !== undefined) {
    const isEmpty = Array.isArray(value) ? value.length === 0 : !value;

    if (Boolean(condition.isEmpty) !== isEmpty) {
      return false;
    }
  }

  if (condition.not !== undefined && matchesScalarCondition(value, condition.not)) {
    return false;
  }

  return true;
}

async function matchesWhere(
  modelName: ModelName,
  row: RecordValue,
  where: unknown,
  context: QueryContext,
): Promise<boolean> {
  if (!where) {
    return true;
  }

  if (!isRecord(where)) {
    return false;
  }

  const andConditions = Array.isArray(where.AND)
    ? where.AND
    : where.AND
      ? [where.AND]
      : [];
  const orConditions = Array.isArray(where.OR)
    ? where.OR
    : where.OR
      ? [where.OR]
      : [];
  const notConditions = Array.isArray(where.NOT)
    ? where.NOT
    : where.NOT
      ? [where.NOT]
      : [];

  for (const condition of andConditions) {
    if (!(await matchesWhere(modelName, row, condition, context))) {
      return false;
    }
  }

  if (
    orConditions.length > 0 &&
    !(await Promise.all(orConditions.map((condition) => matchesWhere(modelName, row, condition, context)))).some(Boolean)
  ) {
    return false;
  }

  for (const condition of notConditions) {
    if (await matchesWhere(modelName, row, condition, context)) {
      return false;
    }
  }

  for (const [key, condition] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      continue;
    }

    const relation = getRelationMeta(modelName, key);

    if (relation) {
      const related = await resolveRelation(modelName, row, key, context);

      if (relation.isList) {
        const relatedRows = Array.isArray(related) ? related : [];

        if (isRecord(condition) && ("some" in condition || "every" in condition || "none" in condition)) {
          if (
            condition.some &&
            !(await Promise.all(
              relatedRows.map((candidate) =>
                matchesWhere(relation.model, candidate, condition.some, context),
              ),
            )).some(Boolean)
          ) {
            return false;
          }

          if (
            condition.every &&
            !(await Promise.all(
              relatedRows.map((candidate) =>
                matchesWhere(relation.model, candidate, condition.every, context),
              ),
            )).every(Boolean)
          ) {
            return false;
          }

          if (
            condition.none &&
            (await Promise.all(
              relatedRows.map((candidate) =>
                matchesWhere(relation.model, candidate, condition.none, context),
              ),
            )).some(Boolean)
          ) {
            return false;
          }

          continue;
        }

        if (
          !(await Promise.all(
            relatedRows.map((candidate) => matchesWhere(relation.model, candidate, condition, context)),
          )).some(Boolean)
        ) {
          return false;
        }

        continue;
      }

      if (related == null) {
        return false;
      }

      if (!(await matchesWhere(relation.model, related as RecordValue, condition, context))) {
        return false;
      }

      continue;
    }

    if (!matchesScalarCondition(row[key], condition)) {
      return false;
    }
  }

  return true;
}

async function getFilteredRows(
  modelName: ModelName,
  args: QueryArgs | undefined,
  context: QueryContext,
  baseRows?: RecordValue[],
) {
  const sourceRows = baseRows ?? (await loadRows(modelName, context));
  const filteredRows: RecordValue[] = [];

  for (const row of sourceRows) {
    if (await matchesWhere(modelName, row, args?.where, context)) {
      filteredRows.push(row);
    }
  }

  return filteredRows;
}

async function getOrderValue(
  modelName: ModelName,
  row: RecordValue,
  orderSpec: RecordValue,
  context: QueryContext,
): Promise<unknown> {
  const [fieldName, directionOrNested] = Object.entries(orderSpec)[0] ?? [];

  if (!fieldName) {
    return null;
  }

  const relation = getRelationMeta(modelName, fieldName);

  if (relation && isRecord(directionOrNested)) {
    const related = await resolveRelation(modelName, row, fieldName, context);
    const relatedRow = Array.isArray(related) ? related[0] ?? null : related;

    if (!relatedRow) {
      return null;
    }

    return getOrderValue(relation.model, relatedRow, directionOrNested, context);
  }

  return row[fieldName];
}

async function applyOrderBy(
  modelName: ModelName,
  rows: RecordValue[],
  orderBy: RecordValue | RecordValue[] | undefined,
  context: QueryContext,
) {
  const orderSpecs = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  if (orderSpecs.length === 0) {
    return rows;
  }

  const decorated = await Promise.all(
    rows.map(async (row) => ({
      row,
      keys: await Promise.all(
        orderSpecs.map(async (orderSpec) => {
          const [fieldName, directionOrNested] = Object.entries(orderSpec)[0] ?? [];
          return {
            direction:
              directionOrNested === "desc"
                ? "desc"
                : isRecord(directionOrNested)
                  ? "asc"
                  : "asc",
            value: fieldName
              ? await getOrderValue(modelName, row, orderSpec, context)
              : null,
          };
        }),
      ),
    })),
  );

  decorated.sort((left, right) => {
    for (let index = 0; index < left.keys.length; index += 1) {
      const leftKey = left.keys[index];
      const rightKey = right.keys[index];
      const comparison = compareValues(leftKey?.value, rightKey?.value);

      if (comparison !== 0) {
        return leftKey?.direction === "desc" ? comparison * -1 : comparison;
      }
    }

    return 0;
  });

  return decorated.map((entry) => entry.row);
}

async function applyProjection(
  modelName: ModelName,
  row: RecordValue,
  select: RecordValue | undefined,
  include: RecordValue | undefined,
  context: QueryContext,
): Promise<RecordValue> {
  const projected = select ? {} : Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cloneValue(value)]));

  if (select) {
    for (const [fieldName, fieldSelection] of Object.entries(select)) {
      if (!fieldSelection) {
        continue;
      }

      if (fieldName === "_count" && isRecord(fieldSelection) && isRecord(fieldSelection.select)) {
        const counts = await Promise.all(
          Object.keys(fieldSelection.select).map(async (relationName) => {
            const related = await resolveRelation(modelName, row, relationName, context);
            const count = Array.isArray(related)
              ? related.length
              : related
                ? 1
                : 0;
            return [relationName, count] as const;
          }),
        );

        projected._count = Object.fromEntries(counts);
        continue;
      }

      const relation = getRelationMeta(modelName, fieldName);

      if (!relation) {
        projected[fieldName] = cloneValue(row[fieldName]);
        continue;
      }

      const related = await resolveRelation(modelName, row, fieldName, context);

      if (fieldSelection === true) {
        projected[fieldName] = cloneValue(related);
        continue;
      }

      if (!isRecord(fieldSelection)) {
        projected[fieldName] = cloneValue(related);
        continue;
      }

      if (Array.isArray(related)) {
        const relatedRows = await executeFindMany(
          relation.model,
          {
            ...fieldSelection,
          },
          context,
          related,
        );
        projected[fieldName] = relatedRows;
      } else {
        projected[fieldName] = related
          ? await applyProjection(
              relation.model,
              related,
              fieldSelection.select as RecordValue | undefined,
              fieldSelection.include as RecordValue | undefined,
              context,
            )
          : null;
      }
    }
  }

  if (include) {
    for (const [fieldName, fieldInclude] of Object.entries(include)) {
      if (!fieldInclude) {
        continue;
      }

      const relation = getRelationMeta(modelName, fieldName);

      if (!relation) {
        continue;
      }

      const related = await resolveRelation(modelName, row, fieldName, context);

      if (fieldInclude === true) {
        projected[fieldName] = cloneValue(related);
        continue;
      }

      if (!isRecord(fieldInclude)) {
        projected[fieldName] = cloneValue(related);
        continue;
      }

      if (Array.isArray(related)) {
        projected[fieldName] = await executeFindMany(
          relation.model,
          fieldInclude,
          context,
          related,
        );
      } else {
        projected[fieldName] = related
          ? await applyProjection(
              relation.model,
              related,
              fieldInclude.select as RecordValue | undefined,
              fieldInclude.include as RecordValue | undefined,
              context,
            )
          : null;
      }
    }
  }

  return projected;
}

async function executeFindMany(
  modelName: ModelName,
  args: QueryArgs | undefined,
  context: QueryContext,
  baseRows?: RecordValue[],
) {
  const pushedDownRows = await tryExecuteFindManyViaSupabase(
    modelName,
    args,
    context,
    baseRows,
  );

  if (pushedDownRows) {
    return pushedDownRows;
  }

  const filteredRows = await getFilteredRows(modelName, args, context, baseRows);
  const orderedRows = await applyOrderBy(modelName, filteredRows, args?.orderBy, context);
  const skippedRows = args?.skip ? orderedRows.slice(args.skip) : orderedRows;
  const limitedRows =
    typeof args?.take === "number" ? skippedRows.slice(0, args.take) : skippedRows;

  if (!args?.select && !args?.include) {
    return limitedRows.map((row) => cloneValue(row));
  }

  return Promise.all(
    limitedRows.map((row) =>
      applyProjection(
        modelName,
        row,
        args.select as RecordValue | undefined,
        args.include as RecordValue | undefined,
        context,
      ),
    ),
  );
}

async function executeFindFirst(
  modelName: ModelName,
  args: QueryArgs | undefined,
  context: QueryContext,
) {
  const [row] = await executeFindMany(
    modelName,
    {
      ...(args ?? {}),
      take: 1,
    },
    context,
  );

  return row ?? null;
}

function flattenUniqueWhere(where: RecordValue | undefined) {
  if (!where) {
    return {};
  }

  const entries = Object.entries(where);

  if (
    entries.length === 1 &&
    entries[0] &&
    entries[0][0].includes("_") &&
    isRecord(entries[0][1])
  ) {
    return entries[0][1];
  }

  return where;
}

function getRowIdentifier(row: RecordValue) {
  if (typeof row.id === "string" && row.id.length > 0) {
    return { id: row.id };
  }

  if (typeof row.sessionToken === "string" && row.sessionToken.length > 0) {
    return { sessionToken: row.sessionToken };
  }

  if (
    typeof row.provider === "string" &&
    typeof row.providerAccountId === "string"
  ) {
    return {
      provider: row.provider,
      providerAccountId: row.providerAccountId,
    };
  }

  if (typeof row.identifier === "string" && typeof row.token === "string") {
    return {
      identifier: row.identifier,
      token: row.token,
    };
  }

  throw new Error("Unable to identify a row for mutation.");
}

function invalidateContext(context: QueryContext) {
  context.rowCache.clear();
  context.tableStatus.clear();
}

async function performUpdateByIdentifier(
  modelName: ModelName,
  identifier: RecordValue,
  data: RecordValue,
  context: QueryContext,
) {
  const client = getSupabaseDbClient();

  if (!client) {
    throw new SchemaUnavailableError();
  }

  await ensureTableAvailable(modelName, context);

  let query = client.from(getModelMeta(modelName).table).update(data).select("*");

  for (const [fieldName, value] of Object.entries(identifier)) {
    query = query.eq(fieldName, serializeFieldValue(getFieldMeta(modelName, fieldName), value));
  }

  const { data: rows, error } = await query;

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      throw new SchemaUnavailableError(
        `${modelName} is not available in the current Supabase project.`,
      );
    }

    throw new Error(`Failed to update ${modelName}: ${error.message}`);
  }

  invalidateContext(context);
  return (rows ?? []).map((row) => normalizeRow(modelName, row as RecordValue));
}

async function performDeleteByIdentifier(
  modelName: ModelName,
  identifier: RecordValue,
  context: QueryContext,
) {
  const client = getSupabaseDbClient();

  if (!client) {
    throw new SchemaUnavailableError();
  }

  await ensureTableAvailable(modelName, context);

  let query = client.from(getModelMeta(modelName).table).delete().select("*");

  for (const [fieldName, value] of Object.entries(identifier)) {
    query = query.eq(fieldName, serializeFieldValue(getFieldMeta(modelName, fieldName), value));
  }

  const { data: rows, error } = await query;

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      throw new SchemaUnavailableError(
        `${modelName} is not available in the current Supabase project.`,
      );
    }

    throw new Error(`Failed to delete ${modelName}: ${error.message}`);
  }

  invalidateContext(context);
  return (rows ?? []).map((row) => normalizeRow(modelName, row as RecordValue));
}

function normalizeMutationData(modelName: ModelName, data: RecordValue, mode: "create" | "update") {
  const modelMeta = getModelMeta(modelName);
  const payload: RecordValue = {};
  const now = new Date();

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }

    const relation = modelMeta.relations[key];

    if (relation && isRecord(value)) {
      const connectValue = value.connect;

      if (isRecord(connectValue)) {
        relation.localFields.forEach((localField, index) => {
          const remoteField = relation.remoteFields[index] ?? relation.remoteFields[0];
          payload[localField] = serializeFieldValue(
            getFieldMeta(modelName, localField),
            connectValue[remoteField],
          );
        });
      }

      if (value.disconnect) {
        relation.localFields.forEach((localField) => {
          payload[localField] = null;
        });
      }

      continue;
    }

    const field = modelMeta.fields[key];

    if (!field || field.kind === "relation") {
      continue;
    }

    payload[key] = serializeFieldValue(field, value);
  }

  if (mode === "create") {
    if ("id" in modelMeta.fields && !("id" in payload)) {
      payload.id = randomUUID();
    }

    if ("createdAt" in modelMeta.fields && !("createdAt" in payload)) {
      payload.createdAt = now.toISOString();
    }
  }

  if ("updatedAt" in modelMeta.fields) {
    payload.updatedAt = now.toISOString();
  }

  return payload;
}

async function executeCreate(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const client = getSupabaseDbClient();

  if (!client) {
    throw new SchemaUnavailableError();
  }

  await ensureTableAvailable(modelName, context);
  const payload = normalizeMutationData(modelName, (args.data ?? {}) as RecordValue, "create");
  const { data, error } = await client
    .from(getModelMeta(modelName).table)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      throw new SchemaUnavailableError(
        `${modelName} is not available in the current Supabase project.`,
      );
    }

    throw new Error(`Failed to create ${modelName}: ${error.message}`);
  }

  invalidateContext(context);
  const normalizedRow = normalizeRow(modelName, data as RecordValue);

  if (!args.select && !args.include) {
    return normalizedRow;
  }

  return applyProjection(
    modelName,
    normalizedRow,
    args.select as RecordValue | undefined,
    args.include as RecordValue | undefined,
    context,
  );
}

async function executeUpdate(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const uniqueWhere = flattenUniqueWhere(args.where as RecordValue | undefined);
  const existing = await executeFindFirst(
    modelName,
    { where: uniqueWhere },
    context,
  );

  if (!existing) {
    return null;
  }

  const rows = await performUpdateByIdentifier(
    modelName,
    getRowIdentifier(existing),
    normalizeMutationData(modelName, (args.data ?? {}) as RecordValue, "update"),
    context,
  );
  const updated = rows[0] ?? normalizeRow(modelName, existing);

  if (!args.select && !args.include) {
    return updated;
  }

  return applyProjection(
    modelName,
    updated,
    args.select as RecordValue | undefined,
    args.include as RecordValue | undefined,
    context,
  );
}

async function executeDelete(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const existing = await executeFindFirst(modelName, { where: args.where }, context);

  if (!existing) {
    return null;
  }

  await performDeleteByIdentifier(modelName, getRowIdentifier(existing), context);
  return existing;
}

async function executeUpdateMany(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const matches = await getFilteredRows(modelName, args, context);
  let count = 0;

  for (const row of matches) {
    const updatedRows = await performUpdateByIdentifier(
      modelName,
      getRowIdentifier(row),
      normalizeMutationData(modelName, (args.data ?? {}) as RecordValue, "update"),
      context,
    );
    count += updatedRows.length;
  }

  return { count };
}

async function executeDeleteMany(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const matches = await getFilteredRows(modelName, args, context);
  let count = 0;

  for (const row of matches) {
    const deletedRows = await performDeleteByIdentifier(
      modelName,
      getRowIdentifier(row),
      context,
    );
    count += deletedRows.length;
  }

  return { count };
}

async function executeUpsert(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const uniqueWhere = flattenUniqueWhere(args.where as RecordValue | undefined);
  const existing = await executeFindFirst(modelName, { where: uniqueWhere }, context);

  if (!existing) {
    return executeCreate(
      modelName,
      {
        data: (args.data ?? (args as RecordValue).create) as RecordValue | undefined,
        include: args.include,
        select: args.select,
      },
      context,
    );
  }

  return executeUpdate(
    modelName,
    {
      where: uniqueWhere,
      data: args.update,
      include: args.include,
      select: args.select,
    },
    context,
  );
}

async function executeCount(modelName: ModelName, args: QueryArgs | undefined, context: QueryContext) {
  const pushedDownCount = await tryExecuteCountViaSupabase(modelName, args, context);

  if (typeof pushedDownCount === "number") {
    return pushedDownCount;
  }

  const rows = await getFilteredRows(modelName, args, context);
  return rows.length;
}

function getAggregateFields(selection: RecordValue | undefined) {
  return selection ? Object.keys(selection).filter((key) => selection[key]) : [];
}

function getNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function executeAggregate(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const rows = await getFilteredRows(modelName, args, context);
  const result: RecordValue = {};

  if (args._count) {
    result._count = {
      _all: rows.length,
    };
  }

  for (const [aggregateKey, selection] of [
    ["_sum", args._sum],
    ["_avg", args._avg],
    ["_max", args._max],
    ["_min", args._min],
  ] as const) {
    const aggregateFields = getAggregateFields(selection as RecordValue | undefined);

    if (aggregateFields.length === 0) {
      continue;
    }

    const aggregateValues: RecordValue = {};

    for (const fieldName of aggregateFields) {
      const values = rows
        .map((row) => row[fieldName])
        .filter((value) => value !== null && value !== undefined);

      if (aggregateKey === "_sum") {
        aggregateValues[fieldName] = values.reduce<number>((sum, value) => {
          const numericValue = getNumericValue(value);
          return sum + (numericValue ?? 0);
        }, 0);
        continue;
      }

      if (aggregateKey === "_avg") {
        const numericValues = values
          .map((value) => getNumericValue(value))
          .filter((value): value is number => value !== null);
        aggregateValues[fieldName] =
          numericValues.length > 0
            ? numericValues.reduce((sum, value) => sum + value, 0) /
              numericValues.length
            : null;
        continue;
      }

      if (values.length === 0) {
        aggregateValues[fieldName] = null;
        continue;
      }

      const sortedValues = [...values].sort((left, right) => compareValues(left, right));
      aggregateValues[fieldName] =
        aggregateKey === "_max"
          ? sortedValues.at(-1) ?? null
          : sortedValues[0] ?? null;
    }

    result[aggregateKey] = aggregateValues;
  }

  return result;
}

async function executeGroupBy(modelName: ModelName, args: QueryArgs, context: QueryContext) {
  const rows = await getFilteredRows(modelName, args, context);
  const groupFields = Array.isArray(args.by) ? args.by : [];
  const groups = new Map<string, RecordValue[]>();

  for (const row of rows) {
    const groupKey = JSON.stringify(groupFields.map((fieldName) => row[fieldName] ?? null));
    const groupRows = groups.get(groupKey) ?? [];
    groupRows.push(row);
    groups.set(groupKey, groupRows);
  }

  return Array.from(groups.entries()).map(([groupKey, groupRows]) => {
    const values = JSON.parse(groupKey) as unknown[];
    const aggregateRow: RecordValue = Object.fromEntries(
      groupFields.map((fieldName, index) => [fieldName, values[index] ?? null]),
    );
    const aggregateArgs = {
      _count: args._count,
      _sum: args._sum,
      _avg: args._avg,
      _max: args._max,
      _min: args._min,
    } satisfies QueryArgs;

    const aggregateResult = {
      _count: args._count ? { _all: groupRows.length } : undefined,
      _sum: {} as RecordValue,
      _avg: {} as RecordValue,
      _max: {} as RecordValue,
      _min: {} as RecordValue,
    };

    for (const fieldName of getAggregateFields(aggregateArgs._sum as RecordValue | undefined)) {
      aggregateResult._sum[fieldName] = groupRows.reduce((sum, row) => {
        const numericValue = getNumericValue(row[fieldName]);
        return sum + (numericValue ?? 0);
      }, 0);
    }

    for (const fieldName of getAggregateFields(aggregateArgs._avg as RecordValue | undefined)) {
      const numericValues = groupRows
        .map((row) => getNumericValue(row[fieldName]))
        .filter((value): value is number => value !== null);
      aggregateResult._avg[fieldName] =
        numericValues.length > 0
          ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
          : null;
    }

    for (const fieldName of getAggregateFields(aggregateArgs._max as RecordValue | undefined)) {
      const sortedValues = groupRows
        .map((row) => row[fieldName])
        .filter((value) => value !== null && value !== undefined)
        .sort((left, right) => compareValues(left, right));
      aggregateResult._max[fieldName] = sortedValues.at(-1) ?? null;
    }

    for (const fieldName of getAggregateFields(aggregateArgs._min as RecordValue | undefined)) {
      const sortedValues = groupRows
        .map((row) => row[fieldName])
        .filter((value) => value !== null && value !== undefined)
        .sort((left, right) => compareValues(left, right));
      aggregateResult._min[fieldName] = sortedValues[0] ?? null;
    }

    if (aggregateResult._count) {
      aggregateRow._count = aggregateResult._count;
    }

    if (Object.keys(aggregateResult._sum).length > 0) {
      aggregateRow._sum = aggregateResult._sum;
    }

    if (Object.keys(aggregateResult._avg).length > 0) {
      aggregateRow._avg = aggregateResult._avg;
    }

    if (Object.keys(aggregateResult._max).length > 0) {
      aggregateRow._max = aggregateResult._max;
    }

    if (Object.keys(aggregateResult._min).length > 0) {
      aggregateRow._min = aggregateResult._min;
    }

    return aggregateRow;
  });
}

function withContext<T>(
  boundContext: QueryContext | undefined,
  callback: (context: QueryContext) => Promise<T>,
) {
  return callback(boundContext ?? createQueryContext());
}

function createDelegate(modelName: ModelName, boundContext?: QueryContext): DbDelegate {
  return {
    findMany(args?: QueryArgs) {
      return withContext(boundContext, (context) => executeFindMany(modelName, args, context));
    },
    findFirst(args?: QueryArgs) {
      return withContext(boundContext, (context) => executeFindFirst(modelName, args, context));
    },
    findUnique(args?: QueryArgs) {
      return withContext(boundContext, (context) =>
        executeFindFirst(
          modelName,
          {
            ...(args ?? {}),
            where: flattenUniqueWhere(args?.where as RecordValue | undefined),
          },
          context,
        ),
      );
    },
    count(args?: QueryArgs) {
      return withContext(boundContext, (context) => executeCount(modelName, args, context));
    },
    aggregate(args: QueryArgs) {
      return withContext(boundContext, (context) => executeAggregate(modelName, args, context));
    },
    groupBy(args: QueryArgs) {
      return withContext(boundContext, (context) => executeGroupBy(modelName, args, context));
    },
    create(args: QueryArgs) {
      return withContext(boundContext, (context) => executeCreate(modelName, args, context));
    },
    update(args: QueryArgs) {
      return withContext(boundContext, (context) => executeUpdate(modelName, args, context));
    },
    updateMany(args: QueryArgs) {
      return withContext(boundContext, (context) => executeUpdateMany(modelName, args, context));
    },
    delete(args: QueryArgs) {
      return withContext(boundContext, (context) => executeDelete(modelName, args, context));
    },
    deleteMany(args: QueryArgs) {
      return withContext(boundContext, (context) => executeDeleteMany(modelName, args, context));
    },
    upsert(args: QueryArgs & { create?: RecordValue }) {
      return withContext(boundContext, (context) => executeUpsert(modelName, args, context));
    },
  };
}

function createDataClient(boundContext?: QueryContext): DbClient {
  const client = {
    async $disconnect() {
      return;
    },
    async $transaction<T>(callback: (tx: DbClient) => Promise<T>) {
      const transactionContext = boundContext ?? createQueryContext();
      return callback(createDataClient(transactionContext));
    },
  } as Partial<ModelDelegates> &
    Pick<DbClient, "$disconnect" | "$transaction">;

  for (const [delegateName, modelName] of Object.entries(modelDelegateNames)) {
    client[delegateName as keyof ModelDelegates] = createDelegate(
      modelName,
      boundContext,
    ) as ModelDelegates[keyof ModelDelegates];
  }

  return client as DbClient;
}

export async function isWorkspaceSchemaAvailable() {
  const context = createQueryContext();
  await loadRows("Organization", context);
  return context.tableStatus.get("Organization") !== "missing";
}

export const db: DbClient = createDataClient();
export const prisma: DbClient = db;
