# FinTalk AI — Regulatory Compliance Review

**Prepared:** 2026-08-10
**Scope:** Every feature and process in the FinTalk AI codebase (backend + frontend, as committed today), reviewed against five Malaysian financial-law instruments supplied in `Financial Law and Regulations/`, with Islamic banking (Shariah) compliance treated as the priority.
**Prepared by:** Claude, acting as requested in a law-consultant capacity for this review.

> **This is an engineering-level compliance gap analysis, not a legal opinion.** It was produced by reading the statutory PDFs and the source code directly — it has not been reviewed by a Malaysian-qualified lawyer or a registered Shariah adviser. Treat every finding below as a worklist for those two people, not as clearance. This matters especially here: the codebase's own Shariah rule engine tags every legal citation it relies on with the string `"requires legal confirmation"` — the code is explicitly asking for the same review this document is attempting. Nothing in this review discharges that.

---

## 0. Method and sources

Five PDFs were supplied and read directly (not summarized from memory, not fetched from the web):

| Document | What was read |
|---|---|
| **Islamic Financial Services Act 2013** (Act 759) | Parts I–III (definitions, regulatory objectives, authorization) and **Part IV "Shariah Requirements" (ss.27–38) in full** — the core statute for this review. Payment Systems and Prudential Requirements parts skimmed for context. |
| **Financial Services Act 2013** (Act 758) | Part VIII "Business Conduct and Consumer Protection" in full, including Division 4 "Information and Secrecy" (ss.131–134) and Division 5 (ss.135–139). Parts VI–VII and XI–XIII skimmed for context. |
| **Anti-Money Laundering, Anti-Terrorism Financing and Proceeds of Unlawful Activities Act 2001** (Act 613) | Part IV "Reporting Obligations" (ss.13–20) in full, including customer due diligence (s.16), record retention (s.17), and compliance programme (s.19). |
| **Personal Data Protection (Amendment) Act 2024** (A1727) | Read in full (10 pages) — this is the 2024 amendment to the Personal Data Protection Act 2010 (Act 709), not the principal Act. **The base 2010 Act's text was not in the supplied folder**, so principle-level citations below (e.g. the seven data protection principles) rely on the amendment's own section references plus general knowledge of the unamended Act's structure, not on text actually extracted from a PDF. Flagged inline wherever this applies. |
| **Risk Management in Technology** (BNM/RH/PD 028-98, issued 28 Nov 2025) | Read in full, 80 pages including all 11 appendices — governance, technology risk management, cybersecurity, digital services, third-party/cloud provisions, and the notification/consultation regime. |

Codebase files read directly: `backend/src/shariah/{engine,rules}.ts`, `backend/src/compliance/{shariah-review,termsheet,errors}.ts`, `backend/src/pdpa/{detectors,redactor,vault,transcript-store,whiteboard-store}.ts`, `backend/src/audit/chain.ts`, `backend/src/auth/{middleware,rbac,password,tokens}.ts`, `backend/src/ai/{provider,gemini.provider}.ts`, `backend/src/pipeline/process-meeting.ts`, `backend/src/routes/{compliance,meetings}.routes.ts`, `backend/src/export/pain001.ts`, `backend/src/config/env.ts`, `backend/prisma/schema.prisma`, `backend/prisma/sql/constraints.sql`, `frontend/src/app/(app)/meetings/page.tsx`.

A note on how this review was done: the Agent/subagent tool is non-functional in this environment this session (confirmed by a live test before starting — it fails with a model-routing error), so this could not be parallelized across sub-agents as would normally happen for a review this size. Everything above was read directly, section by section, in one continuous pass. This is disclosed because it affects the confidence you should place in completeness — a few things below are explicitly marked as inferred-by-structural-parallel rather than independently verified (e.g. IFSA's own secrecy division), and you should treat those as lower-confidence than the items with an exact section citation.

**Where this file lives:** there was no existing convention in the repo for compliance/legal review documents (only `docs/superpowers/{specs,plans}/`, which belong to a different workflow), so this is a new `docs/compliance/` folder, dated like the existing convention.

---

## 1. What FinTalk AI actually is

Before applying any statute, it matters what kind of entity FinTalk AI is, because that determines whose obligations are whose (see §2).

As built, FinTalk AI is **an AI-assisted deal-desk tool for credit committee meetings**, most plausibly sold to or operated by a bank or Islamic financial institution rather than being one itself. The pipeline, end to end:

1. A **maker** uploads a meeting recording (and optionally a whiteboard photo) with a required consent confirmation.
2. Audio is sent to **Google Gemini** for transcription (never written to disk; held in memory for the request only).
3. The raw transcript is run through a **PII redactor** before anything is persisted — NRIC, bank account, phone, email and card numbers are replaced with placeholders and the original values are sealed (AES-256-GCM) into a separate vault table.
4. The redacted transcript is screened by a **deterministic Shariah rule engine** for six issue types (riba, gharar, maysir, haram-sector activity, late-payment-penalty mischaracterisation, and Islamic-contract/interest-rate contradictions), raising advisory findings that a human holding the `SHARIAH` role must clear before anything downstream can proceed.
5. The maker drafts a **term sheet**, which the application and the database both enforce must be either a conventional facility (interest rate, no Islamic contract) or an Islamic facility (profit rate under a named contract — Murabahah, Tawarruq, Ijarah, Musharakah, Mudharabah, Istisna or Salam), never a mix of both.
6. Submission is blocked while any Shariah finding on the meeting is unresolved.
7. A **checker** (never the same person as the maker — enforced by the database, not just the application) approves or rejects.
8. An approved facility can be downloaded as a **CSV handoff** for a human to complete in their own banking channel — deliberately not an ISO 20022 pain.001 payment instruction (see §7.3 for why that matters).
9. Every step above writes to a **hash-chained, append-only audit log** (Postgres triggers reject UPDATE/DELETE on it).

This is evidently an early-stage build — the repository root also contains a hackathon-style pitch deck and presentation audio — but the compliance engineering inside it (redaction-by-construction via a branded `RedactedText` type, database-enforced segregation of duties, database-enforced rate/contract exclusivity, an append-only audit chain) is unusually mature for that stage. That context shapes the tone of this review: the findings below are a pre-production punch list, not a "you are currently breaking the law" notice.

---

## 2. Threshold question: whose obligations are these?

FSA 2013 and IFSA 2013 regulate **licensed persons** — banks, investment banks, insurers, takaful operators, payment system operators, and so on (FSA s.10 licensing; IFSA equivalent). Nothing in the codebase suggests FinTalk AI itself accepts deposits, extends financing, or otherwise carries on a licensed business — it is software that a licensed institution's staff use internally. On the evidence available, **FinTalk AI is a third-party service provider (TPSP) to a licensed institution, not itself a licensed institution.**

That reframes almost everything below:

- **FSA/IFSA licensing offences** (unlicensed deposit-taking, misuse of the words "bank"/"Islamic bank", etc.) are not FinTalk AI's exposure — they are the client institution's, and FinTalk AI should simply avoid marketing language that could blur that line.
- **IFSA's Shariah compliance duty** (s.28) is a duty *of the institution*, not of its software vendor. FinTalk AI cannot discharge that duty on the institution's behalf — it can only support the institution's own Shariah committee in discharging it. This distinction should be explicit in FinTalk AI's own marketing and documentation (see §3.4).
- **AMLA's reporting obligations** (Part IV) bind "reporting institutions" (First Schedule) — banks, not their software vendors. FinTalk AI's job is to not get in the way of its client's AMLA compliance (retention, CDD record-keeping), not to independently comply with AMLA.
- **RMiT** binds the licensed institution directly, but flows down to FinTalk AI *contractually and operationally*, because RMiT's definition of "third party service provider" (§10.44 of the policy) explicitly captures "cloud computing software, platform and infrastructure service providers" and anyone handling confidential customer information on the institution's behalf. This is the regime FinTalk AI has the most direct exposure to, and where a client's onboarding due diligence will be most demanding (§7.4).
- **PDPA** binds FinTalk AI directly and unavoidably, in its own right, as whichever entity is processing the personal data that flows through the redaction pipeline — this is the one regime here where FinTalk AI itself is squarely the regulated party (§6).

---

## 3. Islamic banking / Shariah compliance — Islamic Financial Services Act 2013 (priority section)

### 3.1 What the Act requires

IFSA Part IV, "Shariah Requirements," is short (12 sections) but load-bearing:

- **s.28 — duty to comply with Shariah.** An Islamic financial institution "shall at all times ensure that its aims and operations, business, affairs and activities are in compliance with Shariah," and specifically must not have any element that isn't approved by the Shariah Advisory Council (SAC) or the institution's own Shariah committee. This is the institution's duty — not a duty that can be outsourced to a screening tool.
- **s.29 — Bank's power to specify Shariah standards.** BNM may issue standards on any Shariah matter, and rulings of the SAC are, per the Central Bank of Malaysia Act 2009, binding on both the institution and its own Shariah committee.
- **s.30–34 — Shariah committee.** Every Islamic financial institution must establish a Shariah committee; BNM may specify fit-and-proper and other requirements for appointment; a member's duties run to the institution; cessation of a member must be notified to BNM with reasons.
- **s.35 — information to be provided** to the Shariah committee so it can discharge its function; **s.36 — qualified privilege** protecting good-faith Shariah committee communications, alongside confidentiality obligations.
- **s.37–38 — audit on Shariah compliance.** The institution must have its compliance with Shariah audited, and BNM may specify standards for that audit.
- Separately, **s.18(1)(a)** makes "pursuing aims... contrary to Shariah" a ground on which BNM can revoke a licence outright — the highest-stakes provision in the Act for an Islamic institution.

The recurring theme: **Shariah compliance is a matter of institutional and human authority** (the Shariah committee, backed by the SAC), not a matter a piece of software can settle. Anything built here can only ever be an aid to that authority.

### 3.2 What's built

This is where the codebase is genuinely strong, and worth describing precisely because the design choices track the statute closely, whether or not that was the explicit intent:

- **`shariah/rules.ts`** defines six deterministic, versioned, regex-based rules (riba via interest-rate/compounding language, late-payment penalty mischaracterisation between *ta'widh* and *gharamah*, gharar via unspecified terms, maysir, haram-sector business activity, and a same-transcript Islamic-contract-plus-interest contradiction). Patterns cover both English and Bahasa Rojak code-switching ("kena guna profit rate" alongside "we quote 8% interest"), which is realistic for how these meetings actually happen.
- Every rule's `reference` field is explicit that it names *where to look*, not a settled legal reading, and is tagged `"requires legal confirmation"`. That is honest and correct — but it also means **no rule in production today has been signed off by anyone qualified to sign it off.**
- **`shariah/engine.ts`** runs the rules over already-redacted transcript text (never raw text — see §6), caps findings per rule, and explicitly documents that it produces *findings*, never *violations*: "the word 'violation' appears nowhere in its output — that judgement belongs to a qualified reviewer holding the SHARIAH role." `FacilityContext.isIslamic` defaults unknown-to-Islamic, i.e. it fails safe toward the more cautious classification.
- **`compliance/shariah-review.ts`** gates resolution of a finding on `role === 'SHARIAH'` (403 otherwise), refuses to store a review note containing personal data (forcing the reviewer to cite a redaction placeholder instead), requires a non-empty rationale to clear or confirm a finding, and treats `CLEARED`/`CONFIRMED_VIOLATION` as terminal — a resolved finding cannot be quietly re-opened, only superseded by a fresh finding on a new term sheet.
- **`compliance/termsheet.ts` + `prisma/sql/constraints.sql`** enforce, at both the application layer and as a Postgres `CHECK` constraint, that an `ISLAMIC` facility carries a profit rate under a named contract and *never* an interest rate, and a `CONVENTIONAL` facility is the exact mirror image. This is the practical expression of s.28's "no element not in compliance with Shariah" — encoded so it cannot be bypassed by an application bug, only by someone with raw database access.
- Submission to approval is refused while any Shariah finding on the meeting is not `CLEARED` — `CONFIRMED_VIOLATION` blocks *permanently*; the only way forward is a new term sheet, not an edit to the flagged one.

### 3.3 Assessment — what this gets right

- The system never claims to make a Shariah ruling. Every design choice reinforces "flag for a human," never "decide." That is the correct posture under s.28/30, and it should be preserved through any future refactor — it would be easy for a well-meaning "let's make the AI smarter" change to erode this boundary.
- The interest-rate/profit-rate exclusivity constraint is enforced at the database level, not just in application code. That's a genuinely strong control against exactly the failure mode the engine's own code comments describe encountering (a term sheet naming a Murabahah contract while also carrying an interest rate).
- Segregation between who can raise a finding (the engine, automatically), who can clear it (only `SHARIAH` role), who can draft a term sheet (`MAKER`), and who can approve it (`CHECKER`, never the maker) maps cleanly onto sound Shariah governance practice and general four-eyes control design.

### 3.4 Gaps and risks

1. **Every legal citation is unverified.** This is the single highest-priority item in this entire review. Before any rule set like this is relied on for a real facility, a registered Shariah adviser or the institution's own Shariah committee needs to review and formally adopt (or correct) each of the six rules in `rules.ts`. Right now the code is asking for exactly this, in its own comments.
2. **No link between the app's `SHARIAH` role and an actual IFSA-appointed Shariah committee member.** The RBAC layer (`rbac.ts`) treats `SHARIAH` as an application role like any other — there's nothing that ties granting that role to the institution's formal appointment process under s.31, and nothing that reflects a cessation-of-appointment event under s.33/34 (e.g. immediately revoking the app role when BNM is notified a member has ceased). If this is handled organisationally outside the app today, that's fine, but it should be documented as a control, because an auditor will ask.
3. **Regex-based detection has an inherent false-negative ceiling.** The engine's own design (advisory-only, human-reviewed) is the right mitigation for this, but it's worth being explicit in any client-facing documentation that the tool *narrows* what a human has to look for — it does not *replace* the human's judgment, and should never be marketed as if it does. Overclaiming here would itself risk misleading a client institution about how it can discharge its own s.28 duty.
4. **No Shariah audit trail artifact aimed at s.37/38 specifically.** The audit chain captures every action generically, which is good, but there's no dedicated "Shariah compliance audit report" view assembling, say, all findings + resolutions + reviewer identities for a given period — which is what s.37/38 contemplates the institution producing. This is a nice-to-have, not urgent, since the raw data for it already exists in the audit log.
5. **`CONTRACT_MISMATCH` suppression logic is a judgment call worth flagging to Shariah counsel specifically**, not just noting in passing: the rule only surfaces when a `RIBA` finding is *also* present, on the theory that naming a contract alone is unremarkable. That's a reasonable design decision, but it's exactly the kind of threshold call that should be explicitly ratified (or overridden) by whoever signs off on the rule set in item 1, not left as an unreviewed engineering default.

### 3.5 Recommendations, in order

1. Get the six rules in `rules.ts` — patterns, confidence thresholds, and references — formally reviewed and adopted by a registered Shariah adviser before any facility processed through the tool is relied on for a real credit decision.
2. Document (even if it's a process outside the app) how the `SHARIAH` role is granted and revoked, and tie it explicitly to the institution's own s.31/33/34 appointment records.
3. Add a one-line disclosure, surfaced in the product itself (not just in code comments), that Shariah findings are a screening aid and do not constitute a Shariah ruling — this protects both the client institution and FinTalk AI.
4. Consider a periodic "Shariah compliance summary" export scoped to s.37/38's audit purpose, built from data that already exists in the audit chain.

---

## 4. Anti-Money Laundering (Act 613)

### 4.1 Applicability

Per §2, FinTalk AI is not itself a "reporting institution" under AMLA's First Schedule — the client bank is. FinTalk AI's exposure is indirect: it must not *obstruct* the client's ability to meet Part IV obligations, and ideally should actively support them.

### 4.2 What's built, and where it helps

- **s.16 (customer due diligence)** requires a reporting institution to ascertain and verify customer identity and keep records of it. FinTalk AI's transcripts and term sheets (applicant name, facility terms) are exactly the kind of "record of a business relationship, transaction or activity" contemplated here, retained with full provenance (model ID, prompt version, timestamps) — useful supporting evidence for a client's own CDD file.
- **s.19 (compliance programme)** requires the reporting institution to maintain an independent audit function testing its AML controls, with employees trained per ss.13–17. FinTalk AI's audit log gives that internal audit function a verifiable, tamper-evident record to test against — a genuine asset for a client's compliance programme, not something FinTalk AI needs to build itself.

### 4.3 The one real gap: retention

**s.17(1)** is unambiguous and was read in full: a reporting institution "shall maintain any account, record, business correspondence and document relating to an account, business relationship, transaction or activity with a customer... for a period of **at least six years** from the date the account is closed or the business relationship, transaction or activity is completed or terminated." Contravention is an offence carrying up to RM3 million or five years' imprisonment.

`backend/src/config/env.ts` defines `MEETING_RETENTION_DAYS` with a **default of 90 days**. If a credit committee meeting transcript and its term sheet are treated as records "relating to a transaction" for AMLA purposes — which is a plausible reading given they document the basis on which a facility was approved — a 90-day default is roughly **24× shorter** than what s.17 requires. This is a configurable environment variable, so a deployer *can* set it correctly, but shipping 90 days as the default is a foot-gun: it will be correct for nobody's actual AMLA obligation and wrong by default for everybody's.

This also creates a direct, non-obvious tension with PDPA's Retention Principle (data must not be kept **longer** than necessary — see §6), which pulls in the opposite direction. The two statutes together imply a **specific minimum-and-maximum band**, not a single free variable: at least six years from relationship-completion for anything that counts as an AMLA-relevant record, and no longer than that once the purpose is served. That's a real reconciliation task for whoever owns this deployment, not something a default value can paper over.

### 4.4 Recommendations

1. Do not ship `MEETING_RETENTION_DAYS=90` as a production default. Replace it with a value derived from the client institution's own AMLA retention policy (at least six years post-relationship for anything that is or supports an AMLA record), and make the *reasoning* — not just the number — visible in configuration so a future maintainer doesn't quietly "fix" it back down.
2. Confirm with the client institution's compliance team whether FinTalk AI-generated transcripts/term sheets are being treated as AMLA s.17 records in their own retention schedule, and align accordingly.

---

## 5. Financial Services Act 2013 — secrecy and consumer conduct

### 5.1 What applies

FSA Part VIII Division 4 ("Information and Secrecy," ss.131–134) makes it an offence — up to RM10 million or five years' imprisonment — for anyone with access to a financial institution's customer information to disclose it outside a defined list of permitted circumstances (Schedule 11). "Financial institution" here is defined narrowly (licensed banks, investment banks, and payment system operators/issuers) and does not, on its face, capture FinTalk AI itself — but the customer information a bank's credit committee discusses, and that FinTalk AI transcribes, is squarely the kind of information s.133 protects **for the bank**. A vendor mishandling it doesn't commit the s.133 offence itself (that offence attaches to the institution and its officers/agents), but a leak from FinTalk AI's systems would still be the proximate cause of the bank's breach — which is precisely the exposure a bank's own vendor due diligence (and RMiT, §7) exists to manage.

**IFSA has a structurally parallel secrecy division** (Islamic institutions are twin-drafted with FSA throughout) — this was not independently pulled during this review (time was prioritised on Part IV Shariah Requirements instead, per the user's stated priority), so treat "IFSA has an equivalent to FSA ss.131–134" as a reasonable inference from statutory structure, not a verified citation. Confirm the exact section numbers before relying on this point in anything formal.

FSA s.135 is worth noting for precision: Division 5 (restrictions relating to consumer protection, e.g. deposit advertising rules) explicitly **does not apply to a licensed Islamic bank under IFSA** — that Division has its own Islamic equivalent, which is consistent with the twin-Act structure generally.

### 5.2 Assessment

The redaction-before-storage design (§6) is, functionally, the right control for this risk regardless of which Act's secrecy provision technically applies: by the time anything is queryable through the application, direct identifiers are already sealed behind the vault, not sitting in plaintext in a transcript row. That's a reasonable technical proxy for secrecy compliance even though it wasn't necessarily built with FSA s.133 specifically in mind.

### 5.3 Recommendations

1. Get IFSA's own secrecy division confirmed (section numbers and exact scope) before this review is treated as complete on this point.
2. Make sure any FinTalk AI–client contract explicitly addresses confidentiality of customer information in terms that mirror FSA/IFSA secrecy expectations — this is a contractual backstop, not something the software alone can satisfy.

---

## 6. Personal Data Protection — PDPA (Act 709, as amended by Act A1727:2024)

### 6.1 What the 2024 amendment requires

Read in full. The amendment (among other changes):

- Renames "data user" to **"data controller"** throughout, and for the first time in the amended sections makes data security obligations bind **data processors directly**, not only controllers.
- Inserts a new **s.12A** requiring appointment of a **Data Protection Officer** and disclosure of their contact details.
- Inserts a new **s.12B** requiring **mandatory data breach notification** — to the Commissioner "as soon as practicable," and to affected data subjects "without unnecessary delay" where the breach causes or is likely to cause significant harm.
- Inserts a new **s.43A** right to **data portability**.
- Amends **s.129** (cross-border data transfer) — this section previously worked off a Minister-gazetted whitelist of approved destination countries; the amendment moves toward the controller conducting its own assessment against statutory conditions rather than relying solely on a whitelist. (The exact post-amendment text of s.129(2)'s conditions was captured in the amendment PDF, but the base Act's original s.129 was not supplied, so cross-check the precise current wording before relying on it for a specific transfer decision.)

### 6.2 What's built, and where it's strong

This is the best-covered regime in the codebase, by a clear margin:

- **`pdpa/detectors.ts`** finds NRIC (with a plausible-date-of-birth shape check), bank account numbers, Malaysian phone numbers, email addresses, and card numbers (Luhn-validated), applied most-specific-pattern-first so a card number's tail digits can't be misclaimed as a bank account.
- **`pdpa/redactor.ts`** enforces, via a branded `RedactedText` TypeScript type that only this module can mint, that **nothing can reach storage without having passed through redaction** — this is enforced by the type system, not by convention or code review discipline, and a dedicated architecture test (`tests/unit/pdpa/architecture.test.ts`, referenced in the code comments) fails the build if anything else tries to produce that type. A second pass (`redactDerived`) re-checks model-generated summaries and **fails closed** — discarding a summary entirely — if the summarising model reproduces an identifier from redacted input, rather than trying to silently patch it.
- **`pdpa/vault.ts`** seals every detected identifier with AES-256-GCM (authenticated encryption, fresh IV per value), and the Prisma schema confirms there is **no plaintext column anywhere** for this data.
- **`meetings.routes.ts`** implements an explicit **consent gate**: processing is refused with a 422 before the audio is even inspected if `consentConfirmed` is not `true`, and the refusal happens because "processing means sending audio to a third-party model" — this is exactly the right sequencing (consent-before-processing, not consent-as-an-afterthought), and it's mirrored honestly in the frontend (`meetings/page.tsx`), which discloses to the operator in plain language what they're confirming before they can submit.
- Raw audio is held **in memory only**, never written to disk — reducing the retention/security surface for the most sensitive input.

### 6.3 Gaps

1. **No Data Protection Officer appears anywhere in the codebase or configuration.** s.12A requires one to be appointed with published contact details. This is an organisational action, not a code change, but it's a hard requirement with no code-level trace of having been done.
2. **No breach notification workflow.** There's no code path, runbook, or even a placeholder for "notify the Commissioner" / "notify affected data subjects" per s.12B. Given the audit chain already tracks exactly the kind of event (`redaction.created`, `meeting.failed`, etc.) a breach investigation would need, the underlying data exists — the *process* wrapping it (who decides "significant harm," who notifies whom, on what clock) does not.
3. **Cross-border transfer to Google Gemini is not documented as risk-assessed anywhere.** `ai/provider.ts`'s own code comment refers to this as "RISK-001" and frames the provider abstraction as making a future move to a host-local model "a configuration change, not a rewrite" — which shows the risk was recognised at design time — but there is no artifact (data processing agreement reference, Google's processing-location commitments, a documented s.129 assessment) confirming the transfer is currently lawful. This is the single largest cross-cutting risk in the whole review (it also touches RMiT, §7.3, and arguably FSA/IFSA secrecy, §5) and deserves a dedicated write-up of its own, not just a line item here.
4. **`PERSON_NAME` and `ADDRESS` detection is a known, self-disclosed gap.** The code comment in `detectors.ts` is explicit: these "need a model pass, which arrives with the capture pipeline" and are "deliberately absent" for now because "a regex that guessed at names would produce false confidence in a redaction log an auditor is meant to trust." That's a defensible engineering call, but it means **spoken names in a transcript are not currently redacted at all** — worth stating plainly rather than letting the enum in the Prisma schema (`PiiType` includes `PERSON_NAME` and `ADDRESS`) create a false impression that this is already handled.
5. **Retention** — see §4.3; the same 90-day default is also the PDPA-relevant number, just pulling in the opposite direction from AMLA.

### 6.4 Recommendations

1. Appoint a DPO and record it somewhere durable (even a `COMPLIANCE.md` in the repo, referencing the organisational decision).
2. Write the breach-notification runbook now, before it's needed under time pressure — the audit chain already gives it the evidence trail it needs.
3. Produce a documented cross-border transfer assessment for the Gemini dependency: where Google processes the data, what contractual safeguards exist (standard contractual clauses / Google's own data processing terms), and how that satisfies the amended s.129. Treat this as the top action item in the whole document alongside the Shariah rule sign-off in §3.5.
4. When the "model pass" for `PERSON_NAME`/`ADDRESS` detection ships, make sure it goes through the same `redact()`-only-mints-`RedactedText` discipline already enforced for the regex detectors.

---

## 7. BNM Risk Management in Technology (RMiT)

### 7.1 Applicability

RMiT binds licensed banks, licensed Islamic banks, insurers, takaful operators, e-money issuers, and payment system operators directly (§2 of the policy) — not FinTalk AI itself. But its definition of **third party service provider** (§10.44) is drafted exactly to reach a vendor like FinTalk AI: "any internal group affiliate or external entity providing technology-related functions or services directly to enable or support a function or service provided by the financial institution, or which involves the transmission, processing, storage or handling of confidential information pertaining to the financial institution or its customers. This includes cloud computing software, platform and infrastructure service providers." FinTalk AI is a TPSP under this definition, full stop. Everything in this section is about what a client institution's own RMiT obligations will require *of FinTalk AI*, contractually and operationally — not obligations FinTalk AI owes BNM directly.

There's also a second layer: FinTalk AI itself depends on Google Gemini as **its own** sub-processor — RMiT's language for this is a "fourth party" relative to the institution (Appendix 10, Part A.5(d)), and Appendix 8 §3 calls out "cyber supply chain risks" including "third party risk management for key sub-contractors" and "concentration and geopolitical risk" as things the institution must be satisfied about. A client institution's due diligence on FinTalk AI will, correctly, extend one level further to ask about Gemini.

### 7.2 What's built, and where it maps well

- **Encryption at rest** for the one column that matters most (the PII vault, AES-256-GCM) — aligns with RMiT Appendix 5 Part B.1 (data-at-rest encryption for PII).
- **Argon2id password hashing** (`auth/password.ts`) — a defensible, modern choice; the module correctly treats an unreadable stored hash as "verification failed" rather than throwing in a way a caller might mistake for a retryable fault.
- **Capability-based access control** (`auth/rbac.ts`, enforced via `requireCapability` on every route) with an explicit design note that no single role holds both sides of the maker–checker split, and that `ADMIN` deliberately does **not** hold `shariah:review` or `termsheet:approve` — this maps directly onto RMiT's least-privilege and segregation-of-duties expectations (Appendix 10 Part B.9).
- **Append-only, hash-chained audit log**, enforced by database triggers rather than only application logic — a strong evidentiary control that goes beyond what RMiT strictly requires and directly supports both RMiT's audit-trail expectations (§13, technology audits) and the SOC/incident-forensics expectations in Appendix 5 Part C.
- **JWT access/refresh separation** with distinct secrets and audience claims (`auth/tokens.ts`) — sound token hygiene.

### 7.3 Gaps

1. **No multi-factor authentication anywhere in the auth flow.** RMiT is explicit and repeated on this point: Appendix 5 Part A.3(e) requires MFA for all remote access sessions, and Appendix 10 Part B.9(a)(ii) requires MFA for privileged/management-plane access. `SHARIAH`, `CHECKER`, and `ADMIN` are exactly the privileged roles this applies to, and today authentication is password (argon2id-hashed, which is good) plus a JWT cookie — no second factor. This is a real gap relative to what a bank's TPRM review will expect, not a nice-to-have.
2. **No documented cloud/cross-border consultation.** RMiT §17.1 requires the *institution* (not FinTalk AI) to consult BNM before first adopting a public cloud or emerging technology for a critical system, backed by a documented risk assessment following Appendix 10's structure. If a client institution treats FinTalk AI (and, transitively, Gemini) as supporting a critical system, this consultation is theirs to run — but FinTalk AI should be prepared to hand them a ready-made risk assessment package (see §7.4), because they cannot complete their own s.17.1 consultation without it.
3. **No visible sub-processor register or SLA artifact for Gemini.** RMiT §10.46–10.49 (Third Party Service Provider Management, read in full) expects the institution's SLA with a TPSP to cover regulator access rights, sub-contracting notice, secrecy undertakings, disaster recovery, and exit/data-portability terms — and by extension expects FinTalk AI to be able to say the same about its own arrangement with Google. Nothing in the repository documents this today.
4. **No visible SOC, cyber incident response plan, penetration testing cadence, or business continuity plan.** Expected and unremarkable at this build stage, but every one of these is a named, minimum requirement in RMiT (§11 Cybersecurity Management, Appendix 5 Parts C–D) that a client institution's onboarding due diligence will ask for directly, using something close to the Appendix 7 "Risk Assessment Report" template.

### 7.4 What a client bank will actually ask for (practical checklist)

RMiT Appendix 7 gives the literal form a bank's technology risk team will send back to FinTalk AI during vendor onboarding — worth preparing proactively rather than reactively:

- Company/SSM registration details, engagement scope, key contacts (Appendix 7 Part A, Sections 1–2).
- A technology risk assessment addressing, at minimum: access control, physical/environmental security, operations security, communication security, incident management, and business continuity (Appendix 7 Part D.1).
- For anything touching cloud or "emerging technology": a comprehensive risk assessment following Appendix 10's structure (cloud governance, architecture, cryptographic key management, access controls, cyber response/recovery, exit strategy) plus a board/CISO-level confirmation in the exact form Appendix 7 Part B specifies.
- Answers to Appendix 8's third-party/cyber-risk questions directly: operational resilience and key-man risk, security governance and data segregation from other tenants, and the cyber-supply-chain questions about Gemini specifically (vetting, sub-contractor risk management, geopolitical/concentration risk).

Preparing this package before a client asks for it — rather than assembling it under deadline pressure during a sales process — is the single most practically useful thing this section of the review can recommend.

### 7.5 Recommendations

1. Add MFA for `SHARIAH`, `CHECKER`, and `ADMIN` roles at minimum; ideally for all roles.
2. Draft the RMiT Appendix 7/8/10-shaped risk assessment package now, reusing content from this review, so it exists before a client's TPRM team asks for it.
3. Document the Gemini sub-processor relationship explicitly: data flow, processing location, contractual terms, and how FinTalk AI would support a client's own §17.1 BNM consultation.
4. Even a lightweight, documented incident response plan and backup/recovery procedure will materially help here — it doesn't need to be enterprise-grade yet, but "nothing written down" is the actual gap, not "not enterprise-grade."

---

## 8. Cross-cutting findings

These don't belong to any single Act — they only become visible by reading all five together.

1. **The retention default is wrong in both directions at once.** `MEETING_RETENTION_DAYS=90` is too short for AMLA s.17 (needs ≥6 years for records that support a client's AML file) and is a default rather than a deliberate PDPA-minimisation decision (needs to be "no longer than necessary," which is a different exercise than "no longer than 90 days by default"). These two constraints define a *band*, not a single number, and the band depends on what kind of record a given piece of data is. This needs a real retention policy, not a single env var.
2. **The cross-border transfer to Google Gemini is the single highest-leverage risk in this entire review**, because it's the one place where PDPA (§6.3), RMiT (§7.3), and arguably FSA/IFSA secrecy (§5.1) all converge on the same fact pattern: customer-affairs information, potentially including Shariah-sensitive deal terms, leaving Malaysia (or at least leaving the institution's own control) to reach a third-party model. The provider-abstraction design (`ai/provider.ts`) shows this was anticipated at a technical level — good — but there is no compliance artifact yet that actually closes the loop. This deserves its own dedicated legal memo, not just a paragraph in three different sections of this one.
3. **Every Shariah rule citation is explicitly unverified**, by the code's own admission. This is the one item in the entire review that the codebase itself flags most loudly, and it should be the first thing resolved given the user's stated priority on Islamic banking compliance.

---

## 9. Prioritized action list

**Before any pilot or production use involving real customer data:**

1. Get Shariah counsel/committee sign-off on every rule in `shariah/rules.ts` (§3.5.1).
2. Produce a documented cross-border transfer risk assessment for the Gemini dependency, addressing PDPA s.129 and setting up what RMiT §17 will require of the client institution (§6.4.3, §7.5.3).
3. Appoint a DPO and document it (§6.4.1).
4. Write a breach-notification runbook (§6.4.2).
5. Replace the 90-day retention default with a deliberate, documented policy that satisfies AMLA's 6-year floor for AML-relevant records while not over-retaining everything else (§4.4.1, §8.1).
6. Add MFA for privileged roles (§7.5.1).
7. Document how the `SHARIAH` app role maps to real IFSA-appointed Shariah committee membership (§3.5.2).

**Before onboarding a bank/Islamic-bank client:**

8. Assemble the RMiT Appendix 7/8/10-shaped vendor risk package proactively (§7.4).
9. Confirm IFSA's own secrecy division citation and reflect it in any client-facing compliance documentation (§5.3.1).
10. Put a written incident response plan and backup/recovery procedure in place, even a lightweight one (§7.5.4).

**Hardening / best practice, not blocking:**

11. Extend PII detection to `PERSON_NAME`/`ADDRESS` when the model-based pass is ready, through the same `redact()`-only discipline (§6.4.4).
12. Build a s.37/38-shaped "Shariah compliance audit" export from existing audit-log data (§3.5.4).

---

## 10. What's already right — don't lose this in a rewrite

Worth stating plainly, since a review like this can read as all-gaps: several design decisions here are unusually good compliance engineering for the project's stage, and are worth explicitly protecting through future changes rather than being casually refactored away:

- The `RedactedText` branded type, enforced by an architecture test, that makes an unredacted write **inexpressible in the type system**, not just discouraged by convention.
- The database-level `CHECK` constraint making an Islamic facility's rate/contract exclusivity impossible to violate even by an application bug.
- The database-level constraint (and application check) that a term sheet's checker can never be its maker.
- The append-only audit chain enforced by triggers, not just application discipline.
- The explicit, principled decision to drop the ISO 20022 pain.001 export in favour of a CSV handoff, documented in `export/pain001.ts` with real reasoning (a Murabahah's actual cash flow — bank to vendor for an asset purchase — doesn't match what a plain credit-transfer instruction describes, and emitting one would have re-created the exact interest/profit-rate confusion the Shariah engine exists to catch).
- The consent gate that blocks processing *before* audio is inspected, not after, with matching plain-language disclosure in the UI.
- Never persisting raw audio to disk.
- The Shariah engine's unwavering "advisory only, human decides" framing throughout — this is the correct posture under IFSA s.28/30 and is worth treating as an invariant, not a starting point to be "improved" toward more automation later.

---

*End of review. Next step recommended: route this document to the two people who can actually close its top items — Shariah counsel (§3) and whoever owns the Gemini data processing relationship (§6.3, §8.2) — starting with those two, since everything else in the prioritized list is either faster to fix or depends on decisions those two conversations will produce.*
