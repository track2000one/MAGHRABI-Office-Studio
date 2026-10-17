import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import QuizStudio from "../QuizStudio";
import App from "../App";
import studioCss from "../index.css?raw";

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
  it("lays out each quiz option horizontally without global label margins or wide radios",async()=>{
    // Real stylesheet regression: global label/input rules previously stacked
    // the radio, choice letter and option text vertically with huge gaps.
    const style=document.createElement("style");
    style.textContent=studioCss;
    document.head.appendChild(style);
    try {
      await generate();
      const radios=screen.getAllByRole("radio");
      expect(radios).toHaveLength(4);
      for(const radio of radios){
        const card=radio.closest("label");
        expect(card).not.toBeNull();
        expect(card).toHaveClass("quiz-choice");
        expect(getComputedStyle(card!).flexDirection).toBe("row");
        expect(getComputedStyle(card!).marginTop).toMatch(/^0(?:px)?$/);
        expect(getComputedStyle(card!).marginBottom).toMatch(/^0(?:px)?$/);
        expect((radio as HTMLInputElement).style.width).toBe("18px");
        expect((radio as HTMLInputElement).style.height).toBe("18px");
        expect((radio as HTMLInputElement).style.flex).toBe("0 0 18px");
        expect(card!.querySelector(".quiz-choice-letter")).toBeTruthy();
        expect(card!.querySelector(".quiz-choice-text")).toHaveAttribute("dir","auto");
      }
      expect(screen.getByText("What fact number 1 is explained by the lecture?")).toHaveAttribute("dir","auto");
    } finally {
      style.remove();
    }
  });
  it("shows valid exams while clearly marking unsupported source quotes rather than inventing pages",async()=>{
    const user=userEvent.setup();
    const unverified=questions.map((question,i)=>({
      ...question,source_quote:i===0?"":"The circulation lecture describes arteries, veins and capillaries.",
      source_page:i===0?0:1,source_verified:i!==0,
    }));
    vi.mocked(fetch).mockImplementation(async(input)=>{
      const path=String(input);
      if(path.includes("/ai/quiz/extract")) return new Response(JSON.stringify({
        filename:"lecture.pdf",source_text:"[PAGE 1]\n"+lecture,pages:1,
        truncated:false,characters:lecture.length,
      }),{status:200,headers:{"Content-Type":"application/json"}});
      if(path.includes("/ai/quiz/generate")) return new Response(JSON.stringify({
        title:"Practice test with one unverified citation",questions:unverified,
      }),{status:200,headers:{"Content-Type":"application/json"}});
      return new Response(JSON.stringify({configured:false,authenticated:false}),{status:200});
    });
    render(<QuizStudio/>);
    await user.upload(screen.getByLabelText("ملف المحاضرة"),
      new File([lecture],"lecture.pdf",{type:"application/pdf"}));
    await user.click(screen.getByRole("button",{name:"استخراج المحاضرة"}));
    await screen.findByText(/تم استخراج النص/);
    await user.selectOptions(screen.getByLabelText("عدد أسئلة الاختبار"),"5");
    await user.click(screen.getByRole("button",{name:"إنشاء الاختبار وبدء الأسئلة"}));
    expect(await screen.findByText("السؤال 1 من 5")).toBeVisible();
    expect(screen.getByText(/لن تُعرض لهذه الأسئلة صفحات أو اقتباسات غير مؤكدة/)).toBeVisible();
    for(let i=0;i<5;i++){
      await user.click(screen.getByText(i===0?"Wrong first 0":"Correct choice "+i));
      await user.click(screen.getByRole("button",{name:i===4?"إنهاء وتصحيح الجولة":"السؤال التالي"}));
    }
    expect(screen.getByText(/لا يوجد اقتباس موثق لهذا السؤال/)).toBeVisible();
    expect(screen.queryByText(/المصدر: lecture.pdf · صفحة 0/)).not.toBeInTheDocument();
    expect(screen.getByText(/قد تكون الإجابة صحيحة، لكن يُنصح بمراجعة المحتوى الأصلي/)).toBeVisible();
  });

  it("grades first attempt, repeats only wrong answers, and requires two correct reviews",async()=>{
    const user=await generate();
    for(let i=0;i<5;i++)await answer(user,i,i===0?1:0,i===4);
    expect((await screen.findAllByText(/4 من 5/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/80 من 100/).length).toBeGreaterThan(0);
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

  it("offers 40 questions and splits the full exam into four generated groups", async()=>{
    const sizes:number[]=[];
    vi.mocked(fetch).mockImplementation(async (input,init)=>{
      const url=String(input);
      if(url.includes("/ai/quiz/extract")) return new Response(JSON.stringify({
        filename:"lecture.pdf",source_text:"[PAGE 1] "+lecture,
        pages:1,truncated:false,characters:lecture.length
      }),{status:200});
      if(url.includes("/ai/quiz/generate")){
        const p=JSON.parse(init!.body as string);
        const offset=p.avoid_questions.length;
        sizes.push(offset);
        return new Response(JSON.stringify({
          title:"Extended revision test",
          questions:Array.from({length:p.count},(_,i)=>({
            question:"Explain the lecture topic number "+(offset+i+1)+" in context?",
            options:["one","two","three","four"],correct_index:0,
            explanation:"This fact is supported by the supplied lecture information.",
            source_quote:"The circulation lecture describes arteries, veins and capillaries.",
            source_page:1,
          }))
        }),{status:200});
      }
      return new Response("{}",{status:200});
    });
    const user=userEvent.setup();
    render(<QuizStudio/>);
    await user.upload(screen.getByLabelText("ملف المحاضرة"),
      new File([lecture],"lecture.pdf",{type:"application/pdf"}));
    await user.click(screen.getByRole("button",{name:"استخراج المحاضرة"}));
    await screen.findByText(/تم استخراج النص/);
    const control=screen.getByLabelText("عدد أسئلة الاختبار");
    expect(Array.from((control as HTMLSelectElement).options).map(o=>Number(o.value)))
      .toEqual([5,10,15,20,25,30,35,40]);
    await user.selectOptions(control,"40");
    await user.click(screen.getByRole("button",{name:"إنشاء الاختبار وبدء الأسئلة"}));
    expect(await screen.findByText("السؤال 1 من 40")).toBeVisible();
    expect(sizes).toEqual([0,10,20,30]);
    const saved=JSON.parse(localStorage.getItem("maghrabi-office-quiz-banks-v1")||"[]");
    expect(saved[0].bank.questions).toHaveLength(40);
    cleanup();
    render(<QuizStudio/>);
    expect(screen.getByText(/40 سؤال/)).toBeVisible();
  });
  it("returns to saved question banks without storing the lecture source",async()=>{
    const user=await generate();
    const saved=localStorage.getItem("maghrabi-office-quiz-banks-v1")||"";
    expect(JSON.parse(saved)[0].title).toBe("lecture");
    expect(saved).not.toContain("[PAGE 1]");
    cleanup();
    render(<QuizStudio/>);
    expect(screen.getByText("lecture")).toBeVisible();
    expect(screen.getByRole("button",{name:"بدء الاختبار"})).toBeEnabled();
  });
  it("keeps multiple named lecture projects, lets users search, rename and fully retake without AI",async()=>{
    const at="2026-10-16T00:00:00.000Z";
    const create=(id:string,title:string,firstScore:number)=>({
      id,title,filename:title+".pdf",createdAt:at,updatedAt:at,
      difficulty:"hard",origin:"generated",firstScore,reviewIds:[0],
      streaks:{0:0},reviewRounds:0,attempts:[],
      bank:{title,questions:questions.map(q=>({...q}))},
    });
    localStorage.setItem("maghrabi-office-quiz-banks-v1",JSON.stringify([
      create("lecture-graphs","Analyzing and Summarizing Graphs",60),
      create("lecture-business","Introduction to Business",80),
    ]));
    const user=userEvent.setup();
    render(<QuizStudio/>);
    expect(screen.getByText("2 من 50 مشروعًا محفوظًا")).toBeVisible();
    await user.type(screen.getByLabelText("البحث في مكتبة اختباراتي"),"Graphs");
    expect(screen.getByText("Analyzing and Summarizing Graphs")).toBeVisible();
    expect(screen.queryByText("Introduction to Business")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"تغيير الاسم"}));
    const input=screen.getByLabelText("الاسم الجديد للمحاضرة Analyzing and Summarizing Graphs");
    await user.clear(input);
    await user.type(input,"ملخص الجداول والرسوم");
    await user.click(screen.getByRole("button",{name:"حفظ الاسم"}));
    await user.clear(screen.getByLabelText("البحث في مكتبة اختباراتي"));
    expect(screen.getByText("ملخص الجداول والرسوم")).toBeVisible();
    expect(screen.getByText("Introduction to Business")).toBeVisible();
    await user.click(screen.getAllByRole("button",{name:"إعادة الاختبار كاملًا"})[0]);
    for(let i=0;i<5;i++) await answer(user,i,0,i===4);
    expect((await screen.findAllByText(/100 من 100/)).length).toBeGreaterThan(0);
    const projects=JSON.parse(localStorage.getItem("maghrabi-office-quiz-banks-v1")||"[]");
    expect(projects).toHaveLength(2);
    const graphs=projects.find((x:{id:string})=>x.id==="lecture-graphs");
    expect(graphs.firstScore).toBe(60); // The first attempt never gets overwritten.
    expect(graphs.attempts).toHaveLength(1);
    expect(graphs.attempts[0]).toMatchObject({score:100,kind:"full",correct:5,total:5});
    expect(projects.find((x:{id:string})=>x.id==="lecture-business").firstScore).toBe(80);
    cleanup();
    render(<QuizStudio/>);
    expect(screen.getByText("ملخص الجداول والرسوم")).toBeVisible();
    expect(screen.getByText("Introduction to Business")).toBeVisible();
    expect(screen.getByText(/آخر درجة 100%/)).toBeVisible();
    expect(screen.getAllByRole("button",{name:"إعادة الاختبار كاملًا"})).toHaveLength(2);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
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
