/** One-tab, time-limited checkpoint for interrupted Gemini quiz batches.
 * Contains extracted lecture text in sessionStorage, never persistent backend
 * storage or cross-device synchronization. Clear on completion or new upload.
 */
import type {QuizQuestion} from "./quizLibrary";

export const PENDING_QUIZ_KEY="maghrabi-office-pending-quiz-v1";
const MAX_AGE_MS=2*60*60*1000;
type Lecture={filename:string;source_text:string;pages:number;truncated:boolean;characters:number};
export type PendingQuiz={
  savedAt:number;
  lecture:Lecture;
  count:number;
  difficulty:string;
  language:"ar"|"en";
  title:string;
  questions:QuizQuestion[];
};
function validQuestion(value:unknown):value is QuizQuestion {
  if(!value||typeof value!=="object")return false;
  const q=value as Partial<QuizQuestion>;
  return typeof q.question==="string" && q.question.length>=12 && q.question.length<=380 &&
    Array.isArray(q.options) && q.options.length===4 &&
    q.options.every(option=>typeof option==="string" && option.length>0 && option.length<=220) &&
    Number.isInteger(q.correct_index) && (q.correct_index as number)>=0 && (q.correct_index as number)<=3 &&
    typeof q.explanation==="string" && q.explanation.length>=12 &&
    typeof q.source_quote==="string" && typeof q.source_page==="number";
}
export function readPendingQuiz():PendingQuiz|null {
  try {
    const raw=sessionStorage.getItem(PENDING_QUIZ_KEY);
    if(!raw)return null;
    const entry=JSON.parse(raw) as PendingQuiz;
    if(!entry||!Number.isFinite(entry.savedAt) ||
       Date.now()<entry.savedAt || Date.now()-entry.savedAt>MAX_AGE_MS ||
       !entry.lecture || typeof entry.lecture.filename!=="string" ||
       typeof entry.lecture.source_text!=="string" ||
       entry.lecture.source_text.length<250 || entry.lecture.source_text.length>30000 ||
       ![25,30,35,40].includes(entry.count) || typeof entry.title!=="string" ||
       !["easy","medium","hard","mixed"].includes(entry.difficulty) ||
       !["ar","en"].includes(entry.language) ||
       !Array.isArray(entry.questions) || entry.questions.length===0 ||
       entry.questions.length>=entry.count || entry.questions.length%10!==0 ||
       !entry.questions.every(validQuestion))return null;
    return entry;
  }catch{return null;}
}
export function writePendingQuiz(quiz:PendingQuiz) {
  try{sessionStorage.setItem(PENDING_QUIZ_KEY,JSON.stringify(quiz));}
  catch{ /* User may have disabled browser storage; in-memory retry still works. */ }
}
export function clearPendingQuiz(){
  try{sessionStorage.removeItem(PENDING_QUIZ_KEY);}
  catch{ /* Browser storage disabled */ }
}
