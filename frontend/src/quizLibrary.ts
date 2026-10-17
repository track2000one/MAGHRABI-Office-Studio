/** Durable browser quiz library with conservative, non-destructive imports.
 *
 * This is local browser storage, not account-synced cloud storage.
 * Legacy quiz banks (v1) remain readable without migration/deletion.
 */
export const QUIZ_STORAGE_KEY = "maghrabi-office-quiz-banks-v1";
export const MAX_QUIZ_PROJECTS = 50;
export const MAX_QUESTIONS_PER_QUIZ = 40;
export const MAX_BACKUP_SIZE = 4 * 1024 * 1024;

export type QuizQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  source_quote: string;
  source_page: number;
  source_verified?: boolean;
};
export type QuizAttempt = {
  at: string;
  score: number;
  correct: number;
  total: number;
  kind: "full" | "review";
};
export type QuizProject = {
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  difficulty: string;
  bank: {title:string;questions:QuizQuestion[]};
  firstScore: number | null;
  reviewIds: number[];
  streaks: Record<number,number>;
  reviewRounds: number;
  origin?: "generated" | "imported";
  attempts: QuizAttempt[];
};

const validDate = (value:unknown) => typeof value==="string" && !Number.isNaN(Date.parse(value));
const isObject = (value:unknown):value is Record<string,unknown> =>
  value!==null && typeof value==="object" && !Array.isArray(value);
const boundedText = (value:unknown, max:number) =>
  typeof value==="string" && value.trim().length>0 && value.length<=max;

function validateQuestion(value:unknown):value is QuizQuestion {
  if (!isObject(value)) return false;
  return boundedText(value.question,380) &&
    Array.isArray(value.options) && value.options.length===4 &&
    value.options.every(option=>boundedText(option,750)) &&
    new Set(value.options.map(option=>(option as string).trim().toLowerCase())).size===4 &&
    Number.isInteger(value.correct_index) && (value.correct_index as number)>=0 &&
    (value.correct_index as number)<=3 &&
    typeof value.explanation==="string" && value.explanation.length<=1500 &&
    typeof value.source_quote==="string" && value.source_quote.length<=320 &&
    typeof value.source_page==="number" && Number.isInteger(value.source_page) &&
    value.source_page>=0 && value.source_page<=80 &&
    (value.source_verified===undefined || typeof value.source_verified==="boolean");
}
function validateAttempt(value:unknown):value is QuizAttempt {
  if(!isObject(value))return false;
  return validDate(value.at) && Number.isInteger(value.score) &&
    (value.score as number)>=0 && (value.score as number)<=100 &&
    Number.isInteger(value.correct) && Number.isInteger(value.total) &&
    (value.total as number)>=1 && (value.total as number)<=MAX_QUESTIONS_PER_QUIZ &&
    (value.correct as number)>=0 && (value.correct as number)<=(value.total as number) &&
    (value.kind==="full"||value.kind==="review");
}
export function normalizeQuizProject(value:unknown): QuizProject | null {
  if(!isObject(value)||!isObject(value.bank)||
     !boundedText(value.id,120)||!boundedText(value.title,180)||
     !boundedText(value.filename,200)||!validDate(value.createdAt)||
     !validDate(value.updatedAt)||typeof value.difficulty!=="string" ||
     !boundedText(value.bank.title,180)||!Array.isArray(value.bank.questions)||
     value.bank.questions.length<1 || value.bank.questions.length>MAX_QUESTIONS_PER_QUIZ ||
     !value.bank.questions.every(validateQuestion) ||
     !(value.firstScore===null || Number.isInteger(value.firstScore) &&
       (value.firstScore as number)>=0 && (value.firstScore as number)<=100) ||
     !Array.isArray(value.reviewIds)||!isObject(value.streaks)||
     !Number.isInteger(value.reviewRounds)|| (value.reviewRounds as number)<0)
       return null;
  const len=value.bank.questions.length;
  if(!value.reviewIds.every(index=>Number.isInteger(index)&&index>=0&&index<len) ||
     !Object.entries(value.streaks).every(([index,streak])=>
       /^\d+$/.test(index) && Number(index)<len && Number.isInteger(streak) &&
       (streak as number)>=0 && (streak as number)<=2))
     return null;
  if(value.attempts!==undefined &&
     (!Array.isArray(value.attempts)||value.attempts.length>2000||
     !value.attempts.every(validateAttempt))) return null;
  const origin=value.origin==="imported"?"imported":"generated";
  const questions=value.bank.questions as QuizQuestion[];
  const attemptList=(value.attempts||[]) as QuizAttempt[];
  return {
    id:value.id as string,title:value.title as string,filename:value.filename as string,
    createdAt:value.createdAt as string,updatedAt:value.updatedAt as string,
    difficulty:value.difficulty as string,
    bank:{title:value.bank.title as string,questions},
    firstScore:value.firstScore as number|null,
    reviewIds:value.reviewIds as number[],streaks:value.streaks as Record<number,number>,
    reviewRounds:value.reviewRounds as number,
    origin,attempts:attemptList,
  };
}

export function readQuizProjects():QuizProject[] {
  try{
    const raw=localStorage.getItem(QUIZ_STORAGE_KEY);
    if(!raw)return [];
    const data:unknown=JSON.parse(raw);
    if(!Array.isArray(data))return [];
    // NEVER silently slice/discard older projects.
    return data.map(normalizeQuizProject).filter((q):q is QuizProject=>q!==null);
  }catch{return [];}
}
export function persistQuizProjects(items:QuizProject[]):void {
  if(items.length>MAX_QUIZ_PROJECTS)
    throw new Error("بلغت مكتبة الاختبارات الحد الأقصى (50 مشروعًا). صدّر نسخة احتياطية أو احذف مشروعًا غير مطلوب قبل الإضافة.");
  const ids=new Set<string>();
  for(const item of items){
    if(!normalizeQuizProject(item)||ids.has(item.id))
      throw new Error("بيانات أحد مشاريع الاختبارات غير صالحة أو مكررة.");
    ids.add(item.id);
  }
  try{
    localStorage.setItem(QUIZ_STORAGE_KEY,JSON.stringify(items));
  } catch {
    throw new Error("تعذّر حفظ الاختبارات على هذا المتصفح؛ ربما امتلأت مساحة التخزين. صدّر نسخة احتياطية ولا تحذف بيانات الموقع.");
  }
}
export function exportQuizBackup(items:QuizProject[]):string {
  // No PDF, source document, or API credentials are included.
  return JSON.stringify({format:"maghrabi-quiz-projects",version:1,
    exportedAt:new Date().toISOString(),projects:items},null,2);
}
export function parseQuizBackup(contents:string):QuizProject[] {
  if(contents.length>MAX_BACKUP_SIZE)
    throw new Error("النسخة الاحتياطية تتجاوز 4 ميجابايت.");
  let data:unknown;
  try {data=JSON.parse(contents);} catch {throw new Error("الملف ليس نسخة JSON صالحة.");}
  if(!isObject(data) || data.format!=="maghrabi-quiz-projects" || data.version!==1 ||
     !Array.isArray(data.projects) || data.projects.length>MAX_QUIZ_PROJECTS)
    throw new Error("صيغة النسخة الاحتياطية أو إصدارها غير مدعوم.");
  const parsed=data.projects.map(normalizeQuizProject);
  if(parsed.some(item=>item===null))
    throw new Error("تحتوي النسخة الاحتياطية على بيانات اختبار غير مكتملة أو غير صالحة.");
  const ids=new Set<string>();
  for(const item of parsed as QuizProject[]){
    if(ids.has(item.id))throw new Error("النسخة تحتوي على معرّفات اختبارات مكررة.");
    ids.add(item.id);
  }
  return parsed as QuizProject[];
}
export function mergeQuizBackups(current:QuizProject[],incoming:QuizProject[]):QuizProject[] {
  const used=new Set(current.map(item=>item.id));
  const next=[...current];
  for(const item of incoming){
    // Re-importing an unchanged backup must not duplicate or overwrite data.
    if(used.has(item.id))continue;
    used.add(item.id);
    next.push(item);
  }
  if(next.length>MAX_QUIZ_PROJECTS)
    throw new Error("ستتجاوز المكتبة 50 مشروعًا بعد الاستيراد. لن تُحذف أي اختبارات؛ قلل عدد المشاريع أولًا.");
  return next.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
}
