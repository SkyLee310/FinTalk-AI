/**
 * ISO 20022 pain.001 generation for human download.
 *
 * **There is deliberately no function in this module that sends anything.** The
 * only export shape is "build a document and return it as a string". A test
 * asserts that no exported name looks like a transmitter, so the absence is
 * checked rather than merely intended (spec §2.3).
 *
 * Account numbers are emitted as explicit to-be-completed markers, not values. A
 * bank account is personal data; this system redacts it before storage and keeps
 * only ciphertext, so it has no plaintext account number to put here even though
 * the format wants one. The maker supplies those in their own corporate banking
 * channel, which is where submission happens.
 */

export const TO_BE_COMPLETED = 'TO-BE-COMPLETED-BY-MAKER';

export interface Pain001Input {
  readonly messageId: string;
  readonly createdAt: Date;
  readonly requestedExecutionDate: Date;
  readonly initiatingParty: string;
  readonly debtorName: string;
  readonly creditorName: string;
  readonly currency: string;
  /** Minor units. Never a float — see minorToDecimal. */
  readonly amountMinor: bigint;
  readonly endToEndId: string;
  readonly remittanceInfo: string;
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

/** Applicant names are operator input, so every interpolated value is escaped. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildPain001(input: Pain001Input): string {
  const amount = minorToDecimal(input.amountMinor);
  const currency = esc(input.currency);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(input.messageId)}</MsgId>
      <CreDtTm>${isoDateTime(input.createdAt)}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <InitgPty>
        <Nm>${esc(input.initiatingParty)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(input.messageId)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <ReqdExctnDt>
        <Dt>${isoDate(input.requestedExecutionDate)}</Dt>
      </ReqdExctnDt>
      <Dbtr>
        <Nm>${esc(input.debtorName)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${TO_BE_COMPLETED}</Id>
          </Othr>
        </Id>
      </DbtrAcct>
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${esc(input.endToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="${currency}">${amount}</InstdAmt>
        </Amt>
        <Cdtr>
          <Nm>${esc(input.creditorName)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${TO_BE_COMPLETED}</Id>
            </Othr>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${esc(input.remittanceInfo)}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

/** CSV alternative for operators whose channel takes an upload rather than XML. */
export function buildPaymentCsv(input: Pain001Input): string {
  const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

  const header = [
    'end_to_end_id',
    'requested_execution_date',
    'debtor_name',
    'debtor_account',
    'creditor_name',
    'creditor_account',
    'currency',
    'amount',
    'remittance_info',
  ].join(',');

  const row = [
    cell(input.endToEndId),
    cell(isoDate(input.requestedExecutionDate)),
    cell(input.debtorName),
    cell(TO_BE_COMPLETED),
    cell(input.creditorName),
    cell(TO_BE_COMPLETED),
    cell(input.currency),
    cell(minorToDecimal(input.amountMinor)),
    cell(input.remittanceInfo),
  ].join(',');

  return `${header}\n${row}\n`;
}
