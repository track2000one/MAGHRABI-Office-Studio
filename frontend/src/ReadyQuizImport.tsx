import {useState} from "react";
import {api, jsonBody} from "./api";

export type ReadyQuestion = {
  number: number;
  question: string;
  options: string[];
  correct_index: number | null;
  source_page: number;
};
export type ReadyImport = {
  filename: string;
  title: string;
  questions: ReadyQuestion[];
  pages: number;
  detected_answers: number;
  skipped: number;
  warnings: string[];
};

type Props = {
  onAccept: (data: ReadyImport, start: boolean) => void;
};

export default function ReadyQuizImport({onAccept}: Props) {
  const [file,setFile]=useState<File|null>(null);
  const [sourceMode,setSourceMode]=useState<"paste"|"file">("paste");
  const [pastedText,setPastedText]=useState("");
  const [lectureTitle,setLectureTitle]=useState("");
  const [promptCount,setPromptCount]=useState(40);
  const [draft,setDraft]=useState<ReadyImport|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [reviewOpen,setReviewOpen]=useState(false);
  const missing=draft?.questions.filter(q=>q.correct_index===null).length || 0;

  async function parse() {
    if(sourceMode==="file") {
      if (!file) {setError("اختر ملف الأسئلة أولًا.");return;}
      if (!/\.(pdf|docx)$/i.test(file.name)) {setError("استخدم ملف PDF أو DOCX.");return;}
      if (file.size>8*1024*1024 || !file.size) {setError("حجم الملف يجب أن يكون بين 1 بايت و8 ميجابايت.");return;}
    } else {
      if(!pastedText.trim()) {setError("الصق الأسئلة المنسوخة من ChatGPT أولًا.");return;}
      if(pastedText.length>100000) {setError("الحد الأقصى للنص المنسوخ 100 ألف حرف.");return;}
    }
    setBusy(true);
    setDraft(null);
    setError("");
    setNotice("");
    try {
      let parsed:ReadyImport;
      if(sourceMode==="paste") {
        parsed=await (await api("/quiz/import-text",jsonBody({
          title:lectureTitle.trim()||"اختبار منسوخ من ChatGPT",
          text:pastedText,
        }))).json();
      } else {
        const body=new FormData();
        body.append("file",file!);
        parsed=await (await api("/quiz/import",{method:"POST",body})).json();
      }
      setDraft(parsed);
      const missingKeys=parsed.questions.filter(q=>q.correct_index===null).length;
      setReviewOpen(missingKeys>0 || parsed.skipped>0);
      setNotice(missingKeys
        ? "تم استخراج الأسئلة. يلزم تحديد "+missingKeys+" إجابة صحيحة قبل اعتماد الاختبار."
        : "تم تجهيز اختبار الطالب من "+parsed.questions.length+" سؤالًا، ويمكن حفظه أو بدء الحل مباشرة.");
    } catch(e) {
      setError(e instanceof Error?e.message:"تعذر تحليل ملف الأسئلة.");
    } finally {setBusy(false);}
  }

  function addManualQuestion() {
    setError("");
    setDraft(current=>{
      if (!current || current.questions.length>=40) return current;
      const number=Math.max(0,...current.questions.map(q=>q.number))+1;
      return {...current,questions:[...current.questions,{
        number,question:"",options:["","","",""],correct_index:null,source_page:1,
      }]};
    });
    setReviewOpen(true);
  }
  function makeChatGptPrompt() {
    return "من المحاضرة المرفقة أنشئ "+promptCount+
      " سؤال اختيار من متعدد بمستويات متنوعة. استخدم معلومات المحاضرة فقط. "+
      "لكل سؤال أربعة خيارات مختلفة وإجابة واحدة صحيحة. "+
      "اكتب النتيجة كنص عادي، دون جداول أو تقسيم إلى أعمدة، "+
      "وبهذا الشكل لكل سؤال على حدة:\n"+
      "1. Question text?\nA) First choice\nB) Second choice\n"+
      "C) Third choice\nD) Fourth choice\nCorrect Answer: B\n\n"+
      "استمر بالترقيم حتى "+promptCount+" سؤالًا، وضع مفتاح الإجابة بعد خيارات كل سؤال.";
  }
  async function copyChatGptPrompt(){
    try {
      await navigator.clipboard.writeText(makeChatGptPrompt());
      setNotice("تم نسخ الطلب. أرفق المحاضرة في ChatGPT والصق الطلب، ثم انسخ الأسئلة الناتجة هنا.");
    }catch {
      setError("تعذر النسخ التلقائي؛ حدد نص الطلب المعروض وانسخه يدويًا.");
    }
  }
  function update(index:number, patch:Partial<ReadyQuestion>) {
    setDraft(current=>current?{...current,
      questions:current.questions.map((question,i)=>i===index?{...question,...patch}:question),
    }:null);
  }
  function swap(index:number, direction:-1|1) {
    setDraft(current=>{
      if (!current) return null;
      const next=index+direction;
      if(next<0||next>=current.questions.length)return current;
      const items=[...current.questions];
      [items[index],items[next]]=[items[next],items[index]];
      return {...current,questions:items};
    });
  }
  function accept(start:boolean) {
    if (!draft) return;
    if (draft.questions.length===0 || draft.questions.length>40) {
      setError("اختر من 1 إلى 40 سؤالًا لإعداد الاختبار.");return;
    }
    if (missing) {setError("حدد الإجابة الصحيحة في "+missing+" سؤالًا قبل حفظ اختبار بدرجات.");return;}
    for (const [i,q] of draft.questions.entries()) {
      if (!q.question.trim() || !Array.isArray(q.options) ||
          q.options.length!==4 || q.options.some(v=>!v.trim()) ||
          new Set(q.options.map(x=>x.trim().toLocaleLowerCase())).size!==4) {
        setError("راجع نص السؤال "+(i+1)+"؛ يجب أن يتضمن سؤالًا وأربعة خيارات مختلفة غير فارغة.");
        return;
      }
    }
    setError("");
    onAccept(draft,start);
    setNotice("تم اعتماد الأسئلة وحفظها داخل اختباراتي.");
  }

  return <section className="panel ready-import" aria-label="استيراد أسئلة جاهزة">
    <h3>إضافة اختبار جاهز دون رسوم API</h3>
    <p className="muted small">انسخ أسئلة المحاضرة من دردشة ChatGPT والصقها مباشرة، أو ارفع ملف Word/PDF. بعد الترتيب يمكنك مراجعة الإجابات وحفظ الاختبار باسم المحاضرة في مكتبتك. حتى 40 سؤالًا.</p>
    <div className="ready-import-source-tabs" role="group" aria-label="طريقة إدخال الأسئلة">
      <button type="button" className={"button "+(sourceMode==="paste"?"primary":"outline")}
        onClick={()=>{setSourceMode("paste");setDraft(null);setError("");setNotice("");}}>
        لصق أسئلة من ChatGPT
      </button>
      <button type="button" className={"button "+(sourceMode==="file"?"primary":"outline")}
        onClick={()=>{setSourceMode("file");setDraft(null);setError("");setNotice("");}}>
        رفع ملف Word أو PDF
      </button>
    </div>
    {sourceMode==="paste" ? <div className="ready-paste-workflow">
      <div className="ready-chatgpt-instructions">
        <strong>طريقة العمل في 3 خطوات</strong>
        <p>1. ارفع محاضرتك في <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">ChatGPT</a> واطلب منه إنشاء الأسئلة باستخدام القالب التالي.</p>
        <div className="ready-prompt-tools">
          <label>عدد الأسئلة المطلوب من ChatGPT
            <select aria-label="عدد الأسئلة لقالب ChatGPT" value={promptCount}
              onChange={e=>setPromptCount(Number(e.target.value))}>
              {[10,20,30,40].map(value=><option key={value} value={value}>{value} سؤالًا</option>)}
            </select>
          </label>
          <button type="button" className="button outline" onClick={()=>void copyChatGptPrompt()}>نسخ طلب إنشاء الأسئلة</button>
        </div>
        <details><summary>عرض نص الطلب الجاهز لنسخه يدويًا</summary>
          <textarea readOnly dir="auto" aria-label="نص طلب إنشاء أسئلة في ChatGPT"
            rows={6} value={makeChatGptPrompt()}/>
        </details>
        <p>2. انسخ الأسئلة والإجابات من المحادثة، ثم الصقها في المربع أدناه.</p>
        <p>3. اضغط «ترتيب الأسئلة وتجهيز الاختبار»، ثم راجع الإجابات وابدأ الاختبار أو احفظه.</p>
      </div>
      <label>اسم المحاضرة / مشروع الاختبار
        <input aria-label="اسم المحاضرة للأسئلة المنسوخة" placeholder="مثال: المحاضرة الرابعة — الرسوم البيانية"
          maxLength={160} value={lectureTitle} onChange={e=>setLectureTitle(e.target.value)}/>
      </label>
      <label>الصق الأسئلة والخيارات والإجابات
        <textarea dir="auto" aria-label="نص الأسئلة المنسوخة من ChatGPT" rows={11}
          placeholder={"1. What does the graph show?\nA) A trend over time\nB) A list of names\nC) A location\nD) A date\nCorrect Answer: A"}
          value={pastedText} onChange={e=>{setPastedText(e.target.value);setDraft(null);setError("");}}/>
      </label>
      <p className="muted small">يقبل الأسئلة المرقمة والخيارات A–D أو أ–د، ومفتاح الإجابات المرفق. لا تحتاج إلى مفتاح Gemini أو OpenAI API.</p>
    </div> : <label className="ready-import-upload">ملف الأسئلة
      <input aria-label="ملف أسئلة جاهزة" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={e=>{setFile(e.target.files?.[0]||null);setDraft(null);setReviewOpen(false);setError("");setNotice("");}} />
    </label>}
    <button type="button" className="button primary"
      disabled={busy || (sourceMode==="file"?!file:!pastedText.trim())} onClick={()=>void parse()}>
      {busy?"جارٍ ترتيب الأسئلة…":sourceMode==="paste"?"ترتيب الأسئلة وتجهيز الاختبار":"استخراج وترتيب الأسئلة"}
    </button>
    {sourceMode==="file" && <p className="muted small">صيغة مناسبة: رقم السؤال وأربعة خيارات A–D أو أ–د، ومفتاح الإجابات في الملف. يمكنك مراجعة كل سؤال قبل اعتماد الاختبار.</p>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {notice && <p className="soft-note" role="status">{notice}</p>}
    {draft && <>
      <div className="ready-import-summary">
        <div>
          <label>عنوان الاختبار
            <input aria-label="عنوان الاختبار المستورد" value={draft.title}
              onChange={e=>setDraft({...draft,title:e.target.value.slice(0,180)})}/>
          </label>
          <p className="small muted">{draft.filename} · {draft.questions.length} سؤالًا · {draft.filename.toLowerCase().endsWith(".txt")?"نص منسوخ من ChatGPT":draft.pages+" "+(draft.filename.toLowerCase().endsWith(".pdf")?"صفحة":"مستند Word")}</p>
        </div>
        <div className="ready-import-stats">
          <strong>{draft.questions.length}</strong><span>سؤال مرتب</span>
          <strong>{missing}</strong><span>دون إجابة معتمدة</span>
        </div>
      </div>
      {draft.warnings.length>0 && <div className="ready-import-warnings" role="status">
        {draft.warnings.map((message,i)=><p key={i}>{message}</p>)}
      </div>}
      <div className={"ready-exam-status"+(missing===0?" is-ready":" needs-answers")} role="status">
        <div>
          <strong>{missing===0?"الاختبار جاهز للطالب":"الاختبار يحتاج اعتماد الإجابات"}</strong>
          <p>{missing===0
            ? "تم ترتيب الأسئلة وتحديد إجاباتها الصحيحة. يستطيع الطالب الآن أداء الاختبار دون رؤية مفتاح الإجابات."
            : "حدد الإجابات الصحيحة الناقصة من شاشة المراجعة؛ لن نمنح درجات بناءً على تخمين."}</p>
          <p className="muted small">
            {draft.questions.length} سؤالًا · الدرجة الكلية 100 ·
            {(100/draft.questions.length).toFixed(2)} درجة لكل سؤال قبل التقريب النهائي
          </p>
        </div>
        {missing===0 && <div className="ready-exam-quick-actions">
          <button type="button" className="button primary"
            onClick={()=>accept(true)}>ابدأ اختبار الطالب الآن</button>
          <button type="button" className="button outline"
            onClick={()=>accept(false)}>حفظ الاختبار للطالب لاحقًا</button>
        </div>}
      </div>
      <button type="button" className="button outline ready-review-toggle"
        aria-expanded={reviewOpen} onClick={()=>setReviewOpen(open=>!open)}>
        {reviewOpen?"إخفاء مراجعة الأسئلة ومفتاح الإجابات":"مراجعة أو تعديل الأسئلة ومفتاح الإجابات"}
      </button>
      {reviewOpen && <div className="ready-import-items">
        <button type="button" className="button outline ready-add-question" disabled={draft.questions.length>=40} onClick={addManualQuestion}>إضافة سؤال يدويًا</button>
        {draft.questions.map((q,i)=><article className="ready-import-question" key={q.number+"-"+i}>
          <div className="ready-import-question-head">
            <strong>السؤال {i+1}</strong>
            <div className="ready-import-order">
              <button type="button" className="button outline" disabled={i===0}
                onClick={()=>swap(i,-1)} aria-label={"نقل السؤال "+(i+1)+" للأعلى"}>↑</button>
              <button type="button" className="button outline" disabled={i===draft.questions.length-1}
                onClick={()=>swap(i,1)} aria-label={"نقل السؤال "+(i+1)+" للأسفل"}>↓</button>
              <button type="button" className="button outline"
                onClick={()=>setDraft({...draft,questions:draft.questions.filter((_,j)=>j!==i)})}
                aria-label={"حذف السؤال "+(i+1)}>حذف</button>
            </div>
          </div>
          <label>نص السؤال
            <textarea aria-label={"نص السؤال المستورد "+(i+1)} dir="auto"
              rows={2} value={q.question} onChange={e=>update(i,{question:e.target.value})}/>
          </label>
          <div className="ready-import-options">
            {q.options.map((answer,index)=><label key={index}>
              <span>{["أ","ب","ج","د"][index]}.</span>
              <input dir="auto" aria-label={"الخيار "+(index+1)+" للسؤال "+(i+1)}
                value={answer} onChange={e=>update(i,{
                  options:q.options.map((value,j)=>j===index?e.target.value:value),
                })}/>
            </label>)}
          </div>
          <label>الإجابة الصحيحة
            <select aria-label={"الإجابة الصحيحة للسؤال "+(i+1)}
              value={q.correct_index===null?"":String(q.correct_index)}
              onChange={e=>update(i,{correct_index:e.target.value===""?null:Number(e.target.value)})}>
              <option value="">غير محددة — تحتاج مراجعة</option>
              {q.options.map((value,index)=><option key={index} value={index}>
                {["أ","ب","ج","د"][index]} — {value.slice(0,70)}
              </option>)}
            </select>
          </label>
          <p className="small muted">{q.correct_index===null?"يجب تحديد الإجابة قبل التصحيح.":"الإجابة محددة، راجع صحتها."}
            {" · "}{draft.filename.toLowerCase().endsWith(".txt")?"من النص المنسوخ":draft.filename.toLowerCase().endsWith(".pdf")?"صفحة "+q.source_page:"من مستند Word"}</p>
        </article>)}
      </div>}
      <div className="ready-import-footer">
        <p className="muted small">يمكن للطالب البدء بعد اكتمال الإجابات الصحيحة. عند إنهاء الجولة تظهر النتيجة من 100، ويمكن إعادة الأسئلة الخاطئة حتى الإجابة عنها مرتين متتاليتين. لاحظ أن مفتاح الإجابات يظهر في وضع المراجعة، لذا أخفه قبل تسليم الجهاز للطالب.</p>
        {missing>0 && <button type="button" className="button outline"
          onClick={()=>setReviewOpen(true)}>الانتقال إلى اعتماد الإجابات الناقصة ({missing})</button>}
      </div>
    </>}
  </section>;
}
