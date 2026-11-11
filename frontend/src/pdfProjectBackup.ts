/**
 * Portable editable-PDF project archive.
 *
 * [magic UTF-8][manifest length uint32 BE][manifest SHA-256 32 bytes]
 * [manifest JSON UTF-8][PDF bytes][asset bytes in manifest order].
 *
 * Byte-exact hashing detects accidental corruption and prevents a draft from
 * being attached to an unrelated PDF with the same file name. This is NOT
 * encryption, authentication, Adobe FDF/XFDF or a cloud backup.
 *
 * Blob composition avoids base64 inflation and doesn't require a ZIP library.
 */
import { pdfDraftKey, validPdfDraft, type PdfDraftRecord } from "./pdfDraftStore";

const MAGIC = new TextEncoder().encode("MAGHRABI-PDF-PROJECT-V1\n");
const LENGTH_BYTES = 4;
const HASH_BYTES = 32;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 120 * 1024 * 1024;
export const MAX_PORTABLE_PROJECT_BYTES = 155 * 1024 * 1024;
export const PROJECT_BACKUP_EXTENSION = ".mopdf";

type BinaryDescriptor = {
  name: string;
  mime: string;
  size: number;
  sha256: string;
};
type AssetDescriptor = BinaryDescriptor & {id:string};
type PortableManifest = {
  format: "MAGHRABI_PDF_PROJECT";
  version: 1;
  createdAt: number;
  draft: Pick<PdfDraftRecord, "id"|"title"|"updatedAt"|"elements"|"page"|"zoom">;
  source: BinaryDescriptor;
  assets: AssetDescriptor[];
};

export type PortableProjectPreview = {
  title: string;
  id: string;
  elementCount: number;
  assetCount: number;
  updatedAt: number;
  sourceBytes: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
}

async function sha256(blob: Blob | Uint8Array): Promise<string> {
  assert(globalThis.crypto?.subtle, "استيراد النسخ الاحتياطية يحتاج اتصال HTTPS آمن.");
  const data = blob instanceof Blob ? await blob.arrayBuffer() : Uint8Array.from(blob).buffer;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    !/[/\\\x00-\x1f]/.test(value);
}
function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validBinary(value: unknown, limit: number): value is BinaryDescriptor {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<BinaryDescriptor>;
  return validName(b.name) && typeof b.mime === "string" && b.mime.length < 100 &&
    Number.isSafeInteger(b.size) && (b.size ?? -1) > 0 &&
    (b.size ?? Infinity) <= limit && validDigest(b.sha256);
}

function assertEditableElements(elements: unknown[], assets: AssetDescriptor[]) {
  assert(elements.length <= 120, "تجاوزت النسخة الحد المسموح لعناصر التحرير.");
  const assetIds = new Set(assets.map(asset => asset.id));
  const seen = new Set<string>();
  for (const value of elements) {
    assert(value && typeof value === "object", "أحد عناصر التحرير غير صالح.");
    const e = value as Record<string, unknown>;
    assert(typeof e.id === "string" && e.id.length <= 120 && e.id.length > 0 &&
      !seen.has(e.id), "معرّف أحد العناصر مكرر أو غير صالح.");
    seen.add(e.id);
    assert(["text","image","signature","shape"].includes(String(e.type)),
      "النسخة تحتوي على نوع عنصر غير مدعوم.");
    assert(Number.isInteger(e.page) && Number(e.page) >= 1 && Number(e.page) <= 1000,
      "رقم صفحة أحد العناصر غير صالح.");
    for (const key of ["xMm","yMm","widthMm","heightMm"]) {
      assert(typeof e[key] === "number" && Number.isFinite(e[key]) &&
        Math.abs(e[key] as number) < 3000, "إحداثيات أحد العناصر غير صالحة.");
    }
    assert((e.widthMm as number) > 0 && (e.heightMm as number) > 0,
      "أبعاد أحد العناصر غير صالحة.");
    assert(typeof e.rotation === "number" && Number.isInteger(e.rotation) &&
      e.rotation >= 0 && e.rotation <= 359, "زاوية عنصر غير صالحة.");
    assert(typeof e.opacity === "number" && e.opacity >= 0.01 &&
      e.opacity <= 1 && typeof e.locked === "boolean", "خصائص أحد العناصر غير صالحة.");
    if (e.groupId !== undefined)
      assert(typeof e.groupId === "string" && e.groupId.length <= 120,
        "معرّف التجميع غير صالح.");
    if (e.type === "image" || e.type === "signature") {
      assert(typeof e.assetId === "string" && assetIds.has(e.assetId),
        "صورة أو توقيع مفقود من النسخة الاحتياطية.");
    } else if (e.type === "text") {
      assert(typeof e.text === "string" && e.text.length <= 10000,
        "أحد النصوص في النسخة الاحتياطية غير صالح.");
    } else if (e.type === "shape") {
      assert(["rectangle","ellipse","line","arrow","highlight","freehand"].includes(String(e.shape)),
        "هناك شكل هندسي غير مدعوم.");
      if (e.shape === "freehand") {
        assert(Array.isArray(e.points) && e.points.length >= 2 &&
          e.points.length <= 1000, "عدد نقاط القلم الحر غير صالح.");
        for (const point of e.points) {
          assert(Array.isArray(point) && point.length === 2 &&
            point.every((n: unknown) => typeof n === "number" &&
              Number.isFinite(n) && n >= 0 && n <= 1),
            "إحداثيات الرسم الحر غير صالحة.");
        }
      }
    }
  }
}

function checkManifest(data: unknown): asserts data is PortableManifest {
  assert(data && typeof data === "object", "بيانات النسخة الاحتياطية غير صالحة.");
  const manifest = data as Partial<PortableManifest>;
  assert(manifest.format === "MAGHRABI_PDF_PROJECT" && manifest.version === 1,
    "صيغة المشروع غير مدعومة. استخدم نسخة احتياطية من MAGHRABI Office Studio.");
  const draft = manifest.draft;
  assert(draft && validDigest(draft.id) && typeof draft.title === "string" &&
    draft.title.length <= 180 && Number.isFinite(draft.updatedAt) &&
    Number.isInteger(draft.page) && (draft.page ?? 0) >= 1 &&
    Number.isFinite(draft.zoom) && (draft.zoom ?? 0) >= 20 && (draft.zoom ?? 0) <= 400 &&
    Array.isArray(draft.elements), "بيانات مشروع PDF غير مكتملة.");
  assert(Number.isFinite(manifest.createdAt), "تاريخ النسخ الاحتياطي غير صالح.");
  assert(validBinary(manifest.source, 30 * 1024 * 1024) &&
    manifest.source.sha256 === draft.id, "ملف PDF الأصلي غير صالح أو لا يطابق المشروع.");
  assert(Array.isArray(manifest.assets) && manifest.assets.length <= 120,
    "بيانات الصور في النسخة الاحتياطية غير صالحة.");
  const ids = new Set<string>();
  let total = 0;
  for (const asset of manifest.assets as AssetDescriptor[]) {
    assert(validBinary(asset, 15 * 1024 * 1024) &&
      typeof asset.id === "string" && asset.id.length > 0 && asset.id.length < 120 &&
      !ids.has(asset.id), "بيانات إحدى الصور غير صالحة أو مكررة.");
    ids.add(asset.id);
    total += asset.size;
  }
  assert(total <= MAX_ASSET_BYTES, "الصور في النسخة الاحتياطية تتجاوز الحد المسموح.");
  assertEditableElements(draft.elements, manifest.assets as AssetDescriptor[]);
}

export async function createPortablePdfProject(draft: PdfDraftRecord): Promise<Blob> {
  assert(validPdfDraft(draft), "مشروع PDF الحالي غير صالح للنسخ الاحتياطي.");
  const sourceHash = await pdfDraftKey(draft.source);
  assert(sourceHash === draft.id, "ملف PDF الأصلي لا يطابق هوية المشروع المحفوظ.");
  const assets: AssetDescriptor[] = [];
  const binaries: Blob[] = [draft.source];
  let totalAssets = 0;
  for (const asset of draft.assets) {
    totalAssets += asset.file.size;
    assert(totalAssets <= MAX_ASSET_BYTES, "المشروع كبير جدًا للتصدير في ملف واحد.");
    assets.push({
      id: asset.id, name: asset.file.name, mime: asset.file.type || "application/octet-stream",
      size: asset.file.size, sha256: await sha256(asset.file),
    });
    binaries.push(asset.file);
  }
  const manifest: PortableManifest = {
    format: "MAGHRABI_PDF_PROJECT", version: 1, createdAt: Date.now(),
    draft: {
      id: draft.id, title: draft.title, updatedAt: draft.updatedAt,
      elements: draft.elements, page: draft.page, zoom: draft.zoom,
    },
    source: {
      name: draft.source.name, mime: "application/pdf",
      size: draft.source.size, sha256: sourceHash,
    },
    assets,
  };
  checkManifest(manifest);
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  assert(encoded.byteLength <= MAX_MANIFEST_BYTES, "الرسومات كثيرة جدًا لحفظها في ملف واحد.");
  const header = new Uint8Array(LENGTH_BYTES);
  new DataView(header.buffer).setUint32(0, encoded.byteLength, false);
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  const output = new Blob([MAGIC, header, checksum, encoded, ...binaries],
    {type:"application/octet-stream"});
  assert(output.size <= MAX_PORTABLE_PROJECT_BYTES, "حجم النسخة الاحتياطية كبير جدًا.");
  return output;
}

export async function readPortablePdfProject(file: Blob): Promise<PdfDraftRecord> {
  assert(file.size >= MAGIC.length + LENGTH_BYTES + HASH_BYTES &&
    file.size <= MAX_PORTABLE_PROJECT_BYTES,
    "حجم ملف النسخة الاحتياطية غير مقبول.");
  const fixedSize = MAGIC.length + LENGTH_BYTES + HASH_BYTES;
  const prefix = new Uint8Array(await file.slice(0, fixedSize).arrayBuffer());
  assert(MAGIC.every((byte, index) => prefix[index] === byte),
    "ليس هذا ملف مشروع PDF خاصًا بالمنصة (.mopdf).");
  const length = new DataView(prefix.buffer, MAGIC.length, LENGTH_BYTES).getUint32(0, false);
  assert(length > 0 && length <= MAX_MANIFEST_BYTES &&
    fixedSize + length <= file.size, "ترويسة النسخة الاحتياطية غير مكتملة.");
  const manifestBytes = new Uint8Array(await file.slice(fixedSize, fixedSize + length).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", manifestBytes));
  assert(digest.every((byte, index) => byte === prefix[MAGIC.length + LENGTH_BYTES + index]),
    "النسخة الاحتياطية تالفة: تحقق البيانات لم ينجح.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(manifestBytes));
  } catch {
    throw new Error("تعذر قراءة بيانات النسخة الاحتياطية.");
  }
  checkManifest(parsed);
  const manifest = parsed;
  const expectedSize = fixedSize + length + manifest.source.size +
    manifest.assets.reduce((sum, asset) => sum + asset.size, 0);
  assert(file.size === expectedSize, "حجم النسخة لا يطابق الملفات المسجلة فيها.");

  let position = fixedSize + length;
  const sourceBytes = file.slice(position, position + manifest.source.size);
  position += manifest.source.size;
  assert(await sha256(sourceBytes) === manifest.source.sha256,
    "تلفت بيانات ملف PDF الأصلي في النسخة الاحتياطية.");
  const signature = new Uint8Array(await sourceBytes.slice(0, 5).arrayBuffer());
  assert(new TextDecoder().decode(signature) === "%PDF-",
    "النسخة لا تحتوي على ملف PDF صالح.");
  const source = new File([sourceBytes], manifest.source.name, {type:"application/pdf"});
  const assets: PdfDraftRecord["assets"] = [];
  for (const meta of manifest.assets) {
    const bytes = file.slice(position, position + meta.size);
    position += meta.size;
    assert(await sha256(bytes) === meta.sha256,
      "تلفت إحدى الصور أو التواقيع داخل النسخة الاحتياطية.");
    assets.push({id:meta.id, file:new File([bytes], meta.name, {type:meta.mime})});
  }
  const record: PdfDraftRecord = {
    version: 1, id: manifest.draft.id, title: manifest.draft.title,
    updatedAt: manifest.draft.updatedAt, source,
    elements: manifest.draft.elements, assets,
    page: manifest.draft.page, zoom: manifest.draft.zoom,
  };
  assert(validPdfDraft(record, manifest.draft.id),
    "تعذر التحقق من توافق المشروع مع الإصدار الحالي.");
  return record;
}

export function portableProjectFilename(title: string): string {
  const safe = title.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}_.-]+/gu, "_")
    .replace(/^[_\.]+|[_\.]+$/g,"").slice(0, 85);
  return (safe || "PDF-Project") + PROJECT_BACKUP_EXTENSION;
}
