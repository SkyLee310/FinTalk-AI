/**
 * A structured handoff of an approved facility, for human download.
 *
 * **There is deliberately no function in this module that sends anything.** The
 * only export shape is "build a document and return it as a string". A test
 * asserts that no exported name looks like a transmitter, so the absence is
 * checked rather than merely intended (spec §2.3).
 *
 * Account numbers are emitted as explicit to-be-completed markers, not values. A
 * bank account is personal data; this system redacts it before storage and keeps
 * only ciphertext, so it has no plaintext account number to put here. The maker
 * supplies those in their own corporate banking channel, which is where
 * submission happens.
 *
 * This module used to also emit ISO 20022 pain.001 XML. That was removed on
 * purpose. pain.001 is a *credit transfer initiation* — an instruction to move
 * money — while an approved term sheet is a credit decision. For a Murabahah
 * facility the money moves bank-to-vendor for an asset purchase, so a plain TRF
 * crediting the applicant described a cash advance with a markup: the very
 * structure this product exists to flag. Emitting a payment message the system
 * cannot fill in, for a contract whose real flow is different, cost more in
 * credibility than the rekeying it saved.
 *
 * Two fields went with it. `remittanceInfo` carried the meeting title — free text
 * an operator typed, which can name a person and is redacted nowhere — into a
 * file that leaves the system. `requestedExecutionDate` was always two days out
 * because this system schedules nothing, so an authoritative-looking field held
 * an invented date.
 */

export const TO_BE_COMPLETED = 'TO-BE-COMPLETED-BY-MAKER';

export interface PaymentHandoffInput {
  readonly debtorName: string;
  readonly creditorName: string;
  readonly currency: string;
  /** Minor units. Never a float — see minorToDecimal. */
  readonly amountMinor: bigint;
  /** Ties the row back to the approved term sheet, and through it the meeting. */
  readonly endToEndId: string;
}

/**
 * Formats minor units as a decimal string using integer arithmetic only.
 *
 * Dividing by 100 in floating point is how a facility becomes 49999.999999999 in
 * a payment file. There is no Number anywhere in this function.
 */
export function minorToDecimal(minor: bigint, exponent = 2): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(exponent);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(exponent, '0')}`;
}

/**
 * The approved facility as one CSV row, for an operator to complete in their own
 * banking channel.
 *
 * Deliberately not a payment instruction and deliberately not named like one: it
 * carries the figures that would otherwise be rekeyed, and nothing that asserts
 * how or when money moves. Every field here is either a figure the checker
 * approved or a marker saying a human must supply it.
 */
export function buildPaymentCsv(input: PaymentHandoffInput): string {
  const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

  const header = [
    'end_to_end_id',
    'debtor_name',
    'debtor_account',
    'creditor_name',
    'creditor_account',
    'currency',
    'amount',
  ].join(',');

  const row = [
    cell(input.endToEndId),
    cell(input.debtorName),
    cell(TO_BE_COMPLETED),
    cell(input.creditorName),
    cell(TO_BE_COMPLETED),
    cell(input.currency),
    cell(minorToDecimal(input.amountMinor)),
  ].join(',');

  return `${header}\n${row}\n`;
}
