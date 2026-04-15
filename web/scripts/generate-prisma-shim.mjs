import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCALAR_TYPES = new Set([
  "String",
  "Int",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
  "BigInt",
]);

function stripInlineComment(line) {
  const markerIndex = line.indexOf("//");
  return markerIndex >= 0 ? line.slice(0, markerIndex) : line;
}

function parseSchema(schemaSource) {
  const lines = schemaSource.split(/\r?\n/);
  const enums = [];
  const models = [];
  let current = null;

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();

    if (!line) {
      continue;
    }

    const enumMatch = line.match(/^enum\s+(\w+)\s+\{$/);

    if (enumMatch) {
      current = {
        kind: "enum",
        name: enumMatch[1],
        values: [],
      };
      enums.push(current);
      continue;
    }

    const modelMatch = line.match(/^model\s+(\w+)\s+\{$/);

    if (modelMatch) {
      current = {
        kind: "model",
        name: modelMatch[1],
        fields: [],
      };
      models.push(current);
      continue;
    }

    if (line === "}") {
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    if (current.kind === "enum") {
      const valueMatch = line.match(/^(\w+)/);

      if (valueMatch) {
        current.values.push(valueMatch[1]);
      }

      continue;
    }

    if (line.startsWith("@@")) {
      continue;
    }

    const fieldMatch = line.match(/^(\w+)\s+([^\s]+)(?:\s+(.*))?$/);

    if (!fieldMatch) {
      continue;
    }

    const [, name, rawType, rawAttributes = ""] = fieldMatch;
    const isList = rawType.endsWith("[]");
    const isOptional = !isList && rawType.endsWith("?");
    const type = rawType.replace(/\[\]|\?/g, "");

    const relationMatch = rawAttributes.match(/@relation\((.*)\)/);
    const relationArgs = relationMatch?.[1] ?? null;
    const relationNameMatch = relationArgs?.match(/^\s*"([^"]+)"/);
    const fieldsMatch = relationArgs?.match(/fields:\s*\[([^\]]*)\]/);
    const referencesMatch = relationArgs?.match(/references:\s*\[([^\]]*)\]/);

    current.fields.push({
      name,
      type,
      rawType,
      isList,
      isOptional,
      attributes: rawAttributes,
      relationName: relationNameMatch?.[1] ?? null,
      localFields: fieldsMatch
        ? fieldsMatch[1]
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      referenceFields: referencesMatch
        ? referencesMatch[1]
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    });
  }

  return { enums, models };
}

function mapScalarTypeToTs(type, isOptional) {
  let mapped;

  switch (type) {
    case "String":
      mapped = "string";
      break;
    case "Int":
    case "Float":
    case "Decimal":
      mapped = "number";
      break;
    case "Boolean":
      mapped = "boolean";
      break;
    case "DateTime":
      mapped = "Date";
      break;
    case "Json":
      mapped = "Prisma.JsonValue | null";
      break;
    case "Bytes":
      mapped = "Uint8Array";
      break;
    case "BigInt":
      mapped = "bigint";
      break;
    default:
      mapped = type;
      break;
  }

  return isOptional ? `${mapped} | null` : mapped;
}

function buildRelationMetadata(models, enums) {
  const enumNames = new Set(enums.map((entry) => entry.name));
  const metadata = Object.fromEntries(
    models.map((model) => [
      model.name,
      {
        table: model.name,
        fields: {},
        relations: {},
      },
    ]),
  );

  const forwardRelations = [];

  for (const model of models) {
    for (const field of model.fields) {
      const kind = SCALAR_TYPES.has(field.type)
        ? "scalar"
        : enumNames.has(field.type)
          ? "enum"
          : "relation";

      metadata[model.name].fields[field.name] = {
        kind,
        type: field.type,
        isList: field.isList,
        isOptional: field.isOptional,
      };

      if (kind === "relation" && field.localFields.length > 0 && field.referenceFields.length > 0) {
        metadata[model.name].relations[field.name] = {
          model: field.type,
          isList: field.isList,
          localFields: field.localFields,
          remoteFields: field.referenceFields,
        };

        forwardRelations.push({
          model: model.name,
          fieldName: field.name,
          targetModel: field.type,
          relationName: field.relationName,
          localFields: field.localFields,
          remoteFields: field.referenceFields,
        });
      }
    }
  }

  for (const relation of forwardRelations) {
    const targetModel = models.find((model) => model.name === relation.targetModel);

    if (!targetModel) {
      continue;
    }

    const candidates = targetModel.fields.filter((field) => {
      if (field.type !== relation.model) {
        return false;
      }

      if (field.localFields.length > 0) {
        return false;
      }

      if (relation.relationName || field.relationName) {
        return relation.relationName === field.relationName;
      }

      return true;
    });

    if (candidates.length !== 1) {
      continue;
    }

    const [candidate] = candidates;

    metadata[targetModel.name].relations[candidate.name] = {
      model: relation.model,
      isList: candidate.isList,
      localFields: relation.remoteFields,
      remoteFields: relation.localFields,
    };
  }

  return metadata;
}

function buildPrismaShim({ enums, models }) {
  const enumBlocks = enums
    .map(
      (entry) =>
        `export enum ${entry.name} {\n${entry.values
          .map((value) => `  ${value} = "${value}",`)
          .join("\n")}\n}`,
    )
    .join("\n\n");

  const modelBlocks = models
    .map((model) => {
      const fieldLines = model.fields
        .filter((field) => SCALAR_TYPES.has(field.type) || enums.some((entry) => entry.name === field.type))
        .map((field) => {
          const baseType =
            SCALAR_TYPES.has(field.type)
              ? mapScalarTypeToTs(field.type, field.isOptional)
              : mapScalarTypeToTs(field.type, field.isOptional);
          const listType = field.isList ? `${baseType.replace(" | null", "")}[]` : baseType;
          return `  ${field.name}: ${listType};`;
        })
        .join("\n");

      return `export interface ${model.name} {\n${fieldLines}\n}`;
    })
    .join("\n\n");

  const prismaNamespace = `export namespace Prisma {
  export type JsonObject = { [key: string]: JsonValue };
  export type JsonArray = JsonValue[];
  export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
  export type InputJsonValue = JsonValue;
  export type InputJsonObject = JsonObject;
  export type SortOrder = "asc" | "desc";
  export type TransactionClient = any;
  export type GenericWhereInput = Record<string, unknown> & {
    AND?: GenericWhereInput[];
    OR?: GenericWhereInput[];
    NOT?: GenericWhereInput | GenericWhereInput[];
  };
  export type GenericOrderByInput = Record<string, unknown>;
  export type GenericSelect = Record<string, unknown>;
  export type GenericInput = Record<string, unknown>;
${models
  .map(
    (model) => `  export type ${model.name}WhereInput = GenericWhereInput;
  export type ${model.name}OrderByWithRelationInput = GenericOrderByInput;
  export type ${model.name}Select = GenericSelect;
  export type ${model.name}CreateInput = GenericInput;
  export type ${model.name}UpdateInput = GenericInput;`,
  )
  .join("\n")}
  export const ModelName = {
${models.map((model) => `    ${model.name}: "${model.name}",`).join("\n")}
  } as const;
}`;

  return `/* eslint-disable */\n// Generated by scripts/generate-prisma-shim.mjs\n\n${enumBlocks}\n\n${modelBlocks}\n\n${prismaNamespace}\n`;
}

function buildSchemaMetadataFile(metadata) {
  return `/* eslint-disable */\n// Generated by scripts/generate-prisma-shim.mjs\n\nexport const modelSchema = ${JSON.stringify(
    metadata,
    null,
    2,
  )} as const;\n\nexport type ModelSchema = typeof modelSchema;\nexport type ModelName = keyof ModelSchema;\n`;
}

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const schemaPath = resolve(projectRoot, "prisma/schema.prisma");
const shimPath = resolve(projectRoot, "src/lib/prisma-shim.ts");
const metadataPath = resolve(projectRoot, "src/lib/db-schema.generated.ts");
const parsed = parseSchema(readFileSync(schemaPath, "utf8"));
const metadata = buildRelationMetadata(parsed.models, parsed.enums);

mkdirSync(dirname(shimPath), { recursive: true });
writeFileSync(shimPath, buildPrismaShim(parsed));
writeFileSync(metadataPath, buildSchemaMetadataFile(metadata));

console.log(`Generated ${shimPath}`);
console.log(`Generated ${metadataPath}`);
