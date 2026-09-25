export type Section = { title: string; body: string[]; notes: string };
export type Content = {
  title: string;
  summary: string;
  language: "ar" | "en";
  sections: Section[];
};
export type Format = "docx" | "pptx";
export type RequestSettings = {
  topic: string;
  audience: string;
  language: "ar" | "en";
  tone: "formal" | "educational" | "concise";
  format: Format;
  section_count: number;
  reference_text: string;
  source_mode: "general" | "reference";
};
const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export async function api(path: string, init: RequestInit = {}, token = "") {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(
        typeof payload.detail === "string"
          ? payload.detail
          : "تحقق من الحقول: العناوين والنصوص مطلوبة، وعدد المحاور بين ١ و٢٠، وطول الفقرة حتى ٢٠٠٠ حرف.",
      );
    }
    return response;
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error("تعذر الاتصال بالخادم. تحقق من تشغيل خدمة المنصة.");
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error("انتهت مهلة الطلب. حاول مرة أخرى.");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
export async function downloadResponse(response: Response, filename: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const example: Content = {
  title: "تحسين تجربة المستفيد",
  summary: "تصور أولي لتبسيط الخدمات وقياس أثر التحسين — مثال توضيحي",
  language: "ar",
  sections: [
    {
      title: "الهدف من المبادرة",
      body: [
        "تسهيل وصول المستفيد إلى الخدمة، وتقليل الخطوات غير الضرورية، وتوضيح متطلبات كل إجراء.",
      ],
      notes: "ابدأ بسؤال عن أكثر الخطوات التي يجدها المستفيد صعوبة.",
    },
    {
      title: "خطوات التنفيذ",
      body: [
        "توثيق رحلة المستفيد الحالية والاستماع إلى ملاحظاته.",
        "اختيار خدمة واحدة لتجربة التحسين، وتحديد المسؤوليات وموعد المراجعة.",
      ],
      notes: "اشرح كيف تساعد التجربة المحدودة على التعلم قبل التوسع.",
    },
    {
      title: "المتابعة والخطوة التالية",
      body: [
        "مقارنة زمن إتمام الخدمة قبل التحسين وبعده باستخدام بيانات فعلية.",
        "عقد اجتماع قصير لمراجعة النتائج وتحديد التعديلات التالية.",
      ],
      notes: "",
    },
  ],
};
