# Ask FinTalk AI — Conversational Capture Wizard — Design Specification

**Date:** 2026-08-20
**Source:** Product direction from the app owner: Ask FinTalk AI's existing "start a capture" scoped action (redirect to `/record` with a pre-filled title) should become a real, multi-turn interview that can create a meeting end to end when the source is an uploaded audio file — while everything else in the app, including real-time recording itself, stays exactly as human-controlled as it is today.
**Status:** approved — ready for implementation planning

---

## 1. What this changes

Today, `backend/src/knowledge/intent.ts` detects a "start a capture" request in the user's first message, and `frontend/src/components/ask-fintalk-ai.tsx` responds by closing the panel and navigating to `/record?title=...`. The user then walks through Record's own three-step disclosure (title/participants, consent, capture) entirely by hand.

This spec keeps that detection step, but replaces the redirect with a wizard conducted inside the chat panel: it asks for the title (if not already given), presents the real consent disclosure, asks whether the source is an existing audio file or a live recording, and — for the upload case — collects the audio (and optional whiteboard photos), shows one final summary, and only then creates the meeting, on an explicit click. Choosing live recording still hands off to `/record`, now carrying the title and the consent already given forward, rather than asking the user to repeat consent a route later.

Nothing here changes what the app can do — every request the wizard makes is a request Record's page already makes today, through the same endpoints, with the same server-side validation. What changes is who conducts the interview leading up to that request.

Everything below was walked through and agreed section by section before being written up here; this document is the durable record of that conversation, not a new proposal.

## 2. Decisions made during design

| Decision | Choice |
|---|---|
| Consent inside chat | Render the real `TransferNotice` component inline (same disclosure text, same two real checkboxes) — not a simplified conversational yes/no. A regulated cross-border-transfer disclosure needs the same evidentiary weight it has today, not a weaker substitute. |
| Real-time branch | The chat still asks consent before asking import-vs-real-time (matching the name → consent → mode order the owner described), so by the time "real time" is chosen, consent has already been genuinely, contemporaneously given. Handoff to `/record` carries the title *and* that consent forward, pre-filling (not defaulting) Record's checkboxes. |
| Final mutation gate | The wizard never calls the backend the moment it has enough information. It always shows one last summary card with a single explicit "Create meeting" click before anything is created. Automation covers the interview, never the mutation itself. |
| Conversation engine | Not an LLM loop. After the opening trigger, the rest of the interview is deterministic frontend state rendered as chat bubbles — a wizard wearing a chat's clothes, not an agent making judgment calls about consent flags or file state. `intent.ts` is the only place free text is interpreted, and only to catch the opening trigger phrase and an optional title. |
| Backend surface | No new endpoints. The wizard's submit step calls the exact same `api.uploadMeeting()` / `api.uploadWhiteboard()` Record's page already calls, via one small shared helper both places use. |
| Scope boundary | Participants and description are not collected by the wizard (both stay editable on the meeting page afterward, as they are today). No other area of the app — term sheets, approvals, Shariah decisions — is reachable from Ask FinTalk AI now or as a direction this spec opens up. |

## 3. Out of scope

- Any change to `assistant.ts`'s corpus-search answering path, or to the existing single-attachment grounding upload already in `ask-fintalk-ai.tsx` (the paperclip button) — that remains for extracting text into a question's context and is unrelated to the wizard's audio/whiteboard inputs.
- Editing or cancelling a meeting once the wizard's final "Create meeting" has been clicked — cancellation is only available before that click.
- Persisting wizard state across a reload or panel close. Closing the panel or reloading mid-wizard abandons it, exactly as closing Record's own tab mid-capture does today.
- Any second scoped action beyond "start a capture." The `intent.ts` trigger vocabulary is unchanged.
- Voice dictation (`useDictation`) or the existing text attachment picker being usable *during* the wizard — both are for composing a free-text question, which the wizard's non-title steps don't take.

## 4. Global constraints

Carried forward from the base spec and the UX-redesign spec, still binding: `RedactedText` is the only write path for AI-derived text; audit entries append inside the transaction that writes the data they describe; the AI never issues a Shariah ruling; `.env` is never committed; `prefers-reduced-motion` zeros every transition.

New constraints this feature introduces:

- **A checkbox click never becomes text.** Consent state moves from the `TransferNotice` card straight into wizard state as booleans. It is never serialized into a chat message, summarized by a model, or re-derived from conversation history — the same two flags Record collects today, collected the same way, just rendered in a different place.
- **The server-side consent re-check is the real gate, not the wizard's UI.** `backend/src/routes/meetings.routes.ts`'s existing 422-without-both-flags check is unchanged and is what actually protects this — the wizard's own gating (disabled Continue button, disabled Create-meeting button) is the same usability layer Record's page already relies on, not a new source of truth.
- **The wizard cannot out-live its own conversation turn's identity.** If `open` goes false (panel closed) or the messages array is reset (sign-out, per the existing session-only history rule), wizard state resets to `null` alongside it — never resumed, never orphaned mid-step holding a stale file handle.
- **Real-time's pre-filled consent is additive to Record, not a fork of it.** Record's own checkboxes stay real, uncontrolled-by-URL-after-mount inputs the user can still uncheck; the query param only sets their *initial* value once, on mount, the same way `title` already does.

---

## 5. Conversation flow

The wizard is a state machine living in `AskFinTalkAI`'s component state (`frontend/src/components/ask-fintalk-ai.tsx`), started only when `api.ask()` returns `{ type: 'action', action: 'start_capture', title }` — `intent.ts`'s response shape and trigger phrases are unchanged.

```ts
type CaptureWizardState =
  | { step: 'title' }
  | { step: 'consent'; title: string; ack: TransferAcknowledgement }
  | { step: 'mode'; title: string; ack: TransferAcknowledgement }
  | { step: 'audio'; title: string; ack: TransferAcknowledgement }
  | {
      step: 'whiteboard';
      title: string;
      ack: TransferAcknowledgement;
      audio: File;
      boardFiles: { file: File; kind: WhiteboardKind }[];
    }
  | {
      step: 'confirm';
      title: string;
      ack: TransferAcknowledgement;
      audio: File;
      boardFiles: { file: File; kind: WhiteboardKind }[];
    }
  | {
      step: 'submitting';
      title: string;
      ack: TransferAcknowledgement;
      audio: File;
      boardFiles: { file: File; kind: WhiteboardKind }[];
    };
```

`null` (not shown above) means no wizard is active — the panel behaves exactly as it does today.

**Step 1 — Title.** If `intent.ts` already extracted a non-empty title, this step is skipped: push an assistant bubble acknowledging it ("Got it — *{title}*.") and enter `consent` directly. Otherwise push an assistant bubble asking "What would you like to call this meeting?" and leave the wizard in `{ step: 'title' }`. This is the one step where the ordinary Textarea + Send stays the active control — the next submitted message becomes the title verbatim (trimmed, no interpretation), exactly like Record's own Title field takes free text as-is.

**Step 2 — Consent.** Assistant bubble explains why ("Before I can create this, I need two confirmations:"), followed by `TransferNotice` rendered inline (`idPrefix="chat-capture"`) with a Continue button disabled until `isFullyAcknowledged(ack)`. The ordinary text input is disabled for this step; `TransferNotice`'s own checkboxes are the input.

**Step 3 — Mode.** Assistant bubble asks "Would you like to import an existing audio file, or record in real time?" with two buttons.
- *Record in real time*: push a bubble ("Let's set that up on the Record page."), close the panel, and hard-navigate (same `window.location.href`-vs-`router.push` branching already used for the title-only case, for the same mount-only-effect reason) to `/record?title=<title>&consent=1`. Wizard state resets to `null`.
- *Import audio*: advance to `{ step: 'audio', ... }`.

**Step 4 — Audio file.** Assistant bubble asks the user to attach the audio file, with a dedicated "Choose audio file" button (`accept="audio/*"`) — a new control, separate from the existing paperclip. Choosing a file shows a filename confirmation chip and immediately advances to `whiteboard` with an empty `boardFiles`.

**Step 5 — Whiteboard (optional).** Assistant bubble: "Any whiteboard photos to attach? Add one or more, or skip." A file-picker button (same accepted types as Record's dropzone: `image/*,application/pdf,.docx,...`) appends to `boardFiles` and stays on this step so more can be added; "Done" (enabled once ≥0 files — it's optional) advances to `confirm`. Each file's `kind` (`WhiteboardKind`, from `frontend/src/lib/api.ts`) is set with the existing `guessAttachmentKind()` (`frontend/src/lib/attachment-kind.ts`) rather than Record's manual cycle-through-kinds control — the wizard has no per-file editing UI, so a wrong guess is corrected later on the meeting page, same as any other attachment metadata.

**Step 6 — Confirm.** Assistant bubble renders a summary card: title, "Consent: both confirmed", audio filename, whiteboard file count (or "None"), with one "Create meeting" button and a "Cancel" button.
- *Cancel*: push a bubble ("Setup cancelled."), reset wizard state to `null`.
- *Create meeting*: advance to `submitting` and call the shared submit helper (§6).

**Step 7 — Submit.** On success: push a bubble mirroring Record's own post-submit language ("Meeting created — transcribing now, this takes a few minutes.") with a link to `/meetings/:id`; reset wizard state to `null`, resuming normal chat. On failure: push/replace an inline error (reusing `describeError`, the same helper `send()` already uses) and return to `confirm` with all collected state intact, so the user can retry without redoing the interview.

**Cancel.** A small "Cancel setup" text control is visible alongside the active step's controls for steps 1–6 (not step 7, which is already in flight). Clicking it behaves like the Step 6 cancel: a bubble, then reset to `null`.

## 6. Frontend components and files

**`frontend/src/components/capture-wizard.tsx`** (new). Exports the step-rendering component(s) — one per step above — kept out of `ask-fintalk-ai.tsx` the same way `record-session.tsx` was already split out of `record/page.tsx`, so that file doesn't grow past its current ~480 lines. `ask-fintalk-ai.tsx` renders the active step, if any, as the last item in the scrollable message area, and conditionally disables/replaces the bottom Textarea+Send row per the per-step rules in §5.

**`frontend/src/lib/submit-capture.ts`** (new). Extracts the call sequence `record/page.tsx`'s own `submit()` already performs — `api.uploadMeeting(form)` with title/occurredAt/consentConfirmed/transferAcknowledged/audio, then a best-effort per-file loop over `api.uploadWhiteboard()` — into one function both Record's page and the wizard call, so the two never drift apart on error handling or field names:

```ts
export interface CaptureUpload {
  title: string;
  description?: string;
  occurredAt: string; // ISO
  consentConfirmed: boolean;
  transferAcknowledged: boolean;
  participants?: { name: string; role: string }[];
  audio: Blob;
  audioFilename: string;
  durationMs?: number;
  boardFiles?: { file: File; kind: WhiteboardKind }[];
}

export interface CaptureUploadResult {
  meetingId: string;
  boardExtractedCount: number;
  boardMaskedCount: number;
  boardFailures: string[];
}

export async function submitCapture(upload: CaptureUpload): Promise<CaptureUploadResult>;
```

`record/page.tsx`'s `submit()` becomes a thin wrapper: gather its local state into a `CaptureUpload`, call `submitCapture`, then keep its own `setProgress`/`setSubmitted`/`router.push` UI sequencing exactly as it is today (the helper returns results, it doesn't own navigation or progress text — those differ between Record's inline progress messages and the wizard's chat bubbles). The wizard's `submitting` step does the same with its own bubble-based progress. `measureDurationMs` (already in `record/page.tsx`) is called by both callers before building the `CaptureUpload` and stays a shared utility; `recordingFilename` (naming a `MediaRecorder` blob) stays Record-only, since the wizard's file already has a real name from the picker.

Record's page sources `occurredAt` from its own step-1 datetime field, which the wizard never collects (§3). The wizard instead passes `new Date().toISOString()` captured at the moment "Create meeting" is clicked (Step 6, §5) — the natural timestamp for a meeting whose audio already exists is "when this capture was submitted," matching how a live recording's own `occurredAt` is effectively "now" at the point it started.

**`frontend/src/app/(app)/record/page.tsx`** (modified). Its existing mount-only effect, which today reads only `title` from the query string, also reads `consent=1` and, when present, initializes `ack` to `{ consentConfirmed: true, transferAcknowledged: true, liveCaptionsConsent: false }` instead of `NO_ACKNOWLEDGEMENT` — `liveCaptionsConsent` stays unset, since that's a separate, optional consent never asked in chat.

## 7. Error handling

- **Audio/whiteboard file rejected by the server** (wrong type, over the 20 MB cap in `backend/src/server.ts`): surfaces as an inline error at whichever step made the request, via the same `describeError` used everywhere else in this panel. The wizard does not attempt client-side type/size validation beyond the file picker's `accept` attribute — the server is already the real gate, exactly as it is for Record today.
- **`uploadMeeting` fails** (network error, validation 422, etc.): the `confirm` step's collected state (title, ack, audio, boardFiles) is preserved so "Create meeting" can be pressed again without re-attaching anything.
- **A whiteboard file fails to extract after the meeting was already created**: same as Record's existing behavior — best-effort, reported in the success bubble's note rather than treated as a failure of the whole operation, since the meeting and its audio are already safely accepted.

## 8. Testing approach

- **Unit**: `submit-capture.ts`'s field-mapping and best-effort whiteboard-loop behavior (a fake `api` module, asserting the exact `FormData` fields Record's own tests today implicitly rely on via `api-client.test.ts`'s conventions).
- **Unit**: the wizard's step-transition logic (`title` → `consent` → `mode` → `audio`/`redirect` → `whiteboard` → `confirm` → `submitting` → reset), independent of the real `TransferNotice`/file-picker rendering, covering: title already known vs. not, consent gating (`Continue` disabled until both boxes checked), cancel from every step, and a failed submit returning to `confirm` with state intact.
- **Browser verification** (per this repo's existing preview workflow, signed in as Maker): trigger "start a capture called Test Meeting" and confirm the wizard opens with the title already acknowledged; complete the consent step and confirm the real disclosure text renders; choose real-time and confirm the redirect lands on `/record` with both checkboxes already checked; separately, choose import audio, attach a fixture audio file and a whiteboard image, confirm the summary card's counts, click Create, and confirm the meeting appears at `/meetings/:id` with transcription underway — the same live-microphone limitation noted in the original UX-redesign spec applies here too (this path needs no microphone, so it *can* be driven end to end, unlike live recording itself).
