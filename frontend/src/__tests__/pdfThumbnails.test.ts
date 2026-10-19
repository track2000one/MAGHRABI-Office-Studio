import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {loadPdfThumbnails,PDF_THUMBNAIL_BATCH} from "../pdfThumbnails";

const jpg="data:image/jpeg;base64,/9j/2Q==";
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
    const body=init?.body as FormData;
    const pages=String(body.get("pages")).split(",").map(Number);
    return new Response(JSON.stringify({
      pages:pages.map(page=>({page,image:jpg})),
    }),{status:200,headers:{"Content-Type":"application/json"}});
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("PDF thumbnail batching",()=>{
  const file=new File(["%PDF dummy"],"lecture.pdf",{type:"application/pdf"});
  it("sends exactly one upload for eight ordered page thumbnails",async()=>{
    const pages=Array.from({length:PDF_THUMBNAIL_BATCH},(_,i)=>i+1);
    const images=await loadPdfThumbnails(file,pages,220);
    expect(Object.keys(images)).toHaveLength(8);
    expect(images[8]).toBe(jpg);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url,init]=vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/pdf/render-thumbnails");
    const form=init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("pages")).toBe("1,2,3,4,5,6,7,8");
    expect(form.get("max_width_px")).toBe("220");
  });
  it("refuses duplicate, empty or oversized page batches before uploading",async()=>{
    for(const invalid of [[],[1,1],[0],[1,2,3,4,5,6,7,8,9]]){
      await expect(loadPdfThumbnails(file,invalid)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed or incomplete server image data",async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      pages:[{page:1,image:"data:text/plain;base64,abc"}],
    }),{status:200}));
    await expect(loadPdfThumbnails(file,[1])).rejects.toThrow();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      pages:[{page:1,image:jpg}],
    }),{status:200}));
    await expect(loadPdfThumbnails(file,[1,2])).rejects.toThrow();
  });
});
