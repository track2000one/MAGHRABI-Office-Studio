import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByText("الذكاء الاصطناعي متصل")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /إعدادات الاتصال/ }));
    await user.type(screen.getByLabelText("رمز الوصول للمنصة"), "test-token");
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
    expect(sessionStorage.getItem("maghrabi-office-access-token-v1")).toBe("test-token");
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


it("restores the access token from session storage after a page reload", async () => {
  sessionStorage.setItem("maghrabi-office-access-token-v1", "saved-session-token");
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ configured: true }), { status: 200 }),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("الذكاء الاصطناعي متصل");
  await user.click(screen.getByRole("button", { name: /إعدادات الاتصال/ }));
  expect(screen.getByLabelText("رمز الوصول للمنصة")).toHaveValue("saved-session-token");
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
