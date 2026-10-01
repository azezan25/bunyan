import { contractBase, contractTotal, contractorPaid, contractorRemaining, contractIsFinal, money, dateLabel, today, type Contractor } from './project';

const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function statementText(c: Contractor, sectionName: string) {
  return [
    'بنيان — كشف حساب المقاول', `${c.name} · ${sectionName}`,
    `نوع الحساب: ${contractIsFinal(c) ? 'نهائي' : 'مؤقت'}`,
    `العقد الأساسي: ${money(contractBase(c))}`,
    ...c.lines.map(l => `${l.title}: ${l.actual ?? l.estimated} ${l.unit} × ${money(l.rate)}${l.actual === null ? ' (كمية تقديرية)' : ''}`),
    ...c.adjustments.map(a => `${a.title}: ${money(a.amount)} — ${dateLabel(a.date)}`),
    `إجمالي العقد: ${money(contractTotal(c))}`,
    ...(c.installments.length ? ['جدول الدفعات المتفق عليه (ليس دفعات مسددة):', ...c.installments.map(i => `${i.title}: ${money(i.amount)}`)] : []),
    'الدفعات المسددة:',
    ...c.payments.map(p => `${dateLabel(p.date)}: ${money(p.amount)}${p.notes ? ` — ${p.notes}` : ''}`),
    `المدفوع: ${money(contractorPaid(c))}`,
    `${contractorRemaining(c) < 0 ? 'رصيد لصالح المالك' : 'المتبقي'}: ${money(Math.abs(contractorRemaining(c)))}`,
    'المشتريات والمواد غير مشمولة في كشف المقاول. الدفعات تخصم من العقد ولا تضاف إلى التكلفة.',
    c.notes,
  ].filter(Boolean).join('\n');
}
export async function shareStatement(c: Contractor, sectionName: string) {
  const text = statementText(c, sectionName);
  if (navigator.share) {
    try { await navigator.share({ title: `كشف حساب ${c.name}`, text }); } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    }
  } else {
    await navigator.clipboard.writeText(text);
    alert('تم نسخ كشف الحساب. تقدر تلصقه في واتساب أو أي تطبيق.');
  }
}
export function printStatement(c: Contractor, sectionName: string) {
  // Open synchronously from the user's tap, including Safari.
  const w = window.open('', '_blank');
  if (!w) throw new Error('المتصفح منع فتح الكشف. اسمح بالنوافذ المنبثقة وجرب مرة ثانية.');
  const lines = c.lines.map(l => `<tr><td>${escape(l.title)}</td><td>${escape(l.unit)}</td><td>${l.estimated}</td><td>${l.actual ?? 'لم يعتمد'}</td><td>${escape(money(l.rate))}</td><td>${escape(money(((l.actual ?? l.estimated) - l.estimated) * l.rate))}</td></tr>`).join('');
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>كشف حساب ${escape(c.name)}</title><style>body{font:16px system-ui,sans-serif;color:#143c35;max-width:850px;margin:35px auto;padding:20px}h1{font-size:25px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:10px;text-align:right;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;font:inherit;line-height:1.9}button{padding:12px 20px;background:#143c35;color:white;border:0;border-radius:8px}@media print{button,.help{display:none}body{margin:0}}</style></head><body><h1>بنيان — كشف حساب</h1><p class="help">اختر طباعة، ثم مشاركة أو حفظ كـ PDF من شاشة الطباعة في الآيفون.</p><button onclick="window.print()">طباعة / حفظ PDF</button><pre>${escape(statementText(c, sectionName))}</pre>${lines ? `<h2>مقارنة الكيّال</h2><table><thead><tr><th>البند</th><th>الوحدة</th><th>التقديري</th><th>الفعلي</th><th>السعر</th><th>فرق المبلغ</th></tr></thead><tbody>${lines}</tbody></table>` : ''}<p>تاريخ الكشف: ${escape(dateLabel(today()))}</p></body></html>`);
  w.document.close();
}