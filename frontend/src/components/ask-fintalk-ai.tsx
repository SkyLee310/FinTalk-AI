'use client';

import {
  ArrowUp,
  FileText,
  Paperclip,
  RotateCcw,
  Sparkles,
  X as RemoveIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { describeError } from '@/hooks/use-async';
import { api, type AskCitation } from '@/lib/api';
import { Logo } from './logo';
import { CaptureWizardStep } from './capture-wizard';
import { MicIcon } from './record-session';
import { ErrorNote, Spinner, Textarea } from './ui';
import {
  addBoardFile,
  advanceFromConsent,
  type CaptureWizardState,
  chooseAudioFile,
  chooseImportAudio,
  finishWhiteboard,
  startSubmitting,
  startWizard,
  submitTitle,
} from '@/lib/capture-wizard-state';
import { guessAttachmentKind } from '@/lib/attachment-kind';
import { measureDurationMs } from '@/lib/audio-duration';
import { submitCapture } from '@/lib/submit-capture';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
  retrieval?: 'semantic' | 'keyword';
  createdMeeting?: { meetingId: string; title: string };
}

export const EXAMPLES = [
  'Which meetings discussed Murabahah pricing?',
  'What was said about late payment penalties?',
  'Where was an interest rate raised on an Islamic facility?',
] as const;

const MAX_HISTORY_TURNS = 10;
const ATTACHMENT_ACCEPT =
  'image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function useDictation(onResult: (text: string) => void): {
  listening: boolean;
  supported: boolean;
  toggle: () => void;
} {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        (window.SpeechRecognition !== undefined ||
          window.webkitSpeechRecognition !== undefined),
    );
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function toggle(): void {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Constructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (Constructor === undefined) return;

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i]?.[0]?.transcript ?? '';
      }
      if (text.trim() !== '') onResultRef.current(text.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  return { listening, supported, toggle };
}

export function AskFinTalkAITrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex items-center gap-2 rounded-full border border-line-strong/80 bg-surface/90 px-4 py-2 text-sm font-semibold text-text shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-px hover:border-brand/40 hover:bg-raised hover:shadow-md hover:shadow-brand/10 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span className="grid size-5 place-items-center rounded-full bg-gradient-to-tr from-brand to-sky-400 text-white shadow-sm shadow-brand/30">
        <Sparkles className="size-3 transition-transform duration-300 group-hover:rotate-12" />
      </span>
      <span>Ask FinTalk AI</span>
    </button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex items-start gap-3 transition-all ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {!isUser && (
        <span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand via-sky-500 to-indigo-600 text-white shadow-md shadow-brand/25 ring-2 ring-brand/10">
          <Logo className="size-4" />
        </span>
      )}
      <div
        className={`max-w-[85%] space-y-2 rounded-[22px] px-4.5 py-3 text-sm leading-relaxed ${
          isUser
            ? 'rounded-tr-sm bg-gradient-to-r from-brand to-sky-600 text-white shadow-md shadow-brand/20'
            : 'rounded-tl-sm border border-line/80 bg-surface/95 dark:bg-raised/95 text-text shadow-sm backdrop-blur-md'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.citations !== undefined && message.citations.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-line/50 dark:border-white/10">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted mb-1.5">
              Referenced Meetings
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {message.citations.map((citation) => (
                <li key={citation.meetingId}>
                  <Link
                    href={`/meetings/${citation.meetingId}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft/70 px-2.5 py-1 text-caption font-medium text-brand-strong transition-all hover:scale-[1.02] hover:bg-brand-soft dark:bg-brand/20 dark:text-sky-300"
                  >
                    <FileText className="size-3" />
                    <span>{citation.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {message.createdMeeting !== undefined && (
          <p className="mt-2">
            <Link
              href={`/meetings/${message.createdMeeting.meetingId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-3 py-1 text-caption font-semibold text-ok transition hover:scale-[1.02]"
            >
              <span>Open {message.createdMeeting.title} →</span>
            </Link>
          </p>
        )}

        {message.retrieval === 'keyword' && (
          <p className="text-[0.7rem] text-faint italic">
            Matched on keywords — phrases worded differently might not be indexed.
          </p>
        )}
      </div>
    </div>
  );
}

export function AskFinTalkAI({
  open,
  onClose,
  messages,
  setMessages,
  wizard,
  setWizard,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  wizard: CaptureWizardState | null;
  setWizard: Dispatch<SetStateAction<CaptureWizardState | null>>;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dictation = useDictation((text) => {
    setQuestion((prev) => (prev.trim() === '' ? text : `${prev} ${text}`));
  });

  function cancelWizard(): void {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: 'Setup cancelled.' },
    ]);
    setWizard(null);
  }

  function handleConsentContinue(): void {
    if (wizard?.step !== 'consent') return;
    setWizard(advanceFromConsent(wizard));
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          'Would you like to import an existing audio file, or record in real time?',
      },
    ]);
  }

  function handleChooseRealTime(): void {
    if (wizard?.step !== 'mode') return;
    const { title } = wizard;
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: "Let's set that up on the Record page." },
    ]);
    setWizard(null);
    onClose();
    const target = `/record?title=${encodeURIComponent(title)}&consent=1`;
    if (window.location.pathname === '/record') {
      window.location.href = target;
    } else {
      router.push(target);
    }
  }

  function handleChooseImport(): void {
    if (wizard?.step !== 'mode') return;
    setWizard(chooseImportAudio(wizard));
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: 'Choose the audio file to import.' },
    ]);
  }

  function handleChooseAudioFile(file: File): void {
    if (wizard?.step !== 'audio') return;
    setWizard(chooseAudioFile(wizard, file));
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          'Any whiteboard photos to attach? Add one or more, or skip.',
      },
    ]);
  }

  function handleAddBoardFile(file: File): void {
    if (wizard?.step !== 'whiteboard') return;
    setWizard(addBoardFile(wizard, { file, kind: guessAttachmentKind(file) }));
  }

  function handleWhiteboardDone(): void {
    if (wizard?.step !== 'whiteboard') return;
    setWizard(finishWhiteboard(wizard));
  }

  async function handleConfirmCapture(): Promise<void> {
    if (wizard?.step !== 'confirm') return;
    const toSubmit = wizard;
    setWizard(startSubmitting(toSubmit));
    setError(null);

    try {
      const durationMs = await measureDurationMs(toSubmit.audio);
      const result = await submitCapture({
        title: toSubmit.title,
        occurredAt: new Date().toISOString(),
        consentConfirmed: toSubmit.ack.consentConfirmed,
        transferAcknowledged: toSubmit.ack.transferAcknowledged,
        audio: toSubmit.audio,
        audioFilename: toSubmit.audio.name,
        durationMs,
        boardFiles: toSubmit.boardFiles,
      });

      let note = '';
      if (result.boardExtractedCount > 0) {
        note =
          ` ${String(result.boardExtractedCount)} attachment${result.boardExtractedCount === 1 ? '' : 's'}` +
          ` extracted, ${String(result.boardMaskedCount)} identifier(s) masked.`;
      }
      if (result.boardFailures.length > 0) {
        note += ` ${String(result.boardFailures.length)} failed: ${result.boardFailures.join('; ')}.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Meeting created — transcribing now, this takes a few minutes.${note}`,
          createdMeeting: { meetingId: result.meetingId, title: toSubmit.title },
        },
      ]);
      setWizard(null);
    } catch (cause) {
      setError(describeError(cause));
      if (open) setWizard(toSubmit);
    }
  }

  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      setClosing(false);
    } else if (wasOpen.current) {
      setClosing(true);
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) setWizard(null);
  }, [open, setWizard]);

  async function send(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length < 3 || busy) return;

    if (wizard?.step === 'title') {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: `Got it — ${text}.` },
      ]);
      setQuestion('');
      setWizard(submitTitle(text));
      return;
    }

    setError(null);
    setBusy(true);
    setQuestion('');
    const file = attachment;
    setAttachment(null);
    const history = messages
      .slice(-MAX_HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      const result = await api.ask(text, history, file ?? undefined);

      if (result.type === 'action') {
        const next = startWizard(result.title);
        setWizard(next);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              next.step === 'title'
                ? 'What would you like to call this meeting?'
                : `Got it — ${next.title}. Before I can create this, I need two confirmations:`,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
          retrieval: result.retrieval,
        },
      ]);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void send(question);
  }

  const wizardBlocksInput = wizard !== null && wizard.step !== 'title';

  if (!open && !closing) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end p-2.5 sm:p-4 md:p-6">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close Ask FinTalk AI"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 dark:bg-black/65 backdrop-blur-md transition-opacity duration-300 ${
          closing ? 'animate-[fade-out_0.25s_ease-out_both]' : 'animate-[fade-in_0.25s_ease-out_both]'
        }`}
      />

      {/* Apple-style Frosted Glass Modal Card */}
      <div
        className={`relative z-10 flex h-full w-full flex-col overflow-hidden rounded-[28px] sm:rounded-[32px] border border-white/50 dark:border-white/10 bg-surface/90 dark:bg-[#0b101b]/90 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:w-[min(100%,820px)] ${
          closing
            ? 'animate-[slide-out-right_0.28s_var(--ease-apple)_both]'
            : 'animate-[slide-in-right_0.32s_var(--ease-apple)_both]'
        }`}
        onAnimationEnd={() => {
          if (closing) setClosing(false);
        }}
      >
        {/* Apple-style Top Bar */}
        <div className="flex items-center justify-between border-b border-line/60 dark:border-white/10 px-5 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="relative grid size-10 place-items-center rounded-2xl bg-gradient-to-tr from-brand via-sky-500 to-indigo-600 text-white shadow-lg shadow-brand/25 ring-2 ring-white/20">
              <Logo className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-text">
                  Ask FinTalk AI
                </h2>
                <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[0.65rem] font-bold text-brand-strong dark:bg-brand/20 dark:text-sky-300">
                  INTELLIGENCE
                </span>
              </div>
              <p className="text-caption text-muted">
                Answers synthesized exclusively from your verified meeting transcripts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                title="Clear conversation"
                className="grid size-9 place-items-center rounded-full border border-line-strong/60 bg-surface text-muted transition hover:bg-raised hover:text-text active:scale-95"
              >
                <RotateCcw className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-full border border-line-strong/60 bg-surface text-muted transition hover:bg-raised hover:text-text active:scale-95"
            >
              <RemoveIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Chat History / Content Area */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
          {messages.length === 0 && (
            <div className="my-auto flex flex-col items-center justify-center py-10 text-center">
              <div className="relative mb-5 grid size-16 place-items-center rounded-3xl bg-gradient-to-tr from-brand/20 via-sky-400/20 to-indigo-500/20 text-brand ring-1 ring-brand/30 shadow-inner">
                <Sparkles className="size-8 animate-pulse text-brand" />
              </div>
              <h3 className="text-lg font-bold tracking-tight text-text">
                What would you like to explore?
              </h3>
              <p className="mt-1 max-w-sm text-caption text-muted">
                Query facility discussions, Shariah governance decisions, and meeting action items instantly.
              </p>

              <div className="mt-6 w-full max-w-lg space-y-2.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      void send(example);
                    }}
                    className="group flex w-full items-center justify-between rounded-2xl border border-line/70 bg-surface/70 px-4 py-3 text-left text-sm font-medium text-muted shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-raised hover:text-text hover:shadow-md hover:shadow-brand/5 active:scale-[0.99]"
                  >
                    <span>{example}</span>
                    <span className="grid size-6 place-items-center rounded-full bg-brand-soft/50 text-brand opacity-0 transition-opacity group-hover:opacity-100 dark:bg-brand/20">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <Bubble key={index} message={message} />
          ))}

          {wizard !== null && (
            <CaptureWizardStep
              state={wizard}
              onCancel={cancelWizard}
              onConsentChange={(ack) => {
                setWizard((current) =>
                  current?.step === 'consent' ? { ...current, ack } : current,
                );
              }}
              onConsentContinue={handleConsentContinue}
              onChooseImport={handleChooseImport}
              onChooseRealTime={handleChooseRealTime}
              onChooseAudioFile={handleChooseAudioFile}
              onAddBoardFile={handleAddBoardFile}
              onWhiteboardDone={handleWhiteboardDone}
              onConfirm={() => {
                void handleConfirmCapture();
              }}
            />
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-2xl border border-line/60 bg-surface/80 px-4 py-3 shadow-sm backdrop-blur-sm w-fit">
              <Spinner label="Searching meeting corpus…" />
            </div>
          )}
          {error !== null && <ErrorNote>{error}</ErrorNote>}
        </div>

        {/* Apple-style Floating Island Prompt Input */}
        <form onSubmit={submit} className="p-4 sm:p-5 border-t border-line/60 dark:border-white/10 backdrop-blur-xl">
          {attachment !== null && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft/60 px-3 py-1.5 text-caption dark:bg-brand/20">
              <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
              <span className="min-w-0 flex-1 truncate font-medium text-brand-strong dark:text-sky-300">
                {attachment.name}
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="shrink-0 rounded-full p-0.5 text-muted hover:bg-surface hover:text-text transition"
              >
                <RemoveIcon aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          )}

          <div className="relative flex items-center gap-2 rounded-2xl border border-line-strong/70 bg-surface/90 dark:bg-raised/90 p-2 shadow-lg backdrop-blur-xl transition-all focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                setAttachment(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />

            <button
              type="button"
              disabled={busy || wizard !== null}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a document"
              title="Attach photo or document"
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-text active:scale-95 disabled:opacity-40"
            >
              <Paperclip className="size-4" />
            </button>

            {dictation.supported && (
              <button
                type="button"
                disabled={busy || wizard !== null}
                onClick={dictation.toggle}
                aria-label={dictation.listening ? 'Stop dictating' : 'Dictate your question'}
                title={dictation.listening ? 'Stop dictating' : 'Dictate question'}
                className={`grid size-9 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-40 ${
                  dictation.listening
                    ? 'bg-danger text-white ring-4 ring-danger/20 animate-pulse'
                    : 'text-muted hover:bg-raised hover:text-text'
                }`}
              >
                <MicIcon />
              </button>
            )}

            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={busy || wizardBlocksInput}
              placeholder="Ask anything about your meetings..."
              rows={1}
              className="flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-faint focus:ring-0 focus-visible:outline-none"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(question);
                }
              }}
            />

            <button
              type="submit"
              disabled={busy || wizardBlocksInput || question.trim().length < 3}
              aria-label="Send query"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white shadow-md shadow-brand/30 transition-all hover:bg-brand-strong active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
