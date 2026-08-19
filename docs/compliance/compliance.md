# FinTalk AI — Compliance Risk Register

**Last updated:** 2026-08-19
**Source:** Distilled from the full [Regulatory Compliance Review](compliance/2026-08-10-regulatory-compliance-review.md), which reads five Malaysian financial-law instruments against the codebase as committed. This register is the quick-reference view; the linked review has the section-by-section legal reasoning behind every row below.

> As with the source review, this is an engineering-level gap analysis, not a legal opinion. Every row is a worklist item for Shariah counsel and/or a qualified lawyer, not a claim of clearance.

## Status key

| Status | Meaning |
|---|---|
| 🔴 Open | Not addressed. No control, code, or documented process exists yet. |
| 🟡 Partial | A real control exists but doesn't fully close the risk. |
| 🟢 Mitigated | A control is built and enforced (in code and/or at the database level), even if a related documentation step remains. |
| ⚪ Organisational | Not a code change — requires a decision or appointment outside the repository. Tracked here because a judge or auditor will ask about it regardless. |

## Risk register

| # | Risk | Domain | Severity | Status | Action needed | Ref. |
|---|---|---|---|---|---|---|
| 1 | Every Shariah rule in `shariah/rules.ts` is legally unverified — each `reference` field is self-tagged `"requires legal confirmation"` | Shariah / IFSA s.28 | 🔴 Critical | Open | Formal review and sign-off by a registered Shariah adviser or the institution's Shariah committee, rule by rule | [§3.4.1](compliance/2026-08-10-regulatory-compliance-review.md#34-gaps-and-risks) |
| 2 | Cross-border transfer of meeting audio/transcript to Google Gemini has no documented risk assessment (PDPA s.129, RMiT §7.3, FSA/IFSA secrecy) | PDPA / RMiT / Secrecy | 🔴 Critical | Open | Dedicated data-transfer risk assessment: processing location, contractual safeguards, s.129 basis | [§6.3.3](compliance/2026-08-10-regulatory-compliance-review.md#63-gaps), [§8.2](compliance/2026-08-10-regulatory-compliance-review.md#8-cross-cutting-findings) |
| 3 | `MEETING_RETENTION_DAYS` defaults to 90 days — roughly 24× short of AMLA s.17's 6-year floor, and not a deliberate PDPA-minimisation figure either | AMLA / PDPA | 🔴 High | Open | Replace the default with a value derived from the client institution's actual AMLA retention schedule | [§4.3](compliance/2026-08-10-regulatory-compliance-review.md#43-the-one-real-gap-retention) |
| 4 | No Data Protection Officer appointed or disclosed (PDPA s.12A) | PDPA | 🔴 High | Open ⚪ | Appoint a DPO; publish contact details | [§6.3.1](compliance/2026-08-10-regulatory-compliance-review.md#63-gaps) |
| 5 | No breach-notification runbook (PDPA s.12B — Commissioner "as soon as practicable", data subjects "without unnecessary delay") | PDPA | 🔴 High | Open | Write the runbook; the audit chain already has the evidence trail it would run on | [§6.3.2](compliance/2026-08-10-regulatory-compliance-review.md#63-gaps) |
| 6 | No MFA for privileged roles (`SHARIAH`, `CHECKER`, `ADMIN`) — RMiT Appendix 5 Part A.3(e) and Appendix 10 Part B.9(a)(ii) both require it | RMiT | 🟡 Medium–High | Open | Add MFA, at minimum for the three privileged roles | [§7.3.1](compliance/2026-08-10-regulatory-compliance-review.md#73-gaps) |
| 7 | The app's `SHARIAH` role isn't linked to an actual IFSA-appointed Shariah committee member — no record of appointment (s.31) or cessation (s.33/34) | Shariah / IFSA | 🟡 Medium | Open ⚪ | Document how the role is granted/revoked and tie it to the institution's own appointment records | [§3.4.2](compliance/2026-08-10-regulatory-compliance-review.md#34-gaps-and-risks) |
| 8 | No RMiT Appendix 7/8/10-shaped vendor risk package prepared for client onboarding | RMiT | 🟡 Medium | Open | Assemble the package proactively, before a client's TPRM team requests it | [§7.4](compliance/2026-08-10-regulatory-compliance-review.md#74-what-a-client-bank-will-actually-ask-for-practical-checklist) |
| 9 | No incident response plan, backup/recovery procedure, or documented pentest cadence | RMiT | 🟡 Medium | Open ⚪ | Even a lightweight, written version closes most of the gap | [§7.3.4](compliance/2026-08-10-regulatory-compliance-review.md#73-gaps) |
| 10 | `PERSON_NAME` and `ADDRESS` are in the `PiiType` enum but not yet detected — spoken names in a transcript are not currently redacted | PDPA | 🟡 Medium | Open (by design, disclosed) | Ship the model-based detection pass through the same `redact()`-only-mints-`RedactedText` discipline already enforced for regex detectors | [§6.3.4](compliance/2026-08-10-regulatory-compliance-review.md#63-gaps) |
| 11 | IFSA's own secrecy division (parallel to FSA ss.131–134) was inferred from statutory structure, not independently pulled and cited | Secrecy | ⚪ Low | Open | Confirm exact section numbers before relying on this in client-facing material | [§5.3.1](compliance/2026-08-10-regulatory-compliance-review.md#53-recommendations) |
| 12 | No dedicated Shariah compliance audit export (IFSA s.37/38) — the underlying data exists in the audit log, but there's no assembled view | Shariah | ⚪ Low | Open (nice-to-have) | Build a scoped export once higher-priority items above are closed | [§3.4.4](compliance/2026-08-10-regulatory-compliance-review.md#34-gaps-and-risks) |

## Controls already in place — not gaps, don't regress these

Listed so a future refactor doesn't casually remove them while chasing the items above:

- **Redaction is enforced by the type system, not convention.** `RedactedText` is a branded type minted in exactly one module (`pdpa/redactor.ts`); a dedicated architecture test fails the build if any other module tries to mint one. — 🟢 Mitigated
- **An Islamic facility cannot carry an interest rate, and vice versa.** Enforced at both the application layer and as a Postgres `CHECK` constraint. — 🟢 Mitigated
- **The checker can never be the maker.** Enforced in application code and as a database constraint. — 🟢 Mitigated
- **The audit log is append-only and hash-chained**, enforced by database triggers, not just application discipline. — 🟢 Mitigated
- **The Shariah engine never issues a ruling** — only a human holding the `SHARIAH` role can clear or confirm a finding; the word "violation" appears nowhere in the engine's own output. — 🟢 Mitigated
- **Consent is required before audio is processed**, not after, with a matching plain-language disclosure in the UI. — 🟢 Mitigated
- **PII is sealed with AES-256-GCM**; there is no plaintext column anywhere in the schema for detected identifiers. — 🟢 Mitigated
- **Raw audio is never written to disk.** — 🟢 Mitigated

## Priority order (from the source review's §9)

1. Rows 1–5 above, before any pilot or production use involving real customer data.
2. Rows 6–9, before onboarding a bank/Islamic-bank client.
3. Rows 10–12, hardening / best practice — not blocking.

*This register will drift out of date if the codebase changes and this file doesn't. Whoever closes a row should update its Status here in the same change, not leave it for the next compliance pass to discover.*
