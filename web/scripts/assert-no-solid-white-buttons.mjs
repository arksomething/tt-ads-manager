import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");
const allowedExtensions = new Set([".tsx", ".jsx", ".ts", ".js"]);
const interactiveElementPattern = /<(button|a|Link)\b[\s\S]*?>/g;
const solidWhiteBackgroundPattern = /\bbg-white(?!\/)/;

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function getLineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

async function findViolations(filePath) {
  const source = await readFile(filePath, "utf8");
  const violations = [];

  for (const match of source.matchAll(interactiveElementPattern)) {
    const tagSource = match[0];

    if (!tagSource.includes("className") || !solidWhiteBackgroundPattern.test(tagSource)) {
      continue;
    }

    const line = getLineNumber(source, match.index ?? 0);
    violations.push({
      filePath,
      line,
      snippet: tagSource
        .replace(/\s+/g, " ")
        .slice(0, 160),
    });
  }

  return violations;
}

async function main() {
  const files = await collectSourceFiles(sourceRoot);
  const violations = [];

  for (const filePath of files) {
    violations.push(...(await findViolations(filePath)));
  }

  if (violations.length === 0) {
    return;
  }

  console.error("Solid white button backgrounds are disallowed. Found:");
  for (const violation of violations) {
    const relativePath = path.relative(projectRoot, violation.filePath);
    console.error(`- ${relativePath}:${violation.line} ${violation.snippet}`);
  }
  process.exit(1);
}

await main();
