import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentSuggestions, pdfTextItemsToRows } from './document-extractor.ts';

test('prefers an explicitly labelled grand total over a subtotal', () => {
  const result = extractDocumentSuggestions('Subtotal 100 KWD\nGrand Total 120 KWD');
  assert.equal(result.amount, 120);
});

test('preserves PDF text rows so total and multiple installment amounts stay distinct', () => {
  const row = (str: string, y: number) => ({
    str,
    transform: [1, 0, 0, 10, 10, y],
    height: 10,
    hasEOL: false,
  });
  const pdfText = pdfTextItemsToRows([
    row('Total', 700), row('1,000 KWD', 700),
    row('First installment', 680), row('200 KWD', 680),
    row('Second installment', 660), row('800 KWD', 660),
  ]);

  assert.equal(pdfText, 'Total 1,000 KWD\nFirst installment 200 KWD\nSecond installment 800 KWD');
  const result = extractDocumentSuggestions(pdfText);
  assert.equal(result.amount, 1000);
  assert.deepEqual(result.installments?.map(item => item.amount), [200, 800]);
});

test('reads Arabic digits, KWD decimals, dates, and installment amounts without treating percentages as money', () => {
  const result = extractDocumentSuggestions([
    'الإجمالي النهائي ١٢٫٥٠٠ د.ك',
    'التاريخ ١٥/٠٢/٢٠٢٥',
    'الدفعة الأولى ٢٫٢٥٠ د.ك',
    'دفعة ٢٥٪ من العقد — ١٠٠ د.ك',
  ].join('\n'));

  assert.equal(result.amount, 12.5);
  assert.equal(result.date, '2025-02-15');
  assert.deepEqual(result.installments?.map(item => item.amount), [2.25, 100]);
});

test('does not guess a total from unrelated amounts when there is no total label', () => {
  const result = extractDocumentSuggestions('Materials 100 KWD\nPayment 200 KWD');
  assert.equal(result.amount, undefined);
});