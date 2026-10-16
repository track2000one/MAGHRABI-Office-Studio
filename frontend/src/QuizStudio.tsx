import {useEffect, useMemo, useState} from "react";
import {api, jsonBody} from "./api";

type Question = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  source_quote: string;
  source_page: number;
};
type Bank = {title: string; questions: Question[]};
type SavedQuiz = {
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  difficulty: string;
  bank: Bank;
  firstScore: number | null;
  reviewIds: number[];
  streaks: Record<number, number>;
  reviewRounds: number;
};
type Extracted = {filename: string; source_text: string; pages: number; truncated: boolean; characters: number};
type Stage = "setup" | "exam" | "results";
const KEY = "maghrabi-office-quiz-banks-v1";
const MAX_BANKS = 12;
const levels: Record<string,string> = {easy:"سهل",medium:"متوسط",hard:"صعب",mixed:"متنوع"};
function readSaved(): SavedQuiz[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedQuiz => {
      if (!item || typeof item !== "object") return false;
      const v = item as Partial<SavedQuiz>;
      return typeof v.id === "string" && typeof v.title === "string" &&
        Array.isArray(v.bank?.questions) && v.bank.questions.length >= 5 &&
        v.bank.questions.length <= 20 && Array.isArray(v.reviewIds) &&
        typeof v.streaks === "object" && v.streaks !== null;
    }).slice(0,MAX_BANKS);
  } catch { return []; }
}
function roundPosition(question: Question, displayIndex: number, round: number) {
  return (displayIndex + round) % question.options.length;
}

export default function QuizStudio() {
  const [saved,setSaved] = useState<SavedQuiz[]>(readSaved);
  const [active,setActive] = useState<SavedQuiz | null>(null);
  const [upload,setUpload] = useState<File | null>(null);
  const [lecture,setLecture] = useState<Extracted | null>(null);
  const [count,setCount] = useState(10);
  const [difficulty,setDifficulty] = useState("mixed");
  const [language,setLanguage] = useState<"ar"|"en">("ar");
  const [stage,setStage] = useState<Stage>("setup");
  const [round,setRound] = useState(0);
  const [indices,setIndices] = useState<number[]>([]);
  const [at,setAt] = useState(0);
  const [answers,setAnswers] = useState<Record<number,number>>({});
  const [wrong,setWrong] = useState<number[]>([]);
  const [lastResult,setLastResult] = useState({correct:0,total:0,points:0});
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [note,setNote] = useState("");
  const [deleteId,setDeleteId] = useState("");
  const activeQuestionId = indices[at];
  const question = active && activeQuestionId !== undefined ? active.bank.questions[activeQuestionId] : null;
  const totalQuestions = active?.bank.questions.length || 0;
  const mastered = useMemo(() => active ? totalQuestions - active.reviewIds.filter(id=>
    (active.streaks[id] || 0) < 2).length : 0, [active,totalQuestions]);

  function store(item: SavedQuiz) {
    try {
      const current = readSaved();
      const next = [item, ...current.filter(q=>q.id !== item.id)].slice(0,MAX_BANKS);
      localStorage.setItem(KEY,JSON.stringify(next));
      setSaved(next);
      setActive(item);
      setNote("تم حفظ الاختبار وتقدم المراجعة على هذا المتصفح.");
    } catch {
      setError("تعذر حفظ الاختبار في هذا المتصفح. يمكنك متابعة الجلسة الحالية دون حفظ.");
      setActive(item);
    }
  }
  function startSet(item: SavedQuiz) {
    setActive(item);
    setRound(0);
    setIndices(item.bank.questions.map((_,i)=>i));
    setAnswers({});
    setWrong([]);
    setAt(0);
    setStage("exam");
    setError("");
    setNote("");
  }
  async function extract() {
    if (!upload) {setError("اختر ملف PDF أو DOCX للمحاضرة.");return;}
    if (upload.size > 8*1024*1024 || upload.size === 0) {setError("حجم المحاضرة يجب ألا يتجاوز 8 ميجابايت.");return;}
    setBusy("جارٍ استخراج نص المحاضرة…");setError("");setNote("");setLecture(null);
    try {
      const form = new FormData();
      form.append("file",upload);
      const info: Extracted = await (await api("/ai/quiz/extract",{method:"POST",body:form})).json();
      setLecture(info);
      setNote(info.truncated
        ? "المحاضرة طويلة؛ سيُبنى الاختبار من الجزء المستخرج فقط. لتغطية بقية الصفحات، قسّم المحاضرة إلى ملفات."
        : "تم استخراج النص. يمكنك الآن إنشاء اختبار من محتوى المحاضرة.");
    } catch(e){setError(e instanceof Error?e.message:"تعذر استخراج المحاضرة.");}
    finally {setBusy("");}
  }
  async function generate() {
    if (!lecture) {setError("استخرج نص المحاضرة أولًا.");return;}
    setBusy("جارٍ إنشاء أسئلة مستندة إلى المحاضرة…");setError("");setNote("");
    try {
      const bank: Bank = await (await api("/ai/quiz/generate",jsonBody({
        source_text:lecture.source_text,count,difficulty,language,
      }))).json();
      const item:SavedQuiz = {
        id:crypto.randomUUID(), title:bank.title,filename:lecture.filename,
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        difficulty, bank, firstScore:null,reviewIds:[],streaks:{},reviewRounds:0,
      };
      store(item);
      startSet(item);
    } catch(e){setError(e instanceof Error?e.message:"تعذر إنشاء الاختبار.");}
    finally {setBusy("");}
  }
  function finishRound() {
    if (!active) return;
    const failed=indices.filter(id=>answers[id] !== active.bank.questions[id].correct_index);
    const correct = indices.length-failed.length;
    const points=Math.round((correct/indices.length)*100);
    const nextStreaks={...active.streaks};
    let reviewIds=active.reviewIds.slice();
    if(round === 0) {
      reviewIds=failed.slice();
      for(const id of failed) nextStreaks[id]=0;
    } else {
      for(const id of indices) {
        nextStreaks[id]=failed.includes(id)?0:Math.min(2,(nextStreaks[id] || 0)+1);
      }
      reviewIds=reviewIds.filter(id=>(nextStreaks[id] || 0)<2);
    }
    const item:SavedQuiz = {
      ...active, updatedAt:new Date().toISOString(),
      firstScore:round===0?points:active.firstScore,
      reviewIds,streaks:nextStreaks,
      reviewRounds:round===0?active.reviewRounds:active.reviewRounds+1,
    };
    setWrong(failed);
    setLastResult({correct,total:indices.length,points});
    store(item);
    setStage("results");
  }
  function retry() {
    if (!active || !active.reviewIds.length) return;
    const nextRound=round+1;
    setRound(nextRound);
    setIndices(active.reviewIds.slice());
    setAnswers({});
    setWrong([]);
    setAt(0);
    setStage("exam");
    setError("");
    setNote("");
  }
  function deleteQuiz() {
    const next=saved.filter(s=>s.id!==deleteId);
    try {localStorage.setItem(KEY,JSON.stringify(next));setSaved(next);}
    catch {setError("تعذر حذف الاختبار من التخزين المحلي.");}
    if(active?.id===deleteId){setActive(null);setStage("setup");}
    setDeleteId("");
  }
  function newQuiz(){
    setActive(null);setStage("setup");setLecture(null);setUpload(null);
    setAnswers({});setRound(0);setError("");setNote("");
  }
  useEffect(()=>{if(stage === "exam" && question) window.scrollTo?.({top:0,behavior:"smooth"});},[at,round,stage]);

  return <div className="quiz-studio">
    <div className="quiz-hero">
      <div>
        <span className="eyebrow">من المحاضرة إلى الإتقان</span>
        <h2>الاختبارات الذكية <span aria-hidden="true">✦</span></h2>
        <p>حوّل ملف PDF أو Word إلى اختبار اختيارات متعددة، ثم راجع أخطاءك حتى تتقن الإجابات.</p>
      </div>
      <div className="quiz-hero-meter"><strong>{active?.firstScore === null || !active ? "—" : active.firstScore+"%"}</strong><span>درجة الاختبار الأول</span></div>
    </div>
    {error && <div className="banner error" role="alert">{error}<button onClick={()=>setError("")} aria-label="إغلاق الخطأ">×</button></div>}
    {note && <p className="soft-note" role="status">{note}</p>}
    {busy && <div className="banner loading" role="status"><span className="spinner"/>{busy}</div>}
    {stage === "setup" && <div className="quiz-setup-grid">
      <section className="panel quiz-settings">
        <h3>إنشاء اختبار من محاضرة</h3>
        <label>ملف المحاضرة (PDF أو DOCX)
          <input aria-label="ملف المحاضرة" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e=>{setUpload(e.target.files?.[0]||null);setLecture(null);setError("");}}/>
        </label>
        <button className="button outline" disabled={!upload || !!busy} onClick={()=>void extract()}>
          استخراج المحاضرة
        </button>
        {lecture && <div className="quiz-lecture-info">
          <strong>{lecture.filename}</strong>
          <span>{lecture.pages} {lecture.pages===1?"صفحة أو قسم":"صفحات"} · {lecture.characters.toLocaleString("ar-SA")} حرف</span>
          {lecture.truncated && <span className="quiz-warning">تم استخلاص جزء من المحاضرة فقط بسبب طولها.</span>}
        </div>}
        <div className="quiz-form-grid">
          <label>عدد الأسئلة
            <select aria-label="عدد أسئلة الاختبار" value={count} onChange={e=>setCount(Number(e.target.value))}>
              {[5,10,15,20].map(n=><option key={n} value={n}>{n} أسئلة</option>)}
            </select>
          </label>
          <label>مستوى الأسئلة
            <select aria-label="مستوى صعوبة الأسئلة" value={difficulty} onChange={e=>setDifficulty(e.target.value)}>
              {Object.entries(levels).map(([value,title])=><option value={value} key={value}>{title}</option>)}
            </select>
          </label>
          <label>لغة الأسئلة
            <select aria-label="لغة أسئلة الاختبار" value={language} onChange={e=>setLanguage(e.target.value as "ar"|"en")}>
              <option value="ar">العربية</option><option value="en">English</option>
            </select>
          </label>
        </div>
        <p className="muted small">الدرجة من 100، وتوزّع بالتساوي على عدد الأسئلة. لا تظهر الإجابات الصحيحة حتى انتهاء الجولة.</p>
        <button className="button primary" disabled={!lecture || !!busy} onClick={()=>void generate()}>
          إنشاء الاختبار وبدء الأسئلة
        </button>
        <p className="muted small">يتطلب التوليد تسجيل الدخول إلى الذكاء الاصطناعي من إعدادات الاتصال، وسيُرسل النص المستخرج إلى المزود المهيأ. لا تُحفظ المحاضرة كاملة على الخادم.</p>
      </section>
      <aside className="panel quiz-advice">
        <h3>كيف يعمل وضع الإتقان؟</h3>
        <div className="quiz-advice-step"><strong>01</strong><div><b>اختبار أول</b><p>إجابة على أسئلة متنوعة وحساب درجتك.</p></div></div>
        <div className="quiz-advice-step"><strong>02</strong><div><b>مراجعة الأخطاء</b><p>تفسير للإجابة واقتباس داعم من المحاضرة.</p></div></div>
        <div className="quiz-advice-step"><strong>03</strong><div><b>تثبيت المعلومات</b><p>إعادة الأسئلة الخاطئة حتى تجيب عنها صحيحًا مرتين متتاليتين.</p></div></div>
      </aside>
    </div>}
    {stage === "exam" && active && question && <section className="panel quiz-exam">
      <div className="quiz-topline"><span>{round===0?"الاختبار الأساسي":"جولة إتقان الأخطاء"}</span><strong>السؤال {at+1} من {indices.length}</strong></div>
      <div className="quiz-progress"><div style={{width:((at+1)/indices.length)*100+"%"}}/></div>
      <div className="quiz-exam-head"><span className="quiz-question-number">س{at+1}</span><h3 dir="auto">{question.question}</h3></div>
      <fieldset className="quiz-choices"><legend className="muted">اختر إجابة واحدة</legend>
        {[0,1,2,3].map(index=>{
          const original=roundPosition(question,index,round);
          return <label key={index} className={"quiz-choice"+(answers[activeQuestionId]===original?" active":"")}>
            <input type="radio" name={"quiz-answer-"+activeQuestionId} checked={answers[activeQuestionId]===original}
              onChange={()=>setAnswers(a=>({...a,[activeQuestionId]:original}))}/>
            <span className="quiz-choice-letter">{["أ","ب","ج","د"][index]}</span>
            <span className="quiz-choice-text" dir="auto">{question.options[original]}</span>
          </label>;
        })}
      </fieldset>
      <div className="quiz-exam-controls">
        <button className="button outline" disabled={at===0} onClick={()=>setAt(v=>v-1)}>السابق</button>
        <button className="button primary" disabled={answers[activeQuestionId]===undefined}
          onClick={()=>at+1===indices.length?finishRound():setAt(v=>v+1)}>
          {at+1===indices.length?"إنهاء وتصحيح الجولة":"السؤال التالي"}
        </button>
      </div>
      <p className="small muted">يُحتسب تصحيح الأسئلة بعد إنهاء الجولة، وليس أثناء الإجابة.</p>
    </section>}
    {stage === "results" && active && <section className="panel quiz-results">
      <div className="quiz-results-header"><div><span className="eyebrow">{round===0?"نتيجة الاختبار":"نتيجة مراجعة الأخطاء"}</span>
        <h3>{active.title}</h3></div>
        <div className="quiz-score">{lastResult.points}%</div>
      </div>
      <p>إجابات صحيحة: <b>{lastResult.correct} من {lastResult.total}</b> ·
        الدرجة: <b>{lastResult.points} من 100</b> ·
        أسئلة تحتاج إلى إتقان: <b>{active.reviewIds.length}</b></p>
      <div className="quiz-mastery-bar"><div style={{width:totalQuestions?mastered/totalQuestions*100+"%":"0%"}}/></div>
      <p className="muted small">إتقان {mastered} من {totalQuestions} سؤالًا. يُشترط جوابان صحيحان متتاليان للأسئلة التي أخطأت فيها أول مرة.</p>
      {wrong.length>0 && <>
        <h3>الأسئلة التي تحتاج إلى مراجعة في هذه الجولة</h3>
        <div className="quiz-review-list">
          {wrong.map(id=>{
            const q=active.bank.questions[id];
            return <article className="quiz-review-card" key={id}>
              <strong>{q.question}</strong>
              <p><b>الإجابة الصحيحة:</b> {q.options[q.correct_index]}</p>
              <p><b>التفسير:</b> {q.explanation}</p>
              <blockquote>{q.source_quote}</blockquote>
              <small className="muted">المصدر: {active.filename} · {q.source_page===1?"المقطع المرجعي 1 / الصفحة 1":"صفحة "+q.source_page}</small>
            </article>;
          })}
        </div>
      </>}
      {!active.reviewIds.length ? <div className="quiz-completed"><strong>اكتمل إتقان أسئلة هذا الاختبار</strong><p>يمكنك بدء اختبار جديد لتثبيت معلومات أخرى من المحاضرة.</p></div>
      : <button className="button primary" onClick={retry}>إعادة اختبار الأسئلة التي تحتاج إلى إتقان ({active.reviewIds.length})</button>}
      <button className="button outline" onClick={newQuiz}>العودة لإنشاء اختبار جديد</button>
    </section>}
    <section className="panel quiz-saved">
      <div className="quiz-section-title"><h3>اختباراتي المحفوظة</h3><span className="muted small">{saved.length} من {MAX_BANKS}</span></div>
      {saved.length===0 ? <p className="muted">عند إنشاء أول اختبار ستجده هنا لتعود إليه لاحقًا.</p>
        : <div className="quiz-saved-grid">{saved.map(item=><article className="quiz-saved-card" key={item.id}>
          <strong>{item.title}</strong>
          <small>{item.filename} · {item.bank.questions.length} سؤال · {levels[item.difficulty]||item.difficulty}</small>
          <p className="muted small">{item.firstScore===null?"لم يُنهَ الاختبار بعد":"الدرجة الأولى "+item.firstScore+"%"} ·
            {item.reviewIds.length?" "+item.reviewIds.length+" سؤال يحتاج مراجعة":" لا توجد أسئلة متبقية للمراجعة"}</p>
          <div className="quiz-saved-actions">
            <button className="button outline" onClick={()=>{
              if(item.reviewIds.length && item.firstScore!==null){
                setActive(item);setRound(Math.max(1,item.reviewRounds+1));setIndices(item.reviewIds);
                setAt(0);setAnswers({});setStage("exam");setWrong([]);setNote("");
              } else startSet(item);
            }}>{item.reviewIds.length && item.firstScore!==null?"استكمال مراجعة الأخطاء":"بدء الاختبار"}</button>
            <button className="text-button" onClick={()=>setDeleteId(item.id)}>حذف</button>
          </div>
          {deleteId===item.id&&<div className="quiz-delete"><p>حذف بنك الأسئلة ونتائجه من هذا المتصفح؟</p>
            <button className="button outline" onClick={()=>setDeleteId("")}>إلغاء</button>
            <button className="button danger" onClick={deleteQuiz}>تأكيد الحذف</button>
          </div>}
        </article>)}</div>}
      <p className="muted small">تُحفظ بنوك الأسئلة ونتائجها محليًا على هذا المتصفح فقط؛ لا تُحفظ نسخة المحاضرة الأصلية. هذه اختبارات تدريبية وليست امتحانات مراقبة.</p>
    </section>
  </div>;
}
