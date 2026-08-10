'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { EXAMPLES } from '@/components/ask-fintalk-ai';
import { Card, CardHeader } from '@/components/card';
import { KnowledgeGraphView } from '@/components/knowledge-graph';
import {
  Button,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Section,
  Spinner,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { api, type AskAnswer } from '@/lib/api';

/**
 * Knowledge: how meetings relate, and questions answered from them.
 *
 * The assistant leads, because asking is what a user came to do. The graph follows,
 * because it shows where an answer could have come from.
 *
 * Every claim on this page about what the assistant will not do is enforced in
 * backend/src/knowledge/assistant.ts rather than merely promised here.
 */

function Answer({ answer }: { answer: AskAnswer }) {
  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg border px-4 py-3 ${
          answer.unanswerable ? 'border-warn/40 bg-warn-soft/50' : 'border-line bg-raised'
        }`}
      >
        <p className="text-body leading-relaxed">{answer.answer}</p>
      </div>

      {answer.citations.length > 0 ? (
        <div>
          <p className="text-caption font-medium">Answered from</p>
          <ul className="mt-1.5 space-y-1.5">
            {answer.citations.map((citation) => (
              <li key={citation.meetingId}>
                <Link
                  href={`/meetings/${citation.meetingId}`}
                  className="text-caption text-brand underline underline-offset-2"
                >
                  {citation.title}
                </Link>
                <span className="ml-2 text-caption text-faint">
                  {new Date(citation.occurredAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        /*
          No citations means no answer, and the copy says so — rather than letting
          unsourced prose sit there looking authoritative.
        */
        <p className="text-caption text-muted">
          Nothing in the stored meetings supports an answer to this, so none is given.
        </p>
      )}

      <p className="text-caption text-faint">
        Answered only from redacted transcripts in this system —{' '}
        <span className="font-medium">not</span> from general knowledge about Islamic
        finance or Malaysian regulation, and never as a Shariah or compliance opinion.
        A qualified reviewer decides; this reports what was said.
      </p>
    </div>
  );
}

export default function KnowledgePage() {
  const router = useRouter();
  const graph = useAsync(() => api.knowledgeGraph(), 'knowledge-graph');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (question.trim().length < 3) return;

    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await api.ask(question.trim()));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Knowledge"
        title="Ask across every meeting"
        lead="Search the whole corpus by asking a question in plain words, and see which meetings discussed the same things."
      />

      <Card>
        <CardHeader
          title="Ask FinTalk AI"
          description="Answers come from stored transcripts, and cite the meetings they came from."
        />
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-4 px-5 py-4"
        >
          {error !== null && <ErrorNote>{error}</ErrorNote>}

          <Field
            label="Your question"
            htmlFor="question"
            hint="Ask about topics, contracts or terms. Do not include anyone's personal details — transcripts store placeholders, so an identifier could never match."
          >
            <Input
              id="question"
              value={question}
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Which meetings discussed Murabahah pricing?"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || question.trim().length < 3}>
              {busy ? 'Searching…' : 'Ask'}
            </Button>
            {!busy && answer === null && (
              <span className="text-caption text-faint">or try:</span>
            )}
          </div>

          {!busy && answer === null && (
            <ul className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-caption text-muted hover:bg-raised hover:text-text"
                    onClick={() => setQuestion(example)}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {busy && <Spinner label="Searching the transcripts" />}
          {answer !== null && <Answer answer={answer} />}
        </form>
      </Card>

      <Section
        title="How meetings connect"
        description="An edge means two meetings discuss the same topics. Click one to see exactly why — no connection here is based on a person, because masked identifiers cannot be matched across meetings."
      >
        {graph.loading && <Spinner label="Building the graph" />}
        {graph.error !== null && <ErrorNote>{graph.error}</ErrorNote>}
        {graph.data !== null && (
          <KnowledgeGraphView
            graph={graph.data}
            onOpenMeeting={(meetingId) => {
              router.push(`/meetings/${meetingId}`);
            }}
          />
        )}
      </Section>
    </div>
  );
}
