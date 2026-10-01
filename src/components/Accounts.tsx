import { useState, type FormEvent } from 'react';
import { Pencil, Phone, Plus, Share2, Printer, Trash2, Lock } from 'lucide-react';
import { contractBase, contractIsFinal, contractTotal, contractorPaid, contractorRemaining, duplicatePayment, today, totals, uid, type Adjustment, type Attachment, type Contractor, type Installment, type LineItem, type Payment, type Warranty } from '../lib/project';
import { printStatement, shareStatement } from '../lib/statement';
import { Area, Attach, D, Empty, Field, Fold, M, Pick, Sheet, num, useApp } from './ui';

const Err = ({ m }: { m: string }) => (m ? <div className="err" role="alert">{m}</div> : null);

export function useMutateContractor() {
  const { data, commit, ask } = useApp();
  return async (id: string, affects: boolean, fn: (c: Contractor) => void) => {
    const c = data.contractors.find(x => x.id === id);
    if (!c) return false;
    if (c.closed || (affects && c.final)) {
      const ok = await ask({ title: 'تعديل حساب معتمد', body: c.closed ? `حساب «${c.name}» مغلق. المتابعة ستعيد فتحه${affects ? ' وتلغي اعتماده النهائي' : ''}.` : `حساب «${c.name}» معتمد كنهائي. المتابعة ستلغي اعتماده ليعود مؤقتاً.`, confirm: 'نعم، أعد الفتح' });
      if (!ok) return false;
    }
    return commit(d => {
      const x = d.contractors.find(y => y.id === id)!;
      fn(x);
      if (x.closed) { x.closed = false; x.closedOn = ''; }
      if (affects) x.final = false;
    });
  };
}

export function ContractorList() {
  const { data, open } = useApp();
  const [adding, setAdding] = useState(false);
  return (
    <>
      {!data.contractors.length && <div className="paper"><Empty title="لا توجد حسابات بعد" hint="أضف أول مقاول أو صاحب عمل، ثم سجّل عقده ودفعاته." /></div>}
      {data.sections.map(s => {
        const cs = data.contractors.filter(c => c.sectionId === s.id);
        const t = totals(data, s.id);
        if (!cs.length && !t.purchases) return null;
        const labour = cs.reduce((a, c) => a + contractTotal(c), 0);
        return (
          <div key={s.id}>
            <h2 className="sec">{s.name}</h2>
            <div className="paper">
              <div className="sechead"><b>الإجمالي <M v={t.total} /></b><span className="muted" style={{ fontSize: 12 }}>مدفوع <M v={t.paid} /></span></div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>عمالة ومقاولات <M v={labour} /> · مواد <M v={t.purchases} /></div>
              {cs.map(c => {
                const r = contractorRemaining(c);
                return (
                  <button key={c.id} className="rowline" onClick={() => open('c', c.id)}>
                    <div className="grow"><div className="t">{c.name}</div>
                      <div className="s">{c.closed ? 'مغلق' : contractIsFinal(c) ? 'نهائي' : 'مؤقت'} · مدفوع <M v={contractorPaid(c)} /></div></div>
                    <div className={`a ${r < 0 ? 'credit' : r > 0 ? 'owed' : ''}`}>{r < 0 ? 'زيادة ' : 'متبقي '}<M v={Math.abs(r)} /></div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <button className="btn fab" onClick={() => setAdding(true)}><Plus size={18} />حساب جديد</button>
      {adding && <ContractorForm onClose={() => setAdding(false)} />}
    </>
  );
}

export function ContractorForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data, commit, busy } = useApp();
  const mutate = useMutateContractor();
  const c = data.contractors.find(x => x.id === id);
  const [att, setAtt] = useState<Attachment[]>(c?.attachments ?? []);
  const [pend, setPend] = useState<{ title: string; amount: number }[]>([]);
  const [name, setName] = useState(c?.name ?? '');
  const [sectionId, setSection] = useState(c?.sectionId ?? data.sections[0]?.id ?? '');
  const [phone, setPhone] = useState(c?.phone ?? '');
  const [kind, setKind] = useState<'fixed' | 'unit'>(c?.kind ?? 'fixed');
  const [fixed, setFixed] = useState(c ? String(c.fixedAmount) : '');
  const [notes, setNotes] = useState(c?.notes ?? '');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f = kind === 'fixed' ? num(fixed) : 0;
    if (!name.trim()) return setErr('اكتب الاسم');
    if (!sectionId) return setErr('اختر القسم');
    if (kind === 'fixed' && !(f >= 0)) return setErr('اكتب مبلغ العقد');
    if (c && contractTotal({ ...c, kind, fixedAmount: f }) < 0) return setErr('الإجمالي بعد الإضافات والخصومات يجب ألا يكون سالباً. ارفع مبلغ العقد أو عدّل الخصومات.');
    const apply = (x: Contractor) => { x.name = name.trim(); x.sectionId = sectionId; x.phone = phone.trim(); x.kind = kind; x.fixedAmount = f; x.notes = notes; x.attachments = att; pend.forEach(i => x.installments.push({ id: uid(), title: i.title, amount: i.amount })); };
    const changedTotal = !!c && (c.kind !== kind || c.fixedAmount !== f);
    const ok = c ? await mutate(c.id, changedTotal, apply) : await commit(d => {
      const n: Contractor = { id: uid(), name: '', sectionId: '', phone: '', kind: 'fixed', fixedAmount: 0, lines: [], adjustments: [], payments: [], installments: [], attachments: [], warranties: [], closed: false, final: false, closedOn: '', notes: '' };
      apply(n); d.contractors.push(n);
    });
    ok ? onClose() : setErr('لم يُحفظ. حاول مرة أخرى.');
  };
  return (
    <Sheet title={c ? 'تعديل الحساب' : 'حساب جديد'} onClose={onClose}>
      <form onSubmit={submit}>
        <Err m={err} />
        <Field label="الاسم" value={name} onChange={setName} />
        <Pick label="القسم" value={sectionId} onChange={setSection} options={data.sections.map(s => [s.id, s.name])} />
        <Field label="الهاتف (اختياري)" value={phone} onChange={setPhone} type="tel" />
        <Pick label="نوع العقد" value={kind} onChange={v => setKind(v as 'fixed' | 'unit')} options={[['fixed', 'مبلغ مقطوع'], ['unit', 'بالوحدة (بنود وأسعار)']]} />
        {kind === 'fixed' && <Field label="مبلغ العقد (د.ك)" value={fixed} onChange={setFixed} type="number" />}
        {kind === 'unit' && <p className="muted" style={{ fontSize: 13 }}>بعد حفظ الحساب، أضف بنود العمل بالكميات وأسعار الوحدات من داخل الحساب.</p>}
        <Area label="ملاحظات" value={notes} onChange={setNotes} />
        <Attach contract value={att} onChange={setAtt} onApply={r => { if (r.amount != null && kind === 'fixed') setFixed(String(r.amount)); if (r.installments?.length) setPend(p => [...p, ...r.installments!]); }} />
        {pend.length > 0 && <div className="note"><b>دفعات ستُضاف عند الحفظ</b>{pend.map((i, k) => <div key={k} className="rowline"><div className="grow">{i.title} — <M v={i.amount} /></div><button type="button" className="btn sm danger" onClick={() => setPend(p => p.filter((_, j) => j !== k))}>إزالة</button></div>)}</div>}
        <button className="btn block" disabled={busy}>حفظ</button>
      </form>
    </Sheet>
  );
}

export function ContractorDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, commit, ask, sectionName } = useApp();
  const mutate = useMutateContractor();
  const [sub, setSub] = useState<null | { t: 'edit' | 'line' | 'adj' | 'pay' | 'inst' | 'war'; id?: string; seed?: { amount: number; notes: string } }>(null);
  const [err, setErr] = useState('');
  const c = data.contractors.find(x => x.id === id);
  if (!c) return null;
  const sName = sectionName(c.sectionId);
  const total = contractTotal(c), paid = contractorPaid(c), rem = contractorRemaining(c);
  const canFinal = c.kind === 'fixed' ? true : c.lines.length > 0 && c.lines.every(l => l.actual !== null);
  const final = contractIsFinal(c);
  const instSum = c.installments.reduce((s, i) => s + i.amount, 0);
  const del = async (what: string, fn: (x: Contractor) => void, affects: boolean) => {
    if (!(await ask({ title: 'حذف', body: `حذف ${what} نهائياً؟`, confirm: 'احذف', danger: true }))) return;
    if (!(await mutate(c.id, affects, fn))) setErr('لم يُحذف. حاول مرة أخرى.');
  };
  const setFinal = async () => {
    const ok = await ask({ title: 'اعتماد الحساب كنهائي', body: 'سيُعتبر المبلغ نهائياً بعد مطابقة القياس الفعلي. يمكنك التراجع بالتعديل لاحقاً.', confirm: 'اعتمد' });
    if (ok && !(await commit(d => { d.contractors.find(x => x.id === id)!.final = true; }))) setErr('لم يُحفظ.');
  };
  const close = async () => {
    const ok = await ask({ title: 'إغلاق الحساب النهائي', body: `إغلاق حساب «${c.name}»${rem !== 0 ? ` والمتبقي عليه غير صفر` : ''}. أي تعديل أو دفعة لاحقة ستطلب إعادة فتحه.`, confirm: 'أغلق الحساب' });
    if (ok && !(await commit(d => { const x = d.contractors.find(y => y.id === id)!; x.closed = true; x.closedOn = today(); }))) setErr('لم يُحفظ.');
  };
  const delContractor = async () => {
    if (!(await ask({ title: 'حذف الحساب', body: `سيُحذف «${c.name}» مع كل بنوده ودفعاته ومرفقاته.`, confirm: 'احذف', danger: true }))) return;
    if (c.closed && !(await ask({ title: 'الحساب مغلق', body: 'هذا حساب مغلق. تأكيد الحذف النهائي؟', confirm: 'احذف', danger: true }))) return;
    (await commit(d => { d.contractors = d.contractors.filter(x => x.id !== id); })) ? onClose() : setErr('لم يُحذف.');
  };
  return (
    <Sheet title={c.name} onClose={onClose}>
      <Err m={err} />
      <div className="paper hero" style={{ animation: 'none' }}>
        <div className="lbl">{sName} · {c.closed ? 'حساب مغلق' : final ? 'نهائي' : 'مؤقت'}</div>
        <div className="big"><M v={total} /></div>
        <div className="row"><div><span className="lbl">المدفوع</span><b><M v={paid} /></b></div>
          <div><span className="lbl">{rem < 0 ? 'زيادة مدفوعة (رصيد لك)' : 'المتبقي'}</span><b><M v={Math.abs(rem)} /></b></div></div>
      </div>
      {c.closed && <div className="note"><Lock size={14} style={{ display: 'inline' }} /> مغلق بتاريخ <D v={c.closedOn} /></div>}
      <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}>
        <button className="btn" onClick={() => setSub({ t: 'pay' })}><Plus size={16} />دفعة</button>
        <button className="btn soft" onClick={() => setSub({ t: 'edit' })}><Pencil size={16} />تعديل</button>
        {c.phone && <a className="btn soft" href={`tel:${c.phone}`}><Phone size={16} />اتصال</a>}
      </div>

      <Fold title={c.kind === 'fixed' ? 'العقد' : 'البنود والقياس'} count={c.kind === 'unit' ? String(c.lines.length) : undefined} open>
        {c.kind === 'fixed' ? <div className="rowline"><div className="grow"><div className="t">مبلغ مقطوع</div></div><div className="a"><M v={c.fixedAmount} /></div></div> : (
          <>
            {!c.lines.length && <Empty title="لا توجد بنود" hint="أضف بنداً بسعر الوحدة والكمية التقديرية." />}
            {c.lines.map(l => {
              const diffQ = l.actual === null ? null : l.actual - l.estimated;
              const diffM = diffQ === null ? null : diffQ * l.rate;
              return (
                <button key={l.id} className="rowline" onClick={() => setSub({ t: 'line', id: l.id })}>
                  <div className="grow"><div className="t">{l.title}</div>
                    <div className="s">{l.rate} د.ك لكل {l.unit || 'وحدة'} · تقديري <bdi className="n">{l.estimated}</bdi> · فعلي {l.actual === null ? 'لم يُقَس' : <bdi className="n">{l.actual}</bdi>}</div>
                    {diffQ !== null && diffM !== null && <div className={`s ${diffM > 0 ? 'owed' : diffM < 0 ? 'credit' : ''}`}>الفرق <bdi className="n">{diffQ > 0 ? '+' : ''}{Math.round(diffQ * 1000) / 1000}</bdi> {l.unit} = {diffM > 0 ? 'زيادة ' : diffM < 0 ? 'نقص ' : ''}<M v={Math.abs(diffM)} /></div>}</div>
                  <div className="a"><M v={(l.actual ?? l.estimated) * l.rate} /></div>
                </button>
              );
            })}
            <div className="actions"><button className="btn sm soft" onClick={() => setSub({ t: 'line' })}><Plus size={14} />بند</button></div>
          </>
        )}
        {!c.closed && (
          <div className="actions">
            {!final && <button className="btn sm" disabled={!canFinal} onClick={setFinal}>اعتماد كنهائي</button>}
            {final && <button className="btn sm" onClick={close}>إغلاق الحساب النهائي</button>}
          </div>
        )}
        {!final && !canFinal && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>لا يُعتمد نهائياً قبل إدخال الكمية الفعلية لكل البنود.</div>}
      </Fold>

      <Fold title="إضافات وخصومات" count={String(c.adjustments.length)}>
        {c.adjustments.map(a => (
          <button key={a.id} className="rowline" onClick={() => setSub({ t: 'adj', id: a.id })}>
            <div className="grow"><div className="t">{a.title}</div><div className="s"><D v={a.date} /></div></div>
            <div className={`a ${a.amount < 0 ? 'credit' : 'owed'}`}>{a.amount < 0 ? 'خصم ' : 'إضافة '}<M v={Math.abs(a.amount)} /></div>
          </button>
        ))}
        <div className="actions"><button className="btn sm soft" onClick={() => setSub({ t: 'adj' })}><Plus size={14} />إضافة أو خصم</button></div>
      </Fold>

      <Fold title="الدفعات" count={String(c.payments.length)} open>
        {!c.payments.length && <Empty title="لا دفعات" />}
        {[...c.payments].sort((a, b) => b.date.localeCompare(a.date)).map(p => (
          <button key={p.id} className="rowline" onClick={() => setSub({ t: 'pay', id: p.id })}>
            <div className="grow"><div className="t"><D v={p.date} /></div><div className="s">{p.notes}{p.attachments.length ? ` · ${p.attachments.length} مرفق` : ''}</div></div>
            <div className="a"><M v={p.amount} /></div>
          </button>
        ))}
      </Fold>

      <Fold title="جدول الدفعات المتفق عليه" count={c.installments.length ? String(c.installments.length) : undefined}>
        {c.installments.map(i => (
          <div key={i.id} className="rowline">
            <button className="grow" style={{ background: 'none', border: 0, textAlign: 'start', padding: 0 }} onClick={() => setSub({ t: 'inst', id: i.id })}><div className="t">{i.title}</div></button>
            <div className="a"><M v={i.amount} /></div>
            <button className="btn sm soft" onClick={() => setSub({ t: 'pay', seed: { amount: i.amount, notes: i.title } })}>سجّل</button>
          </div>
        ))}
        {c.installments.length > 0 && <div className="s muted" style={{ fontSize: 12 }}>مجموع الجدول <M v={instSum} /> من <M v={total} /></div>}
        <div className="actions"><button className="btn sm soft" onClick={() => setSub({ t: 'inst' })}><Plus size={14} />دفعة في الجدول</button></div>
      </Fold>

      <Fold title="عقد ومستندات" count={c.attachments.length ? String(c.attachments.length) : undefined}>
        <Attach value={c.attachments} onChange={(a: Attachment[]) => { void mutate(c.id, false, x => { x.attachments = a; }).then(ok => !ok && setErr('لم تُحفظ المرفقات.')); }} />
      </Fold>

      <Fold title="الضمان والملاحظات" count={String(c.warranties.length)}>
        {c.warranties.map(w => {
          const exp = w.expires && w.expires < today();
          return (
            <button key={w.id} className="rowline" onClick={() => setSub({ t: 'war', id: w.id })}>
              <div className="grow"><div className="t">{w.title}</div><div className="s">{w.expires ? <>ينتهي <D v={w.expires} /></> : 'بدون تاريخ'}{w.repairedOn ? <> · أُصلح <D v={w.repairedOn} /></> : ''}</div></div>
              {exp && <span className="tag bad">منتهٍ</span>}
            </button>
          );
        })}
        <div className="actions"><button className="btn sm soft" onClick={() => setSub({ t: 'war' })}><Plus size={14} />ضمان أو عيب</button></div>
      </Fold>

      <Fold title="بيان الحساب">
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn" onClick={() => printStatement(c, sName)}><Printer size={16} />طباعة / PDF</button>
          <button className="btn soft" onClick={() => void shareStatement(c, sName)}><Share2 size={16} />مشاركة</button>
        </div>
      </Fold>
      <div className="actions" style={{ marginTop: 20 }}><button className="btn danger block" onClick={delContractor}><Trash2 size={16} />حذف الحساب</button></div>

      {sub?.t === 'edit' && <ContractorForm id={c.id} onClose={() => setSub(null)} />}
      {sub?.t === 'line' && <LineForm c={c} lineId={sub.id} onClose={() => setSub(null)} onDelete={sub.id ? () => { const l = c.lines.find(x => x.id === sub.id)!; setSub(null); void del(`البند «${l.title}»`, x => { x.lines = x.lines.filter(y => y.id !== sub.id); }, true); } : undefined} />}
      {sub?.t === 'adj' && <AdjForm c={c} adjId={sub.id} onClose={() => setSub(null)} onDelete={sub.id ? () => { setSub(null); void del('التعديل', x => { x.adjustments = x.adjustments.filter(y => y.id !== sub.id); }, true); } : undefined} />}
      {sub?.t === 'pay' && <PayForm c={c} payId={sub.id} seed={sub.seed} onClose={() => setSub(null)} onDelete={sub.id ? () => { setSub(null); void del('الدفعة', x => { x.payments = x.payments.filter(y => y.id !== sub.id); }, false); } : undefined} />}
      {sub?.t === 'inst' && <InstForm c={c} instId={sub.id} onClose={() => setSub(null)} onDelete={sub.id ? () => { setSub(null); void del('دفعة الجدول', x => { x.installments = x.installments.filter(y => y.id !== sub.id); }, false); } : undefined} />}
      {sub?.t === 'war' && <WarForm c={c} warId={sub.id} onClose={() => setSub(null)} onDelete={sub.id ? () => { setSub(null); void del('الضمان', x => { x.warranties = x.warranties.filter(y => y.id !== sub.id); }, false); } : undefined} />}
    </Sheet>
  );
}

type SubP = { c: Contractor; onClose: () => void; onDelete?: () => void };
const Foot = ({ onDelete }: { onDelete?: () => void }) => {
  const { busy } = useApp();
  return (
  <div className="actions"><button className="btn" style={{ flex: 1 }} disabled={busy}>حفظ</button>{onDelete && <button type="button" className="btn danger" disabled={busy} onClick={onDelete}><Trash2 size={16} />حذف</button>}</div>
  );
};

function LineForm({ c, lineId, onClose, onDelete }: SubP & { lineId?: string }) {
  const mutate = useMutateContractor();
  const l = c.lines.find(x => x.id === lineId);
  const [title, setTitle] = useState(l?.title ?? ''); const [unit, setUnit] = useState(l?.unit ?? '');
  const [rate, setRate] = useState(l ? String(l.rate) : ''); const [est, setEst] = useState(l ? String(l.estimated) : '');
  const [act, setAct] = useState(l?.actual != null ? String(l.actual) : ''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = num(rate), es = num(est), ac = act.trim() === '' ? null : num(act);
    if (!title.trim()) return setErr('اكتب اسم البند');
    if (!(r >= 0) || !(es >= 0) || (ac !== null && !(ac >= 0))) return setErr('السعر والكميات أرقام صفر أو أكثر');
    const cand: LineItem = { id: l?.id ?? '', title, unit, rate: r, estimated: es, actual: ac };
    const lines = l ? c.lines.map(y => y.id === l.id ? cand : y) : [...c.lines, cand];
    if (contractTotal({ ...c, lines }) < 0) return setErr('الإجمالي بعد التعديل يجب ألا يكون سالباً');
    const fin = !l || l.rate !== r || l.estimated !== es || l.actual !== ac;
    const ok = await mutate(c.id, fin, x => {
      const row: LineItem = { id: l?.id ?? uid(), title: title.trim(), unit: unit.trim(), rate: r, estimated: es, actual: ac };
      if (l) x.lines = x.lines.map(y => y.id === l.id ? row : y); else x.lines.push(row);
    });
    ok ? onClose() : setErr('لم يُحفظ.');
  };
  return (
    <Sheet title={l ? 'تعديل البند' : 'بند جديد'} onClose={onClose}>
      <form onSubmit={submit}><Err m={err} />
        <Field label="البند" value={title} onChange={setTitle} />
        <div className="two"><Field label="الوحدة (م²، نقطة…)" value={unit} onChange={setUnit} /><Field label="سعر الوحدة (د.ك)" value={rate} onChange={setRate} type="number" /></div>
        <div className="two"><Field label="الكمية التقديرية" value={est} onChange={setEst} type="number" /><Field label="الكمية الفعلية (بعد القياس)" value={act} onChange={setAct} type="number" /></div>
        <Foot onDelete={onDelete} /></form>
    </Sheet>
  );
}

function AdjForm({ c, adjId, onClose, onDelete }: SubP & { adjId?: string }) {
  const mutate = useMutateContractor();
  const a = c.adjustments.find(x => x.id === adjId);
  const [title, setTitle] = useState(a?.title ?? ''); const [sign, setSign] = useState(a && a.amount < 0 ? 'neg' : 'pos');
  const [amt, setAmt] = useState(a ? String(Math.abs(a.amount)) : ''); const [date, setDate] = useState(a?.date ?? today()); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = num(amt);
    if (!title.trim()) return setErr('اكتب السبب');
    if (!(v > 0)) return setErr('اكتب مبلغاً أكبر من صفر');
    if (!date) return setErr('اختر التاريخ');
    const signed = sign === 'neg' ? -v : v;
    const others = c.adjustments.filter(x => x.id !== a?.id).reduce((s, x) => s + x.amount, 0);
    const newBase = contractBase(c);
    if (newBase + others + signed < 0) return setErr('لا يمكن أن يصبح إجمالي العقد سالباً');
    const ok = await mutate(c.id, true, x => {
      const row: Adjustment = { id: a?.id ?? uid(), title: title.trim(), amount: signed, date };
      if (a) x.adjustments = x.adjustments.map(y => y.id === a.id ? row : y); else x.adjustments.push(row);
    });
    ok ? onClose() : setErr('لم يُحفظ.');
  };
  return (
    <Sheet title={a ? 'تعديل' : 'إضافة أو خصم'} onClose={onClose}>
      <form onSubmit={submit}><Err m={err} />
        <Pick label="النوع" value={sign} onChange={setSign} options={[['pos', 'إضافة على العقد'], ['neg', 'خصم من العقد']]} />
        <Field label="السبب" value={title} onChange={setTitle} />
        <div className="two"><Field label="المبلغ (د.ك)" value={amt} onChange={setAmt} type="number" /><Field label="التاريخ" value={date} onChange={setDate} type="date" /></div>
        <Foot onDelete={onDelete} /></form>
    </Sheet>
  );
}

function PayForm({ c, payId, seed, onClose, onDelete }: SubP & { payId?: string; seed?: { amount: number; notes: string } }) {
  const { ask } = useApp();
  const mutate = useMutateContractor();
  const p = c.payments.find(x => x.id === payId);
  const [amt, setAmt] = useState(p ? String(p.amount) : seed ? String(seed.amount) : ''); const [date, setDate] = useState(p?.date ?? today());
  const [notes, setNotes] = useState(p?.notes ?? seed?.notes ?? ''); const [att, setAtt] = useState<Attachment[]>(p?.attachments ?? []); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = num(amt);
    if (!(v > 0)) return setErr('اكتب مبلغاً أكبر من صفر');
    if (!date) return setErr('اختر تاريخ الدفعة');
    if (duplicatePayment(c, { id: p?.id ?? '', date, amount: v }) && !(await ask({ title: 'دفعة مكررة؟', body: 'توجد دفعة بنفس المبلغ والتاريخ لهذا الحساب. حفظ على أي حال؟', confirm: 'احفظ مرة أخرى' }))) return;
    const ok = await mutate(c.id, false, x => {
      const row: Payment = { id: p?.id ?? uid(), amount: v, date, notes: notes.trim(), attachments: att };
      if (p) x.payments = x.payments.map(y => y.id === p.id ? row : y); else x.payments.push(row);
    });
    ok ? onClose() : setErr('لم تُحفظ الدفعة. لم يتغير شيء.');
  };
  return (
    <Sheet title={p ? 'تعديل الدفعة' : 'دفعة جديدة'} onClose={onClose}>
      <form onSubmit={submit}><Err m={err} />
        <div className="two"><Field label="المبلغ (د.ك)" value={amt} onChange={setAmt} type="number" /><Field label="تاريخ الدفع" value={date} onChange={setDate} type="date" /></div>
        <Field label="ملاحظة (دفعة تقدم، مقدم…)" value={notes} onChange={setNotes} />
        <Attach value={att} onChange={setAtt} onApply={r => { if (r.amount != null) setAmt(String(r.amount)); if (r.date) setDate(r.date); }} />
        <Foot onDelete={onDelete} /></form>
    </Sheet>
  );
}

function InstForm({ c, instId, onClose, onDelete }: SubP & { instId?: string }) {
  const mutate = useMutateContractor();
  const i = c.installments.find(x => x.id === instId);
  const [title, setTitle] = useState(i?.title ?? ''); const [amt, setAmt] = useState(i ? String(i.amount) : ''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = num(amt);
    if (!title.trim()) return setErr('اكتب اسم الدفعة');
    if (!(v >= 0)) return setErr('اكتب المبلغ');
    const ok = await mutate(c.id, false, x => {
      const row: Installment = { id: i?.id ?? uid(), title: title.trim(), amount: v };
      if (i) x.installments = x.installments.map(y => y.id === i.id ? row : y); else x.installments.push(row);
    });
    ok ? onClose() : setErr('لم يُحفظ.');
  };
  return (
    <Sheet title={i ? 'تعديل الدفعة' : 'دفعة في الجدول'} onClose={onClose}>
      <form onSubmit={submit}><Err m={err} />
        <Field label="الاسم (عند الصب، بعد التمديدات…)" value={title} onChange={setTitle} />
        <Field label="المبلغ (د.ك)" value={amt} onChange={setAmt} type="number" />
        <Foot onDelete={onDelete} /></form>
    </Sheet>
  );
}

function WarForm({ c, warId, onClose, onDelete }: SubP & { warId?: string }) {
  const mutate = useMutateContractor();
  const w = c.warranties.find(x => x.id === warId);
  const [title, setTitle] = useState(w?.title ?? ''); const [exp, setExp] = useState(w?.expires ?? ''); const [rep, setRep] = useState(w?.repairedOn ?? '');
  const [notes, setNotes] = useState(w?.notes ?? ''); const [att, setAtt] = useState<Attachment[]>(w?.attachments ?? []); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('اكتب العنوان');
    const ok = await mutate(c.id, false, x => {
      const row: Warranty = { id: w?.id ?? uid(), title: title.trim(), expires: exp, repairedOn: rep, notes, attachments: att };
      if (w) x.warranties = x.warranties.map(y => y.id === w.id ? row : y); else x.warranties.push(row);
    });
    ok ? onClose() : setErr('لم يُحفظ.');
  };
  return (
    <Sheet title={w ? 'تعديل' : 'ضمان أو عيب'} onClose={onClose}>
      <form onSubmit={submit}><Err m={err} />
        <Field label="العنوان (ضمان العزل، تسريب…)" value={title} onChange={setTitle} />
        <div className="two"><Field label="ينتهي الضمان" value={exp} onChange={setExp} type="date" /><Field label="تاريخ الإصلاح" value={rep} onChange={setRep} type="date" /></div>
        <Area label="الوصف" value={notes} onChange={setNotes} />
        <Attach value={att} onChange={setAtt} />
        <Foot onDelete={onDelete} /></form>
    </Sheet>
  );
}

