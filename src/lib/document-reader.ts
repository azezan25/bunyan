import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractDocumentSuggestions, pdfTextItemsToRows } from './document-extractor';
export { extractDocumentSuggestions, pdfTextItemsToRows } from './document-extractor';
export type { DocumentSuggestions } from './document-extractor';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import type { DocumentSuggestions } from './document-extractor';

export type ReaderProgress = {
  message: string;
  progress?: number;
};

export type DocumentReadResult = DocumentSuggestions & {
  text: string;
  notices: string[];
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SCANNED_PDF_OCR_PAGES = 5;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('تم إلغاء قراءة المستند.', 'AbortError');
}

function makeTesseractProgress(onProgress?: (progress: ReaderProgress) => void) {
  return (message: { status: string; progress?: number }) => {
    const ratio = Number.isFinite(message.progress) ? message.progress : undefined;
    onProgress?.({
      message: message.status === 'recognizing text' ? 'جارٍ التعرّف على النص…' : 'جارٍ تجهيز ملفات التعرّف…',
      ...(ratio !== undefined ? { progress: ratio } : {}),
    });
  };
}

async function recognizeImage(
  image: HTMLCanvasElement | File,
  onProgress?: (progress: ReaderProgress) => void,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  onProgress?.({ message: 'قد يتطلب تشغيل التعرّف على النص اتصالاً بالإنترنت لتنزيل ملفاته واللغات العربية والإنجليزية، حتى في مرات الاستخدام اللاحقة؛ لا يُرسل المستند.' });
  const worker = await createWorker('ara+eng', undefined, { logger: makeTesseractProgress(onProgress) });
  const terminate = () => { void worker.terminate(); };
  signal?.addEventListener('abort', terminate, { once: true });
  try {
    throwIfAborted(signal);
    const result = await worker.recognize(image);
    throwIfAborted(signal);
    return result.data.text;
  } finally {
    signal?.removeEventListener('abort', terminate);
    await worker.terminate();
  }
}

async function readPdf(
  file: File,
  onProgress?: (progress: ReaderProgress) => void,
  signal?: AbortSignal,
): Promise<{ text: string; notices: string[] }> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const abortLoading = () => { void loadingTask.destroy().catch(() => undefined); };
  signal?.addEventListener('abort', abortLoading, { once: true });
  const notices = ['تتم قراءة نص PDF والتعرّف على الصفحات المصوّرة داخل المتصفح؛ لا يُرفع المستند.'];
  const pages: string[] = [];
  try {
    const pdf = await loadingTask.promise;
    let scannedPagesBeyondLimit = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      onProgress?.({ message: `قراءة صفحة PDF ${pageNumber} من ${pdf.numPages}…`, progress: pageNumber / pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const textLayer = pdfTextItemsToRows(
        content.items.filter((item): item is typeof item & { str: string } => 'str' in item),
      );

      if (textLayer.length >= 12) {
        pages.push(textLayer);
      } else if (pageNumber <= MAX_SCANNED_PDF_OCR_PAGES) {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.8, 2000 / Math.max(viewport.width, viewport.height));
        const workerCanvas = document.createElement('canvas');
        const workerContext = workerCanvas.getContext('2d', { willReadFrequently: false });
        if (!workerContext) throw new Error('تعذّر إنشاء مساحة رسم لقراءة صفحات PDF المصوّرة في هذا المتصفح.');
        workerCanvas.width = Math.max(1, Math.floor(viewport.width * scale));
        workerCanvas.height = Math.max(1, Math.floor(viewport.height * scale));
        await page.render({
          canvas: workerCanvas,
          canvasContext: workerContext,
          viewport: page.getViewport({ scale }),
        }).promise;
        const pageText = await recognizeImage(workerCanvas, progress => onProgress?.({
          ...progress,
          message: `صفحة PDF مصوّرة ${pageNumber}: ${progress.message}`,
        }), signal);
        pages.push(pageText);
        workerCanvas.width = 0;
        workerCanvas.height = 0;
      } else {
        scannedPagesBeyondLimit = true;
        pages.push('');
      }
      page.cleanup();
    }
    if (scannedPagesBeyondLimit) {
      notices.push(`للحفاظ على سرعة المعالجة، يقتصر التعرّف البصري على الصفحات المصوّرة من ملفات PDF على أول ${MAX_SCANNED_PDF_OCR_PAGES} صفحات. استخرج النص من بقية الصفحات أو أرفقها كصور منفصلة.`);
    }
    return { text: pages.join('\n\n').trim(), notices };
  } finally {
    signal?.removeEventListener('abort', abortLoading);
    await loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Extract text locally from an image or PDF. Scanned PDF pages are OCRed only
 * within the first five pages; PDF text layers can be read throughout the file.
 */
export async function readDocument(
  file: File,
  onProgress?: (progress: ReaderProgress) => void,
  signal?: AbortSignal,
): Promise<DocumentReadResult> {
  if (file.size > MAX_FILE_BYTES) throw new Error('حجم الملف يتجاوز الحد الأقصى وهو 10 ميغابايت لكل ملف.');
  throwIfAborted(signal);

  let text: string;
  let notices: string[];
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const result = await readPdf(file, onProgress, signal);
    text = result.text;
    notices = result.notices;
  } else if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    text = await recognizeImage(file, onProgress, signal);
    notices = ['تتم قراءة الصورة داخل المتصفح؛ لا تُرفع الصورة.'];
  } else {
    throw new Error('صيغة غير مدعومة للقراءة. يدعم التعرّف صور PNG وJPEG وWebP وملفات PDF فقط. حوّل HEIC إلى JPEG أولاً.');
  }

  return { text, notices, ...extractDocumentSuggestions(text) };
}