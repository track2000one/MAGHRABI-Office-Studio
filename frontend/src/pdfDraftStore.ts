/**
 * Editable PDF projects live in IndexedDB because localStorage cannot safely
 * hold the original PDF and uploaded images. This is local device storage,
 * NOT server storage or synchronization between browsers/devices.
 */
export type PdfDraftAsset = { id: string; file: File };

export type PdfDraftRecord = {
  version: 1;
  id: string; // SHA-256 of the original PDF; never mix two same-named files
  title: string;
  updatedAt: number;
  source: File;
  elements: unknown[];
  assets: PdfDraftAsset[];
  page: number;
  zoom: number;
};
export type PdfDraftSummary = Pick<PdfDraftRecord, "id" | "title" | "updatedAt" | "page"> & {
  elementCount: number;
};

const DATABASE = "maghrabi-office-pdf-editable-drafts";
const VERSION = 1;
export const MAX_PDF_DRAFTS = 15;
let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("هذا المتصفح لا يدعم حفظ مشاريع PDF محليًا."));
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("drafts"))
          db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("summaries"))
          db.createObjectStore("summaries", { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        reject(request.error || new Error("تعذر فتح قاعدة مشاريع PDF."));
      };
      request.onblocked = () => {
        connection = null;
        reject(new Error("أغلق التبويبات الأخرى للمنصة ثم أعد المحاولة."));
      };
    });
  }
  return connection;
}

export async function pdfDraftKey(file: File): Promise<string> {
  // Read bytes instead of file name, size or lastModified to avoid accidentally
  // applying drawings to a different PDF that happens to have the same name.
  if (!globalThis.crypto?.subtle)
    throw new Error("تعذر التحقق من بصمة PDF. افتح المنصة باتصال HTTPS آمن.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validPdfDraft(draft: unknown, key?: string): draft is PdfDraftRecord {
  if (!draft || typeof draft !== "object") return false;
  const data = draft as Partial<PdfDraftRecord>;
  return data.version === 1 && typeof data.id === "string" &&
    /^[a-f0-9]{64}$/.test(data.id) && (!key || data.id === key) &&
    typeof data.title === "string" && data.title.length <= 180 &&
    data.source instanceof Blob && data.source.size <= 30 * 1024 * 1024 &&
    Array.isArray(data.elements) && data.elements.length <= 120 &&
    Array.isArray(data.assets) && data.assets.length <= 120 &&
    data.assets.every(asset => asset && typeof asset.id === "string" &&
      asset.file instanceof Blob && asset.file.size <= 15 * 1024 * 1024) &&
    Number.isInteger(data.page) && (data.page ?? 0) >= 1 &&
    Number.isFinite(data.zoom) && (data.zoom ?? 0) >= 50 && (data.zoom ?? 0) <= 180;
}

export async function readPdfDraft(id: string): Promise<PdfDraftRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").get(id);
    request.onsuccess = () => {
      if (request.result == null) resolve(null);
      else if (validPdfDraft(request.result, id)) resolve(request.result);
      else reject(new Error("المشروع المحفوظ غير صالح، ولم تُحذف أي بيانات."));
    };
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function listPdfDrafts(): Promise<PdfDraftSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("summaries", "readonly");
    const request = transaction.objectStore("summaries").getAll();
    request.onsuccess = () => {
      const items = (request.result as PdfDraftSummary[])
        .filter(item => item && typeof item.id === "string" &&
          typeof item.title === "string" && Number.isFinite(item.updatedAt) &&
          Number.isInteger(item.elementCount));
      resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
    };
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function writePdfDraft(draft: PdfDraftRecord): Promise<void> {
  if (!validPdfDraft(draft))
    throw new Error("بيانات مشروع PDF غير صالحة.");
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["drafts", "summaries"], "readwrite");
    const drafts = transaction.objectStore("drafts");
    const summaries = transaction.objectStore("summaries");
    let done = false;
    const fail = (error?: Error | DOMException | null) => {
      if (done) return;
      done = true;
      reject(error || new Error("تعذر الحفظ. قد تكون مساحة التخزين غير كافية."));
    };
    transaction.oncomplete = () => {
      if (!done) { done = true; resolve(); }
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);
    const existing = summaries.get(draft.id);
    existing.onerror = () => fail(existing.error);
    existing.onsuccess = () => {
      if (existing.result) {
        save();
      } else {
        const count = summaries.count();
        count.onerror = () => fail(count.error);
        count.onsuccess = () => {
          if (count.result >= MAX_PDF_DRAFTS) {
            transaction.abort();
            fail(new Error("بلغت مكتبة PDF الحد الأقصى (15 مشروعًا). احذف مشروعًا يدويًا أو احتفظ بنسخة احتياطية أولًا."));
          } else save();
        };
      }
    };
    function save() {
      drafts.put(draft);
      summaries.put({
        id: draft.id, title: draft.title, updatedAt: draft.updatedAt,
        page: draft.page, elementCount: draft.elements.length,
      } satisfies PdfDraftSummary);
    }
  });
}

export async function removePdfDraft(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["drafts", "summaries"], "readwrite");
    transaction.objectStore("drafts").delete(id);
    transaction.objectStore("summaries").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
