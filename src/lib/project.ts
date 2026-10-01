export type Attachment = { id: string; name: string; mime: string; data: string };
export type LineItem = { id: string; title: string; unit: string; rate: number; estimated: number; actual: number | null };
export type Adjustment = { id: string; title: string; amount: number; date: string };
export type Payment = { id: string; amount: number; date: string; notes: string; attachments: Attachment[] };
export type Installment = { id: string; title: string; amount: number };
export type Warranty = { id: string; title: string; expires: string; notes: string; repairedOn: string; attachments: Attachment[] };
export type Contractor = {
  id: string; name: string; sectionId: string; phone: string;
  kind: 'fixed' | 'unit'; fixedAmount: number; lines: LineItem[];
  adjustments: Adjustment[]; payments: Payment[]; installments: Installment[];
  attachments: Attachment[]; warranties: Warranty[];
  closed: boolean; final: boolean; closedOn: string; notes: string;
};
export type Refund = { id: string; amount: number; date: string; notes: string; attachments: Attachment[] };
export type Purchase = { id: string; title: string; supplier: string; sectionId: string; amount: number; date: string; notes: string; attachments: Attachment[]; refunds: Refund[] };
export type Section = { id: string; name: string };
export type ProjectData = { version: 2; name: string; sections: Section[]; contractors: Contractor[]; purchases: Purchase[]; lastBackup: string; backupEveryDays: number; backupChangeCount: number };
export const uid = () => crypto.randomUUID();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const sharedSection = 'shared';
export function emptyProject(): ProjectData {
  return {
    version: 2, name: 'بناء الدور الإضافي', sections: [
      'المكتب الهندسي', 'مقاول البناء', 'الألمنيوم', 'السباكة', 'الكهرباء',
      'المساح', 'الصبغ', 'الديكور', 'النجارة', 'تركيب الأرضيات',
    ].map((name, i) => ({ id: `section-${i}`, name })),
    contractors: [], purchases: [], lastBackup: '', backupEveryDays: 7, backupChangeCount: 0,
  };
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const toFils = (n: number) => Math.round((n + Number.EPSILON) * 1000);
export const sumMoney = (amounts: number[]) => amounts.reduce((s, n) => s + toFils(n), 0) / 1000;
export const contractBase = (c: Contractor) => c.kind === 'fixed' ? round(c.fixedAmount) : sumMoney(c.lines.map(l => (l.actual ?? l.estimated) * l.rate));
export const contractTotal = (c: Contractor) => sumMoney([contractBase(c), ...c.adjustments.map(a => a.amount)]);
export const contractorPaid = (c: Contractor) => sumMoney(c.payments.map(p => p.amount));
export const contractorRemaining = (c: Contractor) => round(contractTotal(c) - contractorPaid(c));
export const contractIsFinal = (c: Contractor) => c.final && (c.kind === 'fixed' || (c.lines.length > 0 && c.lines.every(l => l.actual !== null)));
export const purchaseNet = (p: Purchase) => sumMoney([p.amount, ...p.refunds.map(r => -r.amount)]);
export function totals(data: ProjectData, sectionId?: string) {
  const cs = data.contractors.filter(c => !sectionId || c.sectionId === sectionId);
  const ps = data.purchases.filter(p => !sectionId || p.sectionId === sectionId);
  const purchases = ps.reduce((s, p) => s + purchaseNet(p), 0);
  const total = round(cs.reduce((s, c) => s + contractTotal(c), 0) + purchases);
  const paid = round(cs.reduce((s, c) => s + contractorPaid(c), 0) + purchases);
  return { total, paid, remaining: round(total - paid), final: cs.every(contractIsFinal), purchases: round(purchases) };
}
export function duplicatePurchase(data: ProjectData, p: Pick<Purchase, 'id' | 'supplier' | 'date' | 'amount'>) {
  return data.purchases.some(x => x.id !== p.id && x.supplier.trim().toLowerCase() === p.supplier.trim().toLowerCase() && x.date === p.date && x.amount === p.amount);
}
export function duplicatePayment(c: Contractor, p: Pick<Payment, 'id' | 'date' | 'amount'>) {
  return c.payments.some(x => x.id !== p.id && x.date === p.date && x.amount === p.amount);
}
export function backupDue(data: ProjectData) {
  if (!data.contractors.length && !data.purchases.length) return false;
  return !data.lastBackup || data.backupChangeCount >= 5 || Date.now() - Date.parse(data.lastBackup) >= data.backupEveryDays * 86400000;
}
export const money = (value: number) => new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value) + ' د.ك';
export const dateLabel = (date: string) => date ? new Intl.DateTimeFormat('ar-KW', { dateStyle: 'medium' }).format(new Date(`${date}T12:00:00`)) : '—';

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nonnegative = (x: unknown): x is number => finite(x) && x >= 0;
const text = (x: unknown): x is string => typeof x === 'string';
const validDate = (x: unknown) => text(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x));
const rows = (x: unknown, validator: (v: any) => boolean): boolean => Array.isArray(x) && x.every(v => v && typeof v === 'object' && text(v.id) && validator(v)) && new Set(x.map(v => v.id)).size === x.length;
const attachmentsValid = (x: unknown) => rows(x, a => text(a.name) && text(a.mime) && text(a.data) && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(a.data));
export function isProjectData(v: unknown): v is ProjectData {
  if (!v || typeof v !== 'object') return false;
  const d = v as ProjectData;
  return d.version === 2 && text(d.name) && text(d.lastBackup) && nonnegative(d.backupChangeCount) && finite(d.backupEveryDays) && d.backupEveryDays > 0 &&
    rows(d.sections, s => text(s.name)) &&
    rows(d.contractors, c => text(c.name) && text(c.sectionId) && d.sections.some(s => s.id === c.sectionId) && text(c.phone) && text(c.notes) && ['fixed', 'unit'].includes(c.kind) &&
      nonnegative(c.fixedAmount) && typeof c.closed === 'boolean' && typeof c.final === 'boolean' && text(c.closedOn) &&
      rows(c.lines, l => text(l.title) && text(l.unit) && nonnegative(l.rate) && nonnegative(l.estimated) && (l.actual === null || nonnegative(l.actual))) &&
      rows(c.adjustments, a => text(a.title) && finite(a.amount) && validDate(a.date)) &&
      rows(c.payments, p => nonnegative(p.amount) && validDate(p.date) && text(p.notes) && attachmentsValid(p.attachments)) &&
      rows(c.installments, i => text(i.title) && nonnegative(i.amount)) && attachmentsValid(c.attachments) &&
      rows(c.warranties, w => text(w.title) && text(w.expires) && text(w.notes) && text(w.repairedOn) && attachmentsValid(w.attachments)) &&
      contractTotal(c) >= 0 && Number.isFinite(contractTotal(c)) &&
      (!c.final || contractIsFinal(c)) && (!c.closed || (contractIsFinal(c) && validDate(c.closedOn)))) &&
    rows(d.purchases, p => text(p.title) && text(p.supplier) && text(p.sectionId) && (p.sectionId === sharedSection || d.sections.some(s => s.id === p.sectionId)) &&
      nonnegative(p.amount) && validDate(p.date) && text(p.notes) && attachmentsValid(p.attachments) &&
      rows(p.refunds, r => nonnegative(r.amount) && validDate(r.date) && text(r.notes) && attachmentsValid(r.attachments)) && p.refunds.reduce((s: number, r: Refund) => s + toFils(r.amount), 0) <= toFils(p.amount));
}