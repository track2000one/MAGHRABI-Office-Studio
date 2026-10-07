import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

type PdfPageInfo = {
  page: number;
  width_mm: number;
  height_mm: number;
  orientation: "portrait" | "landscape";
  rotation: number;
  text_chars: number;
};

type PdfInfo = {
  filename: string;
  size_bytes: number;
  pages: number;
  text_chars: number;
  metadata: Record<string, string>;
  page_sizes: PdfPageInfo[];
  supported_sizes: string[];
};

const SIZE_OPTIONS = [
  ["keep", "الحفاظ على المقاس الأصلي"],
  ["A0", "A0 — 841 × 1189 مم"],
  ["A1", "A1 — 594 × 841 مم"],
  ["A2", "A2 — 420 × 594 مم"],
  ["A3", "A3 — 297 × 420 مم"],
  ["A4", "A4 — 210 × 297 مم"],
  ["A5", "A5 — 148 × 210 مم"],
  ["A6", "A6 — 105 × 148 مم"],
  ["B4", "B4 — 250 × 353 مم"],
  ["B5", "B5 — 176 × 250 مم"],
  ["LETTER", "Letter — 215.9 × 279.4 مم"],
  ["LEGAL", "Legal — 215.9 × 355.6 مم"],
  ["TABLOID", "Tabloid — 279.4 × 431.8 مم"],
  ["EXECUTIVE", "Executive — 184.15 × 266.7 مم"],
  ["CUSTOM", "مقاس مخصص"],
] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function PdfStudio() {
  const input = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const visualStageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: "move" | "resize"; startClientX: number; startClientY: number; startX: number; startY: number; startWidth: number; startHeight: number; stageWidth: number; stageHeight: number }>(null);

  const [file, setFile] = useState<File | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [visualPageUrl, setVisualPageUrl] = useState("");
  const [visualPage, setVisualPage] = useState(1);
  const [visualBusy, setVisualBusy] = useState(false);

  const [imagePages, setImagePages] = useState("");
  const [imagePosition, setImagePosition] = useState("free");
  const [imageWidth, setImageWidth] = useState("40");
  const [imageHeight, setImageHeight] = useState("40");
  const [imageX, setImageX] = useState("10");
  const [imageY, setImageY] = useState("10");
  const [imageKeepAspect, setImageKeepAspect] = useState(true);
  const [imageOpacity, setImageOpacity] = useState("1");
  const [imageRotation, setImageRotation] = useState("0");
  const [imageOverlay, setImageOverlay] = useState(true);

  const [pageOrder, setPageOrder] = useState("");
  const [rotate, setRotate] = useState("0");
  const [rotatePages, setRotatePages] = useState("");
  const [pageSize, setPageSize] = useState("keep");
  const [orientation, setOrientation] = useState("keep");
  const [customWidth, setCustomWidth] = useState("210");
  const [customHeight, setCustomHeight] = useState("297");
  const [cropTop, setCropTop] = useState("0");
  const [cropRight, setCropRight] = useState("0");
  const [cropBottom, setCropBottom] = useState("0");
  const [cropLeft, setCropLeft] = useState("0");
  const [watermark, setWatermark] = useState("");
  const [pageNumbers, setPageNumbers] = useState(false);
  const [optimize, setOptimize] = useState(true);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const allPages = useMemo(
    () => (info ? `1-${info.pages}` : ""),
    [info],
  );
  const visualPageInfo = useMemo(
    () => info?.page_sizes.find((item) => item.page === visualPage) ?? null,
    [info, visualPage],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (visualPageUrl) URL.revokeObjectURL(visualPageUrl);
    };
  }, [visualPageUrl]);

  useEffect(() => {
    if (!file || !imageFile || imagePosition !== "free") return;
    let cancelled = false;
    const load = async () => {
      setVisualBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("page_number", String(visualPage));
        form.append("max_width_px", "1400");
        const response = await api("/pdf/render-page", { method: "POST", body: form });
        const blob = await response.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setVisualPageUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تجهيز المعاينة الحرة.");
      } finally {
        if (!cancelled) setVisualBusy(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [file, imageFile, imagePosition, visualPage]);

  async function analyze(next: File, rememberOriginal = false) {
    if (!next.name.toLowerCase().endsWith(".pdf"))
      throw new Error("اختر ملف PDF.");
    if (next.size > 30 * 1024 * 1024)
      throw new Error("الحد الأقصى لملف PDF هو 30 ميجابايت.");

    const form = new FormData();
    form.append("file", next);
    const result: PdfInfo = await (
      await api("/pdf/analyze", { method: "POST", body: form })
    ).json();

    setFile(next);
    setInfo(result);
    if (rememberOriginal) setOriginal(next);
    setPageOrder(`1-${result.pages}`);
    setRotatePages(`1-${result.pages}`);
    setImagePages(`1-${result.pages}`);
    setVisualPage((current) => Math.min(Math.max(current, 1), result.pages));

    const url = URL.createObjectURL(next);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }

  async function chooseFile(next?: File) {
    if (!next) return;
    setBusy("جارٍ قراءة ملف PDF…");
    setError("");
    setNotice("");
    try {
      await analyze(next, true);
      setNotice("تم تحميل ملف PDF. يمكنك الآن ترتيب الصفحات وتغيير المقاسات وإجراء التعديلات.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر قراءة ملف PDF.");
    } finally {
      setBusy("");
    }
  }

  async function exportEdited() {
    if (!file) return;
    setBusy("جارٍ تطبيق تعديلات PDF…");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("page_order", pageOrder.trim() || allPages);
      form.append("rotate", rotate);
      form.append("rotate_pages", rotatePages.trim() || allPages);
      form.append("page_size", pageSize);
      form.append("orientation", orientation);
      form.append("custom_width_mm", customWidth);
      form.append("custom_height_mm", customHeight);
      form.append("crop_top_mm", cropTop || "0");
      form.append("crop_right_mm", cropRight || "0");
      form.append("crop_bottom_mm", cropBottom || "0");
      form.append("crop_left_mm", cropLeft || "0");
      form.append("watermark", watermark);
      form.append("page_numbers", String(pageNumbers));
      form.append("optimize", String(optimize));

      const response = await api("/pdf/edit", { method: "POST", body: form });
      const blob = await response.blob();
      const edited = new File([blob], "MAGHRABI-edited.pdf", {
        type: "application/pdf",
      });
      downloadBlob(blob, edited.name);
      await analyze(edited, false);
      setNotice("تم تطبيق التعديلات وتنزيل النسخة الجديدة، وأصبحت هي النسخة الحالية للمعاينة.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تعديل ملف PDF.");
    } finally {
      setBusy("");
    }
  }


  function chooseImage(next?: File) {
    if (!next) return;
    const lower = next.name.toLowerCase();
    if (!/\.(png|jpe?g|webp)$/.test(lower)) {
      setError("اختر صورة PNG أو JPG أو JPEG أو WEBP.");
      return;
    }
    if (next.size > 15 * 1024 * 1024) {
      setError("الحد الأقصى للصورة هو 15 ميجابايت.");
      return;
    }
    setImageFile(next);
    setError("");
    setImagePosition("free");
    setNotice("تم اختيار الصورة. اسحبها فوق صفحة PDF وضعها في المكان المطلوب، ويمكنك تغيير حجمها من المقبض.");
    const url = URL.createObjectURL(next);
    setImagePreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }


  function beginVisualDrag(event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") {
    const stage = visualStageRef.current;
    if (!stage || !visualPageInfo) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    dragRef.current = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: Number(imageX) || 0,
      startY: Number(imageY) || 0,
      startWidth: Math.max(5, Number(imageWidth) || 40),
      startHeight: Math.max(5, Number(imageHeight) || 40),
      stageWidth: Math.max(bounds.width, 1),
      stageHeight: Math.max(bounds.height, 1),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateVisualDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || !visualPageInfo) return;
    event.preventDefault();
    const dxMm = ((event.clientX - drag.startClientX) / drag.stageWidth) * visualPageInfo.width_mm;
    const dyMm = ((event.clientY - drag.startClientY) / drag.stageHeight) * visualPageInfo.height_mm;

    if (drag.mode === "move") {
      const nextX = Math.min(
        Math.max(0, drag.startX + dxMm),
        Math.max(0, visualPageInfo.width_mm - drag.startWidth),
      );
      const nextY = Math.min(
        Math.max(0, drag.startY + dyMm),
        Math.max(0, visualPageInfo.height_mm - drag.startHeight),
      );
      setImageX(nextX.toFixed(1));
      setImageY(nextY.toFixed(1));
      return;
    }

    let nextWidth = Math.max(5, drag.startWidth + dxMm);
    let nextHeight = Math.max(5, drag.startHeight + dyMm);
    if (imageKeepAspect) {
      const ratio = drag.startWidth / Math.max(drag.startHeight, 0.1);
      const dominantWidth = Math.abs(dxMm) >= Math.abs(dyMm) * ratio;
      if (dominantWidth) nextHeight = nextWidth / ratio;
      else nextWidth = nextHeight * ratio;
    }
    nextWidth = Math.min(nextWidth, Math.max(5, visualPageInfo.width_mm - drag.startX));
    nextHeight = Math.min(nextHeight, Math.max(5, visualPageInfo.height_mm - drag.startY));
    setImageWidth(nextWidth.toFixed(1));
    setImageHeight(nextHeight.toFixed(1));
  }

  function endVisualDrag(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  async function insertImage() {
    if (!file || !imageFile) {
      setError("اختر صورة أولًا.");
      return;
    }
    setBusy("جارٍ إدراج الصورة على PDF…");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("image", imageFile);
      form.append("image_pages", imagePages.trim() || allPages);
      form.append("position", imagePosition === "free" ? "custom" : imagePosition);
      form.append("width_mm", imageWidth || "40");
      form.append("height_mm", imageHeight || "40");
      form.append("x_mm", imageX || "10");
      form.append("y_mm", imageY || "10");
      form.append("keep_aspect", String(imageKeepAspect));
      form.append("opacity", imageOpacity);
      form.append("image_rotation", imageRotation);
      form.append("overlay", String(imageOverlay));

      const response = await api("/pdf/insert-image", { method: "POST", body: form });
      const blob = await response.blob();
      const edited = new File([blob], "MAGHRABI-image-inserted.pdf", {
        type: "application/pdf",
      });
      downloadBlob(blob, edited.name);
      await analyze(edited, false);
      setNotice("تم إدراج الصورة وتنزيل PDF. يمكنك إبقاء الصورة الحالية وإدراجها مرة أخرى بموضع مختلف، أو اختيار صورة أخرى.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إدراج الصورة على PDF.");
    } finally {
      setBusy("");
    }
  }

  async function merge() {
    const filesToMerge = file ? [file, ...mergeFiles] : mergeFiles;
    if (filesToMerge.length < 2) {
      setError(file ? "اختر ملف PDF إضافيًا واحدًا على الأقل." : "اختر ملفي PDF على الأقل للدمج.");
      return;
    }
    setBusy("جارٍ دمج ملفات PDF…");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      filesToMerge.forEach((item) => form.append("files", item));
      const response = await api("/pdf/merge", { method: "POST", body: form });
      const blob = await response.blob();
      const merged = new File([blob], "MAGHRABI-merged.pdf", {
        type: "application/pdf",
      });
      downloadBlob(blob, merged.name);
      await analyze(merged, true);
      setNotice("تم دمج الملفات وتنزيل النسخة المدمجة وفتحها داخل المحرر.");
      setMergeFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر دمج ملفات PDF.");
    } finally {
      setBusy("");
    }
  }

  async function restoreOriginal() {
    if (!original) return;
    setBusy("جارٍ استعادة الملف الأصلي…");
    setError("");
    setNotice("");
    try {
      await analyze(original, false);
      setNotice("تمت استعادة الملف الأصلي.");
    } finally {
      setBusy("");
    }
  }

  function resetEdits() {
    if (!info) return;
    setPageOrder(`1-${info.pages}`);
    setRotate("0");
    setRotatePages(`1-${info.pages}`);
    setImagePages(`1-${info.pages}`);
    setImagePosition("free");
    setImageWidth("40");
    setImageHeight("40");
    setImageX("10");
    setImageY("10");
    setImageKeepAspect(true);
    setImageOpacity("1");
    setImageRotation("0");
    setImageOverlay(true);
    setPageSize("keep");
    setOrientation("keep");
    setCustomWidth("210");
    setCustomHeight("297");
    setCropTop("0");
    setCropRight("0");
    setCropBottom("0");
    setCropLeft("0");
    setWatermark("");
    setPageNumbers(false);
    setOptimize(true);
    setNotice("تمت إعادة إعدادات التحرير للوضع الافتراضي.");
  }

  return (
    <div className="pdf-workspace">
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="إغلاق التنبيه">
            ×
          </button>
        </div>
      )}
      {notice && <div className="banner success">{notice}</div>}
      {busy && (
        <div className="banner loading">
          <span className="spinner" />
          {busy}
        </div>
      )}

      {!file ? (
        <>
          <section className="panel pdf-intro">
            <div>
              <span className="welcome-label">PDF STUDIO</span>
              <h2>تحرير PDF بمقاسات كاملة</h2>
              <p className="muted">
                ترتيب واستخراج الصفحات، تدويرها، قص الهوامش، تحويل المقاسات من A0
                إلى A6 والمقاسات الأمريكية والمقاسات المخصصة، وإضافة علامة مائية
                وترقيم ودمج ملفات متعددة، مع إدراج الشعارات والأختام والصور.
              </p>
            </div>
            <button
              className="upload-zone"
              disabled={!!busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) void chooseFile(e.dataTransfer.files[0]);
              }}
            >
              <span>PDF</span>
              <strong>اختر ملف PDF أو اسحبه هنا</strong>
              <small>حتى 30 MB</small>
            </button>
            <input
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </section>

          <section className="panel pdf-merge-panel">
            <h3>دمج ملفات PDF</h3>
            <p className="muted small">
              اختر عدة ملفات، وستُدمج بالترتيب نفسه الذي تظهر به في قائمة الاختيار.
            </p>
            <button
              className="button outline"
              onClick={() => mergeInput.current?.click()}
              disabled={!!busy}
            >
              اختيار ملفات للدمج
            </button>
            <input
              ref={mergeInput}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              hidden
              onChange={(e) => {
                setMergeFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {mergeFiles.length > 0 && (
              <div className="selected-file">
                <strong>{mergeFiles.length} ملفات</strong>
                <span>{mergeFiles.map((item) => item.name).join(" · ")}</span>
              </div>
            )}
            <button
              className="button primary"
              disabled={!!busy || (file ? mergeFiles.length < 1 : mergeFiles.length < 2)}
              onClick={() => void merge()}
            >
              دمج وتنزيل
            </button>
          </section>
        </>
      ) : (
        <>
          <div className="editor-toolbar">
            <div>
              <h2>محرر PDF</h2>
              <p className="muted">
                {info?.filename} · {info?.pages ?? 0} صفحة ·{" "}
                {((info?.size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <div className="action-row">
              <button
                className="button outline"
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                فتح PDF آخر
              </button>
              <button
                className="button outline"
                disabled={!!busy || !original}
                onClick={() => void restoreOriginal()}
              >
                استعادة الأصل
              </button>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={resetEdits}
              >
                تصفير الإعدادات
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="pdf-editor-layout">
            <section className="panel pdf-controls">
              <h3>الصفحات والترتيب</h3>
              <label>
                ترتيب / استخراج الصفحات
                <input
                  value={pageOrder}
                  onChange={(e) => setPageOrder(e.target.value)}
                  placeholder="مثال: 1-5,8,7"
                />
              </label>
              <p className="muted small">
                يمكنك تغيير الترتيب أو حذف صفحات بعدم كتابتها. مثال: 3,1,2 أو
                1-4,8. ويمكن تكرار الصفحة لإنشاء نسخة منها.
              </p>

              <div className="two-fields">
                <label>
                  التدوير
                  <select value={rotate} onChange={(e) => setRotate(e.target.value)}>
                    <option value="0">بدون تدوير</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </label>
                <label>
                  الصفحات التي تُدوّر
                  <input
                    value={rotatePages}
                    onChange={(e) => setRotatePages(e.target.value)}
                    placeholder="all أو 1-3,5"
                  />
                </label>
              </div>

              <hr />
              <h3>مقاس الصفحة</h3>
              <label>
                المقاس
                <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                  {SIZE_OPTIONS.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                الاتجاه
                <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                  <option value="keep">حسب المقاس</option>
                  <option value="portrait">طولي Portrait</option>
                  <option value="landscape">عرضي Landscape</option>
                </select>
              </label>
              {pageSize === "CUSTOM" && (
                <div className="two-fields">
                  <label>
                    العرض (مم)
                    <input
                      type="number"
                      min="50"
                      max="1500"
                      step="0.1"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(e.target.value)}
                    />
                  </label>
                  <label>
                    الارتفاع (مم)
                    <input
                      type="number"
                      min="50"
                      max="1500"
                      step="0.1"
                      value={customHeight}
                      onChange={(e) => setCustomHeight(e.target.value)}
                    />
                  </label>
                </div>
              )}

              <hr />
              <h3>قص الهوامش</h3>
              <div className="pdf-crop-grid">
                <label>
                  أعلى (مم)
                  <input type="number" min="0" step="0.5" value={cropTop} onChange={(e) => setCropTop(e.target.value)} />
                </label>
                <label>
                  يمين (مم)
                  <input type="number" min="0" step="0.5" value={cropRight} onChange={(e) => setCropRight(e.target.value)} />
                </label>
                <label>
                  أسفل (مم)
                  <input type="number" min="0" step="0.5" value={cropBottom} onChange={(e) => setCropBottom(e.target.value)} />
                </label>
                <label>
                  يسار (مم)
                  <input type="number" min="0" step="0.5" value={cropLeft} onChange={(e) => setCropLeft(e.target.value)} />
                </label>
              </div>


              <hr />
              <div className="pdf-section-heading">
                <div>
                  <h3>إدراج صورة</h3>
                  <p className="muted small">أضف شعارًا أو ختمًا أو توقيعًا أو صورة توضيحية على الصفحات المحددة.</p>
                </div>
                <span className="pdf-feature-badge">PNG · JPG · WEBP</span>
              </div>

              <button
                className="button outline full"
                disabled={!!busy}
                onClick={() => imageInput.current?.click()}
              >
                {imageFile ? "تغيير الصورة" : "اختيار صورة"}
              </button>
              <input
                ref={imageInput}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  chooseImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              {imageFile && (
                <div className="pdf-image-selected">
                  {imagePreviewUrl && <img src={imagePreviewUrl} alt="معاينة الصورة المختارة" />}
                  <div>
                    <strong>{imageFile.name}</strong>
                    <span>{(imageFile.size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              )}

              <label>
                الصفحات المستهدفة
                <input
                  value={imagePages}
                  onChange={(e) => setImagePages(e.target.value)}
                  placeholder="all أو 1-3,5"
                />
              </label>

              <label>
                موضع الصورة
                <select value={imagePosition} onChange={(e) => setImagePosition(e.target.value)}>
                  <option value="free">حر — اسحب الصورة على الصفحة</option>
                  <option value="top_right">أعلى اليمين</option>
                  <option value="top_left">أعلى اليسار</option>
                  <option value="center">وسط الصفحة</option>
                  <option value="bottom_right">أسفل اليمين</option>
                  <option value="bottom_left">أسفل اليسار</option>
                  <option value="full_page">ملء الصفحة / خلفية</option>
                  <option value="custom">موضع مخصص</option>
                </select>
              </label>

              {imagePosition === "free" && info && (
                <label>
                  صفحة المعاينة الحرة
                  <select value={visualPage} onChange={(e) => setVisualPage(Number(e.target.value))}>
                    {Array.from({ length: info.pages }, (_, index) => index + 1).map((page) => (
                      <option key={page} value={page}>صفحة {page}</option>
                    ))}
                  </select>
                </label>
              )}

              {imagePosition === "custom" && (
                <div className="two-fields">
                  <label>
                    X من اليسار (مم)
                    <input type="number" min="0" step="0.5" value={imageX} onChange={(e) => setImageX(e.target.value)} />
                  </label>
                  <label>
                    Y من الأعلى (مم)
                    <input type="number" min="0" step="0.5" value={imageY} onChange={(e) => setImageY(e.target.value)} />
                  </label>
                </div>
              )}

              {imagePosition !== "full_page" && (
                <div className="two-fields">
                  <label>
                    العرض (مم)
                    <input type="number" min="1" step="0.5" value={imageWidth} onChange={(e) => setImageWidth(e.target.value)} />
                  </label>
                  <label>
                    الارتفاع (مم)
                    <input type="number" min="1" step="0.5" value={imageHeight} onChange={(e) => setImageHeight(e.target.value)} />
                  </label>
                </div>
              )}

              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={imageKeepAspect}
                  onChange={(e) => setImageKeepAspect(e.target.checked)}
                />
                الحفاظ على أبعاد الصورة الأصلية
              </label>

              <label>
                الشفافية — {Math.round(Number(imageOpacity) * 100)}%
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={imageOpacity}
                  onChange={(e) => setImageOpacity(e.target.value)}
                />
              </label>

              <div className="two-fields">
                <label>
                  تدوير الصورة
                  <select value={imageRotation} onChange={(e) => setImageRotation(e.target.value)}>
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </label>
                <label>
                  طبقة الصورة
                  <select value={imageOverlay ? "front" : "back"} onChange={(e) => setImageOverlay(e.target.value === "front")}>
                    <option value="front">فوق المحتوى</option>
                    <option value="back">خلف المحتوى</option>
                  </select>
                </label>
              </div>

              <button
                className="button primary full"
                disabled={!!busy || !imageFile}
                onClick={() => void insertImage()}
              >
                إدراج الصورة وتنزيل PDF
              </button>

              <hr />
              <h3>إضافات النص والترقيم</h3>
              <label>
                علامة مائية
                <input
                  maxLength={200}
                  value={watermark}
                  onChange={(e) => setWatermark(e.target.value)}
                  placeholder="مثال: نسخة داخلية"
                />
              </label>
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={pageNumbers}
                  onChange={(e) => setPageNumbers(e.target.checked)}
                />
                إضافة ترقيم للصفحات
              </label>
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={optimize}
                  onChange={(e) => setOptimize(e.target.checked)}
                />
                تنظيف وضغط بنية PDF عند الحفظ
              </label>

              <button
                className="button primary full"
                disabled={!!busy}
                onClick={() => void exportEdited()}
              >
                تطبيق التعديلات وتنزيل PDF
              </button>
            </section>

            <div className="pdf-preview-column">

              {imagePosition === "free" && imageFile && visualPageInfo && (
                <section className="panel pdf-free-placement-panel">
                  <div className="pdf-preview-header">
                    <div>
                      <strong>وضع الصورة بحرية</strong>
                      <span>اسحب الصورة لأي مكان على الصفحة، واسحب المقبض الصغير لتغيير الحجم.</span>
                    </div>
                    <span className="pdf-feature-badge">صفحة {visualPage}</span>
                  </div>

                  <div
                    ref={visualStageRef}
                    className="pdf-visual-stage"
                    style={{ aspectRatio: `${visualPageInfo.width_mm} / ${visualPageInfo.height_mm}` }}
                  >
                    {visualBusy && <div className="pdf-visual-loading">جارٍ تجهيز الصفحة…</div>}
                    {visualPageUrl && <img className="pdf-visual-page" src={visualPageUrl} alt={`صفحة PDF رقم ${visualPage}`} />}
                    {imagePreviewUrl && (
                      <div
                        className="pdf-free-image"
                        data-testid="pdf-free-image"
                        style={{
                          left: `${(Number(imageX) / visualPageInfo.width_mm) * 100}%`,
                          top: `${(Number(imageY) / visualPageInfo.height_mm) * 100}%`,
                          width: `${(Number(imageWidth) / visualPageInfo.width_mm) * 100}%`,
                          height: `${(Number(imageHeight) / visualPageInfo.height_mm) * 100}%`,
                          opacity: Number(imageOpacity),
                          transform: `rotate(${imageRotation}deg)`,
                        }}
                        onPointerDown={(event) => beginVisualDrag(event, "move")}
                        onPointerMove={updateVisualDrag}
                        onPointerUp={endVisualDrag}
                        onPointerCancel={endVisualDrag}
                      >
                        <img
                          src={imagePreviewUrl}
                          alt="الصورة الموضوعة على PDF"
                          draggable={false}
                          style={{ objectFit: imageKeepAspect ? "contain" : "fill" }}
                        />
                        <button
                          type="button"
                          className="pdf-resize-handle"
                          aria-label="تغيير حجم الصورة بالسحب"
                          onPointerDown={(event) => beginVisualDrag(event, "resize")}
                          onPointerMove={updateVisualDrag}
                          onPointerUp={endVisualDrag}
                          onPointerCancel={endVisualDrag}
                        />
                      </div>
                    )}
                  </div>
                  <div className="pdf-placement-readout">
                    <span>X: {Number(imageX).toFixed(1)} مم</span>
                    <span>Y: {Number(imageY).toFixed(1)} مم</span>
                    <span>{Number(imageWidth).toFixed(1)} × {Number(imageHeight).toFixed(1)} مم</span>
                  </div>
                </section>
              )}

              <section className="panel pdf-preview-panel">
                <div className="pdf-preview-header">
                  <div>
                    <strong>المعاينة</strong>
                    <span>تعتمد على عارض PDF في المتصفح</span>
                  </div>
                  <button
                    className="button outline"
                    onClick={() => {
                      if (file) downloadBlob(file, file.name);
                    }}
                  >
                    تنزيل النسخة الحالية
                  </button>
                </div>
                {previewUrl && (
                  <iframe
                    className="pdf-frame"
                    src={previewUrl}
                    title="معاينة PDF"
                  />
                )}
              </section>

              {info && (
                <section className="panel">
                  <h3>مقاسات الصفحات</h3>
                  <div className="metrics-grid">
                    <div>
                      <b>{info.pages}</b>
                      <span>صفحات</span>
                    </div>
                    <div>
                      <b>{info.text_chars.toLocaleString("ar-SA")}</b>
                      <span>حرف نصي قابل للاستخراج</span>
                    </div>
                    <div>
                      <b>{(info.size_bytes / 1024 / 1024).toFixed(2)}</b>
                      <span>MB</span>
                    </div>
                  </div>
                  <div className="pdf-page-table">
                    {info.page_sizes.map((page) => (
                      <div key={page.page}>
                        <strong>صفحة {page.page}</strong>
                        <span>
                          {page.width_mm} × {page.height_mm} مم
                        </span>
                        <small>
                          {page.orientation === "portrait" ? "طولي" : "عرضي"} ·{" "}
                          تدوير {page.rotation}°
                        </small>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="panel pdf-merge-panel">
                <h3>دمج ملفات إضافية</h3>
                <p className="muted small">
                  سيُستخدم الملف الحالي أولًا، ثم تُضاف الملفات التي تختارها بالترتيب، وبعد الدمج يمكنك متابعة التحرير على النتيجة.
                </p>
                <button
                  className="button outline"
                  onClick={() => mergeInput.current?.click()}
                  disabled={!!busy}
                >
                  اختيار ملفات للدمج
                </button>
                <input
                  ref={mergeInput}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    setMergeFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                {mergeFiles.length > 0 && (
                  <div className="selected-file">
                    <strong>{mergeFiles.length} ملفات</strong>
                    <span>{mergeFiles.map((item) => item.name).join(" · ")}</span>
                  </div>
                )}
                <button
                  className="button primary"
                  disabled={!!busy || (file ? mergeFiles.length < 1 : mergeFiles.length < 2)}
                  onClick={() => void merge()}
                >
                  دمج وتنزيل
                </button>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
