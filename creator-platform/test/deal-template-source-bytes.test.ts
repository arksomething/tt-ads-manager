import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";

import {
  archivedDealTemplateSourceBytesMatch,
  dealTemplateSourceDocxContentType,
  validateDealTemplateSourceBytes,
} from "@/server/admin/deal-template-source-bytes";
import type { AdminDealTemplateSourceArtifact } from "@/server/admin/deal-template-source";
import { createHash } from "node:crypto";

function validPdf() {
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const object of [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ]) {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(object);
  }
  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  parts.push(
    "xref\n0 4\n",
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    "trailer\n<< /Size 4 /Root 1 0 R >>\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(parts.join(""), "latin1");
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`;

function baseDocxEntries() {
  return [
    ["[Content_Types].xml", Buffer.from(contentTypes)],
    ["_rels/.rels", Buffer.from(relationships)],
    ["word/document.xml", Buffer.from(documentXml)],
  ] as Array<[string, Buffer]>;
}

function makeZip(entries: Array<[string, Buffer]>) {
  return new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
    zip.end();
  });
}

function replaceEvery(source: Buffer, from: string, to: string) {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const result = Buffer.from(source);
  const needle = Buffer.from(from);
  let offset = 0;
  while ((offset = result.indexOf(needle, offset)) >= 0) {
    Buffer.from(to).copy(result, offset);
    offset += needle.byteLength;
  }
  return result;
}

function markFirstZipEntryEncrypted(source: Buffer) {
  const result = Buffer.from(source);
  const local = result.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const central = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(local).toBeGreaterThanOrEqual(0);
  expect(central).toBeGreaterThanOrEqual(0);
  result.writeUInt16LE(result.readUInt16LE(local + 6) | 0x0001, local + 6);
  result.writeUInt16LE(result.readUInt16LE(central + 8) | 0x0001, central + 8);
  return result;
}

describe("deal template source byte validation", () => {
  it("accepts a parsed PDF with a real trailer and cross-reference table", async () => {
    const bytes = validPdf();
    await expect(validateDealTemplateSourceBytes("agreement.pdf", bytes)).resolves.toEqual({
      contentType: "application/pdf",
      extension: "pdf",
      originalFilename: "agreement.pdf",
    });
  });

  it("rejects header-only PDFs, broken cross-reference pointers, and bytes after EOF", async () => {
    await expect(validateDealTemplateSourceBytes(
      "agreement.pdf",
      Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"),
    )).resolves.toBeNull();

    const valid = validPdf();
    const badPointer = Buffer.from(valid.toString("latin1").replace(/startxref\n\d+/u, "startxref\n1"), "latin1");
    await expect(validateDealTemplateSourceBytes("agreement.pdf", badPointer)).resolves.toBeNull();
    await expect(validateDealTemplateSourceBytes(
      "agreement.pdf",
      Buffer.concat([valid, Buffer.from("injected")]),
    )).resolves.toBeNull();
  });

  it("accepts a structurally valid OOXML Word archive", async () => {
    const bytes = await makeZip(baseDocxEntries());
    await expect(validateDealTemplateSourceBytes("agreement.docx", bytes)).resolves.toEqual({
      contentType: dealTemplateSourceDocxContentType,
      extension: "docx",
      originalFilename: "agreement.docx",
    });
  });

  it("rejects missing OOXML parts, traversal paths, encrypted entries, and declarations", async () => {
    const missingDocument = await makeZip(baseDocxEntries().slice(0, 2));
    await expect(validateDealTemplateSourceBytes("agreement.docx", missingDocument)).resolves.toBeNull();

    const withSafeName = await makeZip([
      ...baseDocxEntries(),
      ["safe/evil.xml", Buffer.from("<safe/>")],
    ]);
    const traversal = replaceEvery(withSafeName, "safe/evil.xml", "../x/evil.xml");
    await expect(validateDealTemplateSourceBytes("agreement.docx", traversal)).resolves.toBeNull();

    const encrypted = markFirstZipEntryEncrypted(await makeZip(baseDocxEntries()));
    await expect(validateDealTemplateSourceBytes("agreement.docx", encrypted)).resolves.toBeNull();

    const withEntity = await makeZip(baseDocxEntries().map(([name, bytes]) => name === "word/document.xml"
      ? [name, Buffer.from(`<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${documentXml}`)]
      : [name, bytes]));
    await expect(validateDealTemplateSourceBytes("agreement.docx", withEntity)).resolves.toBeNull();
  });

  it("rejects excessive ZIP expansion and absurd entry counts before extraction", async () => {
    const expanded = await makeZip([
      ...baseDocxEntries(),
      ["word/large.bin", Buffer.alloc(16 * 1024 * 1024 + 1, 0x41)],
    ]);
    expect(expanded.byteLength).toBeLessThan(4 * 1024 * 1024);
    await expect(validateDealTemplateSourceBytes("agreement.docx", expanded)).resolves.toBeNull();

    const manyEntries = baseDocxEntries();
    for (let index = 0; index < 2_046; index += 1) {
      manyEntries.push([`custom/item-${index}.xml`, Buffer.from("<x/>")]);
    }
    const crowded = await makeZip(manyEntries);
    await expect(validateDealTemplateSourceBytes("agreement.docx", crowded)).resolves.toBeNull();
  });

  it("revalidates structure in addition to immutable size and SHA-256", async () => {
    const bytes = validPdf();
    const artifact = {
      id: "44444444-4444-4444-8444-444444444444",
      dealVersionId: "11111111-1111-4111-8111-111111111111",
      provider: "signwell",
      environment: "production",
      templateId: "33333333-3333-4333-8333-333333333333",
      snapshotHash: "a".repeat(64),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      storageBucket: "creator-deal-template-sources",
      storagePath: "11111111-1111-4111-8111-111111111111/55555555-5555-4555-8555-555555555555.pdf",
      originalFilename: "agreement.pdf",
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
      uploadedBy: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-09-03T12:00:00.000Z",
    } satisfies AdminDealTemplateSourceArtifact;

    await expect(archivedDealTemplateSourceBytesMatch(artifact, bytes)).resolves.toBe(true);
    const structurallyInvalid = Buffer.from(bytes.toString("latin1").replace("xref\n", "yref\n"), "latin1");
    const matchingInvalidArtifact = {
      ...artifact,
      sourceSha256: createHash("sha256").update(structurallyInvalid).digest("hex"),
    };
    await expect(archivedDealTemplateSourceBytesMatch(
      matchingInvalidArtifact,
      structurallyInvalid,
    )).resolves.toBe(false);
  });
});
