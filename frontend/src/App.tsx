import { useMemo, useRef, useState } from 'react'

type OfficeType = 'word' | 'excel' | 'powerpoint'

type FileItem = {
  id: string
  name: string
  size: string
  type: OfficeType
  score: number
}

const modules = [
  { key: 'word' as const, title: 'Word', subtitle: 'تنسيق المستندات والفقرات والجداول', icon: 'W', accept: '.docx' },
  { key: 'excel' as const, title: 'Excel', subtitle: 'تنسيق الجداول والبيانات والطباعة', icon: 'X', accept: '.xlsx' },
  { key: 'powerpoint' as const, title: 'PowerPoint', subtitle: 'توحيد الشرائح والمحاذاة والعناصر', icon: 'P', accept: '.pptx' },
]

const recentSeed: FileItem[] = [
  { id: '1', name: 'محضر اجتماع الإدارة.docx', size: '428 KB', type: 'word', score: 92 },
  { id: '2', name: 'تقرير المؤشرات.xlsx', size: '1.8 MB', type: 'excel', score: 86 },
  { id: '3', name: 'العرض التنفيذي.pptx', size: '4.2 MB', type: 'powerpoint', score: 78 },
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function getType(name: string): OfficeType | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) return 'word'
  if (lower.endsWith('.xlsx')) return 'excel'
  if (lower.endsWith('.pptx')) return 'powerpoint'
  return null
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>(recentSeed)
  const [active, setActive] = useState<'home' | OfficeType | 'templates' | 'history'>('home')
  const inputRef = useRef<HTMLInputElement>(null)

  const activeModule = useMemo(() => modules.find((item) => item.key === active), [active])

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const next: FileItem[] = []
    Array.from(incoming).forEach((file) => {
      const type = getType(file.name)
      if (!type) return
      next.push({
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        size: formatBytes(file.size),
        type,
        score: 0,
      })
    })
    if (next.length) setFiles((current) => [...next, ...current])
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MAGHRABI</strong>
            <span>Office Studio</span>
          </div>
        </div>

        <nav className="nav-list">
          <button className={active === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('home')}>⌂ <span>الرئيسية</span></button>
          <button className={active === 'word' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('word')}>W <span>Word</span></button>
          <button className={active === 'excel' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('excel')}>X <span>Excel</span></button>
          <button className={active === 'powerpoint' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('powerpoint')}>P <span>PowerPoint</span></button>
          <div className="nav-separator" />
          <button className={active === 'templates' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('templates')}>▦ <span>القوالب</span></button>
          <button className={active === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('history')}>◷ <span>سجل الملفات</span></button>
        </nav>

        <div className="sidebar-note">
          <span className="status-dot" />
          <div>
            <strong>Document Engine</strong>
            <small>V0.1 جاهز للتطوير</small>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">منصة تنسيق ومعالجة ملفات Office</p>
            <h1>{activeModule ? activeModule.title : active === 'templates' ? 'القوالب' : active === 'history' ? 'سجل الملفات' : 'لوحة التحكم'}</h1>
          </div>
          <div className="top-actions">
            <button className="ghost-btn">العربية ▾</button>
            <div className="avatar">MG</div>
          </div>
        </header>

        <section className="hero-card">
          <div className="hero-copy">
            <span className="ai-pill">✦ Smart Formatting Engine</span>
            <h2>حوّل ملفات Office إلى مستندات مرتبة واحترافية.</h2>
            <p>ارفع ملف Word أو Excel أو PowerPoint، ثم افحص جودة التنسيق وطبّق التحسينات آليًا مع دعم كامل للعربية وRTL.</p>
            <div className="hero-actions">
              <button className="primary-btn" onClick={() => inputRef.current?.click()}>رفع ملف جديد</button>
              <button className="secondary-btn" onClick={() => setActive('templates')}>استعراض القوالب</button>
            </div>
          </div>
          <div className="score-card">
            <div className="score-ring"><strong>96</strong><span>/100</span></div>
            <div>
              <strong>Document Health</strong>
              <p>قياس جودة التنسيق قبل وبعد التحسين.</p>
            </div>
          </div>
        </section>

        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">ابدأ حسب نوع الملف</p>
              <h3>أدوات Office</h3>
            </div>
          </div>
          <div className="module-grid">
            {modules.map((module) => (
              <button key={module.key} className={`module-card ${module.key}`} onClick={() => setActive(module.key)}>
                <div className="module-icon">{module.icon}</div>
                <div>
                  <h4>{module.title}</h4>
                  <p>{module.subtitle}</p>
                </div>
                <span className="arrow">←</span>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-grid">
          <div className="upload-panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">رفع وتحليل</p>
                <h3>{activeModule ? `ملفات ${activeModule.title}` : 'ملف جديد'}</h3>
              </div>
              <span className="secure-label">✓ آمن</span>
            </div>
            <div
              className="dropzone"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                addFiles(event.dataTransfer.files)
              }}
            >
              <div className="upload-icon">⇧</div>
              <strong>اسحب الملف هنا أو اضغط للاختيار</strong>
              <span>DOCX · XLSX · PPTX</span>
            </div>
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              accept={activeModule?.accept ?? '.docx,.xlsx,.pptx'}
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>

          <div className="features-panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">المحرك الذكي</p>
                <h3>ما الذي سنفحصه؟</h3>
              </div>
            </div>
            <div className="feature-list">
              {['العناوين ومستويات الترقيم', 'الخطوط والأحجام والتباعد', 'الجداول والمحاذاة والحدود', 'الهوامش واتجاه RTL/LTR', 'تناسق المستند كاملًا'].map((item) => (
                <div className="feature-row" key={item}><span>✓</span><p>{item}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="recent-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">آخر النشاطات</p>
              <h3>الملفات الأخيرة</h3>
            </div>
            <button className="text-btn" onClick={() => setActive('history')}>عرض الكل</button>
          </div>
          <div className="file-table">
            {files.slice(0, 5).map((file) => (
              <div className="file-row" key={file.id}>
                <div className={`file-badge ${file.type}`}>{file.type === 'word' ? 'W' : file.type === 'excel' ? 'X' : 'P'}</div>
                <div className="file-name"><strong>{file.name}</strong><span>{file.size}</span></div>
                <div className="file-score">{file.score ? <><span className="status-dot" /> جودة {file.score}%</> : 'بانتظار التحليل'}</div>
                <button className="row-btn">فتح</button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
