import { randomUUID } from "node:crypto";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/core/documentPolicy";
import { getConfigValue } from "@/lib/runtimeConfig";

function matchesMagic(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/heic") return bytes.subarray(4, 12).toString("ascii").includes("ftyp");
  if (mimeType === "application/msword") return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (mimeType === "text/plain") return !bytes.includes(0) && !bytes.subarray(0, 256).toString("utf8").includes("�");
  return false;
}

function decodeDataUri(dataUri: string, mimeType: string): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUri);
  if (!match || match[1] !== mimeType) throw new Error("The encoded file type does not match the declared type.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) throw new Error(`Files must be between 1 byte and ${MAX_DOCUMENT_BYTES} bytes.`);
  if (!ALLOWED_DOCUMENT_TYPES.has(mimeType) || !matchesMagic(bytes, mimeType)) throw new Error("The file signature does not match an allowed document type.");
  return bytes;
}

async function storageConfig() {
  const baseUrl = await getConfigValue("PRIVATE_OBJECT_STORAGE_URL");
  const token = await getConfigValue("PRIVATE_OBJECT_STORAGE_TOKEN");
  const scannerUrl = await getConfigValue("MALWARE_SCAN_URL");
  const scannerToken = await getConfigValue("MALWARE_SCAN_TOKEN");
  if (!baseUrl || !token || !scannerUrl) throw new Error("Private object storage and malware scanning must be configured before document uploads are enabled.");
  return { baseUrl: baseUrl.replace(/\/$/, ""), token, scannerUrl, scannerToken };
}

async function requireCleanScan(bytes: Buffer, mimeType: string, scannerUrl: string, scannerToken?: string) {
  const response = await fetch(scannerUrl, {
    method: "POST",
    headers: { "content-type": mimeType, ...(scannerToken ? { authorization: `Bearer ${scannerToken}` } : {}) },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as { clean?: boolean; status?: string };
  if (!response.ok || (result.clean !== true && result.status !== "clean")) throw new Error("The malware scanner did not certify this file as clean.");
}

export async function uploadPrivateDocument(input: { leadId: string; filename: string; mimeType: string; dataUri: string }) {
  const bytes = decodeDataUri(input.dataUri, input.mimeType);
  const config = await storageConfig();
  await requireCleanScan(bytes, input.mimeType, config.scannerUrl, config.scannerToken);
  const extension = input.filename.includes(".") ? `.${input.filename.split(".").pop()!.replace(/[^a-z0-9]/gi, "").slice(0, 10)}` : "";
  const storageRef = `leads/${input.leadId}/${randomUUID()}${extension}`;
  const response = await fetch(`${config.baseUrl}/${storageRef.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${config.token}`, "content-type": input.mimeType, "cache-control": "private, no-store" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Private object storage rejected the upload (${response.status}).`);
  return { storageRef, sizeBytes: bytes.length };
}

export async function downloadPrivateDocument(storageRef: string) {
  const config = await storageConfig();
  const response = await fetch(`${config.baseUrl}/${storageRef.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Private object storage could not retrieve the document (${response.status}).`);
  return response;
}

export async function deletePrivateDocument(storageRef: string) {
  const config = await storageConfig();
  const response = await fetch(`${config.baseUrl}/${storageRef.split("/").map(encodeURIComponent).join("/")}`, {
    method: "DELETE", headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Private object storage could not remove the document (${response.status}).`);
}
