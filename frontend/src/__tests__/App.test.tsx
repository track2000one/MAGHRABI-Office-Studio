import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import App from "../App";
import { example } from "../api";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ configured: false }), { status: 200 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openExample() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    screen.getByRole("button", { name: /إنشاء بالذكاء الاصطناعي/ }),
  );
  await user.click(screen.getByRole("button", { name: /فتح مثال توضيحي/ }));
  return user;
}

describe("Office Studio workflows", () => {
  it("shows the missing connection honestly and permits manual editing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /إنشاء بالذكاء الاصطناعي/ }),
    );
    expect(
      await screen.findByText(
        "التوليد بالذكاء الاصطناعي غير متاح حتى إعداد الخدمة.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /اقترح مخطط المحتوى/ }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "اكتب المحتوى بنفسك" }),
    );
    expect(screen.getByLabelText("عنوان المستند")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "تنزيل Word" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "أكمل عنوان المستند",
    );
  });

  it("keeps edits when exporting and saves only on explicit save", async () => {
    const user = await openExample();
    expect(localStorage.getItem("maghrabi-office-projects-v1")).toBeNull();
    await user.clear(screen.getByLabelText("عنوان المستند"));
    await user.type(screen.getByLabelText("عنوان المستند"), "عنوان محدث");
    await user.click(screen.getByRole("button", { name: "حفظ نسخة" }));
    expect(
      JSON.parse(localStorage.getItem("maghrabi-office-projects-v1")!)[0]
        .content.title,
    ).toBe("عنوان محدث");
    const create = vi.fn(() => "blob:download");
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(new Response("office-file"));
    await user.click(screen.getByRole("button", { name: "تنزيل Word" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/exports/docx"))!;
    expect(JSON.parse(call[1]!.body as string).title).toBe("عنوان محدث");
    expect(call[1]?.headers).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("uploads the actual file to analysis and renders returned metrics", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /ملفات Office/ }));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          filename: "report.docx",
          type: "word",
          size_bytes: 4,
          metrics: { paragraphs: 7, tables: 2 },
          analysis_note: "إحصاءات فعلية",
        }),
      ),
    );
    const file = new File(["test"], "report.docx");
    await user.upload(container.querySelector('input[type="file"]')!, file);
    expect(await screen.findByText("إحصاءات فعلية")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/files/analyze"))!;
    expect((call[1]!.body as FormData).get("file")).toBe(file);
  });

  it("reviews AI outline and submits edited titles before creating a draft", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true })),
    );
    render(<App />);
    expect(await screen.findByText("الخدمة متصلة · يلزم تسجيل الدخول")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /إعدادات الاتصال/ }));
    await user.type(screen.getByLabelText("رمز الوصول للمنصة"), "test-token");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
    );
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول وتفعيل الذكاء الاصطناعي" }));
    expect(await screen.findByText(/تم تسجيل الدخول بنجاح/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "العودة إلى إنشاء المحتوى" }),
    );
    await user.type(
      screen.getByLabelText("الموضوع", { exact: true }),
      "تحسين الخدمات الجامعية",
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(example)),
    );
    await user.click(
      screen.getByRole("button", { name: /اقترح مخطط المحتوى/ }),
    );
    const field = await screen.findByLabelText("عنوان المحور 1");
    await user.clear(field);
    await user.type(field, "الهدف المعدل");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(example)),
    );
    await user.click(
      screen.getByRole("button", { name: "إنشاء المحتوى الكامل" }),
    );
    expect(await screen.findByLabelText("عنوان المستند")).toBeVisible();
    const calls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/ai/generate"));
    expect(JSON.parse(calls[1][1]!.body as string).outline[0]).toBe(
      "الهدف المعدل",
    );
    expect(localStorage.getItem("test-token")).toBeNull();
    expect(sessionStorage.getItem("maghrabi-office-access-token-v1")).toBeNull();
    const login = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/ai/login"))!;
    expect(JSON.parse(login[1]!.body as string).access_token).toBe("test-token");
    expect(login[1]!.credentials).toBe("same-origin");
  });
});

it("returns from topic settings without losing unsaved content", async () => {
  const user = await openExample();
  await user.clear(screen.getByLabelText("عنوان المستند"));
  await user.type(screen.getByLabelText("عنوان المستند"), "مسودة محفوظة في المحرر");
  await user.click(screen.getByRole("button", {name: "إعدادات الموضوع"}));
  await user.click(screen.getByRole("button", {name: "العودة إلى المحتوى الحالي"}));
  expect(screen.getByLabelText("عنوان المستند")).toHaveValue("مسودة محفوظة في المحرر");
});
it("never evicts saved projects when the capacity is reached", async () => {
  const saved = Array.from({length: 15}, (_, i) => ({id: String(i), date: new Date().toISOString(), content: example}));
  localStorage.setItem("maghrabi-office-projects-v1", JSON.stringify(saved));
  const user = await openExample();
  await user.click(screen.getByRole("button", {name: "حفظ نسخة"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("بلغت الحد الأقصى");
  expect(JSON.parse(localStorage.getItem("maghrabi-office-projects-v1")!)).toEqual(saved);
});


it("restores authenticated cookie sessions and clears old browser-stored tokens", async () => {
  sessionStorage.setItem("maghrabi-office-access-token-v1", "saved-session-token");
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ configured: true, authenticated: true }), { status: 200 }),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("الذكاء الاصطناعي جاهز للاستخدام");
  await user.click(screen.getByRole("button", { name: /إعدادات الاتصال/ }));
  expect(screen.getByText("مسجل الدخول")).toBeVisible();
  expect(screen.queryByLabelText("رمز الوصول للمنصة")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("maghrabi-office-access-token-v1")).toBeNull();
});


it("opens PDF Studio and submits page-size editing settings", async () => {
  const create = vi.fn(() => "blob:pdf-preview");
  URL.createObjectURL = create;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        filename: "sample.pdf",
        size_bytes: 1200,
        pages: 2,
        text_chars: 50,
        metadata: {},
        page_sizes: [
          { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 25 },
          { page: 2, width_mm: 297, height_mm: 210, orientation: "landscape", rotation: 0, text_chars: 25 },
        ],
        supported_sizes: ["A4", "A3", "CUSTOM"],
      }),
      { status: 200 },
    ),
  );

  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const fileInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(fileInput, pdf);

  expect(await screen.findByText(/2 صفحة/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("المقاس"), "A3");
  await user.selectOptions(screen.getByLabelText("الاتجاه"), "landscape");

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new Blob(["edited-pdf"], { type: "application/pdf" }), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    }),
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        filename: "MAGHRABI-edited.pdf",
        size_bytes: 1000,
        pages: 2,
        text_chars: 50,
        metadata: {},
        page_sizes: [
          { page: 1, width_mm: 420, height_mm: 297, orientation: "landscape", rotation: 0, text_chars: 25 },
          { page: 2, width_mm: 420, height_mm: 297, orientation: "landscape", rotation: 0, text_chars: 25 },
        ],
        supported_sizes: ["A4", "A3", "CUSTOM"],
      }),
      { status: 200 },
    ),
  );

  await user.click(screen.getByRole("button", { name: "تطبيق التعديلات وتنزيل PDF" }));
  await waitFor(() => {
    const editCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/edit"));
    expect(editCall).toBeTruthy();
    const body = editCall![1]!.body as FormData;
    expect(body.get("page_size")).toBe("A3");
    expect(body.get("orientation")).toBe("landscape");
  });
});


it("inserts an image into selected PDF pages with placement controls", async () => {
  const create = vi.fn(() => "blob:preview");
  URL.createObjectURL = create;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 3,
    text_chars: 60,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 2, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 3, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(analysis), { status: 200 }),
  );
  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/3 صفحة/);

  const imageInput = container.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement;
  const image = new File(["fake-image"], "logo.png", { type: "image/png" });
  await user.upload(imageInput, image);
  expect(await screen.findByText("logo.png")).toBeVisible();

  await user.selectOptions(screen.getByLabelText("نطاق تطبيق الصورة"), "selected");
  await user.clear(screen.getByLabelText("الصفحات المحددة"));
  await user.type(screen.getByLabelText("الصفحات المحددة"), "1,3");
  await user.selectOptions(screen.getByLabelText("موضع الصورة"), "custom");
  await user.clear(screen.getByLabelText("X من اليسار (مم)"));
  await user.type(screen.getByLabelText("X من اليسار (مم)"), "22");
  await user.clear(screen.getByLabelText("Y من الأعلى (مم)"));
  await user.type(screen.getByLabelText("Y من الأعلى (مم)"), "35");
  await user.selectOptions(screen.getByLabelText("تدوير الصورة"), "90");
  await user.selectOptions(screen.getByLabelText("طبقة الصورة"), "back");

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new Blob(["image-pdf"], { type: "application/pdf" }), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    }),
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ ...analysis, filename: "MAGHRABI-image-inserted.pdf", size_bytes: 1300 }), { status: 200 }),
  );

  await user.click(screen.getByRole("button", { name: "إدراج الصورة وتنزيل PDF" }));
  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/insert-image"));
    expect(call).toBeTruthy();
    const body = call![1]!.body as FormData;
    expect(body.get("image")).toBe(image);
    expect(body.get("image_pages")).toBe("1,3");
    expect(body.get("position")).toBe("custom");
    expect(body.get("x_mm")).toBe("22");
    expect(body.get("y_mm")).toBe("35");
    expect(body.get("image_rotation")).toBe("90");
    expect(body.get("overlay")).toBe("false");
  });
});



it("defaults quick image insertion to the current PDF page only", async () => {
  URL.createObjectURL = vi.fn(() => "blob:page-scope");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 3,
    text_chars: 60,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 2, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 3, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith("/pdf/analyze"))
      return new Response(JSON.stringify(analysis), { status: 200 });
    if (path.endsWith("/pdf/render-page"))
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    if (path.endsWith("/pdf/insert-image"))
      return new Response(new Blob(["edited-pdf"], { type: "application/pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    return new Response(JSON.stringify({ configured: false }), { status: 200 });
  });

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/3 صفحة/);

  const imageInput = container.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement;
  await user.upload(imageInput, new File(["image"], "logo.png", { type: "image/png" }));

  expect(screen.getByLabelText("نطاق تطبيق الصورة")).toHaveValue("current");
  expect(screen.getByText(/لن تظهر تلقائيًا في بقية الصفحات/)).toBeVisible();

  await user.selectOptions(screen.getByLabelText("الصفحة الحالية / المعاينة"), "2");
  await user.click(screen.getByRole("button", { name: "إدراج الصورة وتنزيل PDF" }));

  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/insert-image"));
    expect(call).toBeTruthy();
    const body = call![1]!.body as FormData;
    expect(body.get("image_pages")).toBe("2");
  });
});

it("supports free drag placement of an image over a rendered PDF page", async () => {
  URL.createObjectURL = vi.fn(() => "blob:visual");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 1,
    text_chars: 20,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(analysis), { status: 200 }),
  );
  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/1 صفحة/);

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new Blob(["png"], { type: "image/png" }), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    }),
  );
  const imageInput = container.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement;
  const image = new File(["fake-image"], "logo.png", { type: "image/png" });
  await user.upload(imageInput, image);

  await waitFor(() => {
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/pdf/render-page")),
    ).toBe(true);
  });

  const stage = container.querySelector(".pdf-visual-stage") as HTMLDivElement;
  Object.defineProperty(stage, "getBoundingClientRect", {
    value: () => ({
      width: 420,
      height: 594,
      top: 0,
      left: 0,
      right: 420,
      bottom: 594,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  const overlay = screen.getByTestId("pdf-free-image");
  fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 140, clientY: 140 });
  fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 140, clientY: 140 });

  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new Blob(["image-pdf"], { type: "application/pdf" }), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    }),
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ ...analysis, filename: "MAGHRABI-image-inserted.pdf", size_bytes: 1300 }), { status: 200 }),
  );

  await user.click(screen.getByRole("button", { name: "إدراج الصورة وتنزيل PDF" }));
  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/insert-image"));
    expect(call).toBeTruthy();
    const body = call![1]!.body as FormData;
    expect(body.get("position")).toBe("custom");
    expect(Number(body.get("x_mm"))).toBeGreaterThan(10);
    expect(Number(body.get("y_mm"))).toBeGreaterThan(10);
  });
});


it("uses the unified visual PDF editor and saves multiple elements in one request", async () => {
  URL.createObjectURL = vi.fn(() => "blob:visual-editor");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 2,
    text_chars: 40,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 2, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith("/pdf/render-page")) {
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    if (path.endsWith("/pdf/apply-visual-edits")) {
      return new Response(new Blob(["edited-pdf"], { type: "application/pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    if (path.endsWith("/pdf/analyze")) {
      return new Response(JSON.stringify(analysis), { status: 200 });
    }
    return new Response(JSON.stringify({ configured: false }), { status: 200 });
  });

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/2 صفحة/);

  await user.click(screen.getByRole("button", { name: "فتح المحرر المرئي" }));
  await screen.findByRole("toolbar", { name: "أدوات المحرر المرئي" });

  await user.click(screen.getByRole("button", { name: "＋ نص" }));
  const textField = screen.getByLabelText("النص");
  await user.clear(textField);
  await user.type(textField, "نص عربي تجريبي");
  expect(screen.getAllByText("نص عربي تجريبي").length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: "＋ صورة" }));
  const visualEditor = container.querySelector(".pdf-visual-editor") as HTMLElement;
  const assetInput = visualEditor.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement;
  const logo = new File(["image"], "logo.png", { type: "image/png" });
  await user.upload(assetInput, logo);
  expect(screen.getByTestId("visual-element-image")).toBeVisible();

  const thumbnails = Array.from(container.querySelectorAll(".pdf-thumb")) as HTMLButtonElement[];
  await user.click(thumbnails[1]!);
  expect(screen.queryByTestId("visual-element-image")).not.toBeInTheDocument();

  await user.click(thumbnails[0]!);
  const originalImage = screen.getByTestId("visual-element-image");
  expect(originalImage).toBeVisible();

  await user.click(originalImage);
  expect(screen.getByText("نسخ العنصر إلى صفحات أخرى")).toBeVisible();
  expect(screen.getByLabelText("نطاق النسخ")).toHaveValue("next");
  await user.click(screen.getByRole("button", { name: "نسخ العنصر" }));

  await user.click(thumbnails[1]!);
  expect(screen.getByTestId("visual-element-image")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "تطبيق جميع العناصر وحفظ PDF" }));

  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/apply-visual-edits"));
    expect(call).toBeTruthy();
    const body = call![1]!.body as FormData;
    const elements = JSON.parse(String(body.get("elements_json")));
    expect(elements).toHaveLength(3);
    expect(elements.some((item: { type: string; text?: string }) => item.type === "text" && item.text === "نص عربي تجريبي")).toBe(true);
    const images = elements.filter((item: { type: string }) => item.type === "image");
    expect(images).toHaveLength(2);
    expect(images.map((item: { page: number }) => item.page).sort()).toEqual([1, 2]);
    expect(images.every((item: { asset_index?: number }) => item.asset_index === 0)).toBe(true);
    expect(body.getAll("assets")).toHaveLength(1);
  });
});


it("manages PDF pages visually before applying changes", async () => {
  URL.createObjectURL = vi.fn(() => "blob:page-manager");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 3,
    text_chars: 60,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 2, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
      { page: 3, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith("/pdf/analyze"))
      return new Response(JSON.stringify(analysis), { status: 200 });
    if (path.endsWith("/pdf/render-page"))
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    if (path.endsWith("/pdf/manage-pages"))
      return new Response(new Blob(["managed-pdf"], { type: "application/pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    return new Response(JSON.stringify({ configured: false }), { status: 200 });
  });

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/3 صفحة/);

  await user.click(screen.getByRole("button", { name: "فتح إدارة الصفحات" }));
  const manager = container.querySelector(".pdf-page-manager") as HTMLElement;
  expect(manager).toBeTruthy();

  const cards = () => Array.from(manager.querySelectorAll(".pdf-page-card")) as HTMLElement[];
  expect(cards()).toHaveLength(3);

  const firstActions = cards()[0]!.querySelector(".pdf-page-card-actions") as HTMLElement;
  await user.click(Array.from(firstActions.querySelectorAll("button")).find((button) => button.textContent === "تدوير")!);
  await user.click(Array.from(firstActions.querySelectorAll("button")).find((button) => button.textContent === "نسخ")!);
  expect(cards()).toHaveLength(4);

  await user.click(screen.getByRole("button", { name: "اعتماد تغييرات الصفحات" }));

  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/pdf/manage-pages"));
    expect(call).toBeTruthy();
    const body = call![1]!.body as FormData;
    const plan = JSON.parse(String(body.get("page_plan_json")));
    expect(plan).toHaveLength(4);
    expect(plan[0]).toEqual({ source_page: 1, rotation: 90 });
    expect(plan[1]).toEqual({ source_page: 1, rotation: 90 });
  });
});


it("provides professional object tools for visual PDF elements", async () => {
  URL.createObjectURL = vi.fn(() => "blob:object-tools");
  URL.revokeObjectURL = vi.fn();

  const analysis = {
    filename: "sample.pdf",
    size_bytes: 1200,
    pages: 1,
    text_chars: 20,
    metadata: {},
    page_sizes: [
      { page: 1, width_mm: 210, height_mm: 297, orientation: "portrait", rotation: 0, text_chars: 20 },
    ],
    supported_sizes: ["A4", "CUSTOM"],
  };

  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith("/pdf/analyze"))
      return new Response(JSON.stringify(analysis), { status: 200 });
    if (path.endsWith("/pdf/render-page"))
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    return new Response(JSON.stringify({ configured: false }), { status: 200 });
  });

  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: /^تحرير PDF$/ }));

  const pdf = new File(["fake-pdf"], "sample.pdf", { type: "application/pdf" });
  const pdfInput = container.querySelector('input[type="file"][accept*=".pdf"]:not([multiple])') as HTMLInputElement;
  await user.upload(pdfInput, pdf);
  await screen.findByText(/1 صفحة/);

  await user.click(screen.getByRole("button", { name: "فتح المحرر المرئي" }));
  await user.click(screen.getByRole("button", { name: "＋ صورة" }));

  const visualEditor = container.querySelector(".pdf-visual-editor") as HTMLElement;
  const assetInput = visualEditor.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement;
  await user.upload(assetInput, new File(["image"], "logo.png", { type: "image/png" }));

  const original = screen.getByTestId("visual-element-image");
  await user.click(original);
  expect(screen.getByText("أدوات العنصر")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "تكرار" }));
  expect(screen.getAllByTestId("visual-element-image")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "قفل" }));
  expect(screen.getByRole("button", { name: "فك القفل" })).toBeVisible();
  expect(screen.getByLabelText("X (مم)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "حذف العنصر" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "فك القفل" }));
  await user.click(screen.getByRole("button", { name: "يمين" }));
  expect(screen.getByLabelText("X (مم)")).toHaveValue(155);
});
