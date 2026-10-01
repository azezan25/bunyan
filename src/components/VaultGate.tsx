import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  backupBlob,
  createRecoveryKey,
  createVaultEnvelope,
  encryptVaultData,
  readVaultEnvelope,
  rewrapVaultPassword,
  rewrapVaultPasswordWithRecovery,
  unlockBackup,
  unlockVaultWithPassword,
  type VaultEnvelope,
  type VaultGateProps,
  type VaultSession,
  type VaultValidation,
  writeVaultEnvelope,
  VAULT_IDLE_TIMEOUT_MS,
} from '@/lib/vault';

type GateMode = 'loading' | 'storage-error' | 'setup' | 'unlock' | 'recovery' | 'open';
type ActiveSession = { id: number; key: CryptoKey };

const styles = `
  .vault-shell { color: #19343a; font-family: inherit; }
  .vault-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(ellipse at top, #edf2eb 0%, #f8f7f1 58%, #f1eee5 100%); }
  .vault-panel { width: min(100%, 480px); padding: 30px; border: 1px solid #e5e3d8; border-radius: 24px; background: #fffefa; box-shadow: 0 20px 55px rgba(33, 57, 52, .10); }
  .vault-brand { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; }
  .vault-logo { width: 48px; height: 48px; border-radius: 14px; }
  .vault-brand-name { color: #19343a; font-size: 15px; font-weight: 800; }
  .vault-eyebrow { margin: 0 0 7px; color: #ad6d39; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
  .vault-title { margin: 0; color: #19343a; font-size: 23px; line-height: 1.35; font-weight: 800; }
  .vault-copy { margin: 9px 0 22px; color: #6e7b76; font-size: 13px; line-height: 1.8; }
  .vault-form { display: grid; gap: 14px; }
  .vault-field-label { display: grid; gap: 7px; color: #455a54; font-size: 12px; font-weight: 700; }
  .vault-input { box-sizing: border-box; width: 100%; min-height: 44px; border: 1px solid #dcded5; border-radius: 11px; padding: 10px 12px; background: #fff; color: #19343a; font: inherit; font-size: 14px; outline: none; }
  .vault-input:focus { border-color: #39776d; box-shadow: 0 0 0 3px rgba(57, 119, 109, .14); }
  .vault-primary, .vault-secondary { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 11px; padding: 10px 15px; font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
  .vault-primary { background: #285c55; color: white; }
  .vault-primary:hover { background: #204e48; }
  .vault-primary:disabled { cursor: not-allowed; opacity: .55; }
  .vault-secondary { border: 1px solid #dde2d9; background: #f6f7f2; color: #365b53; }
  .vault-link { border: 0; padding: 5px 0; background: transparent; color: #39756d; font: inherit; font-size: 12px; font-weight: 700; text-decoration: underline; cursor: pointer; }
  .vault-note, .vault-error { border-radius: 12px; padding: 12px 14px; font-size: 12px; line-height: 1.8; }
  .vault-note { background: #f1f5ef; color: #48675c; }
  .vault-error { margin: 0 0 15px; background: #fbedeb; color: #983f37; }
  .vault-recovery-key { display: block; overflow-wrap: anywhere; border: 1px dashed #b7c2b5; border-radius: 12px; padding: 13px; background: #f5f7f1; color: #264d45; direction: ltr; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; font-weight: 800; letter-spacing: .055em; user-select: all; }
  .vault-check { display: flex; align-items: flex-start; gap: 9px; color: #50625b; font-size: 12px; line-height: 1.7; cursor: pointer; }
  .vault-check input { margin-top: 3px; accent-color: #39776d; }
  .vault-spinning { text-align: center; color: #587169; }
  @media (max-width: 540px) { .vault-panel { padding: 24px 20px; } }
`;

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function assertPasswordPair(password: string, confirmation: string): void {
  if (password.length < 8) throw new Error('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
  if (password !== confirmation) throw new Error('كلمتا المرور غير متطابقتين.');
}

export default function VaultGate<T>({ initialData, children, validateData }: VaultGateProps<T>) {
  const [mode, setMode] = useState<GateMode>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [openedData, setOpenedData] = useState<T | null>(null);
  const [hasOpenedData, setHasOpenedData] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmation, setSetupConfirmation] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const envelopeRef = useRef<VaultEnvelope | null>(null);
  const activeSessionRef = useRef<ActiveSession | null>(null);
  const sessionIdRef = useRef(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setMode('loading');
    setError('');
    readVaultEnvelope().then((envelope) => {
      if (cancelled) return;
      envelopeRef.current = envelope;
      setMode(envelope ? 'unlock' : 'setup');
    }).catch((cause: unknown) => {
      if (cancelled) return;
      envelopeRef.current = null;
      setError(messageFrom(cause, 'تعذر فتح الخزنة من التخزين المحلي.'));
      setMode('storage-error');
    });
    return () => { cancelled = true; };
  }, [retry]);

  const lock = useCallback(() => {
    activeSessionRef.current = null;
    sessionIdRef.current += 1;
    setOpenedData(null);
    setHasOpenedData(false);
    setUnlockPassword('');
    setRecoveryInput('');
    setNewPassword('');
    setNewPasswordConfirmation('');
    setMode(envelopeRef.current ? 'unlock' : 'setup');
    setError('');
  }, []);

  const openSession = useCallback((key: CryptoKey, value: T) => {
    sessionIdRef.current += 1;
    activeSessionRef.current = { id: sessionIdRef.current, key };
    setOpenedData(value);
    setHasOpenedData(true);
    setUnlockPassword('');
    setRecoveryInput('');
    setNewPassword('');
    setNewPasswordConfirmation('');
    setSetupPassword('');
    setSetupConfirmation('');
    setError('');
    setMode('open');
  }, []);

  const enqueueWrite = useCallback(<R,>(operation: () => Promise<R>): Promise<R> => {
    const result = writeQueueRef.current.then(operation);
    writeQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const saveSetup = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!recoveryAcknowledged) throw new Error('احفظ مفتاح الاستعادة أولاً ثم أكد ذلك للمتابعة.');
      if (validateData && !validateData(initialData)) throw new Error('بيانات البداية لا تطابق بنية المشروع المطلوبة.');
      const created = await createVaultEnvelope(initialData, setupPassword, recoveryCode);
      await writeVaultEnvelope(created.envelope, null);
      envelopeRef.current = created.envelope;
      setSetupPassword('');
      setSetupConfirmation('');
      openSession(created.key, initialData);
      setRecoveryCode('');
      setRecoveryAcknowledged(false);
    } catch (cause) {
      setError(messageFrom(cause, 'تعذر إنشاء الخزنة الآمنة.'));
    } finally {
      setBusy(false);
    }
  };

  const prepareRecovery = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      assertPasswordPair(setupPassword, setupConfirmation);
      setRecoveryCode(createRecoveryKey());
      setRecoveryAcknowledged(false);
    } catch (cause) {
      setError(messageFrom(cause, 'تعذر إنشاء مفتاح الاستعادة.'));
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    const envelope = envelopeRef.current;
    if (!envelope) {
      setError('تعذر العثور على بيانات الخزنة. أعد تحميل الصفحة.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const opened = await unlockVaultWithPassword<T>(envelope, unlockPassword, validateData);
      openSession(opened.key, opened.data);
    } catch (cause) {
      setError(messageFrom(cause, 'تعذر فتح الخزنة.'));
    } finally {
      setBusy(false);
    }
  };

  const recover = async (event: FormEvent) => {
    event.preventDefault();
    const envelope = envelopeRef.current;
    if (!envelope) {
      setError('تعذر العثور على بيانات الخزنة. أعد تحميل الصفحة.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      assertPasswordPair(newPassword, newPasswordConfirmation);
      const restored = await rewrapVaultPasswordWithRecovery<T>(envelope, recoveryInput, newPassword, validateData);
      await writeVaultEnvelope(restored.envelope, envelope);
      if (envelopeRef.current === envelope) envelopeRef.current = restored.envelope;
      openSession(restored.key, restored.data);
    } catch (cause) {
      setError(messageFrom(cause, 'تعذر استعادة الخزنة.'));
    } finally {
      setBusy(false);
    }
  };

  const session = useMemo<VaultSession<T> | null>(() => {
    if (mode !== 'open' || !hasOpenedData || !activeSessionRef.current) return null;
    const sessionId = activeSessionRef.current.id;
    const assertActive = () => {
      if (!activeSessionRef.current || activeSessionRef.current.id !== sessionId) {
        throw new Error('الخزنة مقفلة. افتحها مجدداً للمتابعة.');
      }
    };
    return {
      data: openedData as T,
      lock,
      save: async (nextData) => {
        assertActive();
        if (validateData && !validateData(nextData)) throw new Error('البيانات لا تطابق بنية المشروع المطلوبة.');
        await enqueueWrite(async () => {
          assertActive();
          const currentEnvelope = envelopeRef.current;
          const activeSession = activeSessionRef.current;
          if (!currentEnvelope || !activeSession) throw new Error('الخزنة مقفلة. افتحها مجدداً للمتابعة.');
          const encryptedData = await encryptVaultData(activeSession.key, nextData);
          assertActive();
          const updatedEnvelope = { ...currentEnvelope, data: encryptedData };
          await writeVaultEnvelope(updatedEnvelope, currentEnvelope);
          if (envelopeRef.current === currentEnvelope) envelopeRef.current = updatedEnvelope;
          if (activeSessionRef.current?.id === sessionId) {
            setOpenedData(nextData);
          }
        });
      },
      exportBackup: async () => {
        assertActive();
        await enqueueWrite(async () => {
          assertActive();
          const envelope = envelopeRef.current ?? await readVaultEnvelope();
          if (!envelope) throw new Error('لا توجد خزنة لتصديرها.');
          const url = URL.createObjectURL(backupBlob(envelope));
          try {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `binaa-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
          } finally {
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        });
      },
      restoreBackup: async (file, password) => {
        assertActive();
        if (!validateData) throw new Error('لا يمكن استعادة نسخة احتياطية دون دالة تحقق من بنية بيانات المشروع.');
        return unlockBackup<T>(file, password, validateData);
      },
      changePassword: async (current, next) => {
        assertActive();
        if (next.length < 8) throw new Error('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
        await enqueueWrite(async () => {
          assertActive();
          const envelope = envelopeRef.current;
          if (!envelope) throw new Error('تعذر العثور على الخزنة.');
          const updatedEnvelope = await rewrapVaultPassword(envelope, current, next);
          assertActive();
          await writeVaultEnvelope(updatedEnvelope, envelope);
          if (envelopeRef.current === envelope) envelopeRef.current = updatedEnvelope;
          if (activeSessionRef.current?.id !== sessionId) return;
        });
      },
    };
  }, [mode, hasOpenedData, openedData, lock, enqueueWrite, validateData]);

  useEffect(() => {
    if (mode !== 'open' || !activeSessionRef.current) return;
    let idleTimer = 0;
    let backgroundTimer = 0;
    const resetIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(lock, VAULT_IDLE_TIMEOUT_MS);
    };
    const onVisibilityChange = () => {
      window.clearTimeout(backgroundTimer);
      if (document.visibilityState === 'hidden') {
        backgroundTimer = window.setTimeout(lock, VAULT_IDLE_TIMEOUT_MS);
      } else {
        resetIdle();
      }
    };
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdle, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);
    resetIdle();
    if (document.visibilityState === 'hidden') onVisibilityChange();
    return () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(backgroundTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdle));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode, lock]);

  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setError('تم نسخ مفتاح الاستعادة.');
    } catch {
      setError('تعذر النسخ تلقائياً. حدّد المفتاح وانسخه يدوياً.');
    }
  };

  if (mode === 'loading') {
    return <div className="vault-shell" dir="rtl"><style>{styles}</style><div className="vault-panel">
      <div className="vault-brand"><img className="vault-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><span className="vault-brand-name">بنيان · حسابات البناء</span></div>
      <div className="vault-spinning" role="status">جارٍ فتح الخزنة الآمنة…</div>
    </div></div>;
  }

  if (mode === 'storage-error') {
    return <div className="vault-shell" dir="rtl"><style>{styles}</style><section className="vault-panel" aria-labelledby="vault-title">
      <div className="vault-brand"><img className="vault-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><span className="vault-brand-name">بنيان · حسابات البناء</span></div>
      <p className="vault-eyebrow">حماية بياناتك محلياً</p>
      <h1 id="vault-title" className="vault-title">تعذر الوصول إلى الخزنة</h1>
      <p className="vault-copy">لم يتم حفظ أي بيانات في مكان بديل. تحقق من إعدادات التخزين في المتصفح ثم أعد المحاولة.</p>
      <p className="vault-error" role="alert">{error}</p>
      <button className="vault-primary" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button>
    </section></div>;
  }

  if (mode === 'open' && session) {
    return <>{children(session)}</>;
  }

  return <div className="vault-shell" dir="rtl">
    <style>{styles}</style>
    <section className="vault-panel" aria-labelledby="vault-title">
      <div className="vault-brand"><img className="vault-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><span className="vault-brand-name">بنيان · حسابات البناء</span></div>
      <p className="vault-eyebrow">حماية بياناتك محلياً</p>
      {error && <p className="vault-error" role="alert">{error}</p>}

      {mode === 'setup' && !recoveryCode && <>
        <h1 id="vault-title" className="vault-title">أنشئ خزنتك الآمنة</h1>
        <p className="vault-copy">بيانات مشروعك ستُشفّر على هذا الجهاز ولا تُرسل إلى أي حساب أو خادم. اختر كلمة مرور قوية واحفظها.</p>
        <form className="vault-form" onSubmit={prepareRecovery}>
          <label className="vault-field-label">كلمة المرور<input className="vault-input" type="password" autoComplete="new-password" minLength={8} required value={setupPassword} onChange={event => setSetupPassword(event.target.value)} /></label>
          <label className="vault-field-label">تأكيد كلمة المرور<input className="vault-input" type="password" autoComplete="new-password" minLength={8} required value={setupConfirmation} onChange={event => setSetupConfirmation(event.target.value)} /></label>
          <p className="vault-note">تُشتق مفاتيح التشفير محلياً باستخدام PBKDF2، ولا يمكن استعادة البيانات دون كلمة المرور أو مفتاح الاستعادة.</p>
          <button type="submit" className="vault-primary">متابعة وإظهار مفتاح الاستعادة</button>
        </form>
      </>}

      {mode === 'setup' && recoveryCode && <>
        <h1 id="vault-title" className="vault-title">احفظ مفتاح الاستعادة</h1>
        <p className="vault-copy">يُعرض هذا المفتاح الآن فقط. احتفظ به في مكان آمن منفصل عن كلمة المرور؛ من دونهما لا يمكن استعادة الخزنة عند نسيان كلمة المرور.</p>
        <div className="vault-recovery-key" aria-label="مفتاح الاستعادة">{recoveryCode}</div>
        <button type="button" className="vault-secondary" style={{ width: '100%', marginTop: 10 }} onClick={copyRecoveryKey}>نسخ مفتاح الاستعادة</button>
        <form className="vault-form" style={{ marginTop: 17 }} onSubmit={saveSetup}>
          <label className="vault-check"><input type="checkbox" checked={recoveryAcknowledged} onChange={event => setRecoveryAcknowledged(event.target.checked)} /><span>حفظت مفتاح الاستعادة في مكان آمن ويمكنني الوصول إليه لاحقاً.</span></label>
          <button type="submit" className="vault-primary" disabled={!recoveryAcknowledged || busy}>{busy ? 'جارٍ إنشاء الخزنة…' : 'إنشاء الخزنة المشفّرة'}</button>
          <button type="button" className="vault-link" onClick={() => { setRecoveryCode(''); setRecoveryAcknowledged(false); setError(''); }}>العودة لتعديل كلمة المرور</button>
        </form>
      </>}

      {mode === 'unlock' && <>
        <h1 id="vault-title" className="vault-title">افتح خزنتك</h1>
        <p className="vault-copy">أدخل كلمة المرور لفك تشفير بيانات هذا الجهاز محلياً.</p>
        <form className="vault-form" onSubmit={unlock}>
          <label className="vault-field-label">كلمة المرور<input className="vault-input" type="password" autoComplete="current-password" minLength={8} required value={unlockPassword} onChange={event => setUnlockPassword(event.target.value)} /></label>
          <button type="submit" className="vault-primary" disabled={busy}>{busy ? 'جارٍ فك التشفير…' : 'فتح الخزنة'}</button>
          <button type="button" className="vault-link" onClick={() => { setMode('recovery'); setError(''); }}>نسيت كلمة المرور؟ استخدم مفتاح الاستعادة</button>
        </form>
      </>}

      {mode === 'recovery' && <>
        <h1 id="vault-title" className="vault-title">استعادة الوصول</h1>
        <p className="vault-copy">أدخل مفتاح الاستعادة المحفوظ وأنشئ كلمة مرور جديدة. لن يُعاد عرض مفتاح الاستعادة.</p>
        <form className="vault-form" onSubmit={recover}>
          <label className="vault-field-label">مفتاح الاستعادة<input className="vault-input" type="text" autoComplete="off" spellCheck={false} required value={recoveryInput} onChange={event => setRecoveryInput(event.target.value)} /></label>
          <label className="vault-field-label">كلمة المرور الجديدة<input className="vault-input" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
          <label className="vault-field-label">تأكيد كلمة المرور الجديدة<input className="vault-input" type="password" autoComplete="new-password" minLength={8} required value={newPasswordConfirmation} onChange={event => setNewPasswordConfirmation(event.target.value)} /></label>
          <button type="submit" className="vault-primary" disabled={busy}>{busy ? 'جارٍ استعادة الخزنة…' : 'استعادة الخزنة وتعيين كلمة المرور'}</button>
          <button type="button" className="vault-link" onClick={() => { setMode('unlock'); setError(''); }}>العودة إلى إدخال كلمة المرور</button>
        </form>
      </>}
    </section>
  </div>;
}