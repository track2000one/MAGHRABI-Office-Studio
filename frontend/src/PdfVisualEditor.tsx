import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";

type PageInfo = {
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
  page_sizes: PageInfo[];
  supported_sizes: string[];
};

type BaseElement = {
  id: string;
  type: "text" | "image" | "signature";
  page: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotation: 0 | 90 | 180 | 270;
  opacity: number;
};

type TextElement = BaseElement & {
  type: "text";
  text: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  align: "right" | "center" | "left";
  rtl: boolean;
};

type AssetElement = BaseElement & {
  type: "image" | "signature";
  assetId: string;
  keepAspect: boolean;
};

type VisualElement = TextElement | AssetElement;
type AssetEntry = { file: File; url: string };

type Props = {
  file: File;
  info: PdfInfo;
  onApplied: (file: File) => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const MAX_HISTORY = 50;

function makeId(prefix: string, counter: number) {
  return `${prefix}-${Date.now()}-${counter}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export default function PdfVisualEditor({
  file,
  info,
  onApplied,
  onError,
  onNotice,
}: Props) {
  const assetInput = useRef<HTMLInputElement>(null);
  const assetMode = useRef<"image" | "signature">("image");
  const stageRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const assetsRef = useRef<Record<string, AssetEntry>>({});
  const pageUrlRef = useRef("");
  const thumbUrlsRef = useRef<Record<number, string>>({});
  const dragRef = useRef<null | {
    mode: "move" | "resize";
    id: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    pageWidthMm: number;
    pageHeightMm: number;
    stageWidth: number;
    stageHeight: number;
    before: VisualElement[];
  }>(null);

  const [active, setActive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageUrl, setPageUrl] = useState("");
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [elements, setElements] = useState<VisualElement[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [assets, setAssets] = useState<Record<string, AssetEntry>>({});
  const [undoStack, setUndoStack] = useState<VisualElement[][]>([]);
  const [redoStack, setRedoStack] = useState<VisualElement[][]>([]);
  const [zoom, setZoom] = useState(100);
  const [loadingPage, setLoadingPage] = useState(false);
  const [saving, setSaving] = useState(false);

  const pageInfo = useMemo(
    () => info.page_sizes.find((item) => item.page === page) ?? info.page_sizes[0]!,
    [info, page],
  );
  const selected = useMemo(
    () => elements.find((item) => item.id === selectedId) ?? null,
    [elements, selectedId],
  );
  const pageElements = useMemo(
    () => elements.filter((item) => item.page === page),
    [elements, page],
  );

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    pageUrlRef.current = pageUrl;
  }, [pageUrl]);

  useEffect(() => {
    thumbUrlsRef.current = thumbUrls;
  }, [thumbUrls]);

  useEffect(() => {
    setPage(1);
    setElements([]);
    setSelectedId("");
    setUndoStack([]);
    setRedoStack([]);
    setZoom(100);
    setThumbUrls((old) => {
      Object.values(old).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setAssets((old) => {
      Object.values(old).forEach((entry) => URL.revokeObjectURL(entry.url));
      return {};
    });
  }, [file]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const loadPage = async () => {
      setLoadingPage(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("page_number", String(page));
        form.append("max_width_px", "1600");
        const response = await api("/pdf/render-page", { method: "POST", body: form });
        const blob = await response.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPageUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (error) {
        if (!cancelled)
          onError(error instanceof Error ? error.message : "تعذر عرض صفحة PDF.");
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    };
    void loadPage();
    return () => {
      cancelled = true;
    };
  }, [active, file, page]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const maxThumbs = Math.min(info.pages, 60);
    const load = async () => {
      for (let pageNumber = 1; pageNumber <= maxThumbs && !cancelled; pageNumber += 1) {
        try {
          const form = new FormData();
          form.append("file", file);
          form.append("page_number", String(pageNumber));
          form.append("max_width_px", "320");
          const response = await api("/pdf/render-page", { method: "POST", body: form });
          const blob = await response.blob();
          if (cancelled) break;
          const url = URL.createObjectURL(blob);
          setThumbUrls((old) => {
            if (old[pageNumber]) URL.revokeObjectURL(old[pageNumber]);
            return { ...old, [pageNumber]: url };
          });
        } catch {
          break;
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, file, info.pages]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        if (selectedId) {
          event.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selectedId, elements, undoStack, redoStack]);

  useEffect(() => {
    return () => {
      if (pageUrlRef.current) URL.revokeObjectURL(pageUrlRef.current);
      Object.values(thumbUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      Object.values(assetsRef.current).forEach((entry) => URL.revokeObjectURL(entry.url));
    };
  }, []);

  function commit(next: VisualElement[] | ((current: VisualElement[]) => VisualElement[])) {
    setElements((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      setUndoStack((history) => [...history, current].slice(-MAX_HISTORY));
      setRedoStack([]);
      return resolved;
    });
  }

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((history) => [elements, ...history].slice(0, MAX_HISTORY));
    setElements(previous);
    setSelectedId((id) => (previous.some((item) => item.id === id) ? id : ""));
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[0];
    setRedoStack((history) => history.slice(1));
    setUndoStack((history) => [...history, elements].slice(-MAX_HISTORY));
    setElements(next);
    setSelectedId((id) => (next.some((item) => item.id === id) ? id : ""));
  }

  function addText() {
    const id = makeId("text", ++idCounter.current);
    const next: TextElement = {
      id,
      type: "text",
      page,
      xMm: 20,
      yMm: 25,
      widthMm: Math.min(95, Math.max(45, pageInfo.width_mm - 40)),
      heightMm: 28,
      rotation: 0,
      opacity: 1,
      text: "نص جديد",
      fontSizePt: 16,
      color: "#173645",
      bold: false,
      align: "right",
      rtl: true,
    };
    commit((current) => [...current, next]);
    setSelectedId(id);
  }

  function requestAsset(mode: "image" | "signature") {
    assetMode.current = mode;
    assetInput.current?.click();
  }

  function addAsset(fileToAdd?: File) {
    if (!fileToAdd) return;
    if (!/\.(png|jpe?g|webp)$/i.test(fileToAdd.name)) {
      onError("اختر صورة PNG أو JPG أو JPEG أو WEBP.");
      return;
    }
    if (fileToAdd.size > 15 * 1024 * 1024) {
      onError("الحد الأقصى للصورة هو 15 ميجابايت.");
      return;
    }
    const mode = assetMode.current;
    const assetId = makeId("asset", ++idCounter.current);
    const id = makeId(mode, ++idCounter.current);
    const url = URL.createObjectURL(fileToAdd);
    setAssets((current) => ({ ...current, [assetId]: { file: fileToAdd, url } }));

    const next: AssetElement = {
      id,
      type: mode,
      page,
      xMm: 20,
      yMm: 28,
      widthMm: mode === "signature" ? 48 : 55,
      heightMm: mode === "signature" ? 20 : 38,
      rotation: 0,
      opacity: 1,
      assetId,
      keepAspect: true,
    };
    commit((current) => [...current, next]);
    setSelectedId(id);
    onNotice(mode === "signature" ? "تمت إضافة التوقيع إلى مساحة العمل." : "تمت إضافة الصورة إلى مساحة العمل.");
  }

  function deleteSelected() {
    if (!selectedId) return;
    commit((current) => current.filter((item) => item.id !== selectedId));
    setSelectedId("");
  }

  function updateSelected(patch: Partial<VisualElement>) {
    if (!selectedId) return;
    commit((current) =>
      current.map((item) =>
        item.id === selectedId ? ({ ...item, ...patch } as VisualElement) : item,
      ),
    );
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    element: VisualElement,
    mode: "move" | "resize",
  ) {
    const stage = stageRef.current;
    if (!stage || !pageInfo) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(element.id);
    const bounds = stage.getBoundingClientRect();
    dragRef.current = {
      mode,
      id: element.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.xMm,
      startY: element.yMm,
      startWidth: element.widthMm,
      startHeight: element.heightMm,
      pageWidthMm: pageInfo.width_mm,
      pageHeightMm: pageInfo.height_mm,
      stageWidth: Math.max(bounds.width, 1),
      stageHeight: Math.max(bounds.height, 1),
      before: elements,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const dxMm = ((event.clientX - drag.startClientX) / drag.stageWidth) * drag.pageWidthMm;
    const dyMm = ((event.clientY - drag.startClientY) / drag.stageHeight) * drag.pageHeightMm;
    setElements((current) =>
      current.map((item) => {
        if (item.id !== drag.id) return item;
        if (drag.mode === "move") {
          return {
            ...item,
            xMm: clamp(drag.startX + dxMm, 0, Math.max(0, drag.pageWidthMm - item.widthMm)),
            yMm: clamp(drag.startY + dyMm, 0, Math.max(0, drag.pageHeightMm - item.heightMm)),
          };
        }
        let width = Math.max(5, drag.startWidth + dxMm);
        let height = Math.max(5, drag.startHeight + dyMm);
        if (item.type !== "text" && item.keepAspect) {
          const ratio = drag.startWidth / Math.max(drag.startHeight, 0.1);
          if (Math.abs(dxMm) >= Math.abs(dyMm) * ratio) height = width / ratio;
          else width = height * ratio;
        }
        width = Math.min(width, Math.max(5, drag.pageWidthMm - item.xMm));
        height = Math.min(height, Math.max(5, drag.pageHeightMm - item.yMm));
        return { ...item, widthMm: width, heightMm: height };
      }),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setUndoStack((history) => [...history, drag.before].slice(-MAX_HISTORY));
    setRedoStack([]);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  async function saveVisualEdits() {
    if (!elements.length) {
      onError("أضف نصًا أو صورة أو توقيعًا قبل الحفظ.");
      return;
    }
    setSaving(true);
    try {
      const usedAssetIds = Array.from(
        new Set(
          elements
            .filter((item): item is AssetElement => item.type === "image" || item.type === "signature")
            .map((item) => item.assetId),
        ),
      );
      const assetIndex = new Map(usedAssetIds.map((id, index) => [id, index]));
      const payload = elements.map((item) => {
        const base = {
          id: item.id,
          type: item.type,
          page: item.page,
          x_mm: Number(item.xMm.toFixed(2)),
          y_mm: Number(item.yMm.toFixed(2)),
          width_mm: Number(item.widthMm.toFixed(2)),
          height_mm: Number(item.heightMm.toFixed(2)),
          rotation: item.rotation,
          opacity: Number(item.opacity.toFixed(2)),
        };
        if (item.type === "text") {
          return {
            ...base,
            text: item.text,
            font_size_pt: item.fontSizePt,
            color: item.color,
            bold: item.bold,
            align: item.align,
            rtl: item.rtl,
          };
        }
        return {
          ...base,
          asset_index: assetIndex.get(item.assetId),
          keep_aspect: item.keepAspect,
        };
      });

      const form = new FormData();
      form.append("file", file);
      form.append("elements_json", JSON.stringify(payload));
      usedAssetIds.forEach((id) => {
        const entry = assets[id];
        if (entry) form.append("assets", entry.file);
      });

      const response = await api("/pdf/apply-visual-edits", {
        method: "POST",
        body: form,
      });
      const blob = await response.blob();
      const edited = new File([blob], "MAGHRABI-visual-edited.pdf", {
        type: "application/pdf",
      });
      await onApplied(edited);
      setElements([]);
      setSelectedId("");
      setUndoStack([]);
      setRedoStack([]);
      onNotice("تم تطبيق عناصر المحرر المرئي على PDF وتنزيل النسخة الجديدة.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر حفظ تعديلات المحرر المرئي.");
    } finally {
      setSaving(false);
    }
  }

  if (!active) {
    return (
      <section className="panel pdf-visual-editor-launch">
        <div>
          <span className="welcome-label">VISUAL PDF EDITOR</span>
          <h3>المحرر المرئي الجديد</h3>
          <p className="muted small">
            حرّك الصور والنصوص والتواقيع مباشرة فوق صفحات PDF مع تراجع وإعادة وتكبير وصور مصغرة للصفحات.
          </p>
        </div>
        <button className="button primary" onClick={() => setActive(true)}>
          فتح المحرر المرئي
        </button>
      </section>
    );
  }

  return (
    <section className="panel pdf-visual-editor">
      <div className="pdf-visual-editor-head">
        <div>
          <span className="welcome-label">VISUAL PDF EDITOR</span>
          <h3>المحرر المرئي</h3>
          <p className="muted small">
            أضف عدة صور ونصوص وتواقيع، ثم حرّكها وكبّرها قبل حفظ PDF مرة واحدة.
          </p>
        </div>
        <div className="pdf-visual-toolbar" role="toolbar" aria-label="أدوات المحرر المرئي">
          <button className="button outline" onClick={() => setActive(false)} disabled={saving}>إغلاق</button>
          <button className="button outline" onClick={addText} disabled={saving}>＋ نص</button>
          <button className="button outline" onClick={() => requestAsset("image")} disabled={saving}>＋ صورة</button>
          <button className="button outline" onClick={() => requestAsset("signature")} disabled={saving}>＋ توقيع</button>
          <button className="button outline" onClick={undo} disabled={!undoStack.length || saving} title="تراجع Ctrl+Z">↶</button>
          <button className="button outline" onClick={redo} disabled={!redoStack.length || saving} title="إعادة Ctrl+Y">↷</button>
          <button className="button danger" onClick={deleteSelected} disabled={!selectedId || saving}>حذف</button>
          <input
            ref={assetInput}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              addAsset(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="pdf-visual-editor-layout">
        <aside className="pdf-thumbnails" aria-label="صفحات PDF">
          {Array.from({ length: info.pages }, (_, index) => index + 1).map((pageNumber) => (
            <button
              key={pageNumber}
              className={pageNumber === page ? "pdf-thumb active" : "pdf-thumb"}
              onClick={() => {
                setPage(pageNumber);
                setSelectedId("");
              }}
            >
              {thumbUrls[pageNumber] ? (
                <img src={thumbUrls[pageNumber]} alt={`صفحة ${pageNumber}`} />
              ) : (
                <span className="pdf-thumb-placeholder">{pageNumber}</span>
              )}
              <small>صفحة {pageNumber}</small>
              {elements.some((item) => item.page === pageNumber) && <i>{elements.filter((item) => item.page === pageNumber).length}</i>}
            </button>
          ))}
        </aside>

        <div className="pdf-canvas-column">
          <div className="pdf-canvas-toolbar">
            <strong>صفحة {page}</strong>
            <div>
              <button className="text-button" onClick={() => setZoom((value) => Math.max(50, value - 10))}>−</button>
              <span>{zoom}%</span>
              <button className="text-button" onClick={() => setZoom((value) => Math.min(180, value + 10))}>＋</button>
              <button className="text-button" onClick={() => setZoom(100)}>100%</button>
            </div>
          </div>
          <div className="pdf-canvas-scroll">
            <div
              ref={stageRef}
              className="pdf-editor-stage"
              data-testid="pdf-editor-stage"
              style={{
                width: `${Math.round(760 * (zoom / 100))}px`,
                aspectRatio: `${pageInfo.width_mm} / ${pageInfo.height_mm}`,
              }}
              onPointerDown={() => setSelectedId("")}
            >
              {loadingPage && <div className="pdf-visual-loading">جارٍ تجهيز الصفحة…</div>}
              {pageUrl && <img className="pdf-editor-page-image" src={pageUrl} alt={`صفحة PDF رقم ${page}`} />}

              {pageElements.map((element) => {
                const selectedNow = element.id === selectedId;
                const commonStyle = {
                  left: `${(element.xMm / pageInfo.width_mm) * 100}%`,
                  top: `${(element.yMm / pageInfo.height_mm) * 100}%`,
                  width: `${(element.widthMm / pageInfo.width_mm) * 100}%`,
                  height: `${(element.heightMm / pageInfo.height_mm) * 100}%`,
                  opacity: element.opacity,
                  transform: `rotate(${element.rotation}deg)`,
                };
                return (
                  <div
                    key={element.id}
                    data-testid={`visual-element-${element.type}`}
                    className={`pdf-canvas-element ${selectedNow ? "selected" : ""}`}
                    style={commonStyle}
                    onPointerDown={(event) => beginDrag(event, element, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {element.type === "text" ? (
                      <div
                        className="pdf-canvas-text"
                        dir={element.rtl ? "rtl" : "ltr"}
                        style={{
                          fontSize: `${Math.max(8, element.fontSizePt * 1.25 * (zoom / 100))}px`,
                          color: element.color,
                          fontWeight: element.bold ? 700 : 400,
                          textAlign: element.align,
                        }}
                      >
                        {element.text}
                      </div>
                    ) : (
                      <img
                        src={assets[element.assetId]?.url}
                        alt={element.type === "signature" ? "توقيع" : "صورة"}
                        draggable={false}
                        style={{ objectFit: element.keepAspect ? "contain" : "fill" }}
                      />
                    )}
                    {selectedNow && (
                      <button
                        type="button"
                        className="pdf-resize-handle"
                        aria-label="تغيير حجم العنصر بالسحب"
                        onPointerDown={(event) => beginDrag(event, element, "resize")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="pdf-element-inspector">
          <h4>خصائص العنصر</h4>
          {!selected && <p className="muted small">حدد نصًا أو صورة أو توقيعًا من الصفحة لتعديل خصائصه.</p>}
          {selected && (
            <>
              <span className="pdf-element-type">
                {selected.type === "text" ? "نص" : selected.type === "signature" ? "توقيع" : "صورة"}
              </span>

              {selected.type === "text" && (
                <>
                  <label>
                    النص
                    <textarea
                      rows={4}
                      value={selected.text}
                      onChange={(event) => updateSelected({ text: event.target.value } as Partial<VisualElement>)}
                    />
                  </label>
                  <div className="two-fields">
                    <label>
                      حجم الخط
                      <input
                        type="number"
                        min="6"
                        max="96"
                        value={selected.fontSizePt}
                        onChange={(event) => updateSelected({ fontSizePt: Number(event.target.value) } as Partial<VisualElement>)}
                      />
                    </label>
                    <label>
                      اللون
                      <input
                        type="color"
                        value={selected.color}
                        onChange={(event) => updateSelected({ color: event.target.value } as Partial<VisualElement>)}
                      />
                    </label>
                  </div>
                  <div className="two-fields">
                    <label>
                      المحاذاة
                      <select
                        value={selected.align}
                        onChange={(event) => updateSelected({ align: event.target.value as TextElement["align"] } as Partial<VisualElement>)}
                      >
                        <option value="right">يمين</option>
                        <option value="center">وسط</option>
                        <option value="left">يسار</option>
                      </select>
                    </label>
                    <label>
                      اتجاه النص
                      <select
                        value={selected.rtl ? "rtl" : "ltr"}
                        onChange={(event) => updateSelected({ rtl: event.target.value === "rtl" } as Partial<VisualElement>)}
                      >
                        <option value="rtl">العربية RTL</option>
                        <option value="ltr">LTR</option>
                      </select>
                    </label>
                  </div>
                  <label className="pdf-check">
                    <input
                      type="checkbox"
                      checked={selected.bold}
                      onChange={(event) => updateSelected({ bold: event.target.checked } as Partial<VisualElement>)}
                    />
                    خط عريض
                  </label>
                </>
              )}

              {selected.type !== "text" && (
                <label className="pdf-check">
                  <input
                    type="checkbox"
                    checked={selected.keepAspect}
                    onChange={(event) => updateSelected({ keepAspect: event.target.checked } as Partial<VisualElement>)}
                  />
                  الحفاظ على تناسب الصورة
                </label>
              )}

              <div className="two-fields">
                <label>
                  X (مم)
                  <input type="number" step="0.5" value={selected.xMm.toFixed(1)} onChange={(event) => updateSelected({ xMm: Number(event.target.value) } as Partial<VisualElement>)} />
                </label>
                <label>
                  Y (مم)
                  <input type="number" step="0.5" value={selected.yMm.toFixed(1)} onChange={(event) => updateSelected({ yMm: Number(event.target.value) } as Partial<VisualElement>)} />
                </label>
              </div>
              <div className="two-fields">
                <label>
                  العرض (مم)
                  <input type="number" min="5" step="0.5" value={selected.widthMm.toFixed(1)} onChange={(event) => updateSelected({ widthMm: Number(event.target.value) } as Partial<VisualElement>)} />
                </label>
                <label>
                  الارتفاع (مم)
                  <input type="number" min="5" step="0.5" value={selected.heightMm.toFixed(1)} onChange={(event) => updateSelected({ heightMm: Number(event.target.value) } as Partial<VisualElement>)} />
                </label>
              </div>
              <div className="two-fields">
                <label>
                  التدوير
                  <select
                    value={selected.rotation}
                    onChange={(event) => updateSelected({ rotation: Number(event.target.value) as BaseElement["rotation"] } as Partial<VisualElement>)}
                  >
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </label>
                <label>
                  الشفافية {Math.round(selected.opacity * 100)}%
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={selected.opacity}
                    onChange={(event) => updateSelected({ opacity: Number(event.target.value) } as Partial<VisualElement>)}
                  />
                </label>
              </div>
              <button className="button danger-soft full" onClick={deleteSelected}>حذف العنصر</button>
            </>
          )}
        </aside>
      </div>

      <div className="pdf-visual-savebar">
        <span>{elements.length} عنصرًا في مساحة العمل</span>
        <button className="button primary" onClick={() => void saveVisualEdits()} disabled={saving || !elements.length}>
          {saving ? "جارٍ الحفظ…" : "تطبيق جميع العناصر وحفظ PDF"}
        </button>
      </div>
    </section>
  );
}
