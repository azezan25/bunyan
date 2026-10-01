import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { sharedSection } from '../lib/project';
import { D, Field, Fold, M, Pick, num, useApp } from './ui';

type E = { key: string; kind: 'payment' | 'purchase' | 'refund'; title: string; party: string; sectionId: string; contractorId: string; purchaseId: string; date: string; amount: number; text: string };

export function Ledger({ only }: { only?: 'purchases' }) {
  const { data, open, sectionName } = useApp();
  const [q, setQ] = useState(''); const [kind, setKind] = useState(''); const [cid, setCid] = useState(''); const [sid, setSid] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const all = useMemo<E[]>(() => {
    const out: E[] = [];
    for (const c of data.contractors) for (const p of c.payments) out.push({ key: p.id, kind: 'payment', title: c.name, party: p.notes, sectionId: c.sectionId, contractorId: c.id, purchaseId: '', date: p.date, amount: p.amount, text: `${c.name} ${p.notes}` });
    for (const p of data.purchases) {
      out.push({ key: p.id, kind: 'purchase', title: p.title, party: p.supplier, sectionId: p.sectionId, contractorId: '', purchaseId: p.id, date: p.date, amount: p.amount, text: `${p.title} ${p.supplier} ${p.notes}` });
      for (const r of p.refunds) out.push({ key: r.id, kind: 'refund', title: `استرجاع: ${p.title}`, party: r.notes, sectionId: p.sectionId, contractorId: '', purchaseId: p.id, date: r.date, amount: r.amount, text: `${p.title} ${p.supplier} ${r.notes}` });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);
  const active = !!(q || kind || cid || sid || from || to || min || max);
  const mn = num(min), mx = num(max);
  const res = active ? all.filter(e =>
    (!only || e.kind !== 'payment') && (!kind || e.kind === kind) && (!q || e.text.includes(q.trim())) && (!cid || e.contractorId === cid) && (!sid || e.sectionId === sid) &&
    (!from || e.date >= from) && (!to || e.date <= to) && (isNaN(mn) || e.amount >= mn) && (isNaN(mx) || e.amount <= mx)) : [];
  const kinds: [string, string][] = only ? [['', 'الكل'], ['purchase', 'مشتريات'], ['refund', 'استرجاعات']] : [['', 'الكل'], ['payment', 'دفعات'], ['purchase', 'مشتريات'], ['refund', 'استرجاعات']];
  const reset = () => { setQ(''); setKind(''); setCid(''); setSid(''); setFrom(''); setTo(''); setMin(''); setMax(''); };
  return (
    <div className="paper" style={{ paddingBlock: 4 }}>
      <Fold title="بحث وتصفية" count={active ? `${res.length} نتيجة` : undefined}>
        <label className="field"><span>بحث بالاسم أو المورّد أو الملاحظة</span><div style={{ position: 'relative' }}><input className="inp" value={q} onChange={e => setQ(e.target.value)} /><Search size={16} style={{ position: 'absolute', insetInlineEnd: 12, top: 15, opacity: .5 }} /></div></label>
        <div className="seg">{kinds.map(([v, l]) => <button key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}</button>)}</div>
        <div className="two">
          {!only && <Pick label="المقاول" value={cid} onChange={setCid} options={[['', 'الكل'], ...data.contractors.map(c => [c.id, c.name] as [string, string])]} />}
          <Pick label="القسم" value={sid} onChange={setSid} options={[['', 'الكل'], [sharedSection, 'مواد مشتركة'], ...data.sections.map(s => [s.id, s.name] as [string, string])]} />
          <Field label="من تاريخ" value={from} onChange={setFrom} type="date" /><Field label="إلى تاريخ" value={to} onChange={setTo} type="date" />
          <Field label="أقل مبلغ" value={min} onChange={setMin} type="number" /><Field label="أعلى مبلغ" value={max} onChange={setMax} type="number" />
        </div>
        {active && <button className="btn sm soft" onClick={reset}>مسح التصفية</button>}
        {active && !res.length && <div className="empty">لا نتائج مطابقة</div>}
        {res.slice(0, 60).map(e => (
          <button key={e.kind + e.key} className="rowline" onClick={() => e.contractorId ? open('c', e.contractorId) : open('p', e.purchaseId)}>
            <div className="grow"><div className="t">{e.title}</div><div className="s">{e.kind === 'payment' ? 'دفعة' : e.kind === 'purchase' ? 'شراء' : 'استرجاع'} · {e.sectionId === sharedSection ? 'مواد مشتركة' : sectionName(e.sectionId)} · <D v={e.date} /></div></div>
            <div className={`a ${e.kind === 'refund' ? 'credit' : ''}`}><M v={e.amount} /></div>
          </button>
        ))}
      </Fold>
    </div>
  );
}
