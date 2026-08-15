'use client';

import Link from 'next/link';
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
import { GlassPanel } from './glass-panel';
import { Button, ErrorNote, Spinner, Textarea } from './ui';

/**
 * A chatbot, not a search form: the header-anchored panel that replaced the
 * ask-form Card knowledge/page.tsx used to carry (Task 12 removes that Card
 * once this is the only place it can be reached from).
 *
 * One turn is `{ role, content, citations?, retrieval? }`. The last two only
 * ever appear on an assistant turn — the user's own words never carry a
 * provenance chip.
 *
 * `retrieval` is stored per turn rather than per panel because it is a fact
 * about how *that* answer was found. A deployment can gain an embedding model
 * mid-conversation, and an earlier turn's disclosure must not be rewritten by
 * a later turn's better luck.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
  retrieval?: 'semantic' | 'keyword';
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
 * Header button that opens the panel. A chat-bubble glyph next to
 * ThemeToggle's sun/moon — both read as "controls for this session," not
 * navigation, which is why neither lives in the nav list in lib/nav.ts.
 *
 * Named in visible text, not only in an aria-label. A lone speech bubble
 * asks everyone to guess, and the one feature people are told to look for
 * by name is the last thing that should be a rebus. That text is now the
 * accessible name too, so there is no second string to drift out of sync.
 */
export function AskFinTalkAITrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-text transition hover:bg-raised active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
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
      Ask FinTalk AI
    </button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-body ${
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

        {/*
          Said plainly, once, under the answer it applies to.
          Keyword matching finds meetings that share words with the question
          rather than meaning, so it can miss a relevant meeting that phrases
          things differently. Presenting that result identically to a semantic
          one would overstate how thoroughly the corpus was searched — the same
          reason the knowledge graph discloses `similarityUnavailable`.
        */}
        {message.retrieval === 'keyword' && (
          <p className="mt-2 text-caption text-faint">
            Matched on words rather than meaning — a relevant meeting phrased
            differently may have been missed.
          </p>
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

  /**
   * Stays mounted through its exit instead of `if (!open) return null`
   * vanishing it, so the panel can leave the way it arrived (§7).
   *
   * `open` is a prop the parent owns, so this can't just toggle its own
   * state on click the way profile-menu.tsx's `close()` does — it has to
   * notice `open` going false and start the exit animation itself, but reset
   * immediately if `open` goes true again mid-exit so a fast reopen shows
   * the panel opening rather than finishing a close it no longer means.
   */
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

  if (!open && !closing) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close Ask FinTalk AI"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${
          closing
            ? 'animate-[fade-out_var(--dur-base)_var(--ease-out)_both]'
            : 'animate-[fade-in_var(--dur-base)_var(--ease-out)_both]'
        }`}
      />

      <GlassPanel
        className={`relative z-10 flex h-full w-full max-w-md flex-col rounded-none p-0 sm:m-4 sm:h-[calc(100%-2rem)] sm:rounded-2xl ${
          closing
            ? 'animate-[panel-out_var(--dur-base)_var(--ease-out)_both]'
            : 'animate-[panel-in_var(--dur-base)_var(--ease-out)_both]'
        }`}
        onAnimationEnd={() => {
          if (closing) setClosing(false);
        }}
      >
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
