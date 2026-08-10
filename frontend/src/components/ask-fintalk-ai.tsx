'use client';

import Link from 'next/link';
import { type Dispatch, type FormEvent, type SetStateAction, useState } from 'react';
import { describeError } from '@/hooks/use-async';
import { api, type AskCitation } from '@/lib/api';
import { GlassPanel } from './glass-panel';
import { Button, ErrorNote, Spinner, Textarea } from './ui';

/**
 * A chatbot, not a search form: the header-anchored panel that replaced the
 * ask-form Card knowledge/page.tsx used to carry (Task 12 removes that Card
 * once this is the only place it can be reached from).
 *
 * One turn is `{ role, content, citations? }`. `citations` only ever
 * appears on an assistant turn — the user's own words never carry a
 * provenance chip.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
}

/**
 * The three example questions this panel opens with. Single source of
 * truth: knowledge/page.tsx imports this rather than keeping its own copy,
 * until Task 12 removes that page's now-redundant ask-form entirely.
 */
export const EXAMPLES = [
  'Which meetings discussed Murabahah pricing?',
  'What was said about late payment penalties?',
  'Where was an interest rate raised on an Islamic facility?',
] as const;

/** Server-side cap is 10 turns (backend AskBody.history.max(10)) — sliced here so a long chat never 400s. */
const MAX_HISTORY_TURNS = 10;

/**
 * Header icon button that opens the panel. A small chat-bubble glyph next
 * to ThemeToggle's sun/moon — both read as "controls for this session," not
 * navigation, which is why neither lives in the nav list in lib/nav.ts.
 */
export function AskFinTalkAITrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick} aria-label="Ask FinTalk AI">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </Button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-body ${
          isUser ? 'bg-brand text-canvas' : 'border border-line bg-raised'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.citations !== undefined && message.citations.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <li key={citation.meetingId}>
                <Link
                  href={`/meetings/${citation.meetingId}`}
                  className="inline-flex items-center rounded-full border border-line-strong bg-surface px-2 py-0.5 text-caption text-brand underline underline-offset-2"
                >
                  {citation.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The slide-over panel itself. Message state lives in the caller
 * ((app)/layout.tsx) so it survives navigation between pages and resets on
 * reload or sign-out for free — this component only owns its own
 * in-progress input text and busy/error flags.
 */
export function AskFinTalkAI({
  open,
  onClose,
  messages,
  setMessages,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length < 3 || busy) return;

    setError(null);
    setBusy(true);
    setQuestion('');
    // Sliced before the request, not after: the server enforces the same
    // cap and rejects rather than truncates an over-cap request, so
    // respecting it here is what keeps a long-running chat from ever
    // hitting that 400.
    const history = messages
      .slice(-MAX_HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      const result = await api.ask(text, history);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.answer, citations: result.citations },
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close Ask FinTalk AI"
        onClick={onClose}
        className="absolute inset-0 bg-text/20 backdrop-blur-[1px]"
      />

      <GlassPanel className="relative z-10 flex h-full w-full max-w-md flex-col rounded-none p-0 sm:m-4 sm:h-[calc(100%-2rem)] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Ask FinTalk AI</h2>
            <p className="text-caption text-muted">Answered only from stored meetings.</p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose} aria-label="Close">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-caption text-muted">
                Answers come from stored transcripts and cite the meetings they came from.
                Try asking:
              </p>
              <ul className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-caption text-muted hover:bg-raised hover:text-text"
                      onClick={() => {
                        void send(example);
                      }}
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((message, index) => (
            // Strictly append-only list, never reordered or spliced —
            // index is a stable, safe key here.
            <Bubble key={index} message={message} />
          ))}

          {busy && <Spinner label="Thinking" />}
          {error !== null && <ErrorNote>{error}</ErrorNote>}
        </div>

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-line px-5 py-4">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy}
            placeholder="Ask a question…"
            rows={1}
            className="flex-1 resize-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <Button type="submit" disabled={busy || question.trim().length < 3}>
            Send
          </Button>
        </form>
      </GlassPanel>
    </div>
  );
}
