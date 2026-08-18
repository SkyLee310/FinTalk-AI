'use client';

import type { ReactNode } from 'react';

/**
 * The cross-border transfer disclosure, and the two confirmations it gates.
 *
 * Three decisions here are deliberate.
 *
 * **Two checkboxes, not one.** Consenting to be recorded and accepting that the
 * recording leaves Malaysia are different acts by different parties — the
 * participants agree to the first, the operator accepts the second. One combined
 * checkbox would evidence neither, and the audit log would be unable to show
 * which was actually agreed to.
 *
 * **The sequence is stated, not softened.** Redaction happens *after* the
 * transfer, so a spoken NRIC reaches Google intact. Saying "personal data is
 * protected" would be true of storage and false of transit, and transit is what
 * this notice exists to disclose.
 *
 * **Neither box is pre-ticked, and the copy is not collapsed behind a link.** A
 * default-on consent checkbox is not consent, and a disclosure a user has to
 * open is one the product is hiding.
 */

export interface TransferAcknowledgement {
  readonly consentConfirmed: boolean;
  readonly transferAcknowledged: boolean;
}

export const NO_ACKNOWLEDGEMENT: TransferAcknowledgement = {
  consentConfirmed: false,
  transferAcknowledged: false,
};

/**
 * Both must be true before a recording may be sent.
 *
 * This is a usability guard, not the enforcement. The route re-checks both
 * fields and answers 422 without them, because a client-side check protects
 * nothing an operator can reach with curl.
 */
export function isFullyAcknowledged(value: TransferAcknowledgement): boolean {
  return value.consentConfirmed && value.transferAcknowledged;
}

function Check({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 size-4 shrink-0 accent-brand"
      />
      <label htmlFor={id} className="text-sm leading-relaxed text-muted">
        {children}
      </label>
    </div>
  );
}

export function TransferNotice({
  value,
  onChange,
  idPrefix = 'transfer',
}: {
  value: TransferAcknowledgement;
  onChange: (next: TransferAcknowledgement) => void;
  idPrefix?: string;
}) {
  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className="rounded-lg border border-warn/40 bg-warn-soft/60 p-4"
    >
      <h3 id={`${idPrefix}-heading`} className="text-sm font-semibold">
        Before you record: where this audio goes
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        This recording is transcribed by{' '}
        <strong className="font-medium text-text">Google Gemini</strong>. The audio —
        and any whiteboard photo — is sent to Google&apos;s servers outside Malaysia
        to be processed. While you are recording, short clips of the same audio are
        also sent the same way every ~10 seconds for a rough live preview — the same
        transfer as above, sent in pieces as you go rather than only once at the end.
      </p>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        Personal data is removed <em>after</em> that transfer, not before. If someone
        reads out an IC number, a bank account or a phone number, it reaches Google
        as spoken words. FinTalk never stores the raw audio, but the transfer itself
        is real and this system cannot avoid it.
      </p>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        The audio is held only for as long as the request takes, and is not retained
        by FinTalk afterwards.
      </p>

      <div className="mt-4 space-y-3 border-t border-warn/30 pt-3">
        <Check
          id={`${idPrefix}-consent`}
          checked={value.consentConfirmed}
          onChange={(consentConfirmed) => {
            onChange({ ...value, consentConfirmed });
          }}
        >
          Everyone in this meeting was told it is being recorded and agreed to it.
        </Check>

        <Check
          id={`${idPrefix}-transfer`}
          checked={value.transferAcknowledged}
          onChange={(transferAcknowledged) => {
            onChange({ ...value, transferAcknowledged });
          }}
        >
          I accept that this audio is transferred to Google outside Malaysia and is
          transcribed before any personal data is removed from it.
        </Check>
      </div>
    </section>
  );
}

/**
 * The same disclosure as a statement of record, for a meeting already captured.
 *
 * Shown on the meeting detail page so the transfer is part of the artifact and
 * not only of the moment it was agreed to. A meeting captured before this gate
 * existed reports that plainly rather than showing nothing — the audio still
 * went to Google, and a blank space would imply otherwise.
 */
export function TransferRecord({
  consentConfirmed,
  transferAcknowledged,
}: TransferAcknowledgement) {
  const both = consentConfirmed && transferAcknowledged;

  return (
    <p className="text-xs leading-relaxed text-faint">
      {both
        ? 'Participant consent and the cross-border transfer to Google were both acknowledged before this recording was processed.'
        : 'This meeting predates the transfer disclosure, so no acknowledgement was recorded for it. Its audio was still processed by Google Gemini.'}
    </p>
  );
}
