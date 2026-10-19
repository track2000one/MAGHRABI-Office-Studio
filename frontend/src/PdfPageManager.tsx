import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {loadPdfThumbnails, PDF_THUMBNAIL_BATCH} from "./pdfThumbnails";

type PdfInfo = {
  filename: string;
  size_bytes: number;
  pages: number;
};

type PlanItem = {
  id: string;
  sourcePage: number;
  rotation: 0 | 90 | 180 | 270;
};

type Props = {
  file: File;
  info: PdfInfo;
  onApplied: (file: File) => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

function pageId(page: number) {
  return `page-${page}-${Date.now()}`;
}

export default function PdfPageManager({
  file,
  info,
  onApplied,
  onError,
  onNotice,
}: Props) {
  const idCounter = useRef(0);
  const thumbUrlsRef = useRef<Record<number, string>>({});
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [draggedId, setDraggedId] = useState("");
  const [saving, setSaving] = useState(false);

  const hasChanges = useMemo(() => {
    if (plan.length !== info.pages) return true;
    return plan.some(
      (item, index) => item.sourcePage !== index + 1 || item.rotation !== 0,
    );
  }, [plan, info.pages]);

  useEffect(() => {
    idCounter.current = 0;
    setPlan(
      Array.from({ length: info.pages }, (_, index) => ({
        id: `page-${index + 1}-${++idCounter.current}`,
        sourcePage: index + 1,
        rotation: 0 as const,
      })),
    );
    setDraggedId("");
    setThumbUrls((old) => {
      Object.values(old).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
  }, [file, info.pages]);

  useEffect(() => {
    thumbUrlsRef.current = thumbUrls;
  }, [thumbUrls]);

  // Page reordering leaves this key unchanged: no cancelled or repeated
  // thumbnail uploads on every drag-and-drop operation.
  const sourcePagesKey=useMemo(
    ()=>Array.from(new Set(plan.map(item=>item.sourcePage)))
      .sort((a,b)=>a-b).join(","),
    [plan],
  );
  useEffect(() => {
    if(!open || !sourcePagesKey)return;
    let cancelled=false;
    const sourcePages=sourcePagesKey.split(",").map(Number);
    const load=async()=>{
      for(let start=0;start<sourcePages.length && !cancelled;start+=PDF_THUMBNAIL_BATCH){
        const pages=sourcePages.slice(start,start+PDF_THUMBNAIL_BATCH)
          .filter(p=>!thumbUrlsRef.current[p]);
        if(!pages.length)continue;
        try {
          const thumbnails=await loadPdfThumbnails(file,pages,260);
          if(cancelled)return;
          setThumbUrls(current=>({...current,...thumbnails}));
        }catch{
          // The page manager stays usable with numbered placeholders.
          return;
        }
      }
    };
    void load();
    return()=>{cancelled=true;};
  },[open,file,sourcePagesKey]);

  useEffect(() => {
    return () => {
      Object.values(thumbUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function moveItem(id: string, direction: -1 | 1) {
    setPlan((current) => {
      const index = current.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function duplicateItem(id: string) {
    setPlan((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return current;
      const source = current[index]!;
      const copy: PlanItem = {
        ...source,
        id: `page-copy-${source.sourcePage}-${++idCounter.current}`,
      };
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function deleteItem(id: string) {
    setPlan((current) => {
      if (current.length <= 1) {
        onError("يجب الإبقاء على صفحة واحدة على الأقل.");
        return current;
      }
      return current.filter((item) => item.id !== id);
    });
  }

  function rotateItem(id: string) {
    setPlan((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              rotation: ((item.rotation + 90) % 360) as PlanItem["rotation"],
            }
          : item,
      ),
    );
  }

  function dropBefore(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    setPlan((current) => {
      const from = current.findIndex((item) => item.id === draggedId);
      const to = current.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      const nextTarget = next.findIndex((item) => item.id === targetId);
      next.splice(nextTarget < 0 ? next.length : nextTarget, 0, moved!);
      return next;
    });
    setDraggedId("");
  }

  function resetPlan() {
    idCounter.current = 0;
    setPlan(
      Array.from({ length: info.pages }, (_, index) => ({
        id: `page-${index + 1}-${++idCounter.current}`,
        sourcePage: index + 1,
        rotation: 0 as const,
      })),
    );
  }

  async function applyPlan() {
    if (!plan.length) {
      onError("يجب الإبقاء على صفحة واحدة على الأقل.");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "page_plan_json",
        JSON.stringify(
          plan.map((item) => ({
            source_page: item.sourcePage,
            rotation: item.rotation,
          })),
        ),
      );
      const response = await api("/pdf/manage-pages", {
        method: "POST",
        body: form,
      });
      const blob = await response.blob();
      const edited = new File([blob], "MAGHRABI-pages.pdf", {
        type: "application/pdf",
      });
      await onApplied(edited);
      onNotice("تم تطبيق ترتيب الصفحات والنسخ والحذف والتدوير، وأصبحت النتيجة هي النسخة الحالية.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر تطبيق إدارة الصفحات.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <section className="panel pdf-page-manager-launch">
        <div>
          <span className="welcome-label">PAGE MANAGER</span>
          <h3>إدارة الصفحات بصريًا</h3>
          <p className="muted small">
            رتّب الصفحات بالسحب، أو انسخ صفحة، احذفها، أو دوّرها قبل اعتماد التغييرات.
          </p>
        </div>
        <button className="button outline" onClick={() => setOpen(true)}>
          فتح إدارة الصفحات
        </button>
      </section>
    );
  }

  return (
    <section className="panel pdf-page-manager">
      <div className="pdf-page-manager-head">
        <div>
          <span className="welcome-label">PAGE MANAGER</span>
          <h3>إدارة الصفحات</h3>
          <p className="muted small">
            اسحب البطاقات لتغيير الترتيب. النسخ والحذف والتدوير لا يُطبّق على الملف حتى تضغط اعتماد التغييرات.
          </p>
        </div>
        <div className="action-row">
          <button className="button outline" onClick={resetPlan} disabled={saving || !hasChanges}>
            إعادة الضبط
          </button>
          <button className="button outline" onClick={() => setOpen(false)} disabled={saving}>
            إغلاق
          </button>
        </div>
      </div>

      <div className="pdf-page-manager-grid" data-testid="pdf-page-manager-grid">
        {plan.map((item, index) => (
          <article
            key={item.id}
            className={draggedId === item.id ? "pdf-page-card dragging" : "pdf-page-card"}
            draggable={!saving}
            onDragStart={() => setDraggedId(item.id)}
            onDragEnd={() => setDraggedId("")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropBefore(item.id)}
          >
            <div className="pdf-page-card-preview">
              {thumbUrls[item.sourcePage] ? (
                <img
                  src={thumbUrls[item.sourcePage]}
                  alt={`معاينة الصفحة الأصلية ${item.sourcePage}`}
                  style={{ transform: `rotate(${item.rotation}deg)` }}
                />
              ) : (
                <span>PDF</span>
              )}
            </div>
            <div className="pdf-page-card-title">
              <strong>صفحة {index + 1}</strong>
              <small>
                الأصل {item.sourcePage}
                {item.rotation ? ` · تدوير +${item.rotation}°` : ""}
              </small>
            </div>
            <div className="pdf-page-card-actions">
              <button
                type="button"
                aria-label={`تحريك الصفحة ${index + 1} للأعلى`}
                onClick={() => moveItem(item.id, -1)}
                disabled={saving || index === 0}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`تحريك الصفحة ${index + 1} للأسفل`}
                onClick={() => moveItem(item.id, 1)}
                disabled={saving || index === plan.length - 1}
              >
                ↓
              </button>
              <button type="button" onClick={() => rotateItem(item.id)} disabled={saving}>
                تدوير
              </button>
              <button type="button" onClick={() => duplicateItem(item.id)} disabled={saving}>
                نسخ
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => deleteItem(item.id)}
                disabled={saving || plan.length <= 1}
              >
                حذف
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="pdf-page-manager-savebar">
        <span>
          {plan.length} صفحة
          {hasChanges ? " · توجد تغييرات غير مطبقة" : " · لا توجد تغييرات"}
        </span>
        <button
          className="button primary"
          onClick={() => void applyPlan()}
          disabled={saving || !hasChanges}
        >
          {saving ? "جارٍ التطبيق…" : "اعتماد تغييرات الصفحات"}
        </button>
      </div>
    </section>
  );
}
