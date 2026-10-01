import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Check, Download, FileText, ImagePlus, LoaderCircle, Pencil, ScanText, Trash2, X } from 'lucide-react';
import { uid, type Attachment } from '../lib/project';
import { extractDocumentSuggestions, readDocument, type DocumentSuggestions, type ReaderProgress } from '../lib/document-reader';
import './doc-import.css';

export type DocumentImportResult = {
  text: string;
  amount?: number;
  date?: string;
  installments?: { title: string; amount: number }[];
};

export interface DocumentImportProps {
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
  onExtract?: (result: DocumentImportResult) => void;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const SUPPORTED_EXTENSIONS = /\.(?:png|jpe?g|webp|pdf)$/i;

function isHeic(file: File) {
  return /(?:heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
}

function fileMime(file: File) {
  if (SUPPORTED_MIMES.has(file.type)) return file.type;
  if (!file.type) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'pdf') return 'application/pdf';
  }
  return '';
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذّرت قراءة الملف المختار.'));
    reader.onerror = () => reject(new Error('تعذّرت قراءة الملف المختار.'));
    reader.onabort = () => reject(new Error('أُلغيت قراءة الملف.'));
    reader.readAsDataURL(file);
  });
}

function attachmentToFile(attachment: Attachment) {
  const separator = attachment.data.indexOf(',');
  if (separator < 0) throw new Error('بيانات المرفق غير صالحة، أعد إرفاق الملف وحاول مرة أخرى.');
  const binary = atob(attachment.data.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], attachment.name, { type: attachment.mime });
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت` : `${(bytes / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

function arabicReadError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/[\u0600-\u06ff]/.test(message)) return message;
  if (/network|fetch|language|traineddata|download/i.test(message)) {
    return 'تعذّر تنزيل ملفات التعرّف على النص. تحقّق من اتصال الإنترنت ثم حاول مرة أخرى.';
  }
  if (/password|encrypt/i.test(message)) return 'ملف PDF محمي أو مشفّر ولا يمكن قراءة نصه.';
  return 'تعذّرت قراءة هذا المستند. تحقّق من سلامة الملف وصيغته ثم حاول مرة أخرى.';
}

function suggestionsFor(text: string): DocumentSuggestions {
  return extractDocumentSuggestions(text);
}

export function DocumentImport({ attachments, onChange, onExtract }: DocumentImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [readError, setReadError] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [draftText, setDraftText] = useState('');
  const [reviewingName, setReviewingName] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    const nextErrors: string[] = [];
    const added: Attachment[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        nextErrors.push(`${file.name}: الحجم ${formatBytes(file.size)} ويتجاوز الحد الأقصى 10 ميغابايت لكل ملف.`);
        continue;
      }
      if (isHeic(file)) {
        nextErrors.push(`${file.name}: صيغة HEIC/HEIF غير مدعومة حالياً. حوّل صورة iPhone إلى JPEG ثم أعد إرفاقها.`);
        continue;
      }
      const mime = fileMime(file);
      if (!mime || (!SUPPORTED_EXTENSIONS.test(file.name) && !SUPPORTED_MIMES.has(file.type))) {
        nextErrors.push(`${file.name}: صيغة غير مدعومة. الصيغ المدعومة هي PNG وJPEG وWebP وPDF. حوّل HEIC إلى JPEG.`);
        continue;
      }
      try {
        added.push({ id: uid(), name: file.name, mime, data: await fileToDataUrl(file) });
      } catch (error) {
        nextErrors.push(`${file.name}: ${error instanceof Error ? error.message : 'تعذّرت قراءة الملف.'}`);
      }
    }

    if (added.length) onChange([...attachments, ...added]);
    setErrors(nextErrors);
  };

  const startReview = async (attachment: Attachment) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReadingId(attachment.id);
    setReviewingName(attachment.name);
    setReadError('');
    setCancelled(false);
    setDraftText('');
    setNotices([]);
    setProgress({ message: 'بدء المعالجة محلياً…' });
    try {
      const file = attachmentToFile(attachment);
      const result = await readDocument(file, value => {
        if (abortRef.current === controller) setProgress(value);
      }, controller.signal);
      if (abortRef.current !== controller) return;
      setDraftText(result.text);
      setNotices(result.notices);
      if (!result.text.trim()) {
        setReadError('لم يُعثر على نص واضح. جرّب صورة أوضح وتحقّق من اتصال الإنترنت؛ فقد يحتاج التعرّف إلى تنزيل ملفاته ولغاته حتى في مرات الاستخدام اللاحقة.');
      }
    } catch (error) {
      if (abortRef.current !== controller) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setCancelled(true);
      } else {
        setReadError(arabicReadError(error));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setReadingId(null);
        setProgress(null);
      }
    }
  };

  const cancelReview = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setReadingId(null);
    setProgress(null);
    setCancelled(true);
  };

  const beginRename = (attachment: Attachment) => {
    setEditingAttachmentId(attachment.id);
    setEditedName(attachment.name);
  };

  const saveRename = (id: string) => {
    const name = editedName.trim();
    if (!name) {
      setErrors(['اكتب اسماً للمرفق قبل الحفظ.']);
      return;
    }
    onChange(attachments.map(attachment => attachment.id === id ? { ...attachment, name } : attachment));
    setEditingAttachmentId(null);
    setEditedName('');
  };

  const removeAttachment = (id: string) => {
    onChange(attachments.filter(attachment => attachment.id !== id));
    if (readingId === id) cancelReview();
    if (editingAttachmentId === id) setEditingAttachmentId(null);
    setErrors([]);
  };

  const currentSuggestions = suggestionsFor(draftText);
  const applyReview = () => {
    if (!onExtract || !draftText.trim()) return;
    onExtract({ text: draftText, ...currentSuggestions });
  };

  return (
    <section className="doc-import" dir="rtl" aria-label="إرفاق المستندات وقراءة النص">
      <div className="doc-import__heading">
        <div className="doc-import__heading-icon" aria-hidden="true"><ImagePlus size={19} /></div>
        <div>
          <h3>المرفقات وقراءة المستند</h3>
          <p>أرفق إيصالاتك محلياً، واستخرج النص لمراجعته قبل استخدامه.</p>
        </div>
      </div>

      <div className="doc-import__privacy" role="note">
        <span className="doc-import__privacy-dot" />
        <span>الملفات تبقى في متصفحك ولا تُرفع. الحد الأقصى 10 ميغابايت لكل ملف. قد يتطلب التعرّف اتصالاً بالإنترنت لتنزيل ملفات التشغيل واللغات حتى في مرات الاستخدام اللاحقة؛ لا يُرسل المستند.</span>
      </div>

      <label className="doc-import__picker">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.heic,.heif"
          multiple
          onChange={handleFiles}
          aria-label="اختيار صور أو ملفات PDF"
        />
        <span className="doc-import__picker-icon"><ImagePlus size={19} /></span>
        <span className="doc-import__picker-copy">
          <strong>إضافة صور أو PDF</strong>
          <small>PNG · JPEG · WebP · PDF — حتى 10 ميغابايت للملف</small>
        </span>
        <span className="doc-import__picker-action">اختيار الملفات</span>
      </label>
      <p className="doc-import__format-note">
        قد تظهر صور iPhone بصيغة HEIC في الاختيار، لكنها غير مدعومة هنا؛ حوّلها إلى JPEG أولاً.
      </p>

      {errors.length > 0 && (
        <div className="doc-import__errors" role="alert">
          {errors.map((error, index) => <p key={`${index}-${error}`}>{error}</p>)}
        </div>
      )}

      <div className="doc-import__list-heading">
        <span>الملفات الحالية</span><span>{attachments.length}</span>
      </div>
      {attachments.length > 0 ? (
        <ul className="doc-import__list">
          {attachments.map(attachment => {
            const isImage = attachment.mime.startsWith('image/');
            const isReading = readingId === attachment.id;
            return (
              <li key={attachment.id} className="doc-import__file">
                {isImage
                  ? <img className="doc-import__thumbnail" src={attachment.data} alt="" />
                  : <span className="doc-import__pdf-icon" aria-hidden="true"><FileText size={19} /></span>}
                <div className="doc-import__file-info">
                  {editingAttachmentId === attachment.id ? (
                    <div className="doc-import__rename">
                      <input
                        value={editedName}
                        onChange={event => setEditedName(event.currentTarget.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') saveRename(attachment.id);
                          if (event.key === 'Escape') setEditingAttachmentId(null);
                        }}
                        aria-label={`اسم المرفق ${attachment.name}`}
                        autoFocus
                      />
                      <button type="button" className="doc-import__icon-button" onClick={() => saveRename(attachment.id)} aria-label="حفظ اسم المرفق"><Check size={15} /></button>
                      <button type="button" className="doc-import__icon-button" onClick={() => setEditingAttachmentId(null)} aria-label="إلغاء تعديل الاسم"><X size={15} /></button>
                    </div>
                  ) : (
                    <a className="doc-import__filename" href={attachment.data} target="_blank" rel="noopener noreferrer" title="عرض الملف">
                      {attachment.name}
                    </a>
                  )}
                  <small>{attachment.mime === 'application/pdf' ? 'ملف PDF · عرض' : 'صورة · عرض'}</small>
                </div>
                <div className="doc-import__file-actions">
                  <button
                    type="button"
                    className="doc-import__icon-button"
                    onClick={() => beginRename(attachment)}
                    aria-label={`تعديل اسم ${attachment.name}`}
                    title="تعديل الاسم"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="doc-import__icon-button"
                    onClick={() => void startReview(attachment)}
                    disabled={Boolean(readingId)}
                    aria-label={`استخراج النص من ${attachment.name}`}
                    title="قراءة النص لمراجعته"
                  >
                    {isReading ? <LoaderCircle size={16} className="doc-import__spin" /> : <ScanText size={16} />}
                  </button>
                  <a className="doc-import__icon-button" href={attachment.data} download={attachment.name} aria-label={`تنزيل ${attachment.name}`} title="تنزيل">
                    <Download size={15} />
                  </a>
                  <button
                    type="button"
                    className="doc-import__icon-button doc-import__icon-button--remove"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`حذف ${attachment.name}`}
                    title="حذف"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="doc-import__empty">لا توجد مرفقات بعد.</div>
      )}

      {readingId && (
        <div className="doc-import__progress" role="status" aria-live="polite">
          <div className="doc-import__progress-line">
            <LoaderCircle size={16} className="doc-import__spin" />
            <span>{progress?.message ?? 'جارٍ قراءة المستند…'}</span>
            <button type="button" className="doc-import__cancel" onClick={cancelReview}>إلغاء</button>
          </div>
          {progress?.progress !== undefined && (
            <div className="doc-import__progress-track" aria-label={`${Math.round(progress.progress * 100)}%`}>
              <span style={{ width: `${Math.max(0, Math.min(100, progress.progress * 100))}%` }} />
            </div>
          )}
        </div>
      )}
      {cancelled && <p className="doc-import__cancelled" role="status">أُلغيت قراءة المستند. لم تُطبّق أي بيانات مستخرجة.</p>}
      {readError && <div className="doc-import__errors" role="alert"><p>{readError}</p></div>}

      {notices.map((notice, index) => <p className="doc-import__notice" role="note" key={`${index}-${notice}`}>{notice}</p>)}

      {draftText !== '' && (
        <div className="doc-import__review">
          <div className="doc-import__review-heading">
            <div>
              <strong>مراجعة النص المستخرج</strong>
              <small>{reviewingName} — راجع النص وصحّحه قبل التطبيق.</small>
            </div>
            <button
              type="button"
              className="doc-import__icon-button"
              onClick={() => { setDraftText(''); setNotices([]); }}
              aria-label="إغلاق مراجعة النص"
              title="إغلاق"
            ><X size={16} /></button>
          </div>
          <textarea
            className="doc-import__textarea"
            value={draftText}
            onChange={event => setDraftText(event.currentTarget.value)}
            placeholder="سيظهر النص المقروء هنا للمراجعة…"
            aria-label="النص المستخرج القابل للتعديل"
            dir="auto"
            rows={8}
          />
          <div className="doc-import__suggestions">
            <strong>اقتراحات للمراجعة فقط</strong>
            <span>{currentSuggestions.amount !== undefined ? `الإجمالي المسمّى: ${currentSuggestions.amount} د.ك` : 'لم يُعثر على إجمالي واضح مُسمّى.'}</span>
            <span>{currentSuggestions.date ? `التاريخ: ${currentSuggestions.date}` : 'لم يُعثر على تاريخ واضح.'}</span>
            {currentSuggestions.installments?.length
              ? <span>الأقساط ذات المبالغ الواضحة: {currentSuggestions.installments.map(item => `${item.title} — ${item.amount} د.ك`).join('؛ ')}</span>
              : <span>لم يُعثر على أقساط بمبالغ واضحة.</span>}
          </div>
          {onExtract && (
            <button type="button" className="doc-import__apply" onClick={applyReview}>
              تطبيق النص بعد المراجعة
            </button>
          )}
          <p className="doc-import__review-note">لن يُطبّق أي اقتراح تلقائياً؛ استخدم الزر بعد مراجعة النص. تحقّق يدوياً من الأرقام والتواريخ.</p>
        </div>
      )}
    </section>
  );
}

export default DocumentImport;