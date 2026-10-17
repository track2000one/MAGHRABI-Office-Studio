import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import QuizStudio from "../QuizStudio";
import ReadyQuizImport from "../ReadyQuizImport";

const sample={
  filename:"Week 4 Graphs.txt",title:"Week 4 Graphs",pages:1,skipped:0,
  detected_answers:2,warnings:[],
  questions:[
    {number:1,question:"What does the first chart describe?",options:["One","Two","Three","Four"],correct_index:2,source_page:1},
    {number:2,question:"Where is a written report stored?",options:["Site","Notes","Report","Wiki"],correct_index:1,source_page:1},
  ],
};

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(sample),{
    status:200,headers:{"Content-Type":"application/json"},
  })));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("ChatGPT quiz paste without Gemini",()=>{
  it("provides a 40-question prompt template and starts a pasted student exam without AI calls",async()=>{
    const user=userEvent.setup();
    render(<QuizStudio/>);
    await user.click(screen.getByRole("button",{name:"استيراد أسئلة جاهزة من Word أو PDF"}));
    const control=screen.getByLabelText("عدد الأسئلة لقالب ChatGPT");
    expect(control).toHaveValue("40");
    await user.selectOptions(control,"20");
    expect((screen.getByLabelText("نص طلب إنشاء أسئلة في ChatGPT") as HTMLTextAreaElement).value).toContain("20 سؤال");
    await user.type(screen.getByLabelText("اسم المحاضرة للأسئلة المنسوخة"),"Week 4 Graphs");
    const pasted=[
      "1. What does the first chart describe?",
      "A) One","B) Two","C) Three","D) Four","Correct Answer: C",
      "2. Where is a written report stored?",
      "A) Site","B) Notes","C) Report","D) Wiki","Correct Answer: B",
    ].join("\n");
    await user.type(screen.getByLabelText("نص الأسئلة المنسوخة من ChatGPT"),pasted);
    await user.click(screen.getByRole("button",{name:"ترتيب الأسئلة وتجهيز الاختبار"}));
    expect(await screen.findByText("الاختبار جاهز للطالب")).toBeVisible();
    const calls=vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain("/quiz/import-text");
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({
      title:"Week 4 Graphs",text:pasted,
    });
    expect(screen.queryByLabelText("الإجابة الصحيحة للسؤال 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"ابدأ اختبار الطالب الآن"}));
    expect(screen.getByText("السؤال 1 من 2")).toBeVisible();
    const saved=JSON.parse(localStorage.getItem("maghrabi-office-quiz-banks-v1")||"[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Week 4 Graphs");
    expect(saved[0].bank.questions).toHaveLength(2);
    expect(saved[0].origin).toBe("imported");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("adds a manual question during review and blocks scoring until its answer is approved",async()=>{
    const user=userEvent.setup();
    const onAccept=vi.fn();
    render(<ReadyQuizImport onAccept={onAccept}/>);
    await user.type(screen.getByLabelText("نص الأسئلة المنسوخة من ChatGPT"),
      "1. What is shown?\nA) One\nB) Two\nC) Three\nD) Four\nCorrect Answer: C");
    await user.click(screen.getByRole("button",{name:"ترتيب الأسئلة وتجهيز الاختبار"}));
    expect(await screen.findByText("الاختبار جاهز للطالب")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"مراجعة أو تعديل الأسئلة ومفتاح الإجابات"}));
    await user.click(screen.getByRole("button",{name:"إضافة سؤال يدويًا"}));
    expect(screen.getByText("الاختبار يحتاج اعتماد الإجابات")).toBeVisible();
    expect(screen.queryByRole("button",{name:"ابدأ اختبار الطالب الآن"})).not.toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
