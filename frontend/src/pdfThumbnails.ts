import {api} from "./api";

/** A single document upload produces up to eight low-res thumbnails.
 * Display-only JPEGs are safe as data URLs; no object URL leaks to manage.
 * Full-page editing still uses lossless PNG via the existing endpoint.
 */
export const PDF_THUMBNAIL_BATCH = 8;
export async function loadPdfThumbnails(
  file: File, pages: number[], maxWidth=240,
): Promise<Record<number,string>> {
  if(pages.length===0 || pages.length>PDF_THUMBNAIL_BATCH ||
     pages.some(p=>!Number.isInteger(p)||p<1) || new Set(pages).size!==pages.length)
    throw new Error("عدد صفحات الصور المصغرة غير صالح.");
  const form=new FormData();
  form.append("file",file);
  form.append("pages",pages.join(","));
  form.append("max_width_px",String(maxWidth));
  const result: unknown=await (await api("/pdf/render-thumbnails",{
    method:"POST",body:form,
  })).json();
  if(!result || typeof result!=="object" || !("pages" in result) ||
     !Array.isArray(result.pages))
    throw new Error("تعذّر قراءة صور PDF المصغرة.");
  const images:Record<number,string>={};
  for(const item of result.pages) {
    if(!item || typeof item!=="object" || !("page" in item) || !("image" in item) ||
       !pages.includes(item.page as number) || typeof item.image!=="string" ||
       !item.image.startsWith("data:image/jpeg;base64,"))
      throw new Error("استجابة صور PDF المصغرة غير صالحة.");
    images[item.page as number]=item.image;
  }
  if(Object.keys(images).length!==pages.length)
    throw new Error("لم يُرجع الخادم جميع الصور المصغرة.");
  return images;
}
