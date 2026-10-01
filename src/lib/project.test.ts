import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupDue, contractIsFinal, contractTotal, contractorRemaining, duplicatePayment, duplicatePurchase, emptyProject, isProjectData, purchaseNet, totals, type Contractor, type Purchase } from './project.ts';

function contract(): Contractor {
  return { id: 'c', name: 'مقاول', sectionId: 'section-0', phone: '', kind: 'unit', fixedAmount: 0,
    lines: [{ id: 'l', title: 'تركيب', unit: 'م²', rate: 3.5, estimated: 100, actual: null }],
    adjustments: [], payments: [], installments: [], attachments: [], warranties: [], closed: false, final: false, closedOn: '', notes: '' };
}
function purchase(): Purchase {
  return { id: 'p', title: 'سيراميك', supplier: 'المورد', sectionId: 'shared', amount: 100, date: '2026-10-01', notes: '', attachments: [], refunds: [] };
}
test('progress payments are deducted, not added to cost; shared materials once', () => {
  const d = emptyProject(), c = contract(), p = purchase();
  c.payments.push({ id: 'pay', amount: 125, date: '2026-10-01', notes: '', attachments: [] });
  d.contractors.push(c); d.purchases.push(p);
  assert.deepEqual(totals(d), { total: 450, paid: 225, remaining: 225, final: false, purchases: 100 });
  assert.equal(totals(d, 'shared').total, 100);
  assert.equal(totals(d, 'section-0').total, 350);
});
test('actual measurements, adjustments and discounts use the agreed rates', () => {
  const c = contract(); c.lines[0].actual = 120;
  c.lines.push({ id: 'l2', title: 'وزرة', unit: 'م', rate: 2, estimated: 10, actual: 8 });
  c.adjustments.push({ id: 'a', title: 'إضافة', amount: 50, date: '2026-10-01' }, { id: 'b', title: 'خصم', amount: -10, date: '2026-10-01' });
  assert.equal(contractTotal(c), 476);
  c.final = true; assert.equal(contractIsFinal(c), true);
  c.lines[1].actual = null; assert.equal(contractIsFinal(c), false);
});
test('fixed contract and overpayments yield a credit', () => {
  const c = contract(); c.kind = 'fixed'; c.fixedAmount = 100;
  c.payments.push({ id: 'p', amount: 150, date: '2026-10-01', notes: '', attachments: [] });
  assert.equal(contractTotal(c), 100); assert.equal(contractorRemaining(c), -50);
});
test('refund lowers cost and paid equally, rejects excess on restore', () => {
  const d = emptyProject(), p = purchase();
  p.refunds.push({ id: 'r', amount: 25, date: '2026-10-01', notes: '', attachments: [] }); d.purchases.push(p);
  assert.equal(purchaseNet(p), 75); assert.equal(totals(d).remaining, 0); assert.equal(isProjectData(d), true);
  p.refunds[0].amount = 101; assert.equal(isProjectData(d), false);
});
test('duplicate checks exclude edited self', () => {
  const d = emptyProject(), p = purchase(), c = contract(); d.purchases.push(p);
  assert.equal(duplicatePurchase(d, p), false);
  assert.equal(duplicatePurchase(d, { ...p, id: 'other' }), true);
  const pay = { id: 'pay', amount: 10, date: '2026-10-01', notes: '', attachments: [] }; c.payments.push(pay);
  assert.equal(duplicatePayment(c, pay), false); assert.equal(duplicatePayment(c, { ...pay, id: 'other' }), true);
});
test('backup reminders respect empty project, first backup, change count and elapsed days', () => {
  const d = emptyProject(); assert.equal(backupDue(d), false);
  d.purchases.push(purchase()); assert.equal(backupDue(d), true);
  d.lastBackup = new Date().toISOString(); assert.equal(backupDue(d), false);
  d.backupChangeCount = 5; assert.equal(backupDue(d), true);
  d.backupChangeCount = 0; d.lastBackup = new Date(Date.now() - 8 * 86400000).toISOString(); assert.equal(backupDue(d), true);
});
test('backup schema rejects corruption, NaN and orphan sections', () => {
  const d = emptyProject(); assert.equal(isProjectData(d), true);
  d.contractors.push(contract()); assert.equal(isProjectData(d), true);
  d.contractors[0].fixedAmount = NaN; assert.equal(isProjectData(d), false);
  d.contractors[0].fixedAmount = 0; d.contractors[0].sectionId = 'missing'; assert.equal(isProjectData(d), false);
  assert.equal(isProjectData(null), false); assert.equal(isProjectData({ version: 2 }), false);
});
test('fils arithmetic accepts 100+200 fils refund of 300 fils', () => {
  const d = emptyProject(), p = purchase(); p.amount = 0.3;
  p.refunds = [0.1, 0.2].map((amount, i) => ({ id: String(i), amount, date: '2026-10-01', notes: '', attachments: [] }));
  d.purchases.push(p);
  assert.equal(isProjectData(d), true); assert.equal(purchaseNet(p), 0); assert.equal(totals(d).paid, 0);
});
test('negative contracts and inconsistent closed/final states are rejected', () => {
  const d = emptyProject(), c = contract(); d.contractors.push(c);
  c.adjustments.push({ id: 'a', title: 'خصم', amount: -400, date: '2026-10-01' });
  assert.equal(isProjectData(d), false);
  c.adjustments = []; c.closed = true; c.closedOn = '2026-10-01';
  assert.equal(isProjectData(d), false);
  c.final = true; assert.equal(isProjectData(d), false);
  c.lines[0].actual = 100; assert.equal(isProjectData(d), true);
});
test('new unit account may be provisional until its lines are entered, never final while empty', () => {
  const d = emptyProject(), c = contract(); c.lines = []; d.contractors.push(c);
  assert.equal(isProjectData(d), true); assert.equal(contractIsFinal(c), false);
  c.final = true; assert.equal(isProjectData(d), false);
});