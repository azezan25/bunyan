export type DocumentSuggestions = {
  amount?: number;
  date?: string;
  installments?: { title: string; amount: number }[];
};

type PdfTextItem = {
  str: string;
  transform?: ArrayLike<number>;
  height?: number;
  hasEOL?: boolean;
};

const CURRENCY = /(?:\bKWD\b|\bKD\b|د\s*\.?\s*ك\s*\.?|دينار\s*كويتي)/i;
const INSTALLMENT_LABEL = /(?:الدفعة|دفعة|القسط|أقساط|اقساط|مرحلة|installment|payment|milestone|upon)/i;
const numericPattern = /\d[\d.,٬٫]*/g;

/**
 * Rebuild PDF.js text items into separate visual rows. PDF items commonly
 * represent each word as a separate item, so joining them without row breaks
 * makes totals and installment amounts indistinguishable.
 */
export function pdfTextItemsToRows(items: readonly PdfTextItem[]) {
  const lines: string[] = [];
  let line = '';
  let baseline: number | undefined;
  let lineHeight = 0;
  const pushLine = () => {
    const value = line.replace(/\s+/g, ' ').trim();
    if (value) lines.push(value);
    line = '';
    baseline = undefined;
    lineHeight = 0;
  };

  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const y = item.transform?.[5];
    const height = item.height ?? 0;
    const rowTolerance = Math.max(1.5, Math.max(height, lineHeight) * 0.2);
    if (line && y !== undefined && baseline !== undefined && Math.abs(y - baseline) > rowTolerance) pushLine();
    if (line) line += ` ${text}`;
    else line = text;
    if (y !== undefined) baseline = y;
    lineHeight = Math.max(lineHeight, height);
    if (item.hasEOL) pushLine();
  }
  pushLine();
  return lines.join('\n');
}

function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

function parseNumber(value: string): number | undefined {
  let normalized = normalizeDigits(value).replace(/[\s\u00a0]/g, '').replace(/٬/g, '');
  if (!normalized) return undefined;

  const arabicDecimal = normalized.includes('٫');
  if (arabicDecimal) {
    normalized = normalized.replace(/\./g, '').replace(/,/g, '').replace('٫', '.');
  } else if (normalized.includes('.')) {
    const lastDot = normalized.lastIndexOf('.');
    const fractionLength = normalized.length - lastDot - 1;
    normalized = fractionLength > 0 && fractionLength <= 3
      ? `${normalized.slice(0, lastDot).replace(/[.,]/g, '')}.${normalized.slice(lastDot + 1)}`
      : normalized.replace(/[.,]/g, '');
  } else if (normalized.includes(',')) {
    const lastComma = normalized.lastIndexOf(',');
    const fractionLength = normalized.length - lastComma - 1;
    normalized = fractionLength > 0 && fractionLength <= 2
      ? `${normalized.slice(0, lastComma).replace(/,/g, '')}.${normalized.slice(lastComma + 1)}`
      : normalized.replace(/,/g, '');
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function numericCandidates(line: string) {
  const normalized = normalizeDigits(line);
  return [...normalized.matchAll(numericPattern)].map(match => ({
    raw: match[0],
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    value: parseNumber(match[0]),
  })).filter((candidate): candidate is typeof candidate & { value: number } => {
    const followsPercent = /^\s*[%٪]/.test(line.slice(candidate.end));
    return candidate.value !== undefined && !followsPercent;
  });
}

function hasCurrencyNear(line: string, start: number, end: number) {
  return CURRENCY.test(line.slice(Math.max(0, start - 8), Math.min(line.length, end + 8)));
}

function totalLabelPriority(line: string): number {
  if (/\bsub[\s-]*total\b/i.test(line) || /(?:الإجمالي|الاجمالي|المجموع)\s+الفرعي/.test(line)) return 0;
  if (/\b(?:grand\s+total|final\s+total|amount\s+due|receipt\s+total|net\s+total)\b/i.test(line) ||
    /(?:الإجمالي|الاجمالي|المجموع)\s+(?:النهائي|الكلي)/.test(line)) return 3;
  if (/صافي\s+المبلغ|المبلغ\s+(?:الإجمالي|الاجمالي|المستحق)/.test(line)) return 2;
  if (/\btotal\b/i.test(line) ||
    /(?:^|[^\u0600-\u06ff])(?:الإجمالي|الاجمالي|المجموع|المطلوب)(?=$|[^\u0600-\u06ff])/.test(line)) return 1;
  return 0;
}

function parseDate(line: string): string | undefined {
  const normalized = normalizeDigits(line);
  const numericDate = normalized.match(/(?:^|\D)(\d{1,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})(?!\d)/);
  if (numericDate) {
    const [, first, second, third] = numericDate;
    let year: number;
    let month: number;
    let day: number;
    if (first.length === 4) {
      year = Number(first); month = Number(second); day = Number(third);
    } else {
      day = Number(first); month = Number(second); year = Number(third);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const months: Record<string, number> = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
    يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
    يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  };
  const wordDate = normalized.match(/(\d{1,2})\s+([a-z]+|[\u0600-\u06ff]+)\s+(\d{4})/i);
  if (wordDate) {
    const month = months[wordDate[2].toLowerCase()];
    const day = Number(wordDate[1]);
    const year = Number(wordDate[3]);
    if (month) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  return undefined;
}

/** Suggest a total only from an explicit, bounded receipt-total label. */
export function extractDocumentSuggestions(text: string): DocumentSuggestions {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const totalCandidates: { priority: number; lineIndex: number; amount: number }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const priority = totalLabelPriority(lines[i]);
    if (!priority) continue;
    const candidates = numericCandidates(lines[i]);
    const withCurrency = candidates.filter(candidate => hasCurrencyNear(lines[i], candidate.index, candidate.end));
    const candidate = withCurrency.at(-1) ?? candidates.at(-1);
    if (candidate) {
      totalCandidates.push({ priority, lineIndex: i, amount: candidate.value });
      continue;
    }

    // Some receipts put a labelled total on one row and its value on the next.
    // Do not borrow a payment/installment amount or another labelled total.
    const nextLine = lines[i + 1];
    if (!nextLine || totalLabelPriority(nextLine) || INSTALLMENT_LABEL.test(nextLine)) continue;
    const nextCandidates = numericCandidates(nextLine);
    const nextWithCurrency = nextCandidates.filter(value => hasCurrencyNear(nextLine, value.index, value.end));
    const nextAmount = nextWithCurrency.at(-1) ?? nextCandidates.at(-1);
    if (nextAmount) totalCandidates.push({ priority, lineIndex: i, amount: nextAmount.value });
  }

  const selectedTotal = totalCandidates.sort((a, b) => b.priority - a.priority || a.lineIndex - b.lineIndex)[0];
  const date = lines.map(parseDate).find((value): value is string => Boolean(value));
  const installments: { title: string; amount: number }[] = [];
  for (const line of lines) {
    if (!INSTALLMENT_LABEL.test(line)) continue;
    const candidates = numericCandidates(line).filter(candidate => hasCurrencyNear(line, candidate.index, candidate.end));
    const candidate = candidates.at(-1);
    if (!candidate) continue;
    const title = line.replace(/\s+/g, ' ').slice(0, 140);
    if (!installments.some(item => item.title === title && item.amount === candidate.value)) {
      installments.push({ title, amount: candidate.value });
    }
  }

  return {
    ...(selectedTotal ? { amount: selectedTotal.amount } : {}),
    ...(date ? { date } : {}),
    ...(installments.length ? { installments } : {}),
  };
}