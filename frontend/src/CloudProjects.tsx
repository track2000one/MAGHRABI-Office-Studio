import {useEffect, useRef, useState} from "react";
import {api, ApiError, jsonBody} from "./api";
import type {Content, Format} from "./api";

export type CloudRecord = {
  id: string;
  date: string;
  updatedAt?: string;
  content: Content;
  format?: Format;
  stage?: "outline" | "edit";
  context?: object;
  version?: number;
};
export type CloudAccount = {
  available: boolean;
  authenticated: boolean;
  setup_required: boolean;
  email?: string;
  role?: "owner" | "member";
};
const unsigned: CloudAccount = {available: false, authenticated: false, setup_required: false};

export function useCloudWorkspace() {
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [projects, setProjects] = useState<CloudRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState("");
  const revisionRef = useRef(new Map<string, number>());
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  async function refresh() {
    try {
      const status: CloudAccount = await (await api("/account/status")).json();
      setAccount(status);
      if (status.authenticated) {
        const data: {projects: CloudRecord[]} = await (await api("/projects")).json();
        setProjects(data.projects);
        revisionRef.current = new Map(data.projects.map(project => [project.id, project.version || 0]));
      } else {
        setProjects([]);
        revisionRef.current.clear();
      }
      setError("");
      return status;
    } catch (err) {
      setAccount(unsigned);
      setProjects([]);
      setError(err instanceof Error ? err.message : "تعذر الاتصال بخدمة الحسابات.");
      return unsigned;
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function action(path: string, payload: object) {
    setBusy(true);
    setError("");
    try {
      const result = await (await api(path, jsonBody(payload))).json();
      await refresh();
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : "تعذر إكمال العملية.";
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("/account/logout", {method: "POST"});
      setProjects([]);
      revisionRef.current.clear();
      setInvitation("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل الخروج.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function invite() {
    setBusy(true);
    setInvitation("");
    try {
      const result: {invitation: string} = await (await api("/account/invite", {method: "POST"})).json();
      setInvitation(result.invitation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء الدعوة.");
    } finally {
      setBusy(false);
    }
  }
  async function save(input: CloudRecord): Promise<CloudRecord> {
    const task = async () => {
      if (!account?.authenticated) throw new Error("سجل الدخول لحفظ المشاريع في السحابة.");
      const revision = revisionRef.current.get(input.id) ?? input.version ?? 0;
      const data = {...input, version: revision};
      try {
        const response = await api("/projects/" + encodeURIComponent(input.id), {
          method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data),
        });
        const stored: CloudRecord = await response.json();
        revisionRef.current.set(stored.id, stored.version || 0);
        setProjects(current =>
          [stored, ...current.filter(item => item.id !== stored.id)]
            .sort((a,b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date)));
        return stored;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setError("توجد نسخة أحدث لهذا المشروع أو تعارض مع جهاز آخر. لا تُكتب التعديلات فوقها تلقائيًا. يمكنك تصدير نسخة محلية ثم تحديث المشاريع.");
        } else if (err instanceof Error) setError(err.message);
        throw err;
      }
    };
    const next = saveQueueRef.current.then(task);
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }
  async function remove(id: string) {
    await api("/projects/" + encodeURIComponent(id), {method: "DELETE"});
    setProjects(items => items.filter(p => p.id !== id));
    revisionRef.current.delete(id);
  }

  return {account, projects, busy, error, invitation, refresh, action,
          logout, invite, save, remove, setError};
}

type CloudPanelProps = {
  cloud: ReturnType<typeof useCloudWorkspace>;
  localProjects: CloudRecord[];
  onOpen: (project: CloudRecord) => void;
  onImport: (projects: CloudRecord[]) => Promise<void>;
};

export function CloudProjectsPanel({cloud, localProjects, onOpen, onImport}: CloudPanelProps) {
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [setupToken,setSetupToken] = useState("");
  const [inviteCode,setInviteCode] = useState("");
  const [mode,setMode] = useState<"login" | "register">("login");
  const [search,setSearch] = useState("");
  const [confirmImport,setConfirmImport] = useState(false);
  const [confirmDelete,setConfirmDelete] = useState("");
  const [formError,setFormError] = useState("");
  const [busy,setBusy] = useState(false);

  async function submitAccount() {
    setFormError("");
    if (password.length < 12 || !email.trim()) {
      setFormError("أدخل بريدًا إلكترونيًا وكلمة مرور من 12 حرفًا على الأقل.");
      return;
    }
    const endpoint = cloud.account?.setup_required ? "/account/bootstrap"
      : mode === "register" ? "/account/register" : "/account/login";
    const payload = {email: email.trim(), password, ...(endpoint.endsWith("bootstrap")
      ? {setup_token: setupToken} : endpoint.endsWith("register") ? {invitation: inviteCode} : {})};
    setBusy(true);
    try {
      await cloud.action(endpoint, payload);
      setPassword("");
      setSetupToken("");
      setInviteCode("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }
  async function importLocal() {
    setBusy(true);
    setFormError("");
    try {
      await onImport(localProjects);
      setConfirmImport(false);
    } catch(err) {
      setFormError(err instanceof Error ? err.message : "تعذر نسخ المشاريع إلى الحساب.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel cloud-panel" aria-label="المشاريع السحابية">
      <div className="cloud-panel-heading">
        <div>
          <h2>المشاريع السحابية</h2>
          <p className="muted small">حساب مستقل لكل مستخدم، وحفظ في PostgreSQL وإمكانية المتابعة من الأجهزة الأخرى.</p>
        </div>
        {cloud.account?.authenticated && <span className="cloud-connected">متصل بالسحابة</span>}
      </div>
      {cloud.account === null ? <p>جارٍ التحقق من الحساب السحابي…</p>
      : !cloud.account.available ? (
        <p className="muted">الاتصال بالمشاريع السحابية غير متاح حاليًا. تبقى المشاريع المحلية آمنة على هذا المتصفح.</p>
      ) : !cloud.account.authenticated ? (
        <div className="cloud-account-form">
          <h3>{cloud.account.setup_required ? "تهيئة حساب المدير لأول مرة" :
            mode === "login" ? "تسجيل الدخول إلى حساب المشاريع" : "إنشاء حساب بدعوة"}</h3>
          <form onSubmit={e => {e.preventDefault(); void submitAccount();}}>
            <label>البريد الإلكتروني
              <input aria-label="بريد الحساب السحابي" type="email" autoComplete="username"
                maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} required />
            </label>
            <label>كلمة المرور
              <input aria-label="كلمة مرور الحساب السحابي" type="password" autoComplete={cloud.account.setup_required || mode==="register"?"new-password":"current-password"}
                value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128} />
            </label>
            {cloud.account.setup_required && (
              <label>رمز التهيئة الأولية (STUDIO_ACCESS_TOKEN من Railway)
                <input aria-label="رمز تهيئة المدير" type="password" value={setupToken} maxLength={512} onChange={e=>setSetupToken(e.target.value)} required />
              </label>
            )}
            {!cloud.account.setup_required && mode === "register" && (
              <label>رمز الدعوة الذي أرسله مدير المنصة
                <input aria-label="رمز دعوة المستخدم" value={inviteCode} maxLength={512} onChange={e=>setInviteCode(e.target.value)} required />
              </label>
            )}
            {formError && <p role="alert" className="error-message">{formError}</p>}
            <button type="submit" className="button primary" disabled={busy || cloud.busy}>
              {cloud.account.setup_required ? "إنشاء حساب المدير" : mode === "login" ? "دخول المشاريع السحابية" : "إنشاء حسابي"}
            </button>
            {!cloud.account.setup_required && (
              <button type="button" className="text-button" onClick={()=>{setMode(mode==="login"?"register":"login");setFormError("");}}>
                {mode==="login"?"لديك دعوة؟ إنشاء حساب":"لديك حساب؟ تسجيل الدخول"}
              </button>
            )}
          </form>
          {cloud.account.setup_required && <p className="muted small">رمز التهيئة يُستخدم لإنشاء أول حساب مدير مرة واحدة فقط، ولا يُحفظ في المتصفح. لا تشارك الرمز في المحادثة.</p>}
        </div>
      ) : (
        <>
          <div className="cloud-account-actions">
            <span className="muted">الحساب: <strong>{cloud.account.email}</strong> · {cloud.account.role==="owner"?"مدير":"مستخدم"}</span>
            <button className="button outline" type="button" onClick={()=>void cloud.refresh()}>تحديث المشاريع السحابية</button>
            <button className="button outline" type="button" onClick={()=>void cloud.logout()}>تسجيل خروج الحساب</button>
          </div>
          {cloud.account.role === "owner" && (
            <div className="cloud-invitation">
              <button className="button outline" type="button" disabled={cloud.busy} onClick={()=>void cloud.invite()}>إصدار دعوة لمستخدم جديد</button>
              {cloud.invitation && <p className="small">رمز الدعوة (صالح لمدة 7 أيام، للاستخدام مرة واحدة): <code dir="ltr">{cloud.invitation}</code> <button type="button" className="text-button" onClick={()=>navigator.clipboard?.writeText(cloud.invitation)}>نسخ الرمز</button></p>}
            </div>
          )}
          <div className="cloud-account-actions">
            <strong>مشاريعي السحابية ({cloud.projects.length})</strong>
            <label>البحث في السحابة
              <input aria-label="البحث في المشاريع السحابية" value={search} onChange={e=>setSearch(e.target.value)} placeholder="عنوان المشروع" />
            </label>
          </div>
          {cloud.projects.filter(p=>p.content.title.toLowerCase().includes(search.toLowerCase())).length ? (
            <div className="project-grid cloud-project-grid">
              {cloud.projects.filter(p=>p.content.title.toLowerCase().includes(search.toLowerCase())).map(p=>(
                <div className="panel project-card" key={p.id}>
                  <h3>{p.content.title || "مشروع بدون عنوان"}</h3>
                  <p className="muted small">{p.format==="docx"?"Word":"PowerPoint"} · آخر تعديل: {new Date(p.updatedAt||p.date).toLocaleString("ar-SA")}</p>
                  <div className="action-row">
                    <button className="button outline" onClick={()=>onOpen(p)}>فتح وتحرير من السحابة</button>
                    <button className="text-button danger" onClick={()=>setConfirmDelete(p.id)}>حذف</button>
                  </div>
                  {confirmDelete===p.id && (
                    <div className="delete-confirm">
                      <p>حذف هذا المشروع من حسابك السحابي؟</p>
                      <button className="button outline" onClick={()=>setConfirmDelete("")}>إلغاء</button>
                      <button className="button danger" onClick={()=>void cloud.remove(p.id).then(()=>setConfirmDelete("")).catch(e=>setFormError(String(e)))}>تأكيد الحذف السحابي</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="muted">لا توجد مشاريع سحابية مطابقة. أنشئ مشروعًا جديدًا أو ارفع مشاريعك المحلية.</p>}
          {localProjects.length>0 && <div className="cloud-import-local">
            <p>لديك {localProjects.length} مشروع محلي في هذا المتصفح. يمكنك نسخها إلى حسابك السحابي دون حذف الأصل.</p>
            {!confirmImport ? <button className="button outline" onClick={()=>setConfirmImport(true)}>نقل نسخة من مشاريعي المحلية للسحابة</button>
              : <div className="action-row">
                  <button className="button primary" disabled={busy} onClick={()=>void importLocal()}>تأكيد نسخ المشاريع إلى السحابة</button>
                  <button className="button outline" onClick={()=>setConfirmImport(false)}>إلغاء</button>
                </div>}
          </div>}
        </>
      )}
      {(cloud.error || formError) && <p role="alert" className="error-message">{cloud.error || formError}</p>}
    </section>
  );
}
