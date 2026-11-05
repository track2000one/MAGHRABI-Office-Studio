import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_DRAFTS, pdfDraftKey, validPdfDraft, type PdfDraftRecord } from "../pdfDraftStore";

const file = new File(["%PDF-1.7"], "buildings.pdf", { type: "application/pdf" });
const project: PdfDraftRecord = {
  version: 1, id: "a".repeat(64), title: "buildings.pdf",
  updatedAt: 1762300000000, source: file,
  page: 2, zoom: 100, elements: [{ id: "shape-1", type: "shape", page: 2 }],
  assets: [{ id: "logo", file: new File(["image"], "logo.png") }],
};

afterEach(() => vi.unstubAllGlobals());

describe("PDF editable project validation", () => {
  it("accepts a project with source PDF, editable drawings and image blobs", () => {
    expect(validPdfDraft(project, project.id)).toBe(true);
    expect(MAX_PDF_DRAFTS).toBe(15);
  });
  it("rejects a source file mismatch and invalid or oversized assets", () => {
    expect(validPdfDraft(project, "b".repeat(64))).toBe(false);
    expect(validPdfDraft({ ...project, id: "same-name-not-sha" })).toBe(false);
    expect(validPdfDraft({ ...project, assets: [{ id: "x", file: "not a blob" }] })).toBe(false);
    expect(validPdfDraft({ ...project, assets: [{ id: "x", file: new Blob([new Uint8Array(1)]) }], elements: Array(121).fill({}) })).toBe(false);
  });
  it("refuses a future schema and damaged geometry metadata", () => {
    expect(validPdfDraft({ ...project, version: 2 })).toBe(false);
    expect(validPdfDraft({ ...project, page: 0 })).toBe(false);
    expect(validPdfDraft({ ...project, zoom: Infinity })).toBe(false);
  });
  it("derives identity from PDF contents, not filename", async () => {
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async (_algorithm: string, buffer: ArrayBuffer) => {
        expect(new Uint8Array(buffer)).toEqual(new Uint8Array([7, 11, 13]));
        return new Uint8Array([0x01, 0x9f, 0x2a]).buffer;
      }) },
    });
    const sample = { name: "same.pdf", size: 3,
      arrayBuffer: async () => new Uint8Array([7, 11, 13]).buffer } as File;
    expect(await pdfDraftKey(sample)).toBe("019f2a");
  });
});
