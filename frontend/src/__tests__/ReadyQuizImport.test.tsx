import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ReadyQuizImport from "../ReadyQuizImport";
import QuizStudio from "../QuizStudio";
import App from "../App";

const sample={
  filename:"questions.docx",title:"Introductory lecture exam",
  pages:1,skipped:0,detected_answers:1,
  warnings:["1 سؤالًا دون مفتاح إجابة؛ حدّد الإجابة الصحيحة يدويًا قبل بدء اختبار مصحّح."],
  questions:[
    {number:1,question:"What does the first chart describe?",options:["One","Two","Three","Four"],correct_index:2,source_page:1},
    {number:2,question:"Where is a written report stored?",options:["Site","Notes","Report","Wiki"],correct_index:null,source_page:1},
  ],
};
beforeEach(()=>{
  localStorage.clear();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(sample),{
    status:200,headers:{"Content-Type":"application/json"},
  })));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

async function upload(){
  const user=userEvent.setup();
  const onAccept=vi.fn();
  render(<ReadyQuizImport onAccept={onAccept}/>);
  await user.upload(screen.getByLabelText("ملف أسئلة جاهزة"),
    new File(["questions"],"questions.docx",{
      type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
  await user.click(screen.getByRole("button",{name:"استخراج وترتيب الأسئلة"}));
  await screen.findByText("What does the first chart describe?");
  return {user,onAccept};
}

describe("Ready MCQ import and review",()=>{
  it("parses existing questions and flags any missing answer key instead of inventing answers",async()=>{
    const {onAccept}=await upload();
    expect(screen.getByText("Where is a written report stored?")).toBeVisible();
    expect(screen.getByText(/دون مفتاح إجابة/)).toBeVisible();
    expect(screen.getByText("الاختبار يحتاج اعتماد الإجابات")).toBeVisible();
    expect(screen.queryByRole("button",{name:"ابدأ اختبار الطالب الآن"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"الانتقال إلى اعتماد الإجابات الناقصة (1)"})).toBeVisible();
    expect(onAccept).not.toHaveBeenCalled();
    const request=vi.mocked(fetch).mock.calls.find(([url])=>String(url).includes("/quiz/import"))!;
    const form=request[1]!.body as FormData;
    expect((form.get("file") as File).name).toBe("questions.docx");
  });
  it("allows editing options, selecting answer keys, reordering and saving without an AI call",async()=>{
    const {user,onAccept}=await upload();
    await user.selectOptions(screen.getByLabelText("الإجابة الصحيحة للسؤال 2"),"3");
    await user.clear(screen.getByLabelText("الخيار 4 للسؤال 2"));
    await user.type(screen.getByLabelText("الخيار 4 للسؤال 2"),"Open Wiki");
    await user.click(screen.getByRole("button",{name:"نقل السؤال 2 للأعلى"}));
    expect(screen.getByLabelText("نص السؤال المستورد 1")).toHaveValue("Where is a written report stored?");
    await user.click(screen.getByRole("button",{name:"ابدأ اختبار الطالب الآن"}));
    expect(onAccept).toHaveBeenCalledTimes(1);
    const result=onAccept.mock.calls[0][0];
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].correct_index).toBe(3);
    expect(result.questions[0].options[3]).toBe("Open Wiki");
    expect(onAccept.mock.calls[0][1]).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("prepares a student exam immediately and conceals correct answers until manual review",async()=>{
    const user=userEvent.setup();
    const onAccept=vi.fn();
    const complete={...sample,detected_answers:2,warnings:[],
      questions:sample.questions.map((q,i)=>({...q,correct_index:i===0?2:1}))};
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(complete),{
      status:200,headers:{"Content-Type":"application/json"},
    }));
    render(<ReadyQuizImport onAccept={onAccept}/>);
    await user.upload(screen.getByLabelText("ملف أسئلة جاهزة"),
      new File(["questions"],"ready.docx",{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}));
    await user.click(screen.getByRole("button",{name:"استخراج وترتيب الأسئلة"}));
    expect(await screen.findByText("الاختبار جاهز للطالب")).toBeVisible();
    expect(screen.getByText(/50.00 درجة لكل سؤال/)).toBeVisible();
    expect(screen.queryByLabelText("الإجابة الصحيحة للسؤال 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"مراجعة أو تعديل الأسئلة ومفتاح الإجابات"})).toHaveAttribute("aria-expanded","false");
    await user.click(screen.getByRole("button",{name:"مراجعة أو تعديل الأسئلة ومفتاح الإجابات"}));
    expect(screen.getByLabelText("الإجابة الصحيحة للسؤال 1")).toHaveValue("2");
    await user.click(screen.getByRole("button",{name:"إخفاء مراجعة الأسئلة ومفتاح الإجابات"}));
    await user.click(screen.getByRole("button",{name:"ابدأ اختبار الطالب الآن"}));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept.mock.calls[0][1]).toBe(true);
    expect(onAccept.mock.calls[0][0].questions).toHaveLength(2);
  });

  it("imports, scores and re-tests only incorrect ready questions until two correct reviews",async()=>{
    const complete={...sample,detected_answers:2,warnings:[],
      questions:sample.questions.map((q,i)=>({...q,correct_index:i===0?2:1}))};
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(complete),{
      status:200,headers:{"Content-Type":"application/json"},
    }));
    const user=userEvent.setup();
    render(<QuizStudio/>);
    await user.click(screen.getByRole("button",{name:"استيراد أسئلة جاهزة من Word أو PDF"}));
    await user.upload(screen.getByLabelText("ملف أسئلة جاهزة"),
      new File(["questions"],"ready.docx",{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}));
    await user.click(screen.getByRole("button",{name:"استخراج وترتيب الأسئلة"}));
    expect(await screen.findByText("الاختبار جاهز للطالب")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"ابدأ اختبار الطالب الآن"}));
    expect(screen.getByText("السؤال 1 من 2")).toBeVisible();
    await user.click(screen.getByText("Three")); // Correct Q1
    await user.click(screen.getByRole("button",{name:"السؤال التالي"}));
    await user.click(screen.getByText("Site")); // Incorrect Q2 (correct is Notes)
    await user.click(screen.getByRole("button",{name:"إنهاء وتصحيح الجولة"}));
    expect(await screen.findByText(/50 من 100/)).toBeVisible();
    expect(screen.getByRole("button",{name:/إعادة اختبار الأسئلة التي تحتاج إلى إتقان/})).toBeVisible();
    await user.click(screen.getByRole("button",{name:/إعادة اختبار الأسئلة التي تحتاج إلى إتقان/}));
    expect(screen.getByText("السؤال 1 من 1")).toBeVisible();
    await user.click(screen.getByText("Notes"));
    await user.click(screen.getByRole("button",{name:"إنهاء وتصحيح الجولة"}));
    expect(screen.getByText(/درجتك الأصلية في الاختبار الأول:/).parentElement).toHaveTextContent("50 من 100");
    await user.click(screen.getByRole("button",{name:/إعادة اختبار الأسئلة التي تحتاج إلى إتقان/}));
    await user.click(screen.getByText("Notes"));
    await user.click(screen.getByRole("button",{name:"إنهاء وتصحيح الجولة"}));
    expect(screen.getByText("اكتمل إتقان أسئلة هذا الاختبار")).toBeVisible();
    const stored=JSON.parse(localStorage.getItem("maghrabi-office-quiz-banks-v1")||"[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].origin).toBe("imported");
    expect(stored[0].firstScore).toBe(50);
    expect(stored[0].reviewIds).toHaveLength(0);
  });

  it("supports switching to ready imported questions from the current Smart Quiz page",async()=>{
    vi.mocked(fetch).mockImplementation(async()=>new Response(JSON.stringify({
      configured:false,authenticated:false,
    }),{status:200,headers:{"Content-Type":"application/json"}}));
    const user=userEvent.setup();
    render(<App/>);
    await user.click(screen.getByRole("button",{name:"الاختبارات الذكية"}));
    await user.click(screen.getByRole("button",{name:"استيراد أسئلة جاهزة من Word أو PDF"}));
    expect(screen.getByLabelText("ملف أسئلة جاهزة")).toBeVisible();
    expect(screen.queryByLabelText("ملف المحاضرة")).not.toBeInTheDocument();
  });
});
