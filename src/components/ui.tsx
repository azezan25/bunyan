import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { DocumentImport } from './DocumentImport';
import { money, dateLabel, type Attachment, type ProjectData } from '../lib/project';

export type AskOpts = { title: string; body: string; confirm?: string; danger?: boolean };
export type AppCtx = {
  data: ProjectData;
  commit: (fn: (d: ProjectData) => void, o?: { countless?: boolean }) => Promise<boolean>;
  ask: (o: AskOpts) => Promise<boolean>;
  open: (t: 'c' | 'p', id: string) => void;
  sectionName: (id: string) => string;
  busy: boolean;
  replaceData: (candidate: ProjectData) => Promise<boolean>;
};
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

export const M = ({ v, cls }: { v: number; cls?: string }) => <bdi className={`n ${cls ?? ''}`}>{money(v)}</bdi>;
export const D = ({ v }: { v: string }) => <bdi className="n">{dateLabel(v)}</bdi>;
export const num = (s: string) => { const n = Number(s.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[,٬]/g, '').replace('٫', '.')); return s.trim() === '' ? NaN : n; };

export function Sheet({ title, onClose, children, center }: { title: string; onClose: () => void; children: ReactNode; center?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${center ? 'center' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button></header>
        <div className="body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Fold({ title, count, children, open }: { title: string; count?: string; children: ReactNode; open?: boolean }) {
  return <details className="fold" open={open}><summary>{title}<span className="c">{count}</span><ChevronDown className="chev" size={16} /></summary><div style={{ paddingBottom: 14 }}>{children}</div></details>;
}

type FP = { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean };
export const Field = ({ label, value, onChange, type = 'text', required }: FP) =>
  <label className="field"><span>{label}</span><input className="inp" type={type} value={value} required={required} onChange={e => onChange(e.target.value)} inputMode={type === 'number' ? 'decimal' : undefined} step={type === 'number' ? 'any' : undefined} dir={type === 'date' ? 'ltr' : undefined} /></label>;
export const Area = ({ label, value, onChange }: FP) => <label className="field"><span>{label}</span><textarea className="inp" value={value} onChange={e => onChange(e.target.value)} /></label>;
export const Pick = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) =>
  <label className="field"><span>{label}</span><select className="inp" value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;

export const Empty = ({ title, hint }: { title: string; hint?: string }) => <div className="empty"><b>{title}</b>{hint}</div>;

export type Draft = { text: string; amount?: number; date?: string; installments?: { title: string; amount: number }[] };
export function Attach({ value, onChange, onApply, contract }: { value: Attachment[]; onChange: (a: Attachment[]) => void; onApply?: (d: { amount?: number; date?: string; installments?: { title: string; amount: number }[] }) => void; contract?: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <div className="field">
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'hsl(var(--muted-foreground))', marginBottom: 5 }}>المرفقات (صور أو PDF)</span>
      <DocumentImport attachments={value} onChange={onChange} onExtract={onApply ? r => setDraft({ text: r.text, amount: r.amount, date: r.date, installments: r.installments }) : undefined} />
      {draft && onApply && (
        <div className="note" style={{ marginTop: 10 }}>
          <b>مسودة مقروءة من المستند — لن تُحفظ حتى تعتمدها</b>
          <div>المبلغ: {draft.amount != null ? <M v={draft.amount} /> : 'لم يُعثر عليه'} · التاريخ: {draft.date ? <D v={draft.date} /> : 'لم يُعثر عليه'}</div>
          {contract && <div>الدفعات المقترحة: {draft.installments?.length ? draft.installments.map((i, k) => <div key={k}>{i.title} — <M v={i.amount} /></div>) : 'لم يُعثر عليها'}</div>}
          <div className="actions">
            <button type="button" className="btn sm" disabled={draft.amount == null && !draft.date && !(contract && draft.installments?.length)} onClick={() => { onApply({ amount: draft.amount, date: draft.date, installments: contract ? draft.installments : undefined }); setDraft(null); }}>{contract ? 'إضافة للنموذج للمراجعة' : 'تعبئة الحقول للمراجعة'}</button>
            <button type="button" className="btn sm soft" onClick={() => setDraft(null)}>تجاهل</button>
          </div>
        </div>
      )}
    </div>
  );
}
