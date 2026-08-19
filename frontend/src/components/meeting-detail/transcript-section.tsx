'use client';

import { useEffect, useRef } from 'react';
import { Card, CardHeader, DataRow } from '@/components/card';
import { SegmentReview, TranscriptConfidence } from '@/components/segment-review';
import { EmptyState } from '@/components/ui';
import { can, timecode, type MeetingDetail, type Session, type TranscriptSegment } from '@/lib/api';
import { RedactedText } from './summary-section';

export interface TranscriptSectionProps {
  meeting: MeetingDetail;
  session: Session | null;
  highlightedSegmentId?: string | null;
  onRefresh: () => void;
}

export function TranscriptSection({
  meeting,
  session,
  highlightedSegmentId,
  onRefresh,
}: TranscriptSectionProps) {
  const mayReviewTranscript =
    can(session, 'transcript:read') &&
    session?.role !== 'VIEWER' &&
    session?.role !== 'OVERSIGHT';

  const transcript = meeting.transcript;

  const segmentRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (highlightedSegmentId && segmentRefs.current[highlightedSegmentId]) {
      segmentRefs.current[highlightedSegmentId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedSegmentId]);

  if (!transcript) {
    return (
      <EmptyState
        title="No Transcript Available"
        body="This meeting does not have a processed transcript yet."
      />
    );
  }

  const segments: TranscriptSegment[] = transcript.segments ?? [];
  const redactions = transcript.redactions ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Main Transcript Column */}
      <Card className="lg:col-span-3">
        <CardHeader
          title="Meeting Transcript"
          description="Mixed-language audio, with personal data replaced before storage."
        />

        <div className="border-b border-line px-5 py-3">
          <TranscriptConfidence segments={segments} />
        </div>

        <ol className="divide-y divide-line">
          {segments.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted">
              No transcript segments recorded.
            </li>
          ) : (
            segments.map((segment) => {
              const isTargeted = highlightedSegmentId === segment.id;
              return (
                <li
                  key={segment.id}
                  id={segment.id}
                  ref={(el) => {
                    segmentRefs.current[segment.id] = el;
                  }}
                  className={`px-5 py-3 transition-colors duration-500 ${
                    isTargeted ? 'bg-warn-soft/60' : ''
                  }`}
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {timecode(segment.startMs)}
                    </span>
                    <span className="text-xs font-medium text-brand">
                      {segment.speakerLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-text">
                    <RedactedText text={segment.textRedacted} />
                  </p>
                  <SegmentReview
                    segment={segment}
                    mayReview={mayReviewTranscript}
                    onChanged={onRefresh}
                  />
                </li>
              );
            })
          )}
        </ol>
      </Card>

      {/* Redaction Audit Log Column */}
      <Card className="lg:col-span-2">
        <CardHeader
          title="Redaction Log"
          description="What was masked, by which detector, and how confidently."
        />
        {redactions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">
            No personal data was detected in this transcript.
          </p>
        ) : (
          <dl className="divide-y divide-line px-5 py-2">
            {redactions.map((row) => (
              <DataRow key={row.id} label={row.placeholder}>
                <span className="text-xs text-muted">
                  {row.detectedBy} · {(row.confidence * 100).toFixed(0)}%
                </span>
              </DataRow>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
