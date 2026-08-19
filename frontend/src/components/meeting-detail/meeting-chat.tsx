'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Card, CardHeader } from '@/components/card';
import { Button, ErrorNote, Input, Spinner } from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import { api, type AskCitation } from '@/lib/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
  retrieval?: 'semantic' | 'keyword';
}

const MEETING_PROMPTS = [
  'Summarize the key loan terms debated in this meeting',
  'What decisions were resolved vs. left unresolved?',
  'Were any Shariah compliance concerns raised?',
] as const;

const MAX_HISTORY_TURNS = 10;

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand text-canvas font-medium shadow-sm'
            : 'border border-line bg-raised text-text shadow-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.citations !== undefined && message.citations.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-line/60 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="font-medium text-text">Source Grounding:</span>
            {message.citations.map((c) => (
              <span
                key={c.meetingId}
                className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] border border-line text-brand"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {c.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MeetingChatProps {
  meetingId: string;
  meetingTitle: string;
}

export function MeetingChat({ meetingId, meetingTitle }: MeetingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;

    setError(null);
    setBusy(true);

    const historyForCall = messages.slice(-MAX_HISTORY_TURNS).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setQuery('');

    try {
      const response = await api.askMeeting(
        meetingId,
        trimmed,
        historyForCall.length > 0 ? historyForCall : undefined,
      );

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.answer,
        citations: response.citations,
        retrieval: response.retrieval,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(query);
  }

  return (
    <Card>
      <CardHeader
        title="Meeting Assistant"
        description={`Ask questions directly grounded on the transcript of "${meetingTitle}". Vault data remains sealed.`}
        action={
          messages.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
            >
              Clear chat
            </Button>
          )
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-line bg-raised/50 p-4 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand mb-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text">Ask anything about this meeting</p>
            <p className="text-xs text-muted mt-1 max-w-md mx-auto">
              Grounds answers solely on this meeting&apos;s verified transcript and decisions. Never guesses.
            </p>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {MEETING_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => submit(prompt)}
                  disabled={busy}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:text-brand hover:border-brand/40 transition active:scale-95"
                >
                  {prompt} →
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">
            {messages.map((message, i) => (
              <ChatBubble key={`${message.role}-${String(i)}`} message={message} />
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-2.5 text-xs text-muted">
                  <Spinner label="Analyzing transcript…" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about this meeting..."
            disabled={busy}
            className="flex-1"
          />
          <Button type="submit" disabled={busy || query.trim().length < 3}>
            {busy ? <Spinner label="Asking…" /> : 'Ask'}
          </Button>
        </form>
      </div>
    </Card>
  );
}
