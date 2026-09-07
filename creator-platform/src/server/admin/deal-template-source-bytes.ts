import { createHash } from "node:crypto";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

import {
  type AdminDealTemplateSourceArtifact,
  maximumDealTemplateSourceBytes,
} from "@/server/admin/deal-template-source";

export const dealTemplateSourceDocxContentType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ValidDealTemplateSource = {
  contentType: "application/pdf" | typeof dealTemplateSourceDocxContentType;
  extension: "pdf" | "docx";
  originalFilename: string;
};

const maximumPdfPages = 2_000;
const maximumZipEntries = 2_048;
const maximumZipEntryBytes = 16 * 1024 * 1024;
const maximumZipExpandedBytes = 32 * 1024 * 1024;
const parserTimeoutMilliseconds = 5_000;
const requiredDocxEntries = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
]);

function safeOriginalFilename(value: string) {
  const base = value.normalize("NFKC").split(/[\\/]/u).at(-1)?.trim() ?? "";
  return base
    .replace(/[^A-Za-z0-9._() -]+/gu, "-")
    .replace(/\s+/gu, " ")
    .slice(0, 200);
}

function validPdfCrossReference(bytes: Buffer) {
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/u.test(bytes.subarray(0, 16).toString("latin1"))) {
    return false;
  }

  const tailOffset = Math.max(0, bytes.byteLength - 2_048);
  const tail = bytes.subarray(tailOffset).toString("latin1");
  const match = /startxref\s+(\d+)\s+%%EOF[\t\n\f\r ]*$/u.exec(tail);
  if (!match) return false;

  const xrefOffset = Number(match[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 0 || xrefOffset >= bytes.byteLength) {
    return false;
  }

  const xrefWindow = bytes.subarray(xrefOffset, Math.min(bytes.byteLength, xrefOffset + 8_192))
    .toString("latin1");
  if (/^xref(?:\r?\n|\r)/u.test(xrefWindow)) {
    const trailerOffset = bytes.lastIndexOf(Buffer.from("trailer", "ascii"));
    return trailerOffset >= xrefOffset && trailerOffset < tailOffset + (match.index ?? 0);
  }

  // PDF 1.5+ may point startxref at an indirect cross-reference stream.
  return /^\d+\s+\d+\s+obj\b/u.test(xrefWindow) && /\/Type\s*\/XRef\b/u.test(xrefWindow);
}

async function validParsedPdf(bytes: Buffer) {
  if (!validPdfCrossReference(bytes)) return false;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    enableXfa: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    maxImageSize: 1_000_000,
    stopAtErrors: true,
    useWasm: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const document = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF validation timed out.")), parserTimeoutMilliseconds);
      }),
    ]);
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > maximumPdfPages) {
      return false;
    }
    await document.getPage(1);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    await loadingTask.destroy().catch(() => undefined);
  }
}

function safeZipEntryName(name: string) {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/u.test(name)) {
    return false;
  }
  const parts = name.split("/");
  if (parts.some((part, index) => (
    part === "." || part === ".." || (part === "" && index !== parts.length - 1)
  ))) return false;
  return true;
}

function openZip(bytes: Buffer) {
  return new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(bytes, {
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error("ZIP could not be opened."));
      else resolve(zipFile);
    });
  });
}

function readZipEntry(zipFile: ZipFile, entry: Entry, collect: boolean) {
  return new Promise<Buffer | null>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("ZIP entry could not be opened."));
        return;
      }
      const chunks: Buffer[] = [];
      let byteCount = 0;
      stream.on("data", (chunk: Buffer | Uint8Array) => {
        const part = Buffer.from(chunk);
        byteCount += part.byteLength;
        if (byteCount > maximumZipEntryBytes || byteCount > entry.uncompressedSize) {
          stream.destroy(new Error("ZIP entry exceeded its declared or allowed size."));
          return;
        }
        if (collect) chunks.push(part);
      });
      stream.once("error", reject);
      stream.once("end", () => {
        if (byteCount !== entry.uncompressedSize) {
          reject(new Error("ZIP entry size did not match its central directory record."));
          return;
        }
        resolve(collect ? Buffer.concat(chunks, byteCount) : null);
      });
    });
  });
}

function decodeXml(bytes: Buffer) {
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0),
  );
}

function xmlObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function xmlItems(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function validDocxXml(entries: Map<string, Buffer>) {
  let contentTypesXml: string;
  let relationshipsXml: string;
  let documentXml: string;
  try {
    contentTypesXml = decodeXml(entries.get("[Content_Types].xml")!);
    relationshipsXml = decodeXml(entries.get("_rels/.rels")!);
    documentXml = decodeXml(entries.get("word/document.xml")!);
  } catch {
    return false;
  }
  for (const xml of [contentTypesXml, relationshipsXml, documentXml]) {
    if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(xml) || XMLValidator.validate(xml) !== true) return false;
  }

  const parser = new XMLParser({
    attributeNamePrefix: "",
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    removeNSPrefix: true,
  });
  try {
    const contentTypes = xmlObject(parser.parse(contentTypesXml));
    const types = xmlObject(contentTypes?.Types);
    const hasDocumentContentType = xmlItems(types?.Override).some((value) => {
      const override = xmlObject(value);
      return override?.PartName === "/word/document.xml" &&
        override.ContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
    });

    const relationships = xmlObject(parser.parse(relationshipsXml));
    const relationshipRoot = xmlObject(relationships?.Relationships);
    const hasDocumentRelationship = xmlItems(relationshipRoot?.Relationship).some((value) => {
      const relationship = xmlObject(value);
      return typeof relationship?.Type === "string" &&
        /\/officeDocument$/u.test(relationship.Type) &&
        relationship.Target === "word/document.xml" &&
        relationship.TargetMode !== "External";
    });

    const document = xmlObject(parser.parse(documentXml));
    const documentRoot = xmlObject(document?.document);
    return hasDocumentContentType && hasDocumentRelationship &&
      documentRoot !== null && xmlObject(documentRoot.body) !== null;
  } catch {
    return false;
  }
}

async function validDocxArchive(bytes: Buffer) {
  let zipFile: ZipFile | undefined;
  try {
    zipFile = await openZip(bytes);
    if (!Number.isSafeInteger(zipFile.entryCount) || zipFile.entryCount < 3 || zipFile.entryCount > maximumZipEntries) {
      zipFile.close();
      return false;
    }

    const requiredEntries = new Map<string, Buffer>();
    const seenNames = new Set<string>();
    let totalExpandedBytes = 0;
    let entriesRead = 0;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (valid: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        zipFile?.close();
        resolve(valid);
      };
      const timeout = setTimeout(() => finish(false), parserTimeoutMilliseconds);
      zipFile!.once("error", () => finish(false));
      zipFile!.once("end", () => {
        if (entriesRead !== zipFile!.entryCount || requiredEntries.size !== requiredDocxEntries.size) {
          finish(false);
          return;
        }
        finish(validDocxXml(requiredEntries));
      });
      zipFile!.on("entry", (entry: Entry) => {
        void (async () => {
          entriesRead += 1;
          const loweredName = entry.fileName.toLowerCase();
          if (
            entriesRead > maximumZipEntries || !safeZipEntryName(entry.fileName) ||
            seenNames.has(loweredName) || (entry.generalPurposeBitFlag & 0x0041) !== 0 ||
            !Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize) ||
            entry.compressedSize < 0 || entry.uncompressedSize < 0 ||
            entry.uncompressedSize > maximumZipEntryBytes ||
            (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
          ) {
            finish(false);
            return;
          }
          seenNames.add(loweredName);
          totalExpandedBytes += entry.uncompressedSize;
          if (!Number.isSafeInteger(totalExpandedBytes) || totalExpandedBytes > maximumZipExpandedBytes) {
            finish(false);
            return;
          }
          if (entry.fileName.endsWith("/")) {
            if (entry.uncompressedSize !== 0) finish(false);
            else zipFile!.readEntry();
            return;
          }
          const content = await readZipEntry(zipFile!, entry, requiredDocxEntries.has(entry.fileName));
          if (content) requiredEntries.set(entry.fileName, content);
          if (!settled) zipFile!.readEntry();
        })().catch(() => finish(false));
      });
      zipFile!.readEntry();
    });
  } catch {
    zipFile?.close();
    return false;
  }
}

export async function validateDealTemplateSourceBytes(
  filename: string,
  bytes: Buffer,
): Promise<ValidDealTemplateSource | null> {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumDealTemplateSourceBytes) return null;
  const originalFilename = safeOriginalFilename(filename);
  const lowered = originalFilename.toLowerCase();
  if (lowered.endsWith(".pdf") && await validParsedPdf(bytes)) {
    return { contentType: "application/pdf", extension: "pdf", originalFilename };
  }
  if (lowered.endsWith(".docx") && await validDocxArchive(bytes)) {
    return { contentType: dealTemplateSourceDocxContentType, extension: "docx", originalFilename };
  }
  return null;
}

export async function archivedDealTemplateSourceBytesMatch(
  artifact: AdminDealTemplateSourceArtifact,
  bytes: Buffer,
) {
  if (bytes.byteLength !== artifact.byteSize) return false;
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  if (sourceSha256 !== artifact.sourceSha256) return false;
  const evidence = await validateDealTemplateSourceBytes(artifact.originalFilename, bytes);
  return evidence?.contentType === artifact.contentType;
}
