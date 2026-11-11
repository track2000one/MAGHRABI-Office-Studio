import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createPortablePdfProject, readPortablePdfProject, portableProjectFilename, PROJECT_BACKUP_EXTENSION}
  from "../pdfProjectBackup";
import {pdfDraftKey, type PdfDraftRecord} from "../pdfDraftStore";

// jsdom's Blob/File lack arrayBuffer in some versions. FileReader is provided
// by jsdom and exercises the binary blob interface used in real browsers.
beforeEach(() => {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true, value: function (this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
  vi.stubGlobal("crypto", {
    subtle: {
      // Reproducible digest stub: test verifies payload integrity workflow.
      // Production uses real WebCrypto SHA-256 on secure origins.
      digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) => {
        const bytes = new Uint8Array(data);
        const out = new Uint8Array(32);
        for (let i = 0; i < bytes.length; i++) {
          out[i % 32] = (out[i % 32]! + bytes[i]! + (i % 7)) & 255;
        }
        return out.buffer;
      }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function sampleProject(): Promise<PdfDraftRecord> {
  const source = new File([new TextEncoder().encode("%PDF-1.7\n1 0 obj\n")],
    "Example Plan.pdf", {type:"application/pdf"});
  const id = await pdfDraftKey(source);
  const signature = new File([new Uint8Array([137, 80, 78, 71, 0, 4, 255])],
    "mark.png", {type:"image/png"});
  return {
    version: 1, id, title:"Example Plan.pdf", updatedAt: 1700000000000,
    source, page:2, zoom:125,
    elements: [
      {id:"shape-1", type:"shape", shape:"rectangle", page:2, xMm:15,yMm:20,
        widthMm:50,heightMm:30,rotation:37,opacity:0.6, locked:false,
        strokeColor:"#000000", fillColor:"#ffff00", fillEnabled:true,
        strokeWidthPt:2, dashed:false, flipX:false,flipY:false, points:[], groupId:"group1"},
      {id:"image-1", type:"image", page:2, xMm:60,yMm:20,widthMm:25,heightMm:10,
        rotation:0,opacity:1,locked:false,assetId:"logo",keepAspect:true,groupId:"group1"},
    ],
    assets:[{id:"logo",file:signature}],
  };
}

describe("portable PDF editable project backup", () => {
  it("round-trips original PDF, drawings, groups, images and metadata losslessly", async () => {
    const input = await sampleProject();
    const backup = await createPortablePdfProject(input);
    expect(backup.size).toBeGreaterThan(input.source.size + input.assets[0]!.file.size);
    const output = await readPortablePdfProject(backup);
    expect(output.id).toBe(input.id);
    expect(output.title).toBe(input.title);
    expect(output.page).toBe(2);
    expect(output.zoom).toBe(125);
    expect(output.elements).toEqual(input.elements);
    expect(output.assets[0]?.id).toBe("logo");
    expect(Array.from(new Uint8Array(await output.source.arrayBuffer())))
      .toEqual(Array.from(new Uint8Array(await input.source.arrayBuffer())));
    expect(Array.from(new Uint8Array(await output.assets[0]!.file.arrayBuffer())))
      .toEqual(Array.from(new Uint8Array(await input.assets[0]!.file.arrayBuffer())));
  });

  it("rejects altered attachment bytes without accepting a partial draft", async () => {
    const backup = await createPortablePdfProject(await sampleProject());
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 1] ^= 0x7f;
    await expect(readPortablePdfProject(new Blob([bytes]))).rejects.toThrow(/الصور|التواقيع/);
  });

  it("rejects corruption in the archive header or manifest", async () => {
    const backup = await createPortablePdfProject(await sampleProject());
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[0] ^= 1;
    await expect(readPortablePdfProject(new Blob([bytes]))).rejects.toThrow(/ليس هذا ملف/);
    const altered = new Uint8Array(await backup.arrayBuffer());
    altered[30] ^= 1;
    await expect(readPortablePdfProject(new Blob([altered]))).rejects.toThrow(/تالفة/);
  });

  it("rejects truncated bundles or invalid source file identifiers", async () => {
    const backup = await createPortablePdfProject(await sampleProject());
    await expect(readPortablePdfProject(backup.slice(0, backup.size - 1))).rejects.toThrow(/لا يطابق/);
    const project = await sampleProject();
    project.id = "a".repeat(64);
    await expect(createPortablePdfProject(project)).rejects.toThrow(/لا يطابق/);
  });

  it("creates a file name with no path traversal or unsafe separators", () => {
    expect(portableProjectFilename("خطة / موقعي.pdf")).toMatch(/\.mopdf$/);
    expect(portableProjectFilename("x.pdf")).toBe("x" + PROJECT_BACKUP_EXTENSION);
    expect(portableProjectFilename("...")).toBe("PDF-Project.mopdf");
  });
});
