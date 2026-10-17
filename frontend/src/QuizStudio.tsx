import {useEffect, useMemo, useRef, useState} from "react";
import {api, jsonBody} from "./api";
import ReadyQuizImport from "./ReadyQuizImport";
import type {ReadyImport} from "./ReadyQuizImport";

type Question = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  source_quote: string;
  source_page: number;
  source_verified?: boolean;
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
  origin?: "generated" | "imported";
};
type Extracted = {filename: string; source_text: string; pages: number; truncated: boolean; characters: number};
type Stage = "setup" | "exam" | "results";
const KEY = "maghrabi-office-quiz-banks-v1";
const MAX_BANKS = 12;
const MAX_EXAM_QUESTIONS = 40;
const BATCH_SIZE = 10;
const levels: Record<string,string> = {easy:"سهل",medium:"متوسط",hard:"صعب",mixed:"متنوع"};
function readSaved(): SavedQuiz[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedQuiz => {
      if (!item || typeof item !== "object") return false;
      const v = item as Partial<SavedQuiz>;
      return typeof v.id === "string" && typeof v.title === "string" &&
        Array.isArray(v.bank?.questions) && v.bank.questions.length >= 1 &&
        v.bank.questions.length <= MAX_EXAM_QUESTIONS && Array.isArray(v.reviewIds) &&
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
  const [setupMode,setSetupMode] = useState<"ai"|"ready">("ai");
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
  // Preserve completed batches in the current tab if a later provider request fails.
  // Source text is never persisted as part of the saved question bank.
  const partialRef = useRef<{key:string;title:string;questions:Question[]} | null>(null);
  const activeQuestionId = indices[at];
  const question = active && activeQuestionId !== undefined ? active.bank.questions[activeQuestionId] : null;
  const totalQuestions = active?.bank.questions.length || 0;
  const noVerifiedQuote = active?.origin!=="imported"
    ? active?.bank.questions.filter(q=>q.source_verified===false).length || 0 : 0;
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
      partialRef.current = null;
      setNote(info.truncated
        ? "المحاضرة طويلة؛ سيُبنى الاختبار من الجزء المستخرج فقط. لتغطية بقية الصفحات، قسّم المحاضرة إلى ملفات."
        : "تم استخراج النص. يمكنك الآن إنشاء اختبار من محتوى المحاضرة.");
    } catch(e){setError(e instanceof Error?e.message:"تعذر استخراج المحاضرة.");}
    finally {setBusy("");}
  }
  async function generate() {
    if (!lecture) {setError("استخرج نص المحاضرة أولًا.");return;}
    setBusy("جارٍ إعداد الاختبار…");setError("");setNote("");
    const key = JSON.stringify([lecture.source_text,count,difficulty,language]);
    const previous = partialRef.current?.key === key ? partialRef.current : null;
    const collected: Question[] = previous ? [...previous.questions] : [];
    let title = previous?.title || "";
    try {
      // Small exams use one request. Exams > 20 use up to 4 individual
      // requests, each independently covered by the existing 120s timeout.
      // This avoids huge, often truncated model responses for 30–40 MCQs.
      const sizes = count <= 20 ? [count] :
        Array.from({length: Math.ceil(count/BATCH_SIZE)}, (_, i) =>
          Math.min(BATCH_SIZE,count-i*BATCH_SIZE));
      const fingerprint = (text: string) => text.normalize("NFKD")
        .toLocaleLowerCase().replace(/[\u0300-\u036f\u064b-\u065f]/g,"")
        .replace(/[^\p{L}\p{N}]+/gu," ").trim();
      const known = new Set(collected.map(q=>fingerprint(q.question)));
      for (const size of sizes) {
        if (collected.length >= count) break;
        // Allow resuming only already completed batches of this configuration.
        // The final partial batch is never saved until all its questions pass.
        if (collected.length % BATCH_SIZE !== 0 && collected.length < count)
          throw new Error("تعذر استئناف دفعات الاختبار. أعد إنشاء الاختبار من البداية.");
        setBusy("جارٍ توليد الأسئلة وتوثيقها… ("+collected.length+" من "+count+")");
        const batch: Bank = await (await api("/ai/quiz/generate",jsonBody({
          source_text:lecture.source_text,count:size,difficulty,language,
          avoid_questions:collected.map(q=>q.question),
        }))).json();
        if (!Array.isArray(batch.questions) || batch.questions.length !== size)
          throw new Error("لم يُنتج مزود الذكاء الاصطناعي العدد المطلوب في هذه الدفعة.");
        for (const q of batch.questions) {
          const fingerprinted = fingerprint(q.question);
          if (!fingerprinted || known.has(fingerprinted))
            throw new Error("تكرر أحد الأسئلة بين دفعات الاختبار. أعد المحاولة.");
          known.add(fingerprinted);
        }
        if (!title) title=batch.title;
        collected.push(...batch.questions);
        partialRef.current={key,title,questions:[...collected]};
      }
      if (collected.length !== count)
        throw new Error("لم تكتمل جميع أسئلة الاختبار. حاول مجددًا.");
      const bank: Bank = {title,questions:collected};
      const item:SavedQuiz = {
        id:crypto.randomUUID(), title:bank.title,filename:lecture.filename,
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        difficulty, bank, firstScore:null,reviewIds:[],streaks:{},reviewRounds:0,
      };
      store(item);
      partialRef.current=null;
      startSet(item);
    } catch(e) {
      const errorMessage=e instanceof Error?e.message:"تعذر إنشاء الاختبار.";
      setError(errorMessage);
      if (partialRef.current?.key === key && partialRef.current.questions.length)
        setNote("تم إنشاء "+partialRef.current.questions.length+" من "+count+
          " سؤالًا. اضغط «إنشاء الاختبار وبدء الأسئلة» مجددًا لاستكمال الدفعات المتبقية.");
    } finally {setBusy("");}
  }
  function acceptReady(data: ReadyImport, launch: boolean) {
    const bank: Bank = {
      title: data.title.trim(),
      questions: data.questions.map(q=>({
        question: q.question.trim(), options: q.options.map(option=>option.trim()),
        correct_index: q.correct_index as number,
        explanation: "هذه الإجابة معتمدة من مفتاح الإجابات في الملف أو من مراجعة مُعدّ الاختبار؛ يُنصح بمراجعة المادة التعليمية لفهم السبب.",
        source_quote: "",
        source_page: q.source_page,
      })),
    };
    const item: SavedQuiz = {
      id: crypto.randomUUID(),title:bank.title,filename:data.filename,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      difficulty:"imported",bank,firstScore:null,reviewIds:[],streaks:{},
      reviewRounds:0,origin:"imported",
    };
    store(item);
    if(launch)startSet(item);
    else setNote("تم حفظ الأسئلة المستوردة في «اختباراتي المحفوظة». يمكنك حلها لاحقًا.");
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
    partialRef.current=null;
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
    {stage === "setup" && <>
      <div className="quiz-mode-tabs" role="group" aria-label="طريقة إعداد الاختبار">
        <button type="button" className={"button "+(setupMode==="ai"?"primary":"outline")}
          onClick={()=>{setSetupMode("ai");setError("");}}>
          توليد أسئلة من محاضرة
        </button>
        <button type="button" className={"button "+(setupMode==="ready"?"primary":"outline")}
          onClick={()=>{setSetupMode("ready");setError("");}}>
          استيراد أسئلة جاهزة من Word أو PDF
        </button>
      </div>
      {setupMode==="ready" ? <ReadyQuizImport onAccept={acceptReady}/> : <div className="quiz-setup-grid">
      <section className="panel quiz-settings">
        <h3>إنشاء اختبار من محاضرة</h3>
        <label>ملف المحاضرة (PDF أو DOCX)
          <input aria-label="ملف المحاضرة" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e=>{partialRef.current=null;setUpload(e.target.files?.[0]||null);setLecture(null);setError("");}}/>
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
              {[5,10,15,20,25,30,35,40].map(n=><option key={n} value={n}>{n} أسئلة</option>)}
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
        <p className="muted small">الدرجة من 100 وتوزّع بالتساوي على عدد الأسئلة. لا تظهر الإجابات الصحيحة حتى انتهاء الجولة. عند اختيار أكثر من 20 سؤالًا، يُنشأ الاختبار على دفعات لضمان اكتماله دون تكرار.</p>
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
    </>}
    {stage === "exam" && active && question && <section className="panel quiz-exam">
      {noVerifiedQuote>0 && round===0 && <p className="soft-note" role="status">
        تم إعداد الاختبار بنجاح. تعذر مطابقة الاقتباس حرفيًا في {noVerifiedQuote} من
        {totalQuestions} سؤالًا؛ لذلك لن تُعرض لهذه الأسئلة صفحات أو اقتباسات غير مؤكدة.
        راجع صحة الإجابات مع المحاضرة عند استخدامها للمذاكرة.
      </p>}
      <div className="quiz-topline"><span>{round===0?"الاختبار الأساسي":"جولة إتقان الأخطاء"}</span><strong>السؤال {at+1} من {indices.length}</strong></div>
      <div className="quiz-progress"><div style={{width:((at+1)/indices.length)*100+"%"}}/></div>
      <div className="quiz-exam-head"><span className="quiz-question-number">س{at+1}</span><h3 dir="auto">{question.question}</h3></div>
      <fieldset className="quiz-choices"><legend className="muted">اختر إجابة واحدة</legend>
        {[0,1,2,3].map(index=>{
          const original=roundPosition(question,index,round);
          return <label key={index} className={"quiz-choice"+(answers[activeQuestionId]===original?" active":"")}>
            <input type="radio" style={{width:18,height:18,margin:0,padding:0,flex:"0 0 18px"}} name={"quiz-answer-"+activeQuestionId} checked={answers[activeQuestionId]===original}
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
      {round>0 && active.firstScore!==null && <p className="soft-note">
        درجتك الأصلية في الاختبار الأول: <strong>{active.firstScore} من 100</strong>.
        هذه الجولة للتدريب وتثبيت الأخطاء، ولا تغيّر درجة الاختبار الأول.
      </p>}
      <div className="quiz-mastery-bar"><div style={{width:totalQuestions?mastered/totalQuestions*100+"%":"0%"}}/></div>
      <p className="muted small">إتقان {mastered} من {totalQuestions} سؤالًا. يُشترط جوابان صحيحان متتاليان للأسئلة التي أخطأت فيها أول مرة.</p>
      {noVerifiedQuote>0 && <p className="soft-note" role="status">
        {noVerifiedQuote} سؤالًا لا يتوفر لها اقتباس مطابق ومتحقق من المحاضرة.
        قد تكون الإجابة صحيحة، لكن يُنصح بمراجعة المحتوى الأصلي قبل الاعتماد عليها.
      </p>}
      {wrong.length>0 && <>
        <h3>الأسئلة التي تحتاج إلى مراجعة في هذه الجولة</h3>
        <div className="quiz-review-list">
          {wrong.map(id=>{
            const q=active.bank.questions[id];
            return <article className="quiz-review-card" key={id}>
              <strong>{q.question}</strong>
              <p><b>الإجابة الصحيحة:</b> {q.options[q.correct_index]}</p>
              <p><b>التفسير:</b> {q.explanation}</p>
              {q.source_quote && <blockquote>{q.source_quote}</blockquote>}
              <small className="muted">{active.origin==="imported"
                ? "المصدر: "+active.filename+" · "+(active.filename.toLowerCase().endsWith(".pdf")?"صفحة "+q.source_page:"مستند Word")
                : q.source_verified===false
                  ? "لا يوجد اقتباس موثق لهذا السؤال؛ راجع المحاضرة للتحقق من صحة الإجابة."
                  : "المصدر: "+active.filename+" · "+(q.source_page===1?"المقطع المرجعي 1 / الصفحة 1":"صفحة "+q.source_page)}</small>
            </article>;
          })}
        </div>
      </>}
      {!active.reviewIds.length ? <div className="quiz-completed"><strong>اكتمل إتقان أسئلة هذا الاختبار</strong><p>يمكنك بدء اختبار جديد لتثبيت معلومات أخرى من المحاضرة.</p></div>
      : <>
        <p className="muted small">ستظهر لك الأسئلة التي أخطأت فيها فقط. تكرار الإجابة الصحيحة مرتين متتاليتين ينهي مراجعة السؤال.</p>
        <button className="button primary" onClick={retry}>إعادة اختبار الأسئلة التي تحتاج إلى إتقان ({active.reviewIds.length})</button>
      </>}
      <button className="button outline" onClick={newQuiz}>العودة لإنشاء اختبار جديد</button>
    </section>}
    <section className="panel quiz-saved">
      <div className="quiz-section-title"><h3>اختباراتي المحفوظة</h3><span className="muted small">{saved.length} من {MAX_BANKS}</span></div>
      {saved.length===0 ? <p className="muted">عند إنشاء أول اختبار ستجده هنا لتعود إليه لاحقًا.</p>
        : <div className="quiz-saved-grid">{saved.map(item=><article className="quiz-saved-card" key={item.id}>
          <strong>{item.title}</strong>
          <small>{item.filename} · {item.bank.questions.length} سؤال · {item.origin==="imported"?"أسئلة مستوردة":levels[item.difficulty]||item.difficulty}</small>
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
