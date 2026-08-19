import { google, type meet_v2, type Auth } from 'googleapis';
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
  constructor(message: string, override readonly cause?: unknown) {
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
 * Resolves a meeting code or conferenceRecord identifier to a valid conferenceRecord resource name.
 * If given a meeting code like 'abc-defg-hij', queries conferenceRecords.list to find the latest conference record.
 */
export async function resolveConferenceRecordName(
  authClient: Auth.OAuth2Client,
  identifier: string,
): Promise<string> {
  const trimmed = identifier.trim();

  // If already a full resource name like 'conferenceRecords/12345678-abcd-...'
  if (trimmed.startsWith('conferenceRecords/')) {
    const sub = trimmed.replace('conferenceRecords/', '');
    // If it's not a 10-char space code like 'abc-defg-hij', it's a real conferenceRecord ID
    if (!sub.match(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i)) {
      return trimmed;
    }
  }

  const meetingCode = extractMeetingCode(trimmed);
  const meet = google.meet({ version: 'v2', auth: authClient });

  try {
    const listRes = await meet.conferenceRecords.list({
      filter: `space.meeting_code = "${meetingCode}"`,
      pageSize: 10,
    });

    const records = listRes.data.conferenceRecords ?? [];
    if (records.length === 0) {
      throw new GoogleMeetFetcherError(
        `No completed conference record found for Google Meet "${meetingCode}". Ensure the call has ended with Transcripts turned on.`,
      );
    }

    // Sort by startTime desc to get the most recent session
    records.sort((a, b) => {
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
      return bTime - aTime;
    });

    const latest = records[0];
    if (!latest?.name) {
      throw new GoogleMeetFetcherError(`Conference record name missing for meeting code "${meetingCode}"`);
    }

    return latest.name;
  } catch (error) {
    if (error instanceof GoogleMeetFetcherError) throw error;
    throw new GoogleMeetFetcherError(
      `Failed to look up conference records for Google Meet "${meetingCode}"`,
      error,
    );
  }
}

/**
 * Fetches all transcript entries for a given conference record or meeting code from Google Meet REST API.
 */
export async function fetchMeetTranscript(
  authClient: Auth.OAuth2Client,
  identifier: string,
): Promise<GoogleTranscriptEntry[]> {
  const conferenceRecordName = await resolveConferenceRecordName(authClient, identifier);
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
    if (!primaryTranscript || !primaryTranscript.name) {
      return [];
    }

    const entries: GoogleTranscriptEntry[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: meet_v2.Params$Resource$Conferencerecords$Transcripts$Entries$List = {
        parent: primaryTranscript.name,
        pageSize: 100,
      };
      if (pageToken !== undefined) {
        params.pageToken = pageToken;
      }

      const entriesRes = await meet.conferenceRecords.transcripts.entries.list(params);

      if (entriesRes.data.transcriptEntries) {
        entries.push(...entriesRes.data.transcriptEntries);
      }
      pageToken = entriesRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    return entries;
  } catch (error) {
    if (error instanceof GoogleMeetFetcherError) throw error;
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
