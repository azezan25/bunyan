import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { duplicatePurchase, purchaseNet, sharedSection, today, uid, type Attachment, type Purchase, type Refund } from '../lib/project';
import { Area, Attach, D, Empty, Field, Fold, M, Pick, Sheet, num, useApp } from './ui';
import { Ledger } from './Ledger';

export function PurchaseList() {
  const { data, open } = useApp();
  const [adding, setAdding] = useState(false);
  const sorted = [...data.purchases].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Ledger only="purchases" />
      <div className="paper">
        {!sorted.length && <Empty title="لا مشتريات بعد" hint="سجّل ما اشتريته مباشرة لقسم معين أو كمواد مشتركة. تُحسب مدفوعة بالكامل." />}
        {sorted.map(p => (
          <button key={p.id} className="rowline" onClick={() => open('p', p.id)}>
            <div className="grow"><div className="t">{p.title}</div>
              <div className="s">{p.supplier || 'بدون مورّد'} · {p.sectionId === sharedSection ? 'مواد مشتركة' : data.sections.find(s => s.id === p.sectionId)?.name} · <D v={p.date} />{p.refunds.length ? ` · ${p.refunds.length} استرجاع` : ''}</div></div>
            <div className="a"><M v={purchaseNet(p)} /></div>
          </button>
        ))}
      </div>
      <button className="btn fab" onClick={() => setAdding(true)}><Plus size={18} />شراء جديد</button>
      {adding && <PurchaseForm onClose={() => setAdding(false)} />}
    </>
  );
}

export function PurchaseForm({ id, onClose, onDone }: { id?: string; onClose: () => void; onDone?: () => void }) {
  const { data, commit, ask, busy } = useApp();
  const p = data.purchases.find(x => x.id === id);
  const [title, setTitle] = useState(p?.title ?? ''); const [supplier, setSupplier] = useState(p?.supplier ?? '');
  const [sectionId, setSection] = useState(p?.sectionId ?? sharedSection); const [amt, setAmt] = useState(p ? String(p.amount) : '');
  const [date, setDate] = useState(p?.date ?? today()); const [notes, setNotes] = useState(p?.notes ?? '');
  const [att, setAtt] = useState<Attachment[]>(p?.attachments ?? []); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = num(amt);
    if (!title.trim()) return setErr('اكتب ما اشتريته');
    if (!(v > 0)) return setErr('اكتب مبلغاً أكبر من صفر');
    if (!date) return setErr('اختر التاريخ');
    const refunded = p ? p.refunds.reduce((s, r) => s + r.amount, 0) : 0;
    if (v < refunded) return setErr('المبلغ أقل من المسترجع سابقاً');
    if (duplicatePurchase(data, { id: p?.id ?? '', supplier, date, amount: v }) && !(await ask({ title: 'شراء مكرر؟', body: 'يوجد شراء من نفس المورّد بنفس التاريخ والمبلغ. حفظ على أي حال؟', confirm: 'احفظ مرة أخرى' }))) return;
    const ok = await commit(d => {
      const base = { title: title.trim(), supplier: supplier.trim(), sectionId, amount: v, date, notes, attachments: att };
      if (p) Object.assign(d.purchases.find(x => x.id === p.id)!, base);
      else d.purchases.push({ id: uid(), refunds: [], ...base } as Purchase);
    });
    if (ok) { onDone?.(); onClose(); } else setErr('لم يُحفظ. لم يتغير شيء.');
  };
  const del = async () => {
    if (!p || !(await ask({ title: 'حذف الشراء', body: `حذف «${p.title}» مع استرجاعاته؟`, confirm: 'احذف', danger: true }))) return;
    (await commit(d => { d.purchases = d.purchases.filter(x => x.id !== p.id); })) ? (onDone?.(), onClose()) : setErr('لم يُحذف.');
  };
  return (
    <Sheet title={p ? 'تعديل الشراء' : 'شراء جديد'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="err" role="alert">{err}</div>}
        <Field label="ما اشتريته" value={title} onChange={setTitle} />
        <Field label="المورّد / المحل" value={supplier} onChange={setSupplier} />
        <Pick label="القسم" value={sectionId} onChange={setSection} options={[[sharedSection, 'مواد مشتركة (تُحسب مرة واحدة)'], ...data.sections.map(s => [s.id, s.name] as [string, string])]} />
        <div className="two"><Field label="المبلغ المدفوع (د.ك)" value={amt} onChange={setAmt} type="number" /><Field label="التاريخ" value={date} onChange={setDate} type="date" /></div>
        <Area label="ملاحظات" value={notes} onChange={setNotes} />
        <Attach value={att} onChange={setAtt} onApply={r => { if (r.amount != null) setAmt(String(r.amount)); if (r.date) setDate(r.date); }} />
        <div className="actions"><button className="btn" style={{ flex: 1 }} disabled={busy}>حفظ</button>{p && <button type="button" className="btn danger" disabled={busy} onClick={del}><Trash2 size={16} />حذف</button>}</div>
      </form>
    </Sheet>
  );
}

export function PurchaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, commit, ask } = useApp();
  const [editing, setEditing] = useState(false);
  const [ref, setRef] = useState<{ id?: string } | null>(null);
  const p = data.purchases.find(x => x.id === id);
  if (!p) return null;
  const refunded = p.amount - purchaseNet(p);
  return (
    <Sheet title={p.title} onClose={onClose}>
      <div className="paper hero" style={{ animation: 'none' }}>
        <div className="lbl">{p.supplier || 'بدون مورّد'} · <D v={p.date} /></div>
        <div className="big"><M v={purchaseNet(p)} /></div>
        <div className="row"><div><span className="lbl">المدفوع</span><b><M v={p.amount} /></b></div><div><span className="lbl">المسترجع</span><b><M v={refunded} /></b></div></div>
      </div>
      {p.notes && <p className="muted">{p.notes}</p>}
      {p.attachments.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{p.attachments.length} مرفق (اضغط تعديل لعرضها)</p>}
      <div className="actions" style={{ marginTop: 0 }}><button className="btn" onClick={() => setEditing(true)}>تعديل</button></div>
      <Fold title="الاسترجاعات" count={String(p.refunds.length)} open>
        {!p.refunds.length && <Empty title="لا استرجاعات" />}
        {p.refunds.map(r => (
          <button key={r.id} className="rowline" onClick={() => setRef({ id: r.id })}>
            <div className="grow"><div className="t"><D v={r.date} /></div><div className="s">{r.notes}</div></div><div className="a credit"><M v={r.amount} /></div>
          </button>
        ))}
        <div className="actions"><button className="btn sm soft" disabled={refunded >= p.amount} onClick={() => setRef({})}><Plus size={14} />استرجاع</button></div>
      </Fold>
      {editing && <PurchaseForm id={p.id} onClose={() => setEditing(false)} onDone={onClose} />}
      {ref && <RefundForm p={p} refId={ref.id} onClose={() => setRef(null)} onDelete={ref.id ? async () => {
        if (!(await ask({ title: 'حذف الاسترجاع', body: 'حذف هذا الاسترجاع؟', confirm: 'احذف', danger: true }))) return;
        if (await commit(d => { const x = d.purchases.find(y => y.id === id)!; x.refunds = x.refunds.filter(r => r.id !== ref.id); })) setRef(null);
      } : undefined} />}
    </Sheet>
  );
}

function RefundForm({ p, refId, onClose, onDelete }: { p: Purchase; refId?: string; onClose: () => void; onDelete?: () => void }) {
  const { commit, busy } = useApp();
  const r = p.refunds.find(x => x.id === refId);
  const [amt, setAmt] = useState(r ? String(r.amount) : ''); const [date, setDate] = useState(r?.date ?? today());
  const [notes, setNotes] = useState(r?.notes ?? ''); const [att, setAtt] = useState<Attachment[]>(r?.attachments ?? []); const [err, setErr] = useState('');
  const others = p.refunds.filter(x => x.id !== r?.id).reduce((s, x) => s + x.amount, 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = num(amt);
    if (!(v > 0)) return setErr('اكتب مبلغاً أكبر من صفر');
    if (!date) return setErr('اختر التاريخ');
    if (!att.length && !notes.trim()) return setErr('أرفق إثباتاً (إيصال) أو اكتب سبب الاسترجاع');
    if (others + v > p.amount + 1e-9) return setErr('المسترجع لا يمكن أن يتجاوز مبلغ الشراء');
    const ok = await commit(d => {
      const x = d.purchases.find(y => y.id === p.id)!;
      const row: Refund = { id: r?.id ?? uid(), amount: v, date, notes: notes.trim(), attachments: att };
      if (r) x.refunds = x.refunds.map(y => y.id === r.id ? row : y); else x.refunds.push(row);
    });
    ok ? onClose() : setErr('لم يُحفظ.');
  };
  return (
    <Sheet title={r ? 'تعديل الاسترجاع' : 'استرجاع'} onClose={onClose}>
      <form onSubmit={submit}>{err && <div className="err" role="alert">{err}</div>}
        <div className="two"><Field label="المبلغ المسترجع (د.ك)" value={amt} onChange={setAmt} type="number" /><Field label="التاريخ" value={date} onChange={setDate} type="date" /></div>
        <Field label="السبب" value={notes} onChange={setNotes} />
        <Attach value={att} onChange={setAtt} onApply={x => { if (x.amount != null) setAmt(String(x.amount)); if (x.date) setDate(x.date); }} />
        <div className="actions"><button className="btn" style={{ flex: 1 }} disabled={busy}>حفظ</button>{onDelete && <button type="button" className="btn danger" disabled={busy} onClick={onDelete}><Trash2 size={16} />حذف</button>}</div>
      </form>
    </Sheet>
  );
}
