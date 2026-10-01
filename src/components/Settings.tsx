import { useRef, useState } from 'react';
import { Download, Lock, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { VaultSession } from '../lib/vault';
import { dateLabel, isProjectData, uid, type ProjectData } from '../lib/project';
import { Field, Fold, Sheet, useApp } from './ui';

export function Settings({ session, onClose }: { session: VaultSession<ProjectData>; onClose: () => void }) {
  const { data, commit, ask, busy, replaceData } = useApp();
  const [working, setWorking] = useState(false);
  const off = busy || working;
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);
  const [name, setName] = useState(data.name); const [newSec, setNewSec] = useState('');
  const [cur, setCur] = useState(''); const [nxt, setNxt] = useState(''); const [file, setFile] = useState<File | null>(null); const [rpw, setRpw] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const say = (m: string, b = false) => { setMsg(m); setBad(b); };
  const legacy = typeof localStorage !== 'undefined' && localStorage.getItem('binaa-project-v1') !== null;
  const run = async (f: () => Promise<void | boolean>, ok: string) => { if (working) return; setWorking(true); try { if ((await f()) === false) { setMsg(''); return; } say(ok); } catch (e) { say(e instanceof Error ? e.message : 'تعذّر تنفيذ العملية', true); } finally { setWorking(false); } };
  const used = (id: string) => data.contractors.some(c => c.sectionId === id) || data.purchases.some(p => p.sectionId === id);
  return (
    <Sheet title="الإعدادات" onClose={onClose}>
      {msg && <div className={bad ? 'err' : 'note'} role="status">{msg}</div>}
      <Fold title="اسم المشروع" open>
        <Field label="الاسم" value={name} onChange={setName} />
        <button className="btn sm" disabled={!name.trim() || name === data.name || off} onClick={() => run(async () => { if (!(await commit(d => { d.name = name.trim(); }))) throw new Error('لم يُحفظ'); }, 'تم الحفظ')}>حفظ الاسم</button>
      </Fold>
      <Fold title="النسخ الاحتياطي">
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>آخر نسخة: {data.lastBackup ? dateLabel(data.lastBackup.slice(0, 10)) : 'لم تؤخذ بعد'} · تغييرات منذ آخر نسخة: {data.backupChangeCount}. التذكير كل 7 أيام أو 5 تغييرات. النسخة مشفّرة وتشمل المرفقات.</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn" disabled={off} onClick={() => run(async () => { await session.exportBackup(); if (!(await commit(d => { d.lastBackup = new Date().toISOString(); d.backupChangeCount = 0; }, { countless: true }))) throw new Error('تم التصدير لكن تعذّر تحديث تاريخ النسخة'); }, 'تم تصدير النسخة')}><Download size={16} />تصدير نسخة</button>
        </div>
        <div style={{ marginTop: 16 }}>
          <input ref={fileRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn soft" onClick={() => fileRef.current?.click()}><Upload size={16} />{file ? file.name : 'اختيار ملف نسخة'}</button>
          {file && <>
            <Field label="كلمة مرور النسخة" value={rpw} onChange={setRpw} type="password" />
            <button className="btn danger" disabled={!rpw || off} onClick={() => run(async () => {
              if (!(await ask({ title: 'استعادة نسخة', body: 'ستُستبدل كل البيانات الحالية بمحتوى النسخة.', confirm: 'استعد', danger: true }))) return false;
              const d = await session.restoreBackup(file, rpw);
              if (!isProjectData(d)) throw new Error('الملف ليس نسخة صالحة');
              if (!(await replaceData(d))) throw new Error('تعذّر حفظ النسخة المستعادة. بقيت بياناتك الحالية.');
              setFile(null); setRpw(''); onClose(); return false;
            }, 'تمت الاستعادة')}>استعادة</button></>}
        </div>
      </Fold>
      <Fold title="الأقسام">
        {data.sections.map(s => (
          <div key={s.id} className="rowline">
            <div className="grow t">{s.name}{used(s.id) && <span className="s">مستخدم</span>}</div>
            <button className="icon-btn" aria-label="تعديل" onClick={() => { const n = prompt('اسم القسم', s.name)?.trim(); if (n) void commit(d => { d.sections.find(x => x.id === s.id)!.name = n; }); }}><Pencil size={15} /></button>
            <button className="icon-btn" aria-label="حذف" disabled={used(s.id)} onClick={async () => { if (await ask({ title: 'حذف القسم', body: `حذف «${s.name}»؟`, confirm: 'احذف', danger: true })) void commit(d => { d.sections = d.sections.filter(x => x.id !== s.id); }); }}><Trash2 size={15} /></button>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>لا يُحذف إلا قسم غير مرتبط بحساب أو شراء.</div>
        <div className="two" style={{ alignItems: 'end' }}><Field label="قسم جديد" value={newSec} onChange={setNewSec} /><button className="btn" style={{ marginBottom: 12 }} disabled={!newSec.trim()} onClick={() => { void commit(d => { d.sections.push({ id: uid(), name: newSec.trim() }); }).then(ok => ok && setNewSec('')); }}><Plus size={16} />إضافة</button></div>
      </Fold>
      <Fold title="كلمة المرور">
        <Field label="الحالية" value={cur} onChange={setCur} type="password" />
        <Field label="الجديدة" value={nxt} onChange={setNxt} type="password" />
        <button className="btn sm" disabled={!cur || nxt.length < 8 || off} onClick={() => run(async () => { await session.changePassword(cur, nxt); setCur(''); setNxt(''); }, 'تم تغيير كلمة المرور')}>تغيير</button>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>8 أحرف على الأقل.</div>
      </Fold>
      <Fold title="تثبيت على الآيفون">
        <ol style={{ lineHeight: 2, paddingInlineStart: 20, margin: 0, fontSize: 14 }}>
          <li>افتح الموقع في سفاري.</li><li>اضغط زر المشاركة.</li><li>اختر «إضافة إلى الشاشة الرئيسية».</li><li>اضغط «إضافة»، ثم افتح «بنيان» من الشاشة الرئيسية.</li>
        </ol>
      </Fold>
      {legacy && <div className="note" style={{ marginTop: 14 }}>توجد بيانات تجريبية قديمة محفوظة في المتصفح بمعزل عن هذا الدفتر. لم تُحذف ولم تُدمج.</div>}
      <div className="actions"><button className="btn soft block" onClick={() => session.lock()}><Lock size={16} />قفل الدفتر</button></div>
    </Sheet>
  );
}
