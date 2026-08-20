# Ask FinTalk AI Capture Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Ask FinTalk AI's existing single-shot "start a capture" redirect into a multi-turn wizard, conducted inside the chat panel, that can create a meeting end to end when the audio source is an uploaded file — while real-time recording and everything else in the app stay exactly as human-controlled as they are today.

**Architecture:** After `intent.ts` detects the opening "start a capture" trigger (unchanged), the rest of the interaction is deterministic frontend state — never an LLM interpreting free text, a checkbox, or a file. A new pure state module (`capture-wizard-state.ts`) models the seven-step flow as a discriminated union with pure transition functions; a new rendering component (`capture-wizard.tsx`) renders the active step's controls (reusing the real `TransferNotice` consent component verbatim). The wizard's state itself is owned by `(app)/layout.tsx`, alongside the conversation history it already holds for the same reason, and passed down to `ask-fintalk-ai.tsx` as props, which wires it to the rendering component and resets it when the panel closes. The final "Create meeting" click calls a new shared helper (`submit-capture.ts`) extracted from Record's page, so the wizard and Record's own manual flow call one real implementation, not two copies.

**Tech Stack:** Next.js (App Router) frontend, TypeScript strict mode, Vitest for unit tests (no React component-rendering test tooling exists in this repo — confirmed no `@testing-library/*`/`jsdom` dependency; existing frontend tests are all pure-function or `fetch`-mock tests). No backend changes.

## Global Constraints

Carried forward from `docs/superpowers/specs/2026-08-08-fintalk-ai-design.md` and `docs/superpowers/specs/2026-08-10-ux-redesign-and-onboarding-design.md`, still binding on this work:
- Errors surface as normal client-visible messages via the existing `describeError` helper — no bare `catch {}`.
- No real personal data enters the repository; nothing here adds fixtures, but any test data added must be synthetic.
- `prefers-reduced-motion` is respected by every transition — this plan adds no new CSS transitions, so nothing further is required, but nothing added may bypass it either.
- Ask FinTalk AI's conversation history is session-only (resets on reload/sign-out) — the wizard's state must reset alongside it, never persisted.

New constraints from `docs/superpowers/specs/2026-08-20-ask-fintalk-ai-capture-wizard-design.md` §4, binding on every task below:
- **A checkbox click never becomes text.** Consent state moves from `TransferNotice` straight into wizard state as booleans — never serialized into a chat message or re-derived from conversation history.
- **The server-side consent re-check is the real gate, not the wizard's UI.** `backend/src/routes/meetings.routes.ts`'s existing 422-without-both-flags check is untouched by this plan; nothing here weakens or replaces it.
- **The wizard cannot out-live its own conversation turn's identity.** If the panel closes or `messages` resets, wizard state resets to `null` alongside it.
- **Real-time's pre-filled consent is additive to Record, not a fork of it.** The `consent=1` query param only sets Record's checkboxes' *initial* value once, on mount — the user can still uncheck them there.

---

### Task 1: Extract `submitCapture`, the shared meeting-creation call sequence

**Files:**
- Create: `frontend/src/lib/submit-capture.ts`
- Test: `frontend/tests/unit/submit-capture.test.ts`
- Modify: `frontend/src/app/(app)/record/page.tsx:291-377` (the `submit` function)

**Interfaces:**
- Produces: `CaptureBoardFile { file: File; kind: WhiteboardKind }`, `CaptureUpload` (input), `CaptureUploadResult` (output), and `submitCapture(upload: CaptureUpload): Promise<CaptureUploadResult>` — the exact shapes below. Task 4 (the wizard's submit step) calls this same function.

This task is a behavior-preserving refactor of code that already ships today (Record's manual upload flow) — no new user-visible behavior. Its purpose is to give Task 4 a call it can reuse instead of duplicating Record's `submit()` body, and to lock that shared behavior down with a unit test before anything else depends on it.

- [ ] **Step 1: Write `frontend/src/lib/submit-capture.ts`**

```ts
import { describeError } from '@/hooks/use-async';
import { api, type WhiteboardKind } from './api';

export interface CaptureBoardFile {
  readonly file: File;
  readonly kind: WhiteboardKind;
}

export interface CaptureUpload {
  readonly title: string;
  readonly description?: string;
  readonly occurredAt: string;
  readonly consentConfirmed: boolean;
  readonly transferAcknowledged: boolean;
  readonly participants?: readonly { readonly name: string; readonly role: string }[];
  readonly audio: Blob;
  readonly audioFilename?: string;
  readonly durationMs?: number;
  readonly boardFiles?: readonly CaptureBoardFile[];
  /**
   * Fired once, right after the meeting is accepted and before the
   * whiteboard-extraction loop (if any) begins — the seam a caller may want
   * to show as a distinct progress step, since extraction is a second,
   * synchronous request after the (already-accepted) upload.
   */
  readonly onAccepted?: () => void;
}

export interface CaptureUploadResult {
  readonly meetingId: string;
  readonly boardExtractedCount: number;
  readonly boardMaskedCount: number;
  readonly boardFailures: readonly string[];
}

/**
 * Creates a meeting from an already-obtained audio take — a live recording's
 * blob or a picked file, this does not need to know which — then
 * best-effort-extracts any whiteboard attachments. Record's page and the Ask
 * FinTalk AI capture wizard both call this so the two never drift apart on
 * field names or on whiteboard-failure handling.
 */
export async function submitCapture(upload: CaptureUpload): Promise<CaptureUploadResult> {
  const form = new FormData();
  form.set('title', upload.title);
  if (upload.description !== undefined && upload.description !== '') {
    form.set('description', upload.description);
  }
  form.set('occurredAt', upload.occurredAt);
  form.set('consentConfirmed', String(upload.consentConfirmed));
  form.set('transferAcknowledged', String(upload.transferAcknowledged));
  if (upload.participants !== undefined && upload.participants.length > 0) {
    form.set('participants', JSON.stringify(upload.participants));
  }
  form.set('audio', upload.audio, upload.audioFilename);
  if (upload.durationMs !== undefined) {
    form.set('durationMs', String(Math.round(upload.durationMs)));
  }

  const { meetingId } = await api.uploadMeeting(form);
  upload.onAccepted?.();

  let boardExtractedCount = 0;
  let boardMaskedCount = 0;
  const boardFailures: string[] = [];
  for (const attachment of upload.boardFiles ?? []) {
    const boardForm = new FormData();
    boardForm.set('file', attachment.file);
    boardForm.set('kind', attachment.kind);
    try {
      const extracted = await api.uploadWhiteboard(meetingId, boardForm);
      boardExtractedCount += 1;
      boardMaskedCount += extracted.redactionCount;
    } catch (cause) {
      boardFailures.push(`${attachment.file.name} (${describeError(cause)})`);
    }
  }

  return { meetingId, boardExtractedCount, boardMaskedCount, boardFailures };
}
```

- [ ] **Step 2: Write `frontend/tests/unit/submit-capture.test.ts`**

Follows this repo's existing convention for mocking `api` directly (`frontend/tests/unit/term-sheet-suggestion.test.ts` mocks nothing since it tests a pure function; this module calls `api`, so it needs `vi.mock`, matching the mocking style already used at the `fetch` layer in `api-client.test.ts` but one level up, at the `api` object itself, since this module's own job is orchestration around `api`, not HTTP mechanics).

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { submitCapture } from '../../src/lib/submit-capture';

vi.mock('../../src/lib/api', () => ({
  api: {
    uploadMeeting: vi.fn(),
    uploadWhiteboard: vi.fn(),
  },
}));

const uploadMeeting = vi.mocked(api.uploadMeeting);
const uploadWhiteboard = vi.mocked(api.uploadWhiteboard);

function audioBlob(): Blob {
  return new Blob(['fake-audio-bytes'], { type: 'audio/webm' });
}

function imageFile(name: string): File {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

beforeEach(() => {
  uploadMeeting.mockReset();
  uploadWhiteboard.mockReset();
});

describe('submitCapture', () => {
  it('sends the required fields and omits optional ones when absent', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });

    await submitCapture({
      title: 'Credit committee review',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
    });

    expect(uploadMeeting).toHaveBeenCalledTimes(1);
    const form = uploadMeeting.mock.calls[0]?.[0] as FormData;
    expect(form.get('title')).toBe('Credit committee review');
    expect(form.get('occurredAt')).toBe('2026-08-20T10:00:00.000Z');
    expect(form.get('consentConfirmed')).toBe('true');
    expect(form.get('transferAcknowledged')).toBe('true');
    expect(form.get('description')).toBeNull();
    expect(form.get('participants')).toBeNull();
    expect(form.get('durationMs')).toBeNull();
    expect(form.get('audio')).toBeInstanceOf(Blob);
  });

  it('includes description, participants and durationMs when given', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });

    await submitCapture({
      title: 'T',
      description: 'Notes',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      participants: [{ name: 'Alice', role: 'Credit Manager' }],
      audio: audioBlob(),
      durationMs: 61234.6,
    });

    const form = uploadMeeting.mock.calls[0]?.[0] as FormData;
    expect(form.get('description')).toBe('Notes');
    expect(form.get('participants')).toBe(JSON.stringify([{ name: 'Alice', role: 'Credit Manager' }]));
    expect(form.get('durationMs')).toBe('61235');
  });

  it('calls onAccepted once the meeting is created, before any whiteboard upload', async () => {
    const order: string[] = [];
    uploadMeeting.mockImplementation(async () => {
      order.push('uploadMeeting');
      return { meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' };
    });
    uploadWhiteboard.mockImplementation(async () => {
      order.push('uploadWhiteboard');
      return { whiteboardId: 'w1', redactionCount: 0 };
    });

    await submitCapture({
      title: 'T',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
      boardFiles: [{ file: imageFile('board.png'), kind: 'WHITEBOARD' }],
      onAccepted: () => order.push('onAccepted'),
    });

    expect(order).toEqual(['uploadMeeting', 'onAccepted', 'uploadWhiteboard']);
  });

  it('extracts every board file best-effort, aggregating counts and failures', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });
    uploadWhiteboard
      .mockResolvedValueOnce({ whiteboardId: 'w1', redactionCount: 2 })
      .mockRejectedValueOnce(new Error('too large'))
      .mockResolvedValueOnce({ whiteboardId: 'w3', redactionCount: 1 });

    const result = await submitCapture({
      title: 'T',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
      boardFiles: [
        { file: imageFile('a.png'), kind: 'WHITEBOARD' },
        { file: imageFile('b.png'), kind: 'SLIDE' },
        { file: imageFile('c.png'), kind: 'DOCUMENT' },
      ],
    });

    expect(result).toEqual({
      meetingId: 'm1',
      boardExtractedCount: 2,
      boardMaskedCount: 3,
      boardFailures: ['b.png (too large)'],
    });
  });

  it('rejects without ever calling uploadWhiteboard when uploadMeeting itself fails', async () => {
    uploadMeeting.mockRejectedValue(new Error('network down'));

    await expect(
      submitCapture({
        title: 'T',
        occurredAt: '2026-08-20T10:00:00.000Z',
        consentConfirmed: true,
        transferAcknowledged: true,
        audio: audioBlob(),
        boardFiles: [{ file: imageFile('a.png'), kind: 'WHITEBOARD' }],
      }),
    ).rejects.toThrow('network down');
    expect(uploadWhiteboard).not.toHaveBeenCalled();
  });
});
```

Note: `describeError` (imported from `@/hooks/use-async`, already used this way inside `submitCapture`) turns any thrown value into a display string — check `frontend/src/hooks/use-async.ts`'s existing export if `describeError(new Error('too large'))` does not resolve to exactly `'too large'` in the third test above; every other file in this repo that calls it (`record/page.tsx`, `ask-fintalk-ai.tsx`) passes a plain `Error`, so this matches existing usage.

- [ ] **Step 3: Run the new test file to verify it passes**

```bash
cd frontend
npx vitest run tests/unit/submit-capture.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Refactor `record/page.tsx`'s `submit()` to call `submitCapture`**

Add the import (alongside the existing imports at the top of the file, after the `measureDurationMs` import on line 29):

```ts
import { submitCapture } from '@/lib/submit-capture';
```

Replace the whole `submit` function (currently `record/page.tsx:291-377`) with:

```ts
  async function submit(): Promise<void> {
    if (readyBlob === null) return;

    setBusy(true);
    setError(null);
    setProgress('Uploading the recording…');

    const named = participants
      .map((p) => ({ name: p.name.trim(), role: p.role.trim() }))
      .filter((p) => p.name !== '');

    const durationMs = await measureDurationMs(readyBlob);

    try {
      const result = await submitCapture({
        title: title.trim(),
        description: description.trim() || undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        consentConfirmed: ack.consentConfirmed,
        transferAcknowledged: ack.transferAcknowledged,
        participants: named.length > 0 ? named : undefined,
        audio: readyBlob,
        audioFilename: mode === 'record' ? recordingFilename(readyBlob) : audioFile?.name,
        durationMs,
        boardFiles,
        onAccepted: () => {
          setSubmitted(true);
          if (boardFiles.length > 0) {
            setProgress(
              boardFiles.length === 1
                ? 'Recording accepted. Extracting the attachment…'
                : `Recording accepted. Extracting ${String(boardFiles.length)} attachments…`,
            );
          }
        },
      });

      let boardNote = '';
      if (result.boardExtractedCount > 0) {
        boardNote = ` ${String(result.boardExtractedCount)} attachment${result.boardExtractedCount === 1 ? '' : 's'}`
          + ` extracted, ${String(result.boardMaskedCount)} identifier(s) masked.`;
      }
      if (result.boardFailures.length > 0) {
        boardNote += ` ${String(result.boardFailures.length)} failed: ${result.boardFailures.join('; ')}.`;
      }

      setProgress(`Uploaded. Transcribing now — this takes a few minutes.${boardNote}`);
      // Straight to the meeting, which already polls its own status and reveals
      // the transcript, redactions and Shariah findings as they land.
      router.push(`/meetings/${result.meetingId}`);
    } catch (cause) {
      setError(describeError(cause));
      setProgress(null);
      setBusy(false);
    }
  }
```

This preserves the exact original behavior and timing — `setSubmitted(true)` and the "Recording accepted…" progress message still fire at the same point (right after the meeting is accepted, before whiteboard extraction), now via the `onAccepted` callback instead of being inlined.

- [ ] **Step 5: Verify Record's page still typechecks and lints clean**

```bash
cd frontend
npx tsc --noEmit
npx eslint src/app/\(app\)/record/page.tsx src/lib/submit-capture.ts
```

Expected: no errors from either command.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/submit-capture.ts frontend/tests/unit/submit-capture.test.ts "frontend/src/app/(app)/record/page.tsx"
git commit -m "refactor(frontend): extract submitCapture, the shared meeting-creation call sequence"
```

---

### Task 2: Build the wizard's pure state module and step-rendering component

**Files:**
- Create: `frontend/src/lib/capture-wizard-state.ts`
- Test: `frontend/tests/unit/capture-wizard-state.test.ts`
- Create: `frontend/src/components/capture-wizard.tsx`

**Interfaces:**
- Consumes: `TransferAcknowledgement`, `NO_ACKNOWLEDGEMENT`, `isFullyAcknowledged`, `TransferNotice` (all from `frontend/src/components/transfer-notice.tsx`, read in full already — exact exports confirmed); `WhiteboardKind` (from `frontend/src/lib/api.ts:140`); `guessAttachmentKind` (from `frontend/src/lib/attachment-kind.ts`).
- Consumes: `CaptureBoardFile` (Task 1's `submit-capture.ts`) — reused as-is for a wizard board attachment rather than redeclaring an identically-shaped type under a second name.
- Produces: `CaptureWizardState` (discriminated union) and the transition functions `startWizard`, `submitTitle`, `advanceFromConsent`, `chooseImportAudio`, `chooseAudioFile`, `addBoardFile`, `finishWhiteboard`, `startSubmitting`, `backToConfirm` — Task 3 calls all of these. `CaptureWizardStep`, the rendering component — Task 3 renders this.

This task builds the wizard in isolation: real logic, real unit tests, and a real rendering component — but not yet reachable from the chat panel (that's Task 3). Splitting pure state transitions into their own module (rather than folding them into the component) mirrors this repo's existing `lib/term-sheet-suggestion.ts` (pure) + consuming-component split, and is what makes Step 2 below possible without any component-rendering test tooling.

- [ ] **Step 1: Write the failing test for the state module**

`frontend/tests/unit/capture-wizard-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NO_ACKNOWLEDGEMENT } from '../../src/components/transfer-notice';
import {
  addBoardFile,
  advanceFromConsent,
  backToConfirm,
  type CaptureWizardState,
  chooseAudioFile,
  chooseImportAudio,
  finishWhiteboard,
  startSubmitting,
  startWizard,
  submitTitle,
} from '../../src/lib/capture-wizard-state';

function audioFile(): File {
  return new File(['fake'], 'recording.mp3', { type: 'audio/mpeg' });
}

function boardFile(): File {
  return new File(['fake'], 'board.png', { type: 'image/png' });
}

describe('startWizard', () => {
  it('goes straight to consent when a title is already known', () => {
    expect(startWizard('Credit committee review')).toEqual({
      step: 'consent',
      title: 'Credit committee review',
      ack: NO_ACKNOWLEDGEMENT,
    });
  });

  it('asks for a title when none was extracted', () => {
    expect(startWizard('')).toEqual({ step: 'title' });
  });

  it('trims whitespace-only titles down to asking', () => {
    expect(startWizard('   ')).toEqual({ step: 'title' });
  });
});

describe('submitTitle', () => {
  it('moves from title to consent with the trimmed text as the title', () => {
    expect(submitTitle('  Credit committee review  ')).toEqual({
      step: 'consent',
      title: 'Credit committee review',
      ack: NO_ACKNOWLEDGEMENT,
    });
  });
});

describe('the rest of the happy path', () => {
  it('walks consent -> mode -> audio -> whiteboard -> confirm -> submitting -> back to confirm', () => {
    const consent: CaptureWizardState = {
      step: 'consent',
      title: 'T',
      ack: { consentConfirmed: true, transferAcknowledged: true, liveCaptionsConsent: false },
    };

    const mode = advanceFromConsent(consent);
    expect(mode).toEqual({ step: 'mode', title: 'T', ack: consent.ack });
    if (mode.step !== 'mode') throw new Error('expected mode step');

    const audio = chooseImportAudio(mode);
    expect(audio).toEqual({ step: 'audio', title: 'T', ack: consent.ack });
    if (audio.step !== 'audio') throw new Error('expected audio step');

    const file = audioFile();
    const whiteboard = chooseAudioFile(audio, file);
    expect(whiteboard).toEqual({ step: 'whiteboard', title: 'T', ack: consent.ack, audio: file, boardFiles: [] });
    if (whiteboard.step !== 'whiteboard') throw new Error('expected whiteboard step');

    const board = boardFile();
    const withBoard = addBoardFile(whiteboard, { file: board, kind: 'WHITEBOARD' });
    expect(withBoard.boardFiles).toEqual([{ file: board, kind: 'WHITEBOARD' }]);
    if (withBoard.step !== 'whiteboard') throw new Error('expected whiteboard step');

    const confirm = finishWhiteboard(withBoard);
    expect(confirm).toEqual({
      step: 'confirm',
      title: 'T',
      ack: consent.ack,
      audio: file,
      boardFiles: [{ file: board, kind: 'WHITEBOARD' }],
    });
    if (confirm.step !== 'confirm') throw new Error('expected confirm step');

    const submitting = startSubmitting(confirm);
    expect(submitting).toEqual({ ...confirm, step: 'submitting' });
    if (submitting.step !== 'submitting') throw new Error('expected submitting step');

    expect(backToConfirm(submitting)).toEqual(confirm);
  });

  it('finishWhiteboard preserves an empty boardFiles list when nothing was added', () => {
    const whiteboard: CaptureWizardState = {
      step: 'whiteboard',
      title: 'T',
      ack: NO_ACKNOWLEDGEMENT,
      audio: audioFile(),
      boardFiles: [],
    };
    if (whiteboard.step !== 'whiteboard') throw new Error('expected whiteboard step');
    expect(finishWhiteboard(whiteboard)).toEqual({ ...whiteboard, step: 'confirm' });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd frontend
npx vitest run tests/unit/capture-wizard-state.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/capture-wizard-state'`.

- [ ] **Step 3: Write `frontend/src/lib/capture-wizard-state.ts`**

```ts
import { NO_ACKNOWLEDGEMENT, type TransferAcknowledgement } from '@/components/transfer-notice';
import type { CaptureBoardFile } from './submit-capture';

/**
 * The capture wizard's own state, entirely separate from Ask FinTalk AI's
 * `messages` transcript. Every transition below is a pure function — no
 * network call, no interpretation of free text — so a checkbox tick, a file
 * pick, or a button click always maps to exactly one new state. The caller
 * (ask-fintalk-ai.tsx) owns *when* this exists: `null` means no wizard is
 * active, matching the panel's normal question-answering behaviour.
 */
export type CaptureWizardState =
  | { readonly step: 'title' }
  | { readonly step: 'consent'; readonly title: string; readonly ack: TransferAcknowledgement }
  | { readonly step: 'mode'; readonly title: string; readonly ack: TransferAcknowledgement }
  | { readonly step: 'audio'; readonly title: string; readonly ack: TransferAcknowledgement }
  | {
      readonly step: 'whiteboard';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    }
  | {
      readonly step: 'confirm';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    }
  | {
      readonly step: 'submitting';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    };

/** Starts the wizard from intent.ts's extracted title, which may be empty. */
export function startWizard(title: string): CaptureWizardState {
  const trimmed = title.trim();
  return trimmed === ''
    ? { step: 'title' }
    : { step: 'consent', title: trimmed, ack: NO_ACKNOWLEDGEMENT };
}

/** The chat's next message, when the wizard asked for a title in step 1. */
export function submitTitle(rawTitle: string): CaptureWizardState {
  return { step: 'consent', title: rawTitle.trim(), ack: NO_ACKNOWLEDGEMENT };
}

export function advanceFromConsent(
  state: Extract<CaptureWizardState, { step: 'consent' }>,
): CaptureWizardState {
  return { step: 'mode', title: state.title, ack: state.ack };
}

export function chooseImportAudio(
  state: Extract<CaptureWizardState, { step: 'mode' }>,
): CaptureWizardState {
  return { step: 'audio', title: state.title, ack: state.ack };
}

export function chooseAudioFile(
  state: Extract<CaptureWizardState, { step: 'audio' }>,
  audio: File,
): CaptureWizardState {
  return { step: 'whiteboard', title: state.title, ack: state.ack, audio, boardFiles: [] };
}

export function addBoardFile(
  state: Extract<CaptureWizardState, { step: 'whiteboard' }>,
  boardFile: CaptureBoardFile,
): CaptureWizardState {
  return { ...state, boardFiles: [...state.boardFiles, boardFile] };
}

export function finishWhiteboard(
  state: Extract<CaptureWizardState, { step: 'whiteboard' }>,
): CaptureWizardState {
  return { ...state, step: 'confirm' };
}

export function startSubmitting(
  state: Extract<CaptureWizardState, { step: 'confirm' }>,
): CaptureWizardState {
  return { ...state, step: 'submitting' };
}

/** A failed submit returns to `confirm` with everything already collected intact. */
export function backToConfirm(
  state: Extract<CaptureWizardState, { step: 'submitting' }>,
): CaptureWizardState {
  return { ...state, step: 'confirm' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend
npx vitest run tests/unit/capture-wizard-state.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Write `frontend/src/components/capture-wizard.tsx`**

```tsx
'use client';

import { useRef } from 'react';
import type { CaptureWizardState } from '@/lib/capture-wizard-state';
import { isFullyAcknowledged, TransferNotice, type TransferAcknowledgement } from './transfer-notice';
import { Button } from './ui';

const AUDIO_ACCEPT = 'audio/*';
const BOARD_ACCEPT = 'image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function CancelLink({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="text-caption text-faint underline underline-offset-2 hover:text-muted"
    >
      Cancel setup
    </button>
  );
}

/**
 * Renders the capture wizard's active step, given its state from
 * capture-wizard-state.ts. Rendered by ask-fintalk-ai.tsx as the last item
 * in the message list, in place of (steps 2-6) or alongside (step 1) the
 * panel's ordinary Textarea + Send row — see that file for which.
 *
 * Every control here is real: the same TransferNotice checkboxes Record's
 * page renders, real file inputs. Nothing here interprets free text.
 * `guessAttachmentKind` tagging of a chosen whiteboard file happens in the
 * caller's `onAddBoardFile`, not here — this component only ever hands back
 * the raw `File` it was given.
 */
export function CaptureWizardStep({
  state,
  onCancel,
  onConsentChange,
  onConsentContinue,
  onChooseImport,
  onChooseRealTime,
  onChooseAudioFile,
  onAddBoardFile,
  onWhiteboardDone,
  onConfirm,
}: {
  state: CaptureWizardState;
  onCancel: () => void;
  onConsentChange: (ack: TransferAcknowledgement) => void;
  onConsentContinue: () => void;
  onChooseImport: () => void;
  onChooseRealTime: () => void;
  onChooseAudioFile: (file: File) => void;
  onAddBoardFile: (file: File) => void;
  onWhiteboardDone: () => void;
  onConfirm: () => void;
}) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const boardInputRef = useRef<HTMLInputElement>(null);

  if (state.step === 'title') {
    return (
      <div className="flex justify-start">
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'consent') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <TransferNotice value={state.ack} onChange={onConsentChange} idPrefix="chat-capture" />
        <div className="flex items-center gap-3">
          <Button disabled={!isFullyAcknowledged(state.ack)} onClick={onConsentContinue}>
            Continue
          </Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  if (state.step === 'mode') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={onChooseImport}>Import audio</Button>
          <Button variant="secondary" onClick={onChooseRealTime}>
            Record in real time
          </Button>
        </div>
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'audio') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <input
          ref={audioInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) onChooseAudioFile(file);
          }}
        />
        <Button onClick={() => audioInputRef.current?.click()}>Choose audio file</Button>
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'whiteboard') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <p className="text-caption text-muted">Audio: {state.audio.name}</p>
        <input
          ref={boardInputRef}
          type="file"
          accept={BOARD_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) onAddBoardFile(file);
          }}
        />
        {state.boardFiles.length > 0 && (
          <ul className="space-y-1 text-caption text-muted">
            {state.boardFiles.map((attachment, index) => (
              <li key={`${attachment.file.name}-${String(index)}`}>{attachment.file.name}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => boardInputRef.current?.click()}>
            Add a photo
          </Button>
          <Button onClick={onWhiteboardDone}>
            {state.boardFiles.length > 0 ? 'Done' : 'Skip'}
          </Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  if (state.step === 'confirm') {
    return (
      <div className="space-y-2 rounded-lg border border-line bg-raised p-4">
        <dl className="space-y-1 text-body">
          <div className="flex gap-2">
            <dt className="font-medium">Title</dt>
            <dd className="text-muted">{state.title}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Consent</dt>
            <dd className="text-muted">Both confirmed</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Audio</dt>
            <dd className="text-muted">{state.audio.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Whiteboard</dt>
            <dd className="text-muted">
              {state.boardFiles.length === 0 ? 'None' : `${String(state.boardFiles.length)} file(s)`}
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={onConfirm}>Create meeting</Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  return <p className="text-caption text-muted">Creating the meeting…</p>;
}
```

- [ ] **Step 6: Typecheck and lint the two new files**

```bash
cd frontend
npx tsc --noEmit
npx eslint src/lib/capture-wizard-state.ts src/components/capture-wizard.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/capture-wizard-state.ts frontend/tests/unit/capture-wizard-state.test.ts frontend/src/components/capture-wizard.tsx
git commit -m "feat(frontend): add capture wizard state machine and step rendering"
```

---

### Task 3: Wire the wizard into Ask FinTalk AI — title, consent, mode, and the real-time handoff

**Files:**
- Modify: `frontend/src/app/(app)/layout.tsx:60-65,176-181` (lifts wizard state up, alongside `chatMessages`)
- Modify: `frontend/src/components/ask-fintalk-ai.tsx` (full file was read for this plan — relevant regions cited below)
- Modify: `frontend/src/app/(app)/record/page.tsx:161-164` (the mount-only effect)

**Interfaces:**
- Consumes: everything Task 2 produced (`CaptureWizardState`, `startWizard`, `submitTitle`, `advanceFromConsent`, `chooseImportAudio`, `CaptureWizardStep`).
- Produces: `AppLayout` now owns `chatWizard: CaptureWizardState | null` state (alongside its existing `chatMessages`) and passes it to `AskFinTalkAI` as new `wizard`/`setWizard` props, on the same footing as the existing `messages`/`setMessages` props. `AskFinTalkAI` gains the handlers `cancelWizard`, `handleConsentContinue`, `handleChooseRealTime`, `handleChooseImport` — Task 4 adds the remaining handlers (`handleChooseAudioFile`, `handleAddBoardFile`, `handleWhiteboardDone`, `handleConfirmCapture`) to this same component.

**Why the wizard's state lives in `AppLayout`, not locally in `AskFinTalkAI`:** `layout.tsx`'s own comment on `chatMessages` (`frontend/src/app/(app)/layout.tsx:60-63`) explains that conversation state is lifted out of `AskFinTalkAI` specifically so a page navigation cannot clear it — `AppLayout` renders `<AskFinTalkAI>` unconditionally as a persistent sibling of `{children}`, so state kept at that level can never be silently broken by a future change to how/where `AskFinTalkAI` itself gets rendered, whereas state kept inside `AskFinTalkAI` would depend on that component never being conditionally remounted. The design spec (§4) draws the same parallel explicitly: wizard state is meant to reset exactly when `messages` resets (sign-out), plus one more case (panel close). Splitting `wizard` off into a second, locally-owned piece of state would both contradict that parallel and reintroduce, for the wizard specifically, the exact class of bug `messages` was already deliberately moved out of `AskFinTalkAI` to avoid — and unlike lost chat history, a silently-lost wizard can mean a lost in-progress file selection.

This task makes the wizard reachable end to end for everything up to (and including) the real-time branch, which needs no new backend call — it only needs Record's page to accept a `consent=1` query param it doesn't read today. The upload branch (audio file onward) is Task 4.

- [ ] **Step 1: Lift wizard state into `AppLayout`**

Add the import, alongside the existing `ChatMessage` import (`frontend/src/app/(app)/layout.tsx:6`):

```ts
import { type CaptureWizardState } from '@/lib/capture-wizard-state';
```

Replace the existing comment and state declarations (currently `layout.tsx:60-65`):

```ts
  // Lives here, not inside AskFinTalkAI, so a page navigation does not
  // clear the conversation. Both still reset for free: this whole layout
  // unmounts on sign-out (redirect to /login, outside this route group)
  // and on a hard reload (fresh component instance, fresh useState).
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
```

with:

```ts
  // Lives here, not inside AskFinTalkAI, so a page navigation does not
  // clear the conversation. All three still reset for free: this whole
  // layout unmounts on sign-out (redirect to /login, outside this route
  // group) and on a hard reload (fresh component instance, fresh useState).
  // chatWizard additionally resets on a plain panel close — see
  // AskFinTalkAI's own effect for that, since open/close is that
  // component's concern, not this layout's.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatWizard, setChatWizard] = useState<CaptureWizardState | null>(null);
```

Then pass the new state down (currently `layout.tsx:176-181`):

```tsx
      <AskFinTalkAI
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        setMessages={setChatMessages}
      />
```

becomes:

```tsx
      <AskFinTalkAI
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        setMessages={setChatMessages}
        wizard={chatWizard}
        setWizard={setChatWizard}
      />
```

- [ ] **Step 2: Change `AskFinTalkAI` to receive the wizard as props, and reset it on close**

Add the import for the state module and step-rendering component, after the existing `import { MicIcon } from './record-session';` line (line 18):

```ts
import { CaptureWizardStep } from './capture-wizard';
import {
  advanceFromConsent,
  type CaptureWizardState,
  chooseImportAudio,
  startWizard,
  submitTitle,
} from '@/lib/capture-wizard-state';
```

Change the component's prop type and destructuring (currently lines 214-224):

```ts
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
```

to:

```ts
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
```

Directly after the existing `closing`/`wasOpen` effect (currently lines 246-256, ending `}, [open]);`), add a second effect enforcing the design spec's own rule (§4) that the wizard cannot survive a close:

```ts
  // Spec: wizard state must not out-live the panel being open — unlike
  // `messages`, which deliberately survives a close so the conversation
  // itself isn't lost, a half-finished capture is abandoned the same way
  // closing Record's own tab mid-capture already abandons one there.
  useEffect(() => {
    if (!open) setWizard(null);
  }, [open, setWizard]);
```

- [ ] **Step 3: Add the wizard's own handlers**

After the `dictation` declaration (currently lines 232-234) and before the `closing`/`wasOpen` block, add the handlers that don't depend on `send` or the submit helper (the remaining handlers land in Task 4):

```ts
  function cancelWizard(): void {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Setup cancelled.' }]);
    setWizard(null);
  }

  function handleConsentContinue(): void {
    if (wizard?.step !== 'consent') return;
    setWizard(advanceFromConsent(wizard));
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: 'Would you like to import an existing audio file, or record in real time?',
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
    // Same hard-navigation-vs-soft-navigation reasoning as send()'s own
    // redirect below: record/page.tsx only reads its query params in a
    // mount-only effect, so a soft navigation to the same route would never
    // apply them.
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
```

- [ ] **Step 4: Change `send()`'s handling of a wizard-active title step and the `action` response**

The existing `send` function currently opens with (lines 258-260):

```ts
  async function send(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length < 3 || busy) return;
```

Insert a new branch immediately after that guard, before the existing `setError(null);` line:

```ts

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
```

Then replace the existing `result.type === 'action'` branch (currently lines 279-296):

```ts
      if (result.type === 'action') {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Opening a new capture…' }]);
        onClose();
        const target = `/record?title=${encodeURIComponent(result.title)}`;
        // record/page.tsx only reads the title query param in a mount-only
        // effect (see its own comment on why — avoiding useSearchParams'
        // Suspense requirement). A router.push to the same route is a soft
        // navigation that doesn't remount, so the title would silently never
        // apply when the request comes in from Record itself — which,
        // since Record is the Maker's post-login landing page, is the
        // common case rather than an edge case. A hard navigation forces
        // the remount that mount-only effect needs.
        if (window.location.pathname === '/record') {
          window.location.href = target;
        } else {
          router.push(target);
        }
        return;
      }
```

with:

```ts
      if (result.type === 'action') {
        const next = startWizard(result.title);
        setWizard(next);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: next.step === 'title'
              ? 'What would you like to call this meeting?'
              : `Got it — ${next.title}. Before I can create this, I need two confirmations:`,
          },
        ]);
        return;
      }
```

- [ ] **Step 5: Render the wizard step and gate the ordinary input row**

Immediately before the closing `{busy && <Spinner label="Thinking" />}` line inside the scrollable message area (directly after the `{messages.map(...)}` block, currently ending at line 400), add:

```tsx
          {wizard !== null && (
            <CaptureWizardStep
              state={wizard}
              onCancel={cancelWizard}
              onConsentChange={(ack) => {
                setWizard((current) => (current?.step === 'consent' ? { ...current, ack } : current));
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
```

`onChooseAudioFile`, `onAddBoardFile`, `onWhiteboardDone`, and `handleConfirmCapture` are added in Task 4 — this step's JSX references them ahead of that so Task 3 and Task 4's edits to the same render block don't conflict; **Task 3's own typecheck (Step 7 below) will fail until Task 4 adds them, which is expected** — Task 4 starts immediately after Task 3's commit, in the same working tree, so this is a same-branch sequencing note, not a shippable intermediate state.

Then, in the form at the bottom (currently starting at line 406), change the three existing `disabled` props:

The attachment button (currently `disabled={busy}` at line 435):
```tsx
              disabled={busy || wizard !== null}
```

The dictation button (currently `disabled={busy}` at line 445):
```tsx
                disabled={busy || wizard !== null}
```

The `Textarea` (currently `disabled={busy}` at line 462) and the Send button (currently `disabled={busy || question.trim().length < 3}` at line 473) both need the narrower "blocks input except while the wizard is asking for a title" condition. Add this derived constant right before the `return` statement (immediately above the existing `if (!open && !closing) return null;` line, currently line 320):

```ts
  const wizardBlocksInput = wizard !== null && wizard.step !== 'title';
```

Textarea:
```tsx
              disabled={busy || wizardBlocksInput}
```

Send button:
```tsx
            <Button type="submit" disabled={busy || wizardBlocksInput || question.trim().length < 3}>
```

- [ ] **Step 6: Add the `consent=1` query param to Record's mount effect**

`record/page.tsx`'s existing effect (currently lines 161-164):

```ts
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('title');
    if (fromQuery !== null && fromQuery.trim() !== '') setTitle(fromQuery);
  }, []);
```

Replace with:

```ts
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fromQuery = query.get('title');
    if (fromQuery !== null && fromQuery.trim() !== '') setTitle(fromQuery);
    // Set only when the Ask FinTalk AI capture wizard already collected this
    // exact consent moments earlier — see transfer-notice.tsx's own "never
    // pre-ticked" rule, which this does not violate: it carries forward a
    // real affirmative click, it does not default one.
    if (query.get('consent') === '1') {
      setAck({ consentConfirmed: true, transferAcknowledged: true, liveCaptionsConsent: false });
    }
  }, []);
```

- [ ] **Step 7: Typecheck**

This is expected to fail at this point in the plan — see Step 5's note. Run it anyway to confirm the *only* errors are the four missing Task-4 identifiers, not something else:

```bash
cd frontend
npx tsc --noEmit
```

Expected: exactly four errors, each `Cannot find name 'handleChooseAudioFile'` / `'handleAddBoardFile'` / `'handleWhiteboardDone'` / `'handleConfirmCapture'`, all inside `ask-fintalk-ai.tsx`. Any other error means something in Steps 1-6 was mistyped — fix it before continuing to Task 4.

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(app)/layout.tsx" frontend/src/components/ask-fintalk-ai.tsx "frontend/src/app/(app)/record/page.tsx"
git commit -m "feat(frontend): wire capture wizard into Ask FinTalk AI through the real-time handoff

Lifts wizard state into AppLayout alongside the existing chat
messages, so it can never be silently lost to a future change in how
AskFinTalkAI is mounted, and resets it on panel close per the design
spec (docs/superpowers/specs/2026-08-20-ask-fintalk-ai-capture-wizard-design.md §4).

Typecheck intentionally fails until the next commit adds the upload
path's handlers (handleChooseAudioFile, handleAddBoardFile,
handleWhiteboardDone, handleConfirmCapture) — see plan Task 4."
```

---

### Task 4: Complete the upload path — audio, whiteboard, confirm, submit — and verify end to end

**Files:**
- Modify: `frontend/src/components/ask-fintalk-ai.tsx` (adds the four remaining handlers referenced by Task 3, extends `ChatMessage` and `Bubble`)

**Interfaces:**
- Consumes: `submitCapture` (Task 1), `chooseAudioFile`, `addBoardFile`, `finishWhiteboard`, `startSubmitting`, `backToConfirm` (Task 2), `guessAttachmentKind` (existing, `@/lib/attachment-kind`), `measureDurationMs` (existing, `@/lib/audio-duration`).
- Produces: nothing further downstream — this is the plan's last task.

- [ ] **Step 1: Add the remaining imports**

Extend the `@/lib/capture-wizard-state` import added in Task 3 Step 1 to include the rest of the transition functions:

```ts
import {
  addBoardFile,
  advanceFromConsent,
  backToConfirm,
  type CaptureWizardState,
  chooseAudioFile,
  chooseImportAudio,
  finishWhiteboard,
  startSubmitting,
  startWizard,
  submitTitle,
} from '@/lib/capture-wizard-state';
```

Add two more imports alongside the existing `@/lib/api` import (line 15):

```ts
import { guessAttachmentKind } from '@/lib/attachment-kind';
import { measureDurationMs } from '@/lib/audio-duration';
import { submitCapture } from '@/lib/submit-capture';
```

- [ ] **Step 2: Extend `ChatMessage` and `Bubble` with a "meeting created" link**

The existing `ChatMessage` interface (currently lines 35-40):

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
  retrieval?: 'semantic' | 'keyword';
}
```

becomes:

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AskCitation[];
  retrieval?: 'semantic' | 'keyword';
  /** Set only on the wizard's own success message, once its meeting exists. */
  createdMeeting?: { meetingId: string; title: string };
}
```

Inside `Bubble` (currently lines 158-206), immediately after the closing `)}` of the existing `citations` block (directly before the `retrieval === 'keyword'` block), add:

```tsx
        {message.createdMeeting !== undefined && (
          <p className="mt-2">
            <Link
              href={`/meetings/${message.createdMeeting.meetingId}`}
              className="inline-flex items-center rounded-full border border-line-strong bg-surface px-2 py-0.5 text-caption text-brand underline underline-offset-2"
            >
              Open {message.createdMeeting.title}
            </Link>
          </p>
        )}
```

(`Link` is already imported at the top of the file for the citations block, so no new import is needed here.)

- [ ] **Step 3: Add the four remaining handlers**

Directly after `handleChooseImport` (added in Task 3 Step 2), add:

```ts
  function handleChooseAudioFile(file: File): void {
    if (wizard?.step !== 'audio') return;
    setWizard(chooseAudioFile(wizard, file));
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: 'Any whiteboard photos to attach? Add one or more, or skip.' },
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
        note = ` ${String(result.boardExtractedCount)} attachment${result.boardExtractedCount === 1 ? '' : 's'}`
          + ` extracted, ${String(result.boardMaskedCount)} identifier(s) masked.`;
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
      // Only resurrect the wizard if the panel is still open. If the user
      // closed it while this request was in flight, Task 3's own
      // open-triggered effect already reset wizard to null — the design
      // spec (§4) requires it stay that way, since a closed wizard is
      // never resumed, even by a request that was already in flight at
      // the moment of closing.
      if (open) setWizard(toSubmit);
    }
  }
```

`toSubmit` captures the `confirm`-step state before `startSubmitting` moves the wizard on — on failure, restoring `toSubmit` directly puts the wizard back exactly where it was, with everything already collected intact, which is simpler than round-tripping through `backToConfirm` on a freshly-reconstructed `submitting` value. (`backToConfirm` stays exported from Task 2's module — it is the correct, self-contained way to reverse a `submitting` state for a caller that only has *that* state in hand, not this one, which already has the pre-submit value sitting in a local variable.) `open` is already destructured as a prop of `AskFinTalkAI` (Task 3 Step 2), so no new import or plumbing is needed to read it here.

- [ ] **Step 4: Typecheck and lint**

```bash
cd frontend
npx tsc --noEmit
npx eslint src/components/ask-fintalk-ai.tsx
```

Expected: no errors. If `tsc` reports `backToConfirm` as an unused import, that means Step 3 above was not followed exactly — `backToConfirm` must stay imported and exported from Task 2's module regardless of whether this file's own handler calls it, since it is still part of `capture-wizard-state.ts`'s public interface; remove it only from *this file's* import list if this file never calls it, not from `capture-wizard-state.ts` itself.

- [ ] **Step 5: Run the full frontend unit suite**

```bash
cd frontend
npm test -- --run
```

Expected: all tests pass, including the two new files from Tasks 1 and 2.

- [ ] **Step 6: Browser verification**

Per the design spec's §8, drive this through the existing preview workflow (`preview_start` with the `frontend` dev-server config, never Bash), signed in as a Maker:

1. Open Ask FinTalk AI, send "start a capture called Test Meeting" — confirm the wizard opens with an acknowledgement bubble for the title (no title-entry step shown) and the real `TransferNotice` disclosure text renders, Continue disabled until both boxes are checked.
2. Check both boxes, click Continue — confirm the mode-choice bubble appears.
3. Click "Record in real time" — confirm the panel closes and the browser lands on `/record` with the title pre-filled and both consent checkboxes already checked (read the page via `read_page`/`javascript_tool`, don't just screenshot — confirm the checkbox `checked` state, not just its visual appearance).
4. Reopen Ask FinTalk AI, repeat with a fresh "start a capture called Second Test" — this time click "Import audio" at the mode step, choose a small fixture audio file (any real audio file available in the environment, or record a few seconds via the OS if none is available — the file's actual content is irrelevant, only its presence and MIME type matter to this flow), skip the whiteboard step, and confirm the summary card shows the correct title, "Both confirmed", the audio filename, and "None" for whiteboard.
5. Click "Create meeting" — confirm a success bubble appears with an "Open Second Test" link, and following it lands on `/meetings/:id` for a newly created meeting whose status is `CAPTURED` or `PROCESSING` (per `api.meeting(id).status`, checked via `read_network_requests` or the page's own rendering).
6. Separately, start the wizard once more and click "Cancel setup" at the mode step — confirm a "Setup cancelled." bubble appears and the ordinary Textarea/Send row is usable again immediately.
7. Start the wizard again, advance to the audio step (past consent), then click the panel's own "Close" (X) button rather than cancelling — confirm the panel closes, then reopen Ask FinTalk AI and confirm the wizard is gone (back to the ordinary Textarea/Send row, not resumed mid-flow) while the earlier chat messages are still present. This is the Task 3 Step 2 close-triggered reset (design spec §4) — confirm it actually fires, not just that the code compiles.

Report any deviation from the above before considering this task complete — do not claim success without having actually observed all seven checks in the running preview.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ask-fintalk-ai.tsx
git commit -m "feat(frontend): complete the capture wizard's upload path (audio, whiteboard, confirm, submit)"
```
