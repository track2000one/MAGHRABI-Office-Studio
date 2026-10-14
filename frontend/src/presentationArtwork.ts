import type { Content } from "./api";

export type SlideArtwork = {
  cover?: string;
  section?: string;
  slides: Record<string, string>;
  signature: string;
  revision: string;
};

const DATABASE = "maghrabi-pptx-artwork-v1";
const STORE = "projects";
const memoryFallback = new Map<string, SlideArtwork>();

export const blankArtwork = (): SlideArtwork => ({
  slides: {}, signature: "", revision: "",
});

export function presentationSignature(content: Content): string {
  // Notes are deliberately excluded: changes to speaker notes do not move visuals.
  return JSON.stringify({
    title: content.title, summary: content.summary,
    sections: content.sections.map(({title, body}) => ({title, body})),
  });
}

export function renderArtwork(artwork: SlideArtwork, content: Content, enabled: boolean) {
  if (!enabled || artwork.signature !== presentationSignature(content)) {
    return {slides: {} as Record<string, string>};
  }
  return {cover: artwork.cover, section: artwork.section, slides: artwork.slides};
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestFromDatabase<T>(mode: IDBTransactionMode, key: string, value?: SlideArtwork): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const object = transaction.objectStore(STORE);
      const request = mode === "readonly"
        ? object.get(key)
        : value ? object.put(value, key) : object.delete(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function readArtwork(key: string): Promise<SlideArtwork> {
  if (typeof indexedDB === "undefined") return memoryFallback.get(key) || blankArtwork();
  try {
    return (await requestFromDatabase<SlideArtwork>("readonly", key)) || blankArtwork();
  } catch {
    return memoryFallback.get(key) || blankArtwork();
  }
}

export async function saveArtwork(key: string, value: SlideArtwork): Promise<void> {
  if (typeof indexedDB === "undefined") {
    memoryFallback.set(key, value);
    return;
  }
  await requestFromDatabase("readwrite", key, value);
}

export async function deleteArtwork(key: string): Promise<void> {
  memoryFallback.delete(key);
  if (typeof indexedDB === "undefined") return;
  await requestFromDatabase("readwrite", key);
}

export function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة صورة التصميم."));
    reader.readAsDataURL(blob);
  });
}
