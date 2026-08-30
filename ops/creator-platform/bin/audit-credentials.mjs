#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(scriptDirectory, "..", "credentials.catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function expandHome(value) {
  return value.replaceAll("${HOME}", os.homedir());
}

function parseDotenvKeys(contents) {
  const keys = new Map();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u);
    if (!match) continue;
    keys.set(match[1], match[2].trim().length > 0);
  }
  return keys;
}

function inspectSource(source) {
  const sourcePath = expandHome(source.path);
  const result = {
    id: source.id,
    kind: source.kind,
    path: sourcePath,
    exists: false,
    secure: false,
    problems: [],
  };

  let stats;
  try {
    stats = fs.lstatSync(sourcePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      result.problems.push("missing-file");
      return result;
    }
    result.problems.push("unreadable-file");
    return result;
  }

  result.exists = true;
  result.mode = (stats.mode & 0o777).toString(8).padStart(4, "0");
  result.ownerUid = stats.uid;
  result.linkCount = stats.nlink;

  if (!stats.isFile()) result.problems.push("not-regular-file");
  if (stats.isSymbolicLink()) result.problems.push("symlink-not-allowed");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    result.problems.push("wrong-owner");
  }
  if ((stats.mode & 0o077) !== 0) result.problems.push("group-or-other-readable");
  if (stats.nlink !== 1) result.problems.push("unexpected-hard-links");

  if (source.kind === "dotenv" && stats.isFile()) {
    const keys = parseDotenvKeys(fs.readFileSync(sourcePath, "utf8"));
    result.variables = Object.fromEntries(
      (source.expectedVariables ?? []).map((key) => [
        key,
        keys.get(key) === true ? "present" : keys.has(key) ? "empty" : "missing",
      ]),
    );
  }

  result.secure = result.problems.length === 0;
  return result;
}

const sources = catalog.sources.map(inspectSource);
const output = {
  catalogVersion: catalog.version,
  generatedAt: new Date().toISOString(),
  valuesExposed: false,
  summary: {
    sourceCount: sources.length,
    existingSources: sources.filter((source) => source.exists).length,
    secureSources: sources.filter((source) => source.secure).length,
    sourcesWithProblems: sources.filter((source) => source.problems.length > 0).length,
  },
  sources,
  platformRequirements: catalog.platformRequirements,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

if (process.argv.includes("--strict") && sources.some((source) => source.problems.length > 0)) {
  process.exitCode = 1;
}
