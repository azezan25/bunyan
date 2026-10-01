import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Settings as Cog, ShoppingBag, Users } from 'lucide-react';
import VaultGate from './components/VaultGate';
import type { VaultSession } from './lib/vault';
import { backupDue, contractIsFinal, emptyProject, isProjectData, totals, type ProjectData } from './lib/project';
import { Ctx, M, Sheet, useApp, type AppCtx, type AskOpts } from './components/ui';
import { ContractorDetail, ContractorList } from './components/Accounts';
import { PurchaseDetail, PurchaseList } from './components/Purchases';
import { Ledger } from './components/Ledger';
import { Settings } from './components/Settings';

const base = import.meta.env.BASE_URL;
const Logo = () => <img src={`${base}logo.svg`} alt="بنيان" onError={e => { e.currentTarget.style.display = 'none'; }} />;

function Overview({ onSettings }: { onSettings: () => void }) {
  const { data } = useApp();
  const t = totals(data);
  const has = data.contractors.length + data.purchases.length > 0;
  const final = has && t.final;
  return (
    <>
      {backupDue(data) && <div className="note">حان وقت أخذ نسخة احتياطية. <button className="btn sm" style={{ marginInlineStart: 8 }} onClick={onSettings}>افتح الإعدادات</button></div>}
      <div className="paper hero">
        <div className="lbl">إجمالي التكلفة <span className="tag">{final ? 'نهائي' : 'مؤقت'}</span></div>
        <div className="big"><M v={t.total} /></div>
        <div className="row"><div><span className="lbl">المدفوع</span><b><M v={t.paid} /></b></div>
          <div><span className="lbl">{t.remaining < 0 ? 'رصيد دائن (دفعت مقدماً)' : 'المتبقي'}</span><b><M v={Math.abs(t.remaining)} /></b></div></div>
      </div>
      {!has && <div className="paper"><div className="empty"><b>الدفتر فارغ</b>ابدأ من «الحسابات» بإضافة مقاول، أو من «المشتريات» بتسجيل أول شراء.</div></div>}
      {data.contractors.length > 0 && <p className="muted" style={{ fontSize: 12, padding: '0 4px' }}>{data.contractors.filter(contractIsFinal).length} من {data.contractors.length} حسابات نهائية.</p>}
      <Ledger />
    </>
  );
}

function Shell({ session }: { session: VaultSession<ProjectData> }) {
  const [data, setData] = useState(session.data);
  const [tab, setTab] = useState<'o' | 'a' | 'p'>('o');
  const [detail, setDetail] = useState<{ t: 'c' | 'p'; id: string } | null>(null);
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState('');
  const [dlg, setDlg] = useState<(AskOpts & { res: (v: boolean) => void }) | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const dataRef = useRef(data); dataRef.current = data;
  const saveRef = useRef(session.save); saveRef.current = session.save;
  useEffect(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; }, []);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(''), 6000); return () => clearTimeout(h); }, [toast]);

  const commit = useCallback<AppCtx['commit']>((fn, o) => {
    pending.current += 1; setBusy(true);
    const job = queue.current.then(async () => {
      try {
      const next = structuredClone(dataRef.current);
      fn(next);
      if (!o?.countless) next.backupChangeCount += 1;
      if (!isProjectData(next)) throw new Error('بيانات غير صالحة: تحقق من المبالغ (لا سالب، والمسترجع لا يتجاوز الشراء)');
      await saveRef.current(next);
      setData(next); dataRef.current = next;
      return true;
      } catch (e) { setToast(`لم يُحفظ التغيير. ${e instanceof Error ? e.message : ''}`); return false; }
    }).finally(() => { pending.current -= 1; if (!pending.current) setBusy(false); });
    queue.current = job;
    return job;
  }, []);
  const replaceData = useCallback<AppCtx['replaceData']>((candidate) => {
    pending.current += 1; setBusy(true);
    const job = queue.current.then(async () => {
      try {
        if (!isProjectData(candidate)) throw new Error('بيانات النسخة غير صالحة');
        await saveRef.current(candidate);
        setData(candidate); dataRef.current = candidate;
        setDetail(null); setTab('o');
        return true;
      } catch (e) { setToast(`لم تُستعد النسخة. ${e instanceof Error ? e.message : ''}`); return false; }
    }).finally(() => { pending.current -= 1; if (!pending.current) setBusy(false); });
    queue.current = job;
    return job;
  }, []);
  const ask = useCallback((o: AskOpts) => new Promise<boolean>(res => setDlg({ ...o, res })), []);
  const ctx: AppCtx = { busy, replaceData, data, commit, ask, open: (t, id) => setDetail({ t, id }), sectionName: id => data.sections.find(s => s.id === id)?.name ?? 'مواد مشتركة' };
  const answer = (v: boolean) => { dlg?.res(v); setDlg(null); };

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <div className="head"><Logo /><h1>{data.name}<small>بنيان · دفتر الدور الإضافي</small></h1>
          <button className="icon-btn" aria-label="الإعدادات" onClick={() => setSettings(true)}><Cog size={19} /></button></div>
        {tab === 'o' && <Overview onSettings={() => setSettings(true)} />}
        {tab === 'a' && <ContractorList />}
        {tab === 'p' && <PurchaseList />}
      </div>
      <nav className="nav"><div>
        {([['o', 'نظرة عامة', BookOpen], ['a', 'الحسابات', Users], ['p', 'المشتريات', ShoppingBag]] as const).map(([k, l, I]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={20} />{l}</button>)}
      </div></nav>
      {toast && <div className="toast err" role="alert" onClick={() => setToast('')}>{toast}</div>}
      {detail?.t === 'c' && <ContractorDetail id={detail.id} onClose={() => setDetail(null)} />}
      {detail?.t === 'p' && <PurchaseDetail id={detail.id} onClose={() => setDetail(null)} />}
      {settings && <Settings session={session} onClose={() => setSettings(false)} />}
      {dlg && (
        <Sheet center title={dlg.title} onClose={() => answer(false)}>
          <p style={{ lineHeight: 1.8, marginTop: 0 }}>{dlg.body}</p>
          <div className="actions"><button className={`btn ${dlg.danger ? 'dangerfill' : ''}`} style={{ flex: 1 }} onClick={() => answer(true)}>{dlg.confirm ?? 'تأكيد'}</button><button className="btn soft" onClick={() => answer(false)}>إلغاء</button></div>
        </Sheet>
      )}
    </Ctx.Provider>
  );
}

function App() {
  return <VaultGate initialData={emptyProject()} validateData={isProjectData}>{session => <Shell session={session} />}</VaultGate>;
}
export default App;
