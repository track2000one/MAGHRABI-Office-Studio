import {useState} from "react";
import {api} from "./api";

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
  const [draft,setDraft]=useState<ReadyImport|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const missing=draft?.questions.filter(q=>q.correct_index===null).length || 0;

  async function parse() {
    if (!file) {setError("اختر ملف الأسئلة أولًا.");return;}
    if (!/\.(pdf|docx)$/i.test(file.name)) {setError("استخدم ملف PDF أو DOCX.");return;}
    if (file.size>8*1024*1024 || !file.size) {setError("حجم الملف يجب أن يكون بين 1 بايت و8 ميجابايت.");return;}
    setBusy(true);
    setDraft(null);
    setError("");
    setNotice("");
    try {
      const body=new FormData();
      body.append("file",file);
      const parsed:ReadyImport=await (await api("/quiz/import",{method:"POST",body})).json();
      setDraft(parsed);
      setNotice("تم ترتيب "+parsed.questions.length+" سؤالًا. راجع الأسئلة وخياراتها، ثم احفظ الاختبار.");
    } catch(e) {
      setError(e instanceof Error?e.message:"تعذر تحليل ملف الأسئلة.");
    } finally {setBusy(false);}
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
    <h3>تنسيق أسئلة جاهزة من Word أو PDF</h3>
    <p className="muted small">ارفع ملفًا يحتوي على أسئلة متعددة الخيارات جاهزة، وسنرتبها دون توليد أو تغيير محتواها بالذكاء الاصطناعي. حتى 40 سؤالًا لكل اختبار.</p>
    <label className="ready-import-upload">ملف الأسئلة
      <input aria-label="ملف أسئلة جاهزة" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={e=>{setFile(e.target.files?.[0]||null);setDraft(null);setError("");setNotice("");}} />
    </label>
    <button type="button" className="button primary" disabled={!file||busy} onClick={()=>void parse()}>
      {busy?"جارٍ استخراج وترتيب الأسئلة…":"استخراج وترتيب الأسئلة"}
    </button>
    <p className="muted small">صيغة مناسبة: رقم السؤال، ثم أربعة خيارات A–D أو أ–د. يمكن إرفاق مفتاح الإجابات داخل الأسئلة أو في نهايتها. يُراجع المستخدم النتيجة قبل اعتمادها.</p>
    {error && <p className="banner error" role="alert">{error}</p>}
    {notice && <p className="soft-note" role="status">{notice}</p>}
    {draft && <>
      <div className="ready-import-summary">
        <div>
          <label>عنوان الاختبار
            <input aria-label="عنوان الاختبار المستورد" value={draft.title}
              onChange={e=>setDraft({...draft,title:e.target.value.slice(0,180)})}/>
          </label>
          <p className="small muted">{draft.filename} · {draft.questions.length} سؤالًا · {draft.pages} {draft.filename.toLowerCase().endsWith(".pdf")?"صفحة":"مستند Word"}</p>
        </div>
        <div className="ready-import-stats">
          <strong>{draft.questions.length}</strong><span>سؤال مرتب</span>
          <strong>{missing}</strong><span>دون إجابة معتمدة</span>
        </div>
      </div>
      {draft.warnings.length>0 && <div className="ready-import-warnings" role="status">
        {draft.warnings.map((message,i)=><p key={i}>{message}</p>)}
      </div>}
      <div className="ready-import-items">
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
            {" · "}{draft.filename.toLowerCase().endsWith(".pdf")?"صفحة "+q.source_page:"من مستند Word"}</p>
        </article>)}
      </div>
      <div className="ready-import-footer">
        <p className="muted small">قبل الاعتماد: راجع الأرقام والنصوص والمفاتيح، خصوصًا في الملفات متعددة الأعمدة أو المصورة. لن تُفترض إجابة صحيحة إذا لم تتوفر في الملف.</p>
        <button type="button" className="button outline" disabled={missing>0||!draft.questions.length||!draft.title.trim()}
          onClick={()=>accept(false)}>حفظ الاختبار في اختباراتي</button>
        <button type="button" className="button primary" disabled={missing>0||!draft.questions.length||!draft.title.trim()}
          onClick={()=>accept(true)}>حفظ وبدء حل الاختبار</button>
      </div>
    </>}
  </section>;
}
