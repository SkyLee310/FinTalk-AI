'use client';

import { useState } from 'react';
import { Badge } from '@/components/badge';
import { Button, ErrorNote, Textarea } from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import {
  api,
  LOW_CONFIDENCE_THRESHOLD,
  needsReview,
  type TranscriptSegment,
} from '@/lib/api';

/**
 * Confidence display and human review for one transcript segment.
 *
 * **The wording here is load-bearing.** The number is the model's own opinion of
 * itself, obtained by asking for it — Gemini returns no token probabilities for
 * audio. So it is labelled "model self-reported" everywhere it appears and never
 * "accuracy". A figure presented as a measurement invites a trust it cannot
 * support, and in a credit file that is worse than showing nothing.
 *
 * A correction never replaces the model's text on screen, because it never
 * replaces it in the database either: the redaction log's offsets index into the
 * transcript as the model produced it. Both versions show, attributed.
 */

/**
 * Deliberately not a green/amber/red gradient across the whole range.
 *
 * Three colours would imply the number is calibrated finely enough to
 * distinguish 0.71 from 0.79, which it is not. Two states are worth showing:
 * below the review floor, and not.
 */
function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) {
    return (
      <span title="Transcribed before confidence scoring existed.">
        <Badge tone="neutral">not scored</Badge>
      </span>
    );
  }

  const percent = `${String(Math.round(confidence * 100))}%`;
  const low = confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    // The tooltip is supplementary, not the disclosure. Tooltips are unavailable
    // on touch and unreliable with a screen reader, so the caveat that these are
    // self-reported figures is stated as visible text by TranscriptConfidence.
    <span title="The model's own reported certainty. Not a measure of accuracy.">
      <Badge tone={low ? 'warn' : 'neutral'}>
        {low ? `${percent} — check this` : percent}
      </Badge>
    </span>
  );
}

export function SegmentReview({
  segment,
  mayReview,
  onChanged,
}: {
  segment: TranscriptSegment;
  mayReview: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(segment.textRedacted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = needsReview(segment);
  const reviewed = segment.confirmedAt !== null;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={segment.confidence} />
        {reviewed && (
          <Badge tone="ok">
            {segment.corrections.length > 0
              ? 'corrected by a reviewer'
              : 'confirmed by a reviewer'}
          </Badge>
        )}
      </div>

      {/*
        Every correction, oldest first — not only the latest. A reviewer who
        corrected a segment twice made two judgements, and showing just the last
        would hide that the first was reconsidered.
      */}
      {segment.corrections.map((correction) => (
        <div
          key={correction.id}
          className="rounded-lg border border-ok/40 bg-ok-soft/50 px-3 py-2"
        >
          <p className="text-xs font-medium text-ok">
            Reviewer&apos;s version · {new Date(correction.editedAt).toLocaleString()}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{correction.humanValue}</p>
        </div>
      ))}

      {error !== null && <ErrorNote>{error}</ErrorNote>}

      {editing && (
        <div className="space-y-2 rounded-lg border border-line bg-raised p-3">
          <p className="text-xs text-faint">
            Keep any placeholder exactly as it appears —{' '}
            <code className="font-mono">[NRIC_1]</code> and the like stand for data
            held encrypted, and a correction containing real personal details is
            refused.
          </p>
          <Textarea
            aria-label="Corrected text"
            rows={3}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || draft.trim() === ''}
              onClick={() => {
                void run(() => api.correctSegment(segment.id, draft));
              }}
            >
              {busy ? 'Saving…' : 'Save correction'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(segment.textRedacted);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/*
        The prompt appears only where it is useful: an unreviewed segment the
        model was unsure of. Offering Confirm on every line would train reviewers
        to click past it, which is how a review control stops meaning anything.
      */}
      {review && mayReview && !editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft/50 px-3 py-2">
          <p className="mr-1 text-xs text-muted">
            The model was unsure of this line. Is it right?
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void run(() => api.confirmSegment(segment.id));
            }}
          >
            {busy ? 'Saving…' : 'Yes, correct'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDraft(segment.textRedacted);
              setEditing(true);
            }}
          >
            No, fix it
          </Button>
        </div>
      )}

      {/*
        A segment the model was confident about stays correctable — a human
        reading can still catch what a high score missed — but the offer is quiet
        rather than a prompt.
      */}
      {!review && mayReview && !editing && (
        <button
          type="button"
          className="rounded text-xs text-faint underline underline-offset-2 hover:text-muted"
          onClick={() => {
            setDraft(segment.textRedacted);
            setEditing(true);
          }}
        >
          Suggest a correction
        </button>
      )}
    </div>
  );
}

/**
 * Transcript-level summary of how much of this record a human has checked.
 *
 * The mean carries an explicit caveat rather than standing as a headline score.
 * An average of self-reported numbers is not a quality metric, and presenting it
 * as one would repeat the per-segment error at a larger scale.
 */
export function TranscriptConfidence({ segments }: { segments: TranscriptSegment[] }) {
  const scored = segments.filter((s) => s.confidence !== null);
  const low = segments.filter(
    (s) => s.confidence !== null && s.confidence < LOW_CONFIDENCE_THRESHOLD,
  );
  const outstanding = segments.filter(needsReview);

  if (scored.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-faint">
        This transcript was produced before confidence scoring existed, so its
        segments carry no score. That is not a sign of quality either way.
      </p>
    );
  }

  const mean = scored.reduce((sum, s) => sum + (s.confidence ?? 0), 0) / scored.length;

  return (
    <div className="space-y-1">
      <p className="text-xs leading-relaxed text-muted">
        Mean model self-reported confidence{' '}
        <span className="font-mono font-medium text-text">
          {String(Math.round(mean * 100))}%
        </span>{' '}
        across {String(scored.length)} segment{scored.length === 1 ? '' : 's'}.
        {low.length > 0 && (
          <>
            {' '}
            <span className="font-medium text-warn">
              {String(low.length)} below{' '}
              {String(Math.round(LOW_CONFIDENCE_THRESHOLD * 100))}%
            </span>
            {outstanding.length > 0
              ? `, ${String(outstanding.length)} still unchecked.`
              : ', all checked by a reviewer.'}
          </>
        )}
      </p>
      <p className="text-xs leading-relaxed text-faint">
        These are the model&apos;s own estimates of its certainty, not measurements of
        accuracy. A high score can still be wrong.
      </p>
    </div>
  );
}
