import { google, type meet_v2 } from 'googleapis';
import type { SegmentDraft } from '../ai/provider.js';

export interface GoogleTranscriptEntry {
  readonly name?: string | null;
  readonly participant?: string | null;
  readonly text?: string | null;
  readonly languageCode?: string | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
}

export class GoogleMeetFetcherError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GoogleMeetFetcherError';
  }
}

/**
 * Parses a Google Meet URL or meeting code to extract the space code.
 * Example: 'https://meet.google.com/abc-defg-hij' -> 'abc-defg-hij'
 * Example: 'abc-defg-hij' -> 'abc-defg-hij'
 */
export function extractMeetingCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/(?:meet\.google\.com\/|)([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  if (!match || !match[1]) {
    throw new GoogleMeetFetcherError(`Invalid Google Meet link or code: "${input}"`);
  }
  return match[1].toLowerCase();
}

/**
 * Fetches all transcript entries for a given conference record from Google Meet REST API.
 */
export async function fetchMeetTranscript(
  authClient: any,
  conferenceRecordName: string,
): Promise<GoogleTranscriptEntry[]> {
  const meet = google.meet({ version: 'v2', auth: authClient });

  try {
    // 1. List transcripts for the conference record
    const transcriptsRes = await meet.conferenceRecords.transcripts.list({
      parent: conferenceRecordName,
    });

    const transcripts = transcriptsRes.data.transcripts ?? [];
    if (transcripts.length === 0) {
      return [];
    }

    // 2. Fetch entries from the primary transcript
    const primaryTranscript = transcripts[0];
    if (!primaryTranscript.name) {
      return [];
    }

    const entries: GoogleTranscriptEntry[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const entriesRes: { data: meet_v2.Schema$ListTranscriptEntriesResponse } =
        await meet.conferenceRecords.transcripts.entries.list({
          parent: primaryTranscript.name,
          pageToken,
          pageSize: 100,
        });

      if (entriesRes.data.transcriptEntries) {
        entries.push(...entriesRes.data.transcriptEntries);
      }
      pageToken = entriesRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    return entries;
  } catch (error) {
    throw new GoogleMeetFetcherError(
      `Failed to fetch transcript from Google Meet for ${conferenceRecordName}`,
      error,
    );
  }
}

/**
 * Converts Google Meet transcript entries to FinTalk AI SegmentDraft[] format.
 * Assigns anonymized speaker labels (Speaker 1, Speaker 2, etc.) based on participant IDs.
 */
export function convertToSegments(
  entries: readonly GoogleTranscriptEntry[],
  conferenceStartTimeMs?: number,
): SegmentDraft[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  // Calculate conference start reference if not provided
  let baseTimeMs = conferenceStartTimeMs;
  if (baseTimeMs === undefined) {
    const firstEntryWithTime = entries.find((e) => e.startTime);
    baseTimeMs = firstEntryWithTime?.startTime
      ? new Date(firstEntryWithTime.startTime).getTime()
      : 0;
  }

  // Assign stable anonymized labels per participant identifier
  const participantMap = new Map<string, string>();
  let speakerCount = 0;

  const getSpeakerLabel = (participantId?: string | null): string => {
    if (!participantId) {
      return 'Speaker 1';
    }
    let label = participantMap.get(participantId);
    if (!label) {
      speakerCount += 1;
      label = `Speaker ${speakerCount}`;
      participantMap.set(participantId, label);
    }
    return label;
  };

  return entries
    .filter((entry) => entry.text && entry.text.trim().length > 0)
    .map((entry) => {
      const startMs = entry.startTime
        ? Math.max(0, new Date(entry.startTime).getTime() - baseTimeMs!)
        : 0;
      const endMs = entry.endTime
        ? Math.max(startMs + 1000, new Date(entry.endTime).getTime() - baseTimeMs!)
        : startMs + 2000;

      return {
        startMs,
        endMs,
        speakerLabel: getSpeakerLabel(entry.participant),
        text: entry.text!.trim(),
        confidence: 0.95,
      };
    });
}
