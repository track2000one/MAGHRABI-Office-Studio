import {beforeEach,describe,expect,it} from "vitest";
import {
  QUIZ_STORAGE_KEY,MAX_QUIZ_PROJECTS,readQuizProjects,persistQuizProjects,
  exportQuizBackup,parseQuizBackup,mergeQuizBackups,
} from "../quizLibrary";
import type {QuizProject} from "../quizLibrary";

function example(index:number):QuizProject {
  const at=new Date(2026,9,1,0,index%60).toISOString();
  return {
    id:"lecture-"+index,title:"محاضرة "+index,filename:"محاضرة "+index+".pdf",
    createdAt:at,updatedAt:at,difficulty:"mixed",
    bank:{title:"Exam "+index,questions:[{
      question:"What important subject is described by the lecture "+index+"?",
      options:["Option A","Option B","Option C","Option D"],correct_index:0,
      explanation:"Relevant topic from lecture",source_quote:"",source_page:0,
      source_verified:false,
    }]},
    firstScore:null,reviewIds:[],streaks:{},reviewRounds:0,attempts:[],
    origin:"generated",
  };
}
beforeEach(()=>localStorage.clear());
describe("Quiz project library safety",()=>{
  it("retains all 50 projects without discarding older items after another edit",()=>{
    const saved=Array.from({length:MAX_QUIZ_PROJECTS},(_,i)=>example(i));
    persistQuizProjects(saved);
    expect(readQuizProjects()).toHaveLength(50);
    expect(readQuizProjects().at(-1)?.title).toBe("محاضرة 49");
    const edited={...saved[20],title:"مدخل إلى الرسوم البيانية"};
    persistQuizProjects(saved.map(item=>item.id===edited.id?edited:item));
    expect(readQuizProjects()).toHaveLength(50);
    expect(readQuizProjects().find(q=>q.id===edited.id)?.title).toBe("مدخل إلى الرسوم البيانية");
    expect(readQuizProjects().at(-1)?.title).toBe("محاضرة 49");
  });
  it("rejects the 51st project rather than silently deleting the oldest project",()=>{
    const fifty=Array.from({length:50},(_,i)=>example(i));
    persistQuizProjects(fifty);
    const before=localStorage.getItem(QUIZ_STORAGE_KEY);
    expect(()=>persistQuizProjects([example(51),...fifty])).toThrow(/50 مشروعًا/);
    expect(localStorage.getItem(QUIZ_STORAGE_KEY)).toBe(before);
  });
  it("loads old saved quizzes that predate attempt history without losing content",()=>{
    const previous=example(0);
    const old: Record<string,unknown>={...previous};
    delete old.attempts;
    delete old.origin;
    localStorage.setItem(QUIZ_STORAGE_KEY,JSON.stringify([old]));
    const restored=readQuizProjects();
    expect(restored).toHaveLength(1);
    expect(restored[0].bank.questions[0].options).toEqual(previous.bank.questions[0].options);
    expect(restored[0].attempts).toEqual([]);
  });
  it("exports a portable JSON backup and imports only missing projects",()=>{
    const first=example(0),other=example(1);
    const json=exportQuizBackup([first,other]);
    expect(json).toContain("maghrabi-quiz-projects");
    expect(json).not.toContain("STUDIO_ACCESS_TOKEN");
    const parsed=parseQuizBackup(json);
    const merged=mergeQuizBackups([first],parsed);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map(x=>x.id)).size).toBe(2);
    persistQuizProjects(merged);
    expect(readQuizProjects().map(x=>x.title).sort()).toEqual(["محاضرة 0","محاضرة 1"]);
  });
  it("rejects unsupported or invalid backups without mutating current projects",()=>{
    persistQuizProjects([example(0)]);
    const saved=localStorage.getItem(QUIZ_STORAGE_KEY);
    expect(()=>parseQuizBackup("{not json")).toThrow();
    expect(()=>parseQuizBackup(JSON.stringify({version:2,projects:[]}))).toThrow();
    expect(()=>parseQuizBackup(JSON.stringify({
      format:"maghrabi-quiz-projects",version:1,projects:[{bad:"data"}],
    }))).toThrow();
    const huge=Array.from({length:50},(_,i)=>example(i+1));
    expect(()=>mergeQuizBackups([example(0)],huge)).toThrow(/50 مشروعًا/);
    expect(localStorage.getItem(QUIZ_STORAGE_KEY)).toBe(saved);
  });
  it("preserves every complete and review attempt and original score through backup transfer",()=>{
    const saved=example(0);
    saved.firstScore=60;
    saved.reviewIds=[0];
    saved.attempts=[
      {at:"2026-10-16T13:00:00.000Z",score:60,correct:3,total:5,kind:"full"},
      {at:"2026-10-16T13:02:00.000Z",score:100,correct:1,total:1,kind:"review"},
      {at:"2026-10-16T13:05:00.000Z",score:80,correct:4,total:5,kind:"full"},
    ];
    const restored=parseQuizBackup(exportQuizBackup([saved]))[0];
    expect(restored.firstScore).toBe(60);
    expect(restored.attempts.map(item=>[item.kind,item.score]))
      .toEqual([["full",60],["review",100],["full",80]]);
  });
});
