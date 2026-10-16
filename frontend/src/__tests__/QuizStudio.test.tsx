import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import QuizStudio from "../QuizStudio";
import App from "../App";

const lecture="The circulation lecture describes arteries, veins and capillaries. ".repeat(8);
const questions=Array.from({length:5},(_,i)=>({
  question: "What fact number "+(i+1)+" is explained by the lecture?",
  options: ["Correct choice "+i,"Wrong first "+i,"Wrong second "+i,"Wrong third "+i],
  correct_index:0,
  explanation:"The lecture contains this fact and supports the answer.",
  source_quote:"The circulation lecture describes arteries, veins and capillaries.",
  source_page:1,
}));
beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch",vi.fn(async(input:string|URL)=>{
    const path=String(input);
    if(path.includes("/ai/quiz/extract"))return new Response(JSON.stringify({
      filename:"lecture.pdf",source_text:"[PAGE 1]\n"+lecture,pages:1,truncated:false,
      characters:lecture.length,
    }),{status:200,headers:{"Content-Type":"application/json"}});
    if(path.includes("/ai/quiz/generate"))return new Response(JSON.stringify({
      title:"Circulation lecture practice",questions,
    }),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({configured:false,authenticated:false}),{status:200});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function generate(){
  const user=userEvent.setup();
  render(<QuizStudio/>);
  const file=new File([lecture],"lecture.pdf",{type:"application/pdf"});
  await user.upload(screen.getByLabelText("ملف المحاضرة"),file);
  await user.click(screen.getByRole("button",{name:"استخراج المحاضرة"}));
  expect(await screen.findByText(/تم استخراج النص/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("عدد أسئلة الاختبار"),"5");
  await user.selectOptions(screen.getByLabelText("مستوى صعوبة الأسئلة"),"hard");
  await user.click(screen.getByRole("button",{name:"إنشاء الاختبار وبدء الأسئلة"}));
  await screen.findByText("What fact number 1 is explained by the lecture?");
  return user;
}
async function answer(user:ReturnType<typeof userEvent.setup>,q:number,option:number,finish=false){
  await user.click(screen.getByText((option===0?"Correct choice ":"Wrong first ")+q));
  await user.click(screen.getByRole("button",{name:finish?"إنهاء وتصحيح الجولة":"السؤال التالي"}));
}
describe("Lecture Smart Quiz mastery experience",()=>{
  it("creates a lecture-grounded exam with user-selectable difficulty and question count",async()=>{
    const user=await generate();
    expect(screen.getByText("السؤال 1 من 5")).toBeVisible();
    expect(screen.queryByText("The lecture contains this fact and supports the answer.")).not.toBeInTheDocument();
    const calls=vi.mocked(fetch).mock.calls;
    const upload=calls.find(([url])=>String(url).includes("/ai/quiz/extract"))!;
    const body=upload[1]!.body as FormData;
    expect((body.get("file") as File).name).toBe("lecture.pdf");
    const request=calls.find(([url])=>String(url).includes("/ai/quiz/generate"))!;
    expect(JSON.parse(request[1]!.body as string)).toMatchObject({count:5,difficulty:"hard",language:"ar"});
    expect(new Headers(request[1]!.headers).get("X-Maghrabi-Client")).toBe("studio");
    expect(user).toBeDefined();
  });
  it("grades first attempt, repeats only wrong answers, and requires two correct reviews",async()=>{
    const user=await generate();
    for(let i=0;i<5;i++)await answer(user,i,i===0?1:0,i===4);
    expect((await screen.findAllByText(/4 من 5/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/80 من 100/)).toBeVisible();
    expect(screen.getByText("The lecture contains this fact and supports the answer.")).toBeVisible();
    expect(screen.getByText(/The circulation lecture describes/)).toBeVisible();
    await user.click(screen.getByRole("button",{name:/إعادة اختبار الأسئلة التي تحتاج إلى إتقان/}));
    expect(screen.getByText("السؤال 1 من 1")).toBeVisible();
    await answer(user,0,0,true);
    expect(screen.getByText(/أسئلة تحتاج إلى إتقان:/).parentElement).toHaveTextContent("1");
    await user.click(screen.getByRole("button",{name:/إعادة اختبار الأسئلة التي تحتاج إلى إتقان/}));
    await answer(user,0,0,true);
    expect(screen.getByText("اكتمل إتقان أسئلة هذا الاختبار")).toBeVisible();
    const saved=JSON.parse(localStorage.getItem("maghrabi-office-quiz-banks-v1")||"[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].firstScore).toBe(80);
    expect(saved[0].reviewIds).toHaveLength(0);
  });
  it("returns to saved question banks without storing the lecture source",async()=>{
    const user=await generate();
    const saved=localStorage.getItem("maghrabi-office-quiz-banks-v1")||"";
    expect(saved).toContain("Circulation lecture practice");
    expect(saved).not.toContain("[PAGE 1]");
    cleanup();
    render(<QuizStudio/>);
    expect(screen.getByText("Circulation lecture practice")).toBeVisible();
    expect(screen.getByRole("button",{name:"بدء الاختبار"})).toBeEnabled();
  });
  it("rejects an unsupported lecture size before upload",async()=>{
    const user=userEvent.setup();
    render(<QuizStudio/>);
    const file=new File([new Uint8Array(8*1024*1024+1)],"oversize.pdf",{type:"application/pdf"});
    await user.upload(screen.getByLabelText("ملف المحاضرة"),file);
    await user.click(screen.getByRole("button",{name:"استخراج المحاضرة"}));
    expect(screen.getByRole("alert")).toHaveTextContent("8 ميجابايت");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("makes the quizzes page reachable from the studio sidebar",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(screen.getByRole("button",{name:"الاختبارات الذكية"}));
    expect(screen.getAllByRole("heading",{name:/الاختبارات الذكية/}).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("ملف المحاضرة")).toBeVisible();
  });
});
