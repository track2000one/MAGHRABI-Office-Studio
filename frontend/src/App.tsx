import { useEffect, useRef, useState } from "react";
import { api, ApiError, downloadResponse, example, jsonBody } from "./api";
import type { Content, DocumentType, Format, RequestSettings, Section } from "./api";
import PdfStudio from "./PdfStudio";

type Page = "home" | "create" | "files" | "pdf" | "projects" | "settings";
type Analysis = {
  filename: string;
  type: string;
  size_bytes: number;
  metrics: Record<string, unknown>;
  analysis_note: string;
};
type LayoutSettings = {
  logoAlignment: "start" | "center" | "end";
  logoPlacement: "both" | "cover" | "header";
  headerAlignment: "start" | "center" | "end";
  footerAlignment: "start" | "center" | "end";
  pageOrientation: "portrait" | "landscape";
  pageMargins: "compact" | "standard" | "spacious";
  bodyFontSize: 10 | 11 | 12 | 13;
  showPageNumbers: boolean;
};
const defaultLayout: LayoutSettings = {
  logoAlignment: "start", logoPlacement: "both", headerAlignment: "start",
  footerAlignment: "start", pageOrientation: "portrait",
  pageMargins: "standard", bodyFontSize: 11, showPageNumbers: true,
};
type SavedDesign = {
  id: string;
  name: string;
  documentStyle: "luxury" | "corporate" | "minimal";
  documentType: DocumentType;
  brand: BrandFields;
  layout: LayoutSettings;
};
const DESIGN_STORAGE = "maghrabi-office-word-designs-v1";
function readDesigns(): SavedDesign[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DESIGN_STORAGE) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedDesign => {
      if (!item || typeof item !== "object") return false;
      const v = item as Partial<SavedDesign>;
      return typeof v.id === "string" && typeof v.name === "string" &&
        v.name.length <= 60 && !!v.layout && typeof v.layout === "object" &&
        !!v.brand && typeof v.brand === "object" &&
        ["luxury", "corporate", "minimal"].includes(v.documentStyle || "") &&
        Object.keys(documentTypeLabels).includes(v.documentType || "");
    }).slice(0, 12);
  } catch {
    return [];
  }
}
type BrandFields = {
  organizationName: string;
  headerText: string;
  footerText: string;
  tableTitle: string;
  tableTSV: string;
};
const emptyBrandFields: BrandFields = {
  organizationName: "", headerText: "", footerText: "", tableTitle: "", tableTSV: "",
};
type Project = { id: string; date: string; content: Content; context?: Pick<RequestSettings, "source_mode" | "reference_text" | "document_type"> & { branding?: BrandFields; layout?: LayoutSettings; documentStyle?: "luxury" | "corporate" | "minimal" } };
const STORAGE = "maghrabi-office-projects-v1";
const documentTypeLabels: Record<DocumentType, string> = {
  general: "مستند عام",
  report: "تقرير رسمي",
  study: "دراسة تفصيلية",
  strategy: "خطة استراتيجية",
  letter: "خطاب إداري",
};
const documentTypeHelp: Record<DocumentType, string> = {
  general: "غلاف وفهرس وملخص تنفيذي وتنسيق مناسب لمختلف الموضوعات.",
  report: "تقرير منظم بغلاف وفهرس وملخص وأقسام مرقمة لعرض الملاحظات والنتائج.",
  study: "دراسة بغلاف وفهرس وملخص وخارطة محاور؛ تُكتب المنهجية والنتائج إذا زودت بها.",
  strategy: "خطة ذات غلاف وفهرس وملخص وجدول محاور؛ دون اختلاق أهداف أو مؤشرات.",
  letter: "خطاب إداري دون غلاف أو فهرس، ويحتاج بيانات الجهة والتاريخ والتوقيع من المستخدم.",
};
const initial: RequestSettings = {
  topic: "",
  audience: "فريق العمل والإدارة",
  language: "ar",
  tone: "formal",
  format: "pptx",
  document_type: "general",
  section_count: 6,
  reference_text: "",
  source_mode: "general",
};
const names: Record<Page, string> = {
  home: "مساحة عملك",
  create: "إنشاء المحتوى",
  files: "تحليل وتنسيق الملفات",
  pdf: "تحرير PDF",
  projects: "مشاريعي",
  settings: "إعدادات الاتصال",
};
const metrics: Record<string, string> = {
  paragraphs: "فقرات",
  headings: "عناوين",
  tables: "جداول",
  worksheets: "أوراق عمل",
  slides: "شرائح",
  text_shapes: "عناصر نصية",
  pictures: "صور",
};
function readProjects(): Project[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (p: Project) =>
              typeof p?.id === "string" &&
              typeof p?.date === "string" &&
              isContent(p.content),
          )
          .slice(0, 15)
      : [];
  } catch {
    return [];
  }
}
function isContent(c: unknown): c is Content {
  if (!c || typeof c !== "object") return false;
  const v = c as Content;
  return (
    typeof v.title === "string" &&
    typeof v.summary === "string" &&
    ["ar", "en"].includes(v.language) &&
    Array.isArray(v.sections) &&
    v.sections.length > 0 &&
    v.sections.length <= 20 &&
    v.sections.every(
      (s) =>
        typeof s?.title === "string" &&
        typeof s?.notes === "string" &&
        Array.isArray(s.body) &&
        s.body.every((b) => typeof b === "string"),
    )
  );
}
function validateContent(c: Content) {
  if (
    !c.title.trim() ||
    !c.sections.length ||
    c.sections.some(
      (s) => !s.title.trim() || !s.body.length || s.body.some((p) => !p.trim()),
    )
  )
    throw new Error("أكمل عنوان المستند وعناوين المحاور ونصوصها قبل المتابعة.");
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setSettings] = useState<RequestSettings>(initial);
  const [stage, setStage] = useState<"topic" | "outline" | "edit">("topic");
  const [resumeStage, setResumeStage] = useState<"outline" | "edit">("edit");
  const [content, setContent] = useState<Content | null>(null);
  const [previous, setPrevious] = useState<Content | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "unconfigured" | "offline"
  >("loading");
  const [token, setToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [aiVerified, setAiVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<Format>("pptx");
  const [presentationStyle, setPresentationStyle] = useState<"luxury" | "corporate" | "minimal">("luxury");
  const [documentStyle, setDocumentStyle] = useState<"luxury" | "corporate" | "minimal">("luxury");
  const [brand, setBrand] = useState<BrandFields>(emptyBrandFields);
  const [layout, setLayout] = useState<LayoutSettings>(defaultLayout);
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>(readDesigns);
  const [newDesignName, setNewDesignName] = useState("");
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [wordPagePreview, setWordPagePreview] = useState<{url: string; fingerprint: string; pages: number} | null>(null);
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function checkStatus() {
    setStatus("loading");
    try {
      const data = await (await api("/ai/status")).json();
      setStatus(data.configured ? "ready" : "unconfigured");
      setAuthorized(data.authenticated === true);
      setAiVerified(false);
    } catch {
      setStatus("offline");
      setAuthorized(false);
      setAiVerified(false);
    }
  }
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview("");
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);
  useEffect(() => () => {
    if (wordPagePreview?.url) URL.revokeObjectURL(wordPagePreview.url);
  }, [wordPagePreview]);
  useEffect(() => {
    // Discard legacy plaintext credentials previously saved in sessionStorage.
    sessionStorage.removeItem("maghrabi-office-access-token-v1");
    void checkStatus();
  }, []);
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAuthorized(false);
        setPage("settings");
      }
      setError(e instanceof Error ? e.message : "تعذر إكمال العملية.");
    } finally {
      setBusy("");
    }
  }
  async function signIn() {
    await run("جارٍ التحقق من رمز الوصول…", async () => {
      if (!token.trim()) throw new Error("أدخل رمز الوصول للمنصة.");
      await api("/ai/login", jsonBody({ access_token: token.trim() }));
      setToken("");
      setAuthorized(true);
      setNotice("تم تسجيل الدخول بنجاح. يمكنك استخدام الذكاء الاصطناعي لمدة 7 أيام على هذا المتصفح.");
    });
  }
  async function testAIConnection() {
    await run("جارٍ اختبار توليد محتوى فعلي باستخدام مزود الذكاء الاصطناعي…", async () => {
      await api("/ai/test", { method: "POST" });
      setAiVerified(true);
      setNotice("نجح اختبار التوليد الفعلي. يمكنك الآن تجربة إنشاء محتواك.");
    });
  }
  async function signOut() {
    await run("جارٍ تسجيل الخروج…", async () => {
      await api("/ai/logout", { method: "POST" });
      setAuthorized(false);
      setAiVerified(false);
      setNotice("تم تسجيل الخروج من خدمة الذكاء الاصطناعي.");
    });
  }
  function changePage(next: Page) {
    if (!busy) {
      setPage(next);
      setError("");
      setNotice("");
    }
  }
  function start(format: Format) {
    setSettings((s) => ({ ...s, format }));
    setView(format);
    setPage("create");
  }
  function manual() {
    setContent({
      title: settings.topic,
      summary: "",
      language: settings.language,
      sections: [
        { title: "المقدمة", body: [""], notes: "" },
        { title: "الموضوع", body: [""], notes: "" },
      ],
    });
    setPrevious(null);
    setStage("edit");
    setSelected(0);
    setView(settings.format);
    setNotice("ابدأ بكتابة المحتوى؛ يمكنك تصديره بعد إكمال النصوص.");
  }
  async function generate(phase: "outline" | "draft") {
    await run(
      phase === "outline" ? "جارٍ اقتراح المحاور…" : "جارٍ كتابة المحتوى…",
      async () => {
        if (settings.topic.trim().length < 5)
          throw new Error("اكتب موضوعًا واضحًا من خمسة أحرف على الأقل.");
        if (status !== "ready")
          throw new Error(
            "خدمة الذكاء الاصطناعي غير متاحة الآن. استخدم التحرير اليدوي أو المثال التوضيحي.",
          );
        if (!authorized) {
          setPage("settings");
          throw new Error("يرجى تسجيل الدخول من إعدادات الاتصال لاستخدام الذكاء الاصطناعي.");
        }
        const outline =
          phase === "draft"
            ? (content?.sections.map((s) => s.title.trim()) ?? [])
            : [];
        if (
          phase === "draft" &&
          (outline.length < 2 || outline.length > 12 || outline.some((t) => !t))
        )
          throw new Error("أكمل عناوين المخطط؛ المطلوب من ٢ إلى ١٢ محورًا.");
        const data: Content = await (
          await api(
            "/ai/generate",
            jsonBody({
              ...settings,
              phase,
              outline,
              approved_title: phase === "draft" ? (content?.title ?? "") : "",
            }),
          )
        ).json();
        setPrevious(content);
        setContent(data);
        setStage(phase === "outline" ? "outline" : "edit");
        setSelected(0);
        setView(settings.format);
      },
    );
  }
  async function revise() {
    if (!content) return;
    await run("جارٍ تعديل المحتوى…", async () => {
      if (instruction.trim().length < 5)
        throw new Error("اكتب التعديل المطلوب بوضوح.");
      validateContent(content);
      if (!authorized) {
        setPage("settings");
        throw new Error("يرجى تسجيل الدخول لتفعيل التعديل بالذكاء الاصطناعي.");
      }
      const result: Content = await (
        await api(
          "/ai/revise",
          jsonBody({
            content,
            instruction,
            reference_text: settings.reference_text,
            source_mode: settings.source_mode,
          }),
        )
      ).json();
      setPrevious(content);
      setContent(result);
      setSelected(0);
      setInstruction("");
      setNotice("تم التعديل. راجع النتيجة، ويمكنك التراجع إلى النسخة السابقة.");
    });
  }
  function updateSection(index: number, patch: Partial<Section>) {
    setContent(
      (c) =>
        c && {
          ...c,
          sections: c.sections.map((s, i) =>
            i === index ? { ...s, ...patch } : s,
          ),
        },
    );
  }
  function moveSection(index: number, step: number) {
    if (!content) return;
    const sections = [...content.sections];
    [sections[index], sections[index + step]] = [
      sections[index + step],
      sections[index],
    ];
    setContent({ ...content, sections });
    setSelected(0);
  }
  // Invalidate the rendered PDF when content or any design input changes.
  const wordPreviewFingerprint = JSON.stringify({
    content, brand, layout, documentStyle, documentType: settings.document_type,
    logo: logoFile && [logoFile.name, logoFile.size, logoFile.lastModified],
  });

  async function requestWord(preview: boolean): Promise<Response> {
    if (!content) throw new Error("لا يوجد مستند للمعاينة.");
    const suffix = preview ? "&preview=true" : "";
    const custom = logoFile !== null ||
      Object.values(brand).some((value) => value.trim()) ||
      JSON.stringify(layout) !== JSON.stringify(defaultLayout);
    if (custom) {
      const table_rows = brand.tableTSV.trim()
        ? brand.tableTSV.trim().split(/\r?\n/).filter((line) => line.trim()).map(
            (line) => line.split("\t").map((cell) => cell.trim()))
        : [];
      if (table_rows.length > 31 || table_rows.some((row) => row.length > 6))
        throw new Error("الجدول يدعم 6 أعمدة و30 صف بيانات بحد أقصى.");
      const customization = {
        organization_name: brand.organizationName.trim(),
        header_text: brand.headerText.trim(),
        footer_text: brand.footerText.trim(),
        table_title: brand.tableTitle.trim(),
        table_rows,
        logo_alignment: layout.logoAlignment,
        logo_placement: layout.logoPlacement,
        header_alignment: layout.headerAlignment,
        footer_alignment: layout.footerAlignment,
        page_orientation: layout.pageOrientation,
        page_margins: layout.pageMargins,
        body_font_size: layout.bodyFontSize,
        show_page_numbers: layout.showPageNumbers,
      };
      const form = new FormData();
      form.append("content_json", JSON.stringify(content));
      form.append("customization_json", JSON.stringify(customization));
      if (logoFile) form.append("logo", logoFile, logoFile.name);
      return api(
        "/exports/docx/custom?design_style=" + documentStyle +
        "&document_type=" + settings.document_type + suffix,
        {method: "POST", body: form},
      );
    }
    return api(
      "/exports/docx?design_style=" + documentStyle +
      "&document_type=" + settings.document_type + suffix,
      jsonBody(content),
    );
  }

  async function previewActualWordPages() {
    if (!content) return;
    await run("جارٍ إنشاء المعاينة الفعلية لصفحات Word…", async () => {
      validateContent(content);
      const fingerprint = wordPreviewFingerprint;
      const response = await requestWord(true);
      const blob = await response.blob();
      if (!blob.size || !response.headers.get("content-type")?.includes("application/pdf"))
        throw new Error("لم يرجع الخادم معاينة PDF صالحة.");
      const url = URL.createObjectURL(blob);
      const pages = Number(response.headers.get("X-Preview-Pages") || 0);
      setWordPagePreview({url, pages: Number.isFinite(pages) ? pages : 0, fingerprint});
      setView("docx");
      setNotice("تم إنشاء معاينة فعلية لصفحات Word. راجع فواصل الصفحات قبل تنزيل DOCX.");
    });
  }

  async function exportFile(format: Format) {
    if (!content) return;
    await run("جارٍ تجهيز الملف…", async () => {
      validateContent(content);
      const response = format === "docx"
        ? await requestWord(false)
        : await api("/exports/pptx?design_style=" + presentationStyle, jsonBody(content));
      await downloadResponse(
        response,
        "MAGHRABI-" + (format === "docx" ? "document" : "presentation") + "." + format,
      );
      setNotice("تم تجهيز الملف وتنزيله. راجع تنسيقه النهائي في Office.");
    });
  }
  function saveDesignTemplate() {
    const name = newDesignName.trim();
    if (!name || name.length > 60) {
      setError("أدخل اسمًا للقالب من حرف إلى 60 حرفًا.");
      return;
    }
    if (savedDesigns.length >= 12) {
      setError("الحد الأقصى 12 قالبًا محفوظًا. احذف قالبًا قديمًا أولًا.");
      return;
    }
    const item: SavedDesign = {
      id: crypto.randomUUID(), name, documentStyle,
      documentType: settings.document_type, brand: { ...brand }, layout: { ...layout },
    };
    try {
      const next = [item, ...savedDesigns];
      localStorage.setItem(DESIGN_STORAGE, JSON.stringify(next));
      setSavedDesigns(next);
      setSelectedDesignId("");
      setNewDesignName("");
      setError("");
      setNotice("تم حفظ إعدادات تصميم Word على هذا المتصفح، دون ملف الشعار.");
    } catch {
      setError("تعذر حفظ القالب في المتصفح. تحقق من المساحة المتاحة.");
    }
  }
  function applyDesignTemplate(id: string) {
    const found = savedDesigns.find((item) => item.id === id);
    if (!found) return;
    setSelectedDesignId(id);
    setDocumentStyle(found.documentStyle);
    setSettings((value) => ({ ...value, document_type: found.documentType }));
    setBrand({ ...emptyBrandFields, ...found.brand });
    setLayout({ ...defaultLayout, ...found.layout });
    setLogoFile(null);
    setNotice("تم تطبيق القالب المحفوظ. أعد رفع الشعار إذا رغبت في استخدامه.");
    setError("");
  }
  function deleteDesignTemplate() {
    if (!selectedDesignId) return;
    const next = savedDesigns.filter((item) => item.id !== selectedDesignId);
    try {
      localStorage.setItem(DESIGN_STORAGE, JSON.stringify(next));
      setSavedDesigns(next);
      setSelectedDesignId("");
      setNotice("تم حذف القالب المحفوظ من هذا المتصفح.");
      setError("");
    } catch {
      setError("تعذر حذف القالب من التخزين المحلي.");
    }
  }
  function saveProject() {
    if (!content) return;
    try {
      validateContent(content);
      if (projects.length >= 15) throw new Error("بلغت الحد الأقصى وهو 15 نسخة. احذف نسخة محفوظة قبل إضافة نسخة جديدة.");
      const next = [
        { id: crypto.randomUUID(), date: new Date().toISOString(), content, context: {source_mode: settings.source_mode, reference_text: settings.reference_text, document_type: settings.document_type, branding: { ...brand }, layout: { ...layout }, documentStyle} },
        ...projects,
      ];
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setProjects(next);
      setNotice("تم حفظ نسخة على هذا المتصفح.");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الحفظ على المتصفح.");
    }
  }
  async function upload(next: File | undefined) {
    if (!next) return;
    await run("جارٍ تحليل الملف…", async () => {
      if (!/\.(docx|xlsx|pptx)$/i.test(next.name))
        throw new Error("اختر ملف DOCX أو XLSX أو PPTX.");
      if (next.size > 10 * 1024 * 1024)
        throw new Error("الحد الأقصى للملف هو 10 ميجابايت.");
      if (!next.size) throw new Error("الملف فارغ.");
      const form = new FormData();
      form.append("file", next);
      const result: Analysis = await (
        await api("/files/analyze", { method: "POST", body: form })
      ).json();
      setFile(next);
      setAnalyses((items) => [result, ...items].slice(0, 10));
      setNotice("اكتمل تحليل الملف بنجاح.");
    });
  }
  async function formatWord() {
    if (!file) return;
    await run("جارٍ تنسيق المستند…", async () => {
      const form = new FormData();
      form.append("file", file);
      await downloadResponse(
        await api("/files/format-docx", { method: "POST", body: form }),
        "MAGHRABI-formatted.docx",
      );
      setNotice(
        "تم تنزيل نسخة منسقة. احتُفظ بالنصوص والجداول؛ راجع التنسيق النهائي في Word.",
      );
    });
  }
  const section = content?.sections[selected];
  const aiLabel = status === "ready"
    ? (authorized ? (aiVerified ? "الذكاء الاصطناعي يعمل · اختبار ناجح" : "إعدادات الذكاء الاصطناعي مكتملة · لم يُختبر التوليد") : "المزود مهيأ · يلزم تسجيل الدخول")
    : {
        unconfigured: "بانتظار إعداد الذكاء الاصطناعي",
        offline: "الخادم غير متصل",
        loading: "جارٍ فحص الاتصال",
      }[status];

  return (
    <div className="studio-shell" dir="rtl">
      <aside className="studio-sidebar">
        <a
          className="studio-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage("home");
          }}
        >
          <span className="brand-monogram">M</span>
          <div>
            <strong>MAGHRABI</strong>
            <small>OFFICE STUDIO</small>
          </div>
        </a>
        <span className="nav-caption">مساحة العمل</span>
        <nav aria-label="القائمة الرئيسية">
          {(
            [
              ["home", "⌂", "الرئيسية"],
              ["create", "✦", "إنشاء بالذكاء الاصطناعي"],
              ["files", "▤", "ملفات Office"],
              ["pdf", "PDF", "تحرير PDF"],
              ["projects", "◫", "مشاريعي"],
              ["settings", "⚙", "إعدادات الاتصال"],
            ] as [Page, string, string][]
          ).map(([key, icon, title]) => (
            <button
              disabled={!!busy}
              key={key}
              className={page === key ? "side-link selected" : "side-link"}
              onClick={() => changePage(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span
            className={`connection-dot ${status === "ready" && authorized && aiVerified ? "connected" : ""}`}
          />
          <strong>{aiLabel}</strong>
          <p>محتواك، بتنسيق يليق به.</p>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-header">
          <div>
            <p className="eyebrow">من الفكرة إلى الملف النهائي</p>
            <h1>{names[page]}</h1>
          </div>
          <div className="header-tag">
            عربي <span>RTL</span>
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="إغلاق التنبيه">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner success" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="banner loading" role="status">
            <span className="spinner" />
            {busy}
          </div>
        )}
        {page === "home" && (
          <>
            <section className="welcome-panel">
              <div>
                <span className="welcome-label">
                  مساحة واحدة للمستندات والعروض
                </span>
                <h2>
                  فكرتك تستحق
                  <br />
                  <em>عرضًا أفضل.</em>
                </h2>
                <p>
                  اكتب موضوعك، راجع محاوره، ثم حوّله إلى مستند متكامل أو عرض
                  تقديمي قابل للتحرير.
                </p>
                <div className="action-row">
                  <button
                    className="button primary"
                    onClick={() => start("pptx")}
                  >
                    ✦ ابدأ من فكرة
                  </button>
                  <button
                    className="button translucent"
                    onClick={() => changePage("files")}
                  >
                    ارفع ملفًا موجودًا
                  </button>
                </div>
              </div>
              <div className="hero-document" aria-hidden="true">
                <span>MAGHRABI / STUDIO</span>
                <b>
                  وضوح الفكرة.
                  <br />
                  جمال التقديم.
                </b>
                <div className="paper-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <small>WORD + POWERPOINT</small>
              </div>
            </section>
            <div className="section-title">
              <h2>ما الذي تريد إنجازه اليوم؟</h2>
              <span>ابدأ بالطريقة المناسبة لك</span>
            </div>
            <div className="start-grid">
              <button className="start-card" onClick={() => start("docx")}>
                <span className="app-icon word">W</span>
                <h3>موضوع متكامل في Word</h3>
                <p>مقدمة، محاور واضحة وخاتمة، مع تنسيق عربي قابل للتعديل.</p>
                <b>إنشاء مستند ←</b>
              </button>
              <button className="start-card" onClick={() => start("pptx")}>
                <span className="app-icon powerpoint">P</span>
                <h3>فكرة تتحول إلى شرائح</h3>
                <p>مخطط منظم، نصوص مختصرة وملاحظات تساعدك أثناء التقديم.</p>
                <b>إنشاء عرض ←</b>
              </button>
              <button
                className="start-card"
                onClick={() => changePage("files")}
              >
                <span className="app-icon files">↥</span>
                <h3>حلّل ملفاتك ونسّقها</h3>
                <p>
                  تحليل Word وExcel وPowerPoint، وتنسيق أولي لفقرات Word
                  العربية.
                </p>
                <b>اختيار ملف ←</b>
              </button>
              <button
                className="start-card"
                onClick={() => changePage("pdf")}
              >
                <span className="app-icon pdf">PDF</span>
                <h3>تحرير PDF كامل</h3>
                <p>
                  ترتيب ودمج وقص وتدوير الصفحات وتغيير المقاسات وإضافة العلامة
                  المائية والترقيم.
                </p>
                <b>فتح محرر PDF ←</b>
              </button>
            </div>
            <section className="how-panel">
              <span>رحلة المحتوى</span>
              <b>١ · الفكرة</b>
              <i>←</i>
              <b>٢ · مراجعة المحاور</b>
              <i>←</i>
              <b>٣ · التحرير والتصدير</b>
            </section>
            {status === "ready" && !authorized && (
              <div className="soft-note">
                خدمة الذكاء الاصطناعي متصلة. سجّل الدخول مرة واحدة للبدء باستخدام التوليد والتعديل.
                {" "}
                <button className="text-button" onClick={() => changePage("settings")}>
                  تسجيل الدخول ←
                </button>
              </div>
            )}
            {status !== "ready" && (
              <div className="soft-note">
                يمكنك تجربة المحرر والتصدير الآن باستخدام مثال توضيحي أو محتوى
                تكتبه بنفسك.{" "}
                <button className="text-button" onClick={() => start("docx")}>
                  فتح المحرر ←
                </button>
              </div>
            )}
          </>
        )}
        {page === "create" && (
          <>
            <div className="stepper" aria-label="مراحل الإنشاء">
              {[
                ["topic", "١", "الموضوع"],
                ["outline", "٢", "المخطط"],
                ["edit", "٣", "التحرير والتصدير"],
              ].map(([s, n, label]) => (
                <div key={s} className={s === stage ? "current" : ""}>
                  <span>{n}</span>
                  {label}
                </div>
              ))}
            </div>
            {stage === "topic" ? (
              <div className="creation-layout">
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void generate("outline");
                  }}
                >
                  <fieldset disabled={!!busy}>
                    <h2>ما الفكرة التي تريد تطويرها؟</h2>
                    <p className="muted">
                      كلما وضّحت الهدف والجمهور، كان المحتوى أقرب لما تحتاجه.
                    </p>
                    <label>
                      الموضوع
                      <textarea
                        required
                        minLength={5}
                        maxLength={3000}
                        rows={4}
                        placeholder="مثال: خطة لتطوير تجربة المستفيدين في الخدمات الجامعية…"
                        value={settings.topic}
                        onChange={(e) =>
                          setSettings({ ...settings, topic: e.target.value })
                        }
                      />
                    </label>
                    <div className="two-fields">
                      <label>
                        نوع المخرج
                        <select
                          value={settings.format}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              format: e.target.value as Format,
                            })
                          }
                        >
                          <option value="pptx">عرض PowerPoint</option>
                          <option value="docx">مستند Word</option>
                        </select>
                      </label>
                      <label>
                        عدد المحاور
                        <select
                          value={settings.section_count}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              section_count: Number(e.target.value),
                            })
                          }
                        >
                          {[2, 3, 4, 6, 8, 10, 12].map((n) => (
                            <option key={n} value={n}>
                              {n} محاور
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {settings.format === "docx" && (
                      <label>
                        نوع مستند Word
                        <select
                          aria-label="نوع مستند Word"
                          value={settings.document_type}
                          onChange={(e) => {
                            const document_type = e.target.value as DocumentType;
                            setSettings({
                              ...settings,
                              document_type,
                              section_count: document_type === "letter" ? 2 : settings.section_count,
                            });
                          }}
                        >
                          {Object.entries(documentTypeLabels).map(([value, label]) => (
                            <option value={value} key={value}>{label}</option>
                          ))}
                        </select>
                        <small className="muted">{documentTypeHelp[settings.document_type]}</small>
                      </label>
                    )}
                    <label>
                      الجمهور المستهدف
                      <input
                        maxLength={200}
                        value={settings.audience}
                        onChange={(e) =>
                          setSettings({ ...settings, audience: e.target.value })
                        }
                      />
                    </label>
                    <div className="two-fields">
                      <label>
                        اللغة
                        <select
                          value={settings.language}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              language: e.target.value as "ar" | "en",
                            })
                          }
                        >
                          <option value="ar">العربية</option>
                          <option value="en">English</option>
                        </select>
                      </label>
                      <label>
                        أسلوب المحتوى
                        <select
                          value={settings.tone}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              tone: e.target.value as RequestSettings["tone"],
                            })
                          }
                        >
                          <option value="formal">رسمي</option>
                          <option value="educational">تعليمي</option>
                          <option value="concise">مختصر</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      مصدر المعلومات
                      <select
                        value={settings.source_mode}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            source_mode: e.target
                              .value as RequestSettings["source_mode"],
                          })
                        }
                      >
                        <option value="general">
                          معرفة عامة مع مراجعة المعلومات
                        </option>
                        <option value="reference">
                          اعتمد على نصي المرجعي فقط
                        </option>
                      </select>
                    </label>
                    <label>
                      نص مرجعي{" "}
                      {settings.source_mode === "general"
                        ? "(اختياري)"
                        : "(مطلوب)"}
                      <textarea
                        rows={3}
                        maxLength={16000}
                        required={settings.source_mode === "reference"}
                        value={settings.reference_text}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            reference_text: e.target.value,
                          })
                        }
                        placeholder="الصق هنا الحقائق والمراجع التي تريد المحافظة عليها…"
                      />
                    </label>
                    <button
                      className="button primary full"
                      type="submit"
                      disabled={status !== "ready"}
                    >
                      ✦ اقترح مخطط المحتوى
                    </button>
                    {status !== "ready" && (
                      <p className="muted small">
                        التوليد بالذكاء الاصطناعي غير متاح حتى إعداد الخدمة.
                      </p>
                    )}
                  </fieldset>
                </form>
                <aside className="guide-panel">
                  <span className="eyebrow">ابدأ اليوم</span>
                  <h2>
                    أنت تقود الفكرة.
                    <br />
                    والمساعد يرتّبها.
                  </h2>
                  <p>راجع المخطط أولًا، ثم أنشئ المحتوى وعدّله قبل التنزيل.</p>
                  <ul>
                    <li>ملفات قابلة للتحرير في Office.</li>
                    <li>تصدير المحتوى نفسه إلى Word أو PowerPoint.</li>
                    <li>دعم العربية وملاحظات المتحدث.</li>
                  </ul>
                  <hr />
                  {content && <button className="button outline full" disabled={!!busy} onClick={() => setStage(resumeStage)}>العودة إلى المحتوى الحالي</button>}
                  <h3>جرّب دون ذكاء اصطناعي</h3>
                  <button
                    className="button outline full"
                    disabled={!!busy}
                    onClick={manual}
                  >
                    اكتب المحتوى بنفسك
                  </button>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => {
                      setContent(structuredClone(example));
                      setSettings({...initial, format: settings.format, document_type: settings.document_type});
                      setPrevious(null);
                      setStage("edit");
                      setSelected(0);
                      setView(settings.format);
                      setNotice(
                        "هذا مثال توضيحي ثابت لتجربة التحرير والتصدير، وليس نتيجة توليد.",
                      );
                    }}
                  >
                    فتح مثال توضيحي ←
                  </button>
                  <p className="small muted">
                    لا تتضمن هذه النسخة بحثًا مباشرًا على الإنترنت.
                  </p>
                </aside>
              </div>
            ) : (
              content && (
                <>
                  <div className="editor-toolbar">
                    <div>
                      <h2>
                        {stage === "outline"
                          ? "راجع محاور المحتوى"
                          : "حرّر، عاين، ثم صدّر"}
                      </h2>
                      <p className="muted">
                        {stage === "outline"
                          ? "رتّب العناوين أو أضف محورًا قبل الكتابة."
                          : "يمكن تعديل جميع النصوص. الحفظ المحلي يتم عند الضغط على حفظ نسخة."}
                      </p>
                    </div>
                    <button
                      className="button outline"
                      disabled={!!busy}
                      onClick={() => { setResumeStage(stage); setStage("topic"); }}
                    >
                      إعدادات الموضوع
                    </button>
                  </div>
                  {stage === "outline" ? (
                    <div className="panel outline-editor">
                      <fieldset disabled={!!busy}>
                        <label>
                          عنوان المحتوى
                          <input
                            maxLength={180}
                            value={content.title}
                            onChange={(e) =>
                              setContent({ ...content, title: e.target.value })
                            }
                          />
                        </label>
                        {content.sections.map((s, i) => (
                          <div className="outline-row" key={i}>
                            <span>{i + 1}</span>
                            <input
                              aria-label={`عنوان المحور ${i + 1}`}
                              maxLength={160}
                              value={s.title}
                              onChange={(e) =>
                                updateSection(i, { title: e.target.value })
                              }
                            />
                            <button
                              aria-label={`رفع المحور ${i + 1}`}
                              disabled={i === 0}
                              onClick={() => moveSection(i, -1)}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`خفض المحور ${i + 1}`}
                              disabled={i === content.sections.length - 1}
                              onClick={() => moveSection(i, 1)}
                            >
                              ↓
                            </button>
                            <button
                              aria-label={`حذف المحور ${i + 1}`}
                              disabled={content.sections.length <= 2}
                              onClick={() =>
                                setContent({
                                  ...content,
                                  sections: content.sections.filter(
                                    (_, n) => n !== i,
                                  ),
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <div className="action-row">
                          <button
                            className="button outline"
                            disabled={content.sections.length >= 12}
                            onClick={() =>
                              setContent({
                                ...content,
                                sections: [
                                  ...content.sections,
                                  { title: "", body: [""], notes: "" },
                                ],
                              })
                            }
                          >
                            + إضافة محور
                          </button>
                          <button
                            className="button primary"
                            onClick={() => void generate("draft")}
                          >
                            إنشاء المحتوى الكامل
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setStage("edit")}
                          >
                            تحرير يدوي
                          </button>
                        </div>
                      </fieldset>
                    </div>
                  ) : (
                    <>
                      <div className="review-layout">
                        <div className="panel content-editor">
                          <fieldset disabled={!!busy}>
                            <label>
                              عنوان المستند
                              <input
                                maxLength={180}
                                value={content.title}
                                onChange={(e) =>
                                  setContent({
                                    ...content,
                                    title: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              وصف مختصر
                              <textarea
                                maxLength={600}
                                rows={2}
                                value={content.summary}
                                onChange={(e) =>
                                  setContent({
                                    ...content,
                                    summary: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              المحور المحدد
                              <select
                                value={selected}
                                onChange={(e) =>
                                  setSelected(Number(e.target.value))
                                }
                              >
                                {content.sections.map((s, i) => (
                                  <option value={i} key={i}>
                                    {i + 1}. {s.title || "محور جديد"}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {section && (
                              <>
                                <label>
                                  عنوان المحور
                                  <input
                                    maxLength={160}
                                    value={section.title}
                                    onChange={(e) =>
                                      updateSection(selected, {
                                        title: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  النص — فقرة في كل سطر
                                  <textarea
                                    rows={7}
                                    value={section.body.join("\n")}
                                    onChange={(e) =>
                                      updateSection(selected, {
                                        body: e.target.value.split("\n"),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  ملاحظات المتحدث
                                  <textarea
                                    rows={2}
                                    maxLength={3000}
                                    value={section.notes}
                                    onChange={(e) =>
                                      updateSection(selected, {
                                        notes: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                              </>
                            )}
                            <div className="action-row">
                              <button
                                className="text-button"
                                disabled={content.sections.length >= 20}
                                onClick={() => {
                                  setContent({
                                    ...content,
                                    sections: [
                                      ...content.sections,
                                      {
                                        title: "محور جديد",
                                        body: [""],
                                        notes: "",
                                      },
                                    ],
                                  });
                                  setSelected(content.sections.length);
                                }}
                              >
                                + إضافة محور
                              </button>
                              <button
                                className="text-button danger"
                                disabled={content.sections.length <= 1}
                                onClick={() => {
                                  setContent({
                                    ...content,
                                    sections: content.sections.filter(
                                      (_, i) => i !== selected,
                                    ),
                                  });
                                  setSelected(0);
                                }}
                              >
                                حذف المحور
                              </button>
                            </div>
                          </fieldset>
                        </div>
                        <div className="preview-column">
                          <div
                            className="preview-switch"
                            role="group"
                            aria-label="نوع المعاينة"
                          >
                            <button
                              className={view === "pptx" ? "active" : ""}
                              onClick={() => setView("pptx")}
                            >
                              معاينة الشرائح
                            </button>
                            <button
                              className={view === "docx" ? "active" : ""}
                              onClick={() => setView("docx")}
                            >
                              معاينة Word
                            </button>
                          </div>
                          {view === "pptx" ? (
                            <div
                              className={`slide-preview slide-preview--${presentationStyle}`}
                              dir={content.language === "ar" ? "rtl" : "ltr"}
                            >
                              <span>MAGHRABI / OFFICE STUDIO</span>
                              <h2>{section?.title || content.title}</h2>
                              {section?.body.map((p, i) => (
                                <p key={i}>{p}</p>
                              ))}
                              <small>
                                {selected + 1} / {content.sections.length}
                              </small>
                            </div>
                          ) : (
                            <article
                              className={`document-preview document-preview--${documentStyle} document-preview-kind--${settings.document_type} document-preview--${layout.pageOrientation} document-preview-margins--${layout.pageMargins}`}
                              style={{ fontSize: `${layout.bodyFontSize + 2}px` }}
                              dir={content.language === "ar" ? "rtl" : "ltr"}
                            >
                              <div className="document-preview-heading">
                                {brand.organizationName && <strong>{brand.organizationName}</strong>}
                                {logoPreview && (settings.document_type === "letter" || layout.logoPlacement !== "header") && (
                                  <div className={`document-preview-logo-slot align-${layout.logoAlignment}`}>
                                    <img src={logoPreview} alt="الشعار المضاف للمستند" className="document-logo-preview" />
                                  </div>
                                )}
                              </div>
                              {brand.headerText && <div className={`document-preview-line align-${layout.headerAlignment}`}>{brand.headerText}</div>}
                              <span className="document-kind-label">{documentTypeLabels[settings.document_type]}</span>
                              <h2>{content.title}</h2>
                              <p className="muted">{content.summary}</p>
                              {content.sections.map((s, i) => (
                                <div key={i}>
                                  <h3>{s.title}</h3>
                                  {s.body.map((p, j) => (
                                    <p key={j}>{p}</p>
                                  ))}
                                </div>
                              ))}
                              <div className={`document-preview-footer align-${layout.footerAlignment}`}>
                                {brand.footerText}{layout.showPageNumbers ? "  ·  صفحة 1" : ""}
                              </div>
                            </article>
                          )}
                          <p className="small muted">
                            معاينة للمحتوى؛ قد تختلف فواصل الصفحات والخطوط في
                            Office. الشرائح الطويلة تُقسّم تلقائيًا عند التصدير،
                            وتُضاف شريحة غلاف.
                          </p>
                          <div className="presentation-style-control">
                            <label htmlFor="presentation-style">
                              طابع تصميم PowerPoint
                              <select
                                id="presentation-style"
                                value={presentationStyle}
                                onChange={(e) => setPresentationStyle(e.target.value as "luxury" | "corporate" | "minimal")}
                              >
                                <option value="luxury">فاخر — كحلي وذهبي</option>
                                <option value="corporate">مؤسسي — كحلي وفيروزي</option>
                                <option value="minimal">عصري — بنفسجي هادئ</option>
                              </select>
                            </label>
                            <p className="muted small">
                              قوالب متنوعة: غلاف احترافي، فهرس للمحاور، بطاقات محتوى قابلة للتحرير وتوزيع آلي للنصوص الطويلة.
                            </p>
                          </div>
                          <div className="presentation-style-control word-style-control">
                            <h3 className="template-library-heading">مكتبة قوالب Word الجاهزة</h3>
                            <div className="template-library-grid" aria-label="مكتبة قوالب Word">
                              {(Object.entries(documentTypeLabels) as [DocumentType, string][]).map(([kind, label]) => (
                                <button
                                  type="button"
                                  key={kind}
                                  className={`template-library-choice${kind === settings.document_type ? " selected" : ""}`}
                                  aria-pressed={kind === settings.document_type}
                                  onClick={() => setSettings({ ...settings, document_type: kind })}
                                  disabled={!!busy}
                                >
                                  <span className="template-library-visual" aria-hidden="true">
                                    <span /><span /><span />
                                  </span>
                                  <strong>{label}</strong>
                                </button>
                              ))}
                            </div>
                            <label htmlFor="document-type">
                              نوع مستند Word
                              <select
                                id="document-type"
                                value={settings.document_type}
                                onChange={(e) => setSettings({
                                  ...settings,
                                  document_type: e.target.value as DocumentType,
                                })}
                              >
                                {Object.entries(documentTypeLabels).map(([value, label]) => (
                                  <option value={value} key={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                            <p className="muted small">{documentTypeHelp[settings.document_type]}</p>
                            <label htmlFor="document-style">
                              طابع تصميم Word
                              <select
                                id="document-style"
                                value={documentStyle}
                                onChange={(e) => setDocumentStyle(e.target.value as "luxury" | "corporate" | "minimal")}
                              >
                                <option value="luxury">فاخر — كحلي وذهبي</option>
                                <option value="corporate">مؤسسي — كحلي وفيروزي</option>
                                <option value="minimal">عصري — بنفسجي هادئ</option>
                              </select>
                            </label>
                            <p className="muted small">
                              {settings.document_type === "letter"
                                ? "خطاب قابل للتحرير دون بيانات رسمية مفترضة. أدخل اسم الجهة والأرقام والتواريخ والتوقيع في المحتوى حسب الحاجة."
                                : "مستند قابل للتحرير بغلاف وفهرس وملخص ومحاور مرتبة. تُستخدم بياناتك فقط، دون نتائج أو أرقام مختلقة."}
                            </p>
                          </div>
                          <div className="presentation-style-control document-brand-control">
                            <h3 className="template-library-heading">تخصيص الهوية والجداول</h3>
                            <div className="two-fields">
                              <label>
                                اسم الجهة (اختياري)
                                <input
                                  maxLength={150}
                                  value={brand.organizationName}
                                  onChange={(e) => setBrand({ ...brand, organizationName: e.target.value })}
                                  placeholder="اسم الجهة كما تريد ظهوره"
                                />
                              </label>
                              <label>
                                شعار الجهة (PNG أو JPG)
                                <input
                                  aria-label="شعار الجهة (PNG أو JPG)"
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  onChange={(e) => {
                                    const chosen = e.target.files?.[0];
                                    if (!chosen) return;
                                    if (!["image/png", "image/jpeg"].includes(chosen.type) || chosen.size > 1024 * 1024) {
                                      setError("اختر شعار PNG أو JPG بحجم لا يتجاوز 1 ميجابايت.");
                                      setLogoFile(null);
                                    } else {
                                      setLogoFile(chosen);
                                      setError("");
                                    }
                                    e.target.value = "";
                                  }}
                                />
                                {logoFile && (
                                  <button type="button" className="text-button" onClick={() => setLogoFile(null)}>
                                    إزالة الشعار: {logoFile.name}
                                  </button>
                                )}
                              </label>
                            </div>
                            <div className="two-fields">
                              <label>
                                نص الترويسة (اختياري)
                                <input
                                  maxLength={160}
                                  value={brand.headerText}
                                  onChange={(e) => setBrand({ ...brand, headerText: e.target.value })}
                                  placeholder="مثال: الإدارة العامة..."
                                />
                              </label>
                              <label>
                                نص التذييل (اختياري)
                                <input
                                  maxLength={160}
                                  value={brand.footerText}
                                  onChange={(e) => setBrand({ ...brand, footerText: e.target.value })}
                                  placeholder="مثال: للاستخدام الداخلي"
                                />
                              </label>
                            </div>
                            <label>
                              عنوان الجدول (اختياري)
                              <input
                                maxLength={160}
                                value={brand.tableTitle}
                                onChange={(e) => setBrand({ ...brand, tableTitle: e.target.value })}
                                placeholder="مثال: خطة التنفيذ"
                              />
                            </label>
                            <label>
                              بيانات جدول من Excel (اختياري)
                              <textarea
                                rows={4}
                                maxLength={18000}
                                value={brand.tableTSV}
                                onChange={(e) => setBrand({ ...brand, tableTSV: e.target.value })}
                                placeholder={"البند\\tالمسؤول\\tالحالة\nالخطوة الأولى\\tالفريق المختص\\tقيد التنفيذ"}
                              />
                            </label>
                            <p className="muted small">
                              انسخ الجدول من Excel والصقه هنا (أعمدة مفصولة بـ Tab). الصف الأول للعناوين،
                              بحد أقصى 6 أعمدة و30 صفًا. يبقى الجدول قابلًا للتحرير في Word.
                              لا يُحفظ ملف الشعار على الخادم ولا ضمن المشاريع المحلية.
                            </p>
                          </div>
                          <div className="presentation-style-control word-layout-editor">
                            <h3 className="template-library-heading">محرّر تخطيط القالب</h3>
                            <p className="muted small">حدّد محاذاة عناصر الهوية وتخطيط الصفحة. تُطبّق هذه الإعدادات على ملف Word النهائي.</p>
                            <div className="two-fields">
                              <label>
                                موضع الشعار
                                <select aria-label="موضع الشعار" value={layout.logoAlignment} onChange={(e) => setLayout({ ...layout, logoAlignment: e.target.value as LayoutSettings["logoAlignment"] })}>
                                  <option value="start">بداية السطر</option>
                                  <option value="center">وسط الصفحة</option>
                                  <option value="end">نهاية السطر</option>
                                </select>
                              </label>
                              <label>
                                ظهور الشعار
                                <select aria-label="ظهور الشعار" value={layout.logoPlacement} onChange={(e) => setLayout({ ...layout, logoPlacement: e.target.value as LayoutSettings["logoPlacement"] })}>
                                  <option value="both">الغلاف والترويسة</option>
                                  <option value="cover">الغلاف فقط</option>
                                  <option value="header">الترويسة فقط</option>
                                </select>
                              </label>
                            </div>
                            <div className="two-fields">
                              <label>
                                محاذاة الترويسة
                                <select aria-label="محاذاة الترويسة" value={layout.headerAlignment} onChange={(e) => setLayout({ ...layout, headerAlignment: e.target.value as LayoutSettings["headerAlignment"] })}>
                                  <option value="start">بداية السطر</option>
                                  <option value="center">وسط الصفحة</option>
                                  <option value="end">نهاية السطر</option>
                                </select>
                              </label>
                              <label>
                                محاذاة التذييل
                                <select aria-label="محاذاة التذييل" value={layout.footerAlignment} onChange={(e) => setLayout({ ...layout, footerAlignment: e.target.value as LayoutSettings["footerAlignment"] })}>
                                  <option value="start">بداية السطر</option>
                                  <option value="center">وسط الصفحة</option>
                                  <option value="end">نهاية السطر</option>
                                </select>
                              </label>
                            </div>
                            <div className="two-fields">
                              <label>
                                اتجاه الصفحة
                                <select aria-label="اتجاه الصفحة" value={layout.pageOrientation} onChange={(e) => setLayout({ ...layout, pageOrientation: e.target.value as LayoutSettings["pageOrientation"] })}>
                                  <option value="portrait">عمودي A4</option>
                                  <option value="landscape">أفقي A4</option>
                                </select>
                              </label>
                              <label>
                                هوامش الصفحة
                                <select aria-label="هوامش الصفحة" value={layout.pageMargins} onChange={(e) => setLayout({ ...layout, pageMargins: e.target.value as LayoutSettings["pageMargins"] })}>
                                  <option value="compact">ضيقة</option>
                                  <option value="standard">متوسطة</option>
                                  <option value="spacious">واسعة</option>
                                </select>
                              </label>
                            </div>
                            <div className="two-fields">
                              <label>
                                حجم الخط الأساسي
                                <select aria-label="حجم الخط الأساسي" value={layout.bodyFontSize} onChange={(e) => setLayout({ ...layout, bodyFontSize: Number(e.target.value) as LayoutSettings["bodyFontSize"] })}>
                                  {[10, 11, 12, 13].map((v) => <option key={v} value={v}>{v} نقطة</option>)}
                                </select>
                              </label>
                              <label>
                                ترقيم الصفحات
                                <select aria-label="ترقيم الصفحات" value={layout.showPageNumbers ? "yes" : "no"} onChange={(e) => setLayout({ ...layout, showPageNumbers: e.target.value === "yes" })}>
                                  <option value="yes">إظهار</option>
                                  <option value="no">إخفاء</option>
                                </select>
                              </label>
                            </div>
                            {settings.document_type === "letter" && (
                              <p className="muted small">في الخطابات يظهر الشعار في الترويسة دائمًا؛ لأنها لا تتضمن صفحة غلاف.</p>
                            )}
                            <div className="word-design-preset">
                              <h3 className="template-library-heading">قوالبي المحفوظة</h3>
                              <label>
                                القوالب الشخصية
                                <select aria-label="القوالب الشخصية" value={selectedDesignId} onChange={(e) => applyDesignTemplate(e.target.value)}>
                                  <option value="">اختر قالبًا محفوظًا</option>
                                  {savedDesigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                              </label>
                              <label>
                                اسم القالب الجديد
                                <input maxLength={60} aria-label="اسم القالب الجديد" value={newDesignName} onChange={(e) => setNewDesignName(e.target.value)} placeholder="مثال: قالب التقرير الإداري" />
                              </label>
                              <div className="word-preset-actions">
                                <button className="button outline" type="button" disabled={!!busy || !newDesignName.trim()} onClick={saveDesignTemplate}>حفظ تصميم القالب</button>
                                <button className="button outline" type="button" disabled={!!busy || !selectedDesignId} onClick={deleteDesignTemplate}>حذف القالب المحدد</button>
                              </div>
                              <p className="muted small">تُحفظ إعدادات التصميم والنصوص محليًا على هذا المتصفح فقط (12 قالبًا كحد أقصى). لا تُحفظ صورة الشعار؛ أعد رفعها عند تطبيق القالب.</p>
                            </div>
                          </div>
                          <div className="export-row">
                            <button
                              className="button primary"
                              disabled={!!busy}
                              onClick={() => void exportFile("pptx")}
                            >
                              تنزيل PowerPoint
                            </button>
                            <button
                              className="button outline"
                              disabled={!!busy}
                              onClick={() => void exportFile("docx")}
                            >
                              تنزيل Word
                            </button>
                            <button
                              className="text-button"
                              disabled={!!busy}
                              onClick={saveProject}
                            >
                              حفظ نسخة
                            </button>
                          </div>
                        </div>
                      </div>
                      <section className="panel revision-panel">
                        <div>
                          <h3>✦ اطلب تعديلًا</h3>
                          <p className="muted small">
                            مثل: اختصر الفقرات وأضف خطوة عملية لكل محور.
                          </p>
                        </div>
                        <input
                          aria-label="التعديل المطلوب"
                          disabled={!!busy || status !== "ready"}
                          maxLength={2000}
                          value={instruction}
                          onChange={(e) => setInstruction(e.target.value)}
                          placeholder={
                            status === "ready"
                              ? "اكتب التعديل المطلوب…"
                              : "فعّل اتصال الذكاء الاصطناعي لاستخدام التعديل بالمحادثة"
                          }
                        />
                        <button
                          className="button primary"
                          disabled={
                            !!busy || status !== "ready" || !instruction.trim()
                          }
                          onClick={() => void revise()}
                        >
                          تطبيق
                        </button>
                        {previous && (
                          <button
                            className="button outline"
                            disabled={!!busy}
                            onClick={() => {
                              setContent(previous);
                              setPrevious(null);
                              setSelected(0);
                              setNotice("تمت استعادة النسخة السابقة.");
                            }}
                          >
                            تراجع عن آخر توليد
                          </button>
                        )}
                      </section>
                    </>
                  )}
                </>
              )
            )}
          </>
        )}
        {page === "files" && (
          <div className="files-layout">
            <div className="panel">
              <h2>ملفك هو نقطة البداية</h2>
              <p className="muted">
                تحليل فعلي لمحتويات ملفات Office. الحد الأقصى: 10 ميجابايت.
              </p>
              <button
                className="upload-zone"
                disabled={!!busy}
                onClick={() => input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy) void upload(e.dataTransfer.files[0]);
                }}
              >
                <span>↥</span>
                <strong>اسحب ملفًا هنا أو اختره من جهازك</strong>
                <small>DOCX · XLSX · PPTX</small>
              </button>
              <input
                ref={input}
                type="file"
                accept=".docx,.xlsx,.pptx"
                hidden
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {file && (
                <div className="selected-file">
                  <strong>{file.name}</strong>
                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                </div>
              )}
              {file?.name.toLowerCase().endsWith(".docx") && (
                <>
                  <button
                    className="button primary full"
                    disabled={!!busy}
                    onClick={() => void formatWord()}
                  >
                    تنسيق فقرات Word العربية وتنزيل نسخة
                  </button>
                  <p className="muted small">
                    ضبط خط الفقرات العربية ومحاذاتها وتباعدها؛ لا يعيد كتابة
                    النص أو ترتيب المحتوى.
                  </p>
                </>
              )}
            </div>
            <div className="panel">
              <h2>نتائج التحليل</h2>
              {analyses.length ? (
                <>
                  <h3>{analyses[0].filename}</h3>
                  <div className="metrics-grid">
                    {Object.entries(analyses[0].metrics)
                      .filter(([, v]) => typeof v === "number")
                      .map(([k, v]) => (
                        <div key={k}>
                          <b>{String(v)}</b>
                          <span>{metrics[k] ?? k}</span>
                        </div>
                      ))}
                  </div>
                  <p className="muted small">{analyses[0].analysis_note}</p>
                  {Array.isArray(analyses[0].metrics.sheets) && (
                    <ul className="sheet-list">
                      {(
                        analyses[0].metrics.sheets as {
                          name: string;
                          rows: number;
                          columns: number;
                        }[]
                      ).map((s, i) => (
                        <li key={i}>
                          <strong>{s.name}</strong>
                          <span>
                            {s.rows} صف × {s.columns} عمود
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <span>▤</span>
                  <p>ارفع ملفًا لتظهر إحصاءاته هنا.</p>
                </div>
              )}
            </div>
            {analyses.length > 1 && (
              <div className="panel">
                <h3>ملفات هذه الجلسة</h3>
                {analyses.slice(1).map((a, i) => (
                  <p key={i}>{a.filename}</p>
                ))}
              </div>
            )}
          </div>
        )}
        {page === "pdf" && <PdfStudio />}
        {page === "projects" && (
          <>
            <div className="soft-note">
              تُحفظ النسخ على هذا المتصفح فقط عند الضغط على «حفظ نسخة». لن تظهر
              تلقائيًا على جهاز آخر.
            </div>
            {projects.length ? (
              <div className="project-grid">
                {projects.map((p) => (
                  <div className="panel project-card" key={p.id}>
                    <span className="app-icon files">◫</span>
                    <h3>{p.content.title}</h3>
                    <p className="muted">
                      {p.content.sections.length} محاور ·{" "}
                      {new Date(p.date).toLocaleDateString("ar-SA")}
                    </p>
                    <div className="action-row">
                      <button
                        className="button outline"
                        onClick={() => {
                          setContent(p.content);
                          setSettings({...initial, topic: p.content.title, language: p.content.language, source_mode: p.context?.source_mode === "reference" ? "reference" : "general", reference_text: typeof p.context?.reference_text === "string" ? p.context.reference_text.slice(0,16000) : "", document_type: p.context?.document_type && Object.keys(documentTypeLabels).includes(p.context.document_type) ? p.context.document_type : "general" });
                          setBrand(p.context?.branding && typeof p.context.branding === "object"
                            ? { ...emptyBrandFields, ...p.context.branding } : emptyBrandFields);
                          setLogoFile(null);
                          setLayout(p.context?.layout ? { ...defaultLayout, ...p.context.layout } : defaultLayout);
                          setDocumentStyle(p.context?.documentStyle && ["luxury", "corporate", "minimal"].includes(p.context.documentStyle) ? p.context.documentStyle : "luxury");
                          setPrevious(null);
                          setStage("edit");
                          setSelected(0);
                          setPage("create");
                        }}
                      >
                        فتح وتحرير
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => setDeleteId(p.id)}
                      >
                        حذف
                      </button>
                    </div>
                    {deleteId === p.id && (
                      <div className="delete-confirm">
                        <p>حذف هذه النسخة المحفوظة؟</p>
                        <button
                          className="button outline"
                          onClick={() => setDeleteId(null)}
                        >
                          إلغاء
                        </button>
                        <button
                          className="button danger"
                          onClick={() => {
                            try {
                              const next = projects.filter(
                                (x) => x.id !== p.id,
                              );
                              localStorage.setItem(
                                STORAGE,
                                JSON.stringify(next),
                              );
                              setProjects(next);
                              setDeleteId(null);
                            } catch {
                              setError("تعذر حذف النسخة من هذا المتصفح.");
                            }
                          }}
                        >
                          تأكيد الحذف
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel empty-state">
                <span>◫</span>
                <h2>مساحتك تبدأ بمشروعك الأول</h2>
                <p>أنشئ محتوى ثم احفظ نسخة لتعود إليها لاحقًا.</p>
                <button
                  className="button primary"
                  onClick={() => start("docx")}
                >
                  إنشاء محتوى
                </button>
              </div>
            )}
          </>
        )}
        {page === "settings" && (
          <div className="panel settings-panel">
            <h2>حالة الخدمة</h2>
            <div className="soft-note">
              {status === "ready" ? (aiVerified ? "تم اختبار التوليد لدى مزود الذكاء الاصطناعي بنجاح" : "إعدادات مزود الذكاء الاصطناعي موجودة على الخادم؛ لم يُتحقق بعد من قدرته على التوليد") : aiLabel}
            </div>
            <p className="muted">
              حالة صلاحية الاستخدام: <strong>{authorized ? "مسجل الدخول" : "غير مسجل الدخول"}</strong>
            </p>
            <button
              className="button outline"
              disabled={!!busy}
              onClick={() => void checkStatus()}
            >
              إعادة فحص الاتصال
            </button>
            <hr />
            {authorized ? (
              <>
                <div className="soft-note">تم تسجيل الدخول بنجاح. يُرجى اختبار التوليد الفعلي للتحقق من صحة إعدادات مزود الذكاء الاصطناعي.</div>
                <button
                  className="button outline"
                  disabled={!!busy || status !== "ready"}
                  onClick={() => void testAIConnection()}
                >
                  {aiVerified ? "إعادة اختبار التوليد الفعلي" : "اختبار توليد تجريبي"}
                </button>
                <p className="muted small">
                  يرسل هذا الاختبار موضوعًا تجريبيًا قصيرًا إلى المزود، وقد يستهلك جزءًا بسيطًا من رصيد الخدمة.
                  عند فشل الاختبار ستظهر رسالة تساعدك في تحديد سبب المشكلة.
                </p>
                <p className="muted small">
                  جلسة الاستخدام صالحة لمدة تصل إلى 7 أيام منذ تسجيل الدخول. يمكنك إنهاؤها في أي وقت.
                </p>
                <button
                  className="button outline"
                  disabled={!!busy}
                  onClick={() => void signOut()}
                >
                  تسجيل الخروج
                </button>
              </>
            ) : (
              <>
                <label>
                  رمز الوصول للمنصة
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="رمز الوصول الذي حدده مسؤول المنصة"
                  />
                </label>
                <p className="muted">
                  سجّل الدخول مرة واحدة؛ سيتذكر الخادم الجلسة على هذا المتصفح لمدة تصل إلى 7 أيام.
                  لا يُحفظ رمز الوصول في التخزين المحلي للمتصفح.
                </p>
                <button
                  className="button primary"
                  disabled={!!busy || status !== "ready" || !token.trim()}
                  onClick={() => void signIn()}
                >
                  تسجيل الدخول وتفعيل الذكاء الاصطناعي
                </button>
              </>
            )}
            <p className="muted small">
              يُضبط مفتاح Gemini أو OpenAI على الخادم فقط؛ لا تضع مفتاح المزود في حقل رمز الوصول.
              يوصى باستخدام المنصة على جهاز موثوق.
            </p>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => changePage("create")}
            >
              العودة إلى إنشاء المحتوى
            </button>
          </div>
        )}
        <footer className="studio-footer">
          <span>MAGHRABI Office Studio</span>
          <span>فكرتك · أسلوبك · ملفاتك</span>
        </footer>
      </main>
    </div>
  );
}
