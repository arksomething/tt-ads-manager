#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectsRoot = path.join(os.homedir(), "projects");
const skippedDirectories = new Set([
  ".claude",
  ".git",
  ".next",
  ".open-next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "Pods",
  "storage",
  "tmp",
]);

function isRuntimeEnvFile(name) {
  if (!name.startsWith(".env")) return false;
  if (name.includes("example") || name.includes("sample") || name.endsWith(".template")) {
    return false;
  }
  return name === ".env" || name.startsWith(".env.");
}

function parseVariableStates(contents) {
  const variables = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u);
    if (!match) continue;
    variables[match[1]] = match[2].trim().length > 0 ? "present" : "empty";
  }
  return Object.fromEntries(Object.entries(variables).sort(([left], [right]) => left.localeCompare(right)));
}

function visit(directory, results) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) visit(entryPath, results);
      continue;
    }
    if (!entry.isFile() || !isRuntimeEnvFile(entry.name)) continue;

    const stats = fs.lstatSync(entryPath);
    results.push({
      path: entryPath,
      mode: (stats.mode & 0o777).toString(8).padStart(4, "0"),
      ownerUid: stats.uid,
      secure: stats.isFile()
        && !stats.isSymbolicLink()
        && stats.nlink === 1
        && (typeof process.getuid !== "function" || stats.uid === process.getuid())
        && (stats.mode & 0o077) === 0,
      variables: parseVariableStates(fs.readFileSync(entryPath, "utf8")),
    });
  }
}

const files = [];
visit(projectsRoot, files);
files.sort((left, right) => left.path.localeCompare(right.path));

const output = {
  generatedAt: new Date().toISOString(),
  projectsRoot,
  valuesExposed: false,
  fileCount: files.length,
  secureFileCount: files.filter((file) => file.secure).length,
  files,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
