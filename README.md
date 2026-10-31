# Domain Desk

A personal-first, self-hosted inbound CRM running as one TypeScript Cloudflare Worker. Email Routing invokes the `email` handler; bounded raw MIME (10 MiB) is parsed with `postal-mime`; D1 is the sole canonical CRM graph; attachment bytes are written to R2 before their D1 metadata. SvelteKit 5 provides the server-first responsive Today, Inbox, Contacts, Opportunities, and Settings UI. A thin project entrypoint combines the official adapter's `fetch` output with Email Routing's `email` handler. Raw MIME archiving is intentionally deferred.

Version 1 supports explicitly configured domains, products, and exact mailboxes. Inbound arrives by email and by an embeddable landing-page form; owner-reviewed plain-text replies send through the Cloudflare Email Service binding. It does **not** modify DNS or replace an existing mail provider, use AI, use queues or Durable Objects, or act as a generic workflow/CRM platform. `DESIGN.md` includes future directions, not a release checklist.

## Daily workflow and release boundary

1. Receive mail or a verified form submission. Inbox shows its product, domain, exact envelope mailbox and contact. Opening a message does not mark it handled.
2. Read the safe plain-text timeline and download email attachments. Matching RFC reply IDs join the conversation; an equal subject alone does not. The same message delivered to two configured mailboxes retains two attribution contexts.
3. Save a reply draft, review **From, To, subject and saved text**, approve that version, then send once. The recipient is the latest inbound sender, not an unrelated primary address after a contact merge. This is not Reply-all and does not follow a supplied Reply-To header.
4. Inspect the outcome. **Accepted means the provider accepted it, not delivered.** Unresolved sends block further replies in that conversation. See reconciliation below.
5. Add a next action, then complete/reschedule/cancel it from Today. Creating a draft or sending never silently completes follow-up work. Create an opportunity from conversation evidence when needed; activation requires a next action.

All displayed timestamps, due-time inputs and Today day boundaries use **UTC** (Taipei is UTC+8). Per-deployment timezone selection remains unimplemented. Form email addresses are supplied by visitors, not ownership-verified; review them before replying.

**Locally verified:** Workers D1/R2 ingestion, deduplication, cross-mailbox attribution, HTML-only text extraction, safe attachment download, email/form reply threading, atomic send claims, stale approval rejection, provider failure/unknown outcomes, acceptance-write failure, evidence-only reconciliation, follow-up/opportunity invariants, and signed Access JWT validation. Recovery tests reject corrupt backups, invalid references and path escapes before target writes.

**Production acceptance still required:** live Access login/denial on every exposed hostname, real Email Routing duplicate delivery, Email Service sender onboarding and delivered Message-ID fidelity, real recipient acceptance/bounce behavior, and backup/restore into isolated remote resources. Local Email Service simulation is not evidence of delivery. A previous deployment or historical inbound test does not validate this version.

**Not implemented:** form uploads, outbound attachments, delivery/bounce callbacks, automatic retries, remote restore automation, scheduled/encrypted backups, retention/deletion UI, domain discovery/DNS management, and AI agents. The existing operator onboarding CLI is optional; none of these are prerequisites for the first exact-mailbox workflow.

Reproduce checks (all storage and sends are simulated locally):

```sh
npm ci
npm run check
npm run test:recovery          # requires sqlite3
npx playwright install chromium  # first machine setup only
E2E_PORT=4187 npm run test:e2e   # desktop + 320px mobile, MIME → reply → follow-up
```

Playwright creates disposable `.wrangler/e2e` data and captures reply review, accepted/unresolved outcomes, Settings and opportunity evidence under `test-results/`. It invokes Wrangler's local email endpoint and simulated send binding; it never sends real email. Do not reuse this directory for personal data.

Verification on 2026-09-12: `npm run check` passed (format, lint, zero Svelte/TypeScript errors or warnings, 70 Workers tests and deployment dry-run); 6 recovery tests and 12 desktop/mobile browser tests passed. The browser fixture database was backed up, restored into fresh local D1/R2, then backed up again: SQL and all 3 referenced attachment files were byte-identical. Desktop/mobile review, accepted/unresolved outcomes, Settings and opportunity screenshots were inspected. The Today workbench pass additionally verified latest-inbound preview selection and inspected desktop/mobile layouts and expanded follow-up forms. This evidence covers local simulation only.

For a persistent local review of that restored state, use the restore inspection command below; do not use `e2e:serve`, which intentionally resets its own fixture data.

The September UI redesign uses a top navigation and an inquiry-first Today workbench: readable latest-inbound previews on the left, follow-up actions on the right, and compact queue links instead of metric cards. Action forms expand on demand; mobile stacks the two regions. The cream/cobalt palette and locally bundled Archivo / IBM Plex Mono fonts draw from the owner's Aliasport references, without treating the references as a layout template. The full-width Inbox remains the searchable archive. Server actions and reply approval boundaries are unchanged. Browser coverage includes queue navigation, action disclosure, filters, mobile navigation/focus, accessibility checks, and the complete reply workflow. Visual rationale lives in `DESIGN.md` §16.

## Prerequisites and install

- Cloudflare account with Workers, D1, R2, Email Routing, and Access
- Wrangler login (`npx wrangler login`) or appropriately scoped CI credentials
- Node.js 22 or later (Wrangler 4 requires it)
- `sqlite3` CLI for backup verification and local recovery

```sh
npm install
npm run check                 # typecheck, Worker-runtime tests, dry-run bundle
```

Apply all **seven** D1 migrations in order. Migrations 0001–0003 own the inbound graph, follow-up and opportunities; 0004 adds outbound message fields; 0005 adds form intake; 0006 preserves original thread ID casing; 0007 adds persisted reply approvals and single-attempt outcomes. Migration 0007 conservatively quarantines legacy unconfirmed/failed sends because the old adapter also classified lost responses as failures. Do not apply the different, unmerged historical `0004_outbound_email.sql` on top of this history.

## Create and configure production resources

Do not deploy before completing the Access steps below.

**Existing installations:** first inventory the current Worker version, actual D1/R2 bindings, applied migrations, Access applications and exact routing rule. Resource names may predate the Domain Desk rename. Do not create replacements, seed a second mailbox, point these scripts at placeholder resources, or run migrations until the destination and backup are reviewed. The example names below describe a fresh installation only. Deployment, remote reads/writes, routing/Access/DNS changes, real email and pushing require separate operator authorization.

```sh
npx wrangler d1 create domain-desk
npx wrangler r2 bucket create domain-desk-attachments
```

Copy the D1 UUID printed by the first command into `database_id` in the top-level `[[d1_databases]]` block of `wrangler.toml` (leave the local environment placeholder alone). Names and bindings must remain `domain-desk`/`DB` and `domain-desk-attachments`/`ATTACHMENTS`.

```sh
npm run build                              # validates/bundles; never deploys
npx wrangler d1 migrations apply domain-desk --remote
```

Manually seed the one initial context. Copy [`setup/one-domain.sql.example`](./setup/one-domain.sql.example) outside the repository, replace every sample value, and review the resulting file. IDs are stable labels you choose; use a lowercase exact mailbox address. The transaction uses plain `INSERT` statements so any conflicting ID, domain, or mailbox fails instead of overwriting existing CRM data.

```sh
cp setup/one-domain.sql.example /tmp/domain-desk-one-domain.sql
# Edit and review /tmp/domain-desk-one-domain.sql, then explicitly apply it:
npx wrangler d1 execute domain-desk --remote --file /tmp/domain-desk-one-domain.sql
npx wrangler d1 execute domain-desk --remote --command "SELECT d.name domain,p.name product,mi.address mailbox FROM mailbox_identities mi JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id ORDER BY mi.address"
```

The initial migration creates the nine ingestion tables; Slice 3A adds `next_actions`, `activity_events`, and reversible `contact_merges` history. Slice 3B adds `opportunities`, `opportunity_contacts`, and `opportunity_conversations`, plus the designated-action relation and opportunity activity subject needed by that surface.

## Safe local development

Local development requires `LOCAL_DEV=true` in a local, uncommitted environment and local D1/R2 bindings; it must not touch production resources. The Vite development command does not provision or migrate bindings. Never set `LOCAL_DEV=true` in the top-level production vars.

```sh
npx wrangler d1 migrations apply domain-desk --local --env local
npx wrangler d1 execute domain-desk --local --env local --command "INSERT INTO domains(id,name) VALUES('domain-main','example.test'); INSERT INTO products(id,domain_id,name) VALUES('product-main','domain-main','Test Product'); INSERT INTO mailbox_identities(id,product_id,address) VALUES('mailbox-hello','product-main','hello@example.test');"
LOCAL_DEV=true npm run dev
```

## Protect with Cloudflare Access, deploy, and route email

1. In Zero Trust → Access → Applications, create a **Self-hosted** application for the Worker's exact production hostname and an allow policy restricted to your identity. Keep the application's path broad enough to cover `/*`; do not leave another Worker custom domain or route outside Access.
2. In `wrangler.toml`, replace `ACCESS_TEAM_DOMAIN` with the full `https://<team>.cloudflareaccess.com` URL and `ACCESS_AUD` with that Access application's audience tag. The Worker verifies the JWT signature, issuer, audience, and lifetime and fails closed when configuration is missing or invalid. The email handler is not an HTTP route and remains callable by Email Routing.
3. Deploy only after Access is ready: `npx wrangler deploy`.
4. Before changing Email Routing, inspect the domain's current DNS and routing configuration in Cloudflare. If any non-Cloudflare/third-party MX records exist, stop: v1 has no installer or migration planner and must not replace that mail provider. For an eligible domain, enable Email Routing manually and create one exact custom-address rule (for example `hello@example.com`) whose action sends to this Worker. Do not use catch-all for initial verification. The envelope recipient must exactly match a seeded `mailbox_identities.address`; unknown mailboxes are rejected and create no CRM state.

## Onboard each additional domain with the CLI

After the Worker is deployed and Access is in place, each further domain, product, or mailbox
is one command run from your machine:

```sh
export CLOUDFLARE_API_TOKEN=...   # Zone:Read + Email Routing Rules:Edit; never deployed
npm run onboard -- --remote --domain example.com --product "My SaaS" --mailbox hello
```

The command seeds the D1 rows (reusing an existing domain or product row, refusing to move a
mailbox between products) and creates one exact-address Email Routing rule pointing at this
Worker. It reads Cloudflare state first and **never changes DNS**: when Email Routing is not
yet enabled for the zone it stops and tells you to review the zone's existing MX records and
enable routing manually — exactly the step where you confirm no third-party mail provider
would be replaced. Re-running after a partial failure resumes safely; `--local` seeds a local
database only. The manual `setup/one-domain.sql.example` path remains available.

Send a plain-text test email with a small attachment from an external account. Check structured, body-free logs with `npx wrangler tail`, open the Access-protected Worker UI, and verify the inbox row, contact, text body, timestamps, attachment metadata, and authorized download. Downloads resolve the D1 relation before reading R2, force a safe content disposition, and fail explicitly when the referenced binary is missing or inconsistent. Re-deliver the same message and verify it remains one message. Raw HTML is never stored or rendered as UI content; the UI displays plain text only. A message that has no text/plain part stores a server-side plain-text extraction of its HTML body, so HTML-only mail remains readable without rendering HTML.

Settings performs read-only probes of all seven migration-owned table/column groups, the R2 binding, and the configured Access mode. It displays status only, never issuer, audience, credentials, or other secret values. Binding presence does not prove provider onboarding or a working Access policy.

## Outbound replies (Cloudflare Email Service)

Replies are sent from the conversation's mailbox address through the `EMAIL` send binding
(already declared in `wrangler.toml`). Before the first reply from a domain:

```sh
npx wrangler email sending list
npx wrangler email sending enable example.com   # per sending domain; Workers paid plan
```

Behavior and guarantees:

- Drafts persist across reloads. Approval is bound to the saved content and canonical reply
  context hash. Saving edits revokes approval; changed sender/recipient/thread context requires
  review again. A cancelled draft cannot be sent.
- One atomic D1 batch claims the approved draft and records the outbound message, recipient and
  audit before the external call. Concurrent clicks and browser resubmissions cannot call the
  provider again for that draft. This is application-level single-attempt protection, **not** a
  claim that the provider offers exactly-once delivery or accepts an idempotency key.
- A successful call records `accepted` and the original provider Message-ID. The legacy
  `messages.delivery_status='sent'` value is retained for schema compatibility but displayed as
  provider acceptance, never verified delivery. No next action is automatically completed.
- Documented validation/policy rejections become `failed`; unknown/internal/transport failures,
  missing provider IDs and `E_DELIVERY_FAILED` conservatively become `indeterminate`. Raw provider
  exception messages are not stored. A failure to persist acceptance leaves the durable
  `sending` claim, with the provider ID in the error and structured log for recovery. It is never
  reclassified as confirmed rejection.
- `sending` and `indeterminate` block new replies in that conversation. There is no background
  retry. A confirmed failure permits a **new draft and approval**, not replay of the old attempt.
- Replies carry `In-Reply-To`/`References` from the latest inbound message so the customer's
  client threads them. After the first deployment, verify threading end to end: send a reply,
  answer it from an external mailbox, and confirm the answer lands in the same conversation
  (this also confirms the service's returned message id matches the delivered `Message-ID`).
- Only plain text is sent. Sending is unavailable (with an explicit error) when the binding or
  domain onboarding is missing; the Settings page shows the binding status.

If a reply fails with `E_SENDER_NOT_VERIFIED` or `E_SENDER_DOMAIN_NOT_AVAILABLE`, complete
`wrangler email sending enable` for that domain. `E_RECIPIENT_SUPPRESSED` means the recipient
previously bounced or complained; do not force resends.

**Unknown outcome:** do not copy the message into a new conversation to bypass the lock. Inspect
Email Service records/support using the sender, recipient, attempt ID and timestamp. From the
conversation, expand **Reconcile with provider evidence**. Record the evidence and either
confirmed acceptance (provider Message-ID required, restores reply threading) or confirmed
non-acceptance. This only records an audited result; it does not send anything. An interrupted
`sending` attempt has a minimum 15-minute guard, and the operator must also verify it has ended.
Elapsed time or an empty recipient inbox alone is **not** proof of non-acceptance. If evidence
is unavailable, keep it unresolved rather than risk a duplicate.

## Landing-page form intake

Each SaaS landing page can embed a plain HTML contact form that posts to
`POST /intake/<mailbox-id>` — the only unauthenticated route. Submissions become normal
conversations (channel `form`) attributed to that mailbox's product and domain, and replies go
out through the same outbound flow; the customer's email answer threads back into the form
conversation.

Setup, in order:

1. Create a [Turnstile widget](https://dash.cloudflare.com/?to=/:account/turnstile) for your
   landing-page domains. Put the site key in `TURNSTILE_SITE_KEY` (`wrangler.toml` vars) and set
   the secret with `npx wrangler secret put TURNSTILE_SECRET_KEY`. Local development uses
   Cloudflare's documented always-pass test keys already present in the `local` env.
2. In Zero Trust, use a **separate, more-specific self-hosted Access application** for
   `<worker-hostname>/intake/*` with a Bypass policy. Keep the main application and its owner-only
   Allow policy on the rest of the hostname. Do **not** add a hostname-wide Bypass policy to the
   main app. The Worker independently rechecks JWTs for all management routes and only exposes
   POST/OPTIONS intake; GET requests to intake do not expose data.
3. Recommended: add a WAF rate-limiting rule for `/intake/*`.
4. Copy the per-mailbox embed snippet from Settings into the landing page. Pages that prefer an
   inline (no-navigation) experience can `fetch()` the same endpoint with `FormData`; the
   endpoint answers CORS for the mailbox's own domain — the contract is the endpoint, no
   JavaScript widget is published.

Safety behavior: Turnstile is verified server-side on every submission (fail closed, including
when the verifier is unreachable); the `Origin` must belong to the mailbox's configured domain;
a hidden honeypot field silently drops bots; identical same-day resubmissions collapse into one
message; the optional `redirect` must be an `https:` URL on the submitting page's own hostname;
responses never echo submitted content. Rejections log `form_intake_rejected` with codes
`unknown_mailbox`, `invalid_origin`, `turnstile_failed`, `invalid_submission`, or
`not_configured`.

Only HTTPS origins on the configured domain/subdomains and standard port are accepted. Raw
request bodies are capped at 128 KiB before parsing; text fields have smaller independent
limits. File fields are explicitly rejected: receive attachments by email instead. Origin and
Turnstile reduce abuse but do not authenticate the supplied email address. Keep the widget's
hostname allowlist narrow and add edge rate limits before opening a high-traffic public form.

## Verified backup and recovery boundary

Create a new backup directory from either local or explicitly authorized remote resources. The command exports complete D1 SQL, reads attachment references **from that exported snapshot** (not a later live query), downloads exactly those R2 objects, and checks size/SHA-256, SQLite integrity and foreign keys. It emits all table definitions before row data so forward foreign-key references restore in D1, and encodes text as UTF-8 hex to avoid unsupported SQLite `unistr()` syntax while preserving multiline content. Manifest v2 includes SQL size/hash as well as attachment facts. Existing destinations, unsafe paths, missing objects and hash drift fail closed. Unreferenced R2 objects are intentionally excluded.

```sh
npm run backup -- --local --output /safe/path/domain-desk-local-2026-08-26
# Remote is an explicit separate choice and uses the configured Wrangler identity:
npm run backup -- --remote --output /safe/path/domain-desk-production-2026-08-26
# Rehearse against the disposable browser fixture state:
npm run backup -- --local --persist-to .wrangler/e2e --output /safe/path/desk-rehearsal
npm run restore -- --local --backup /safe/path/desk-rehearsal --persist-to /safe/path/new-local-state
```

Treat a backup as complete only when it prints `Verified backup created`. Keep it in private,
encrypted storage outside the repository; backups contain correspondence and are not themselves
encrypted or signed. Restore only trusted backups. Local restore verifies all hashes, safe paths
(including symlinks), foreign keys and exact manifest/DB attachment agreement **before** writing
the target. The target and its parent must be distinct: the parent exists, the target must not.
If importing later fails, keep the partial target isolated and retry with a new disposable
directory. Manifest v1 is not accepted; generate a new backup with this command.

To inspect the restored local state, run `npx wrangler dev --env local --local --persist-to
/safe/path/new-local-state --port 4188` after `npm run build:web`, then verify Settings and
attachment downloads. Do not run the fixture preparation script on the restored directory.

Remote recovery remains separately authorized and operator-run: create isolated D1/R2 resources,
verify the backup locally, import `database.sql`, upload every listed `backup_path` to its exact
`object_key`, verify the full graph and representative attachment bytes, then decide whether to
switch bindings/routing. **Keep sending disabled on the restored deployment until all post-backup
provider activity is reconciled.** An old snapshot may contain an approved draft that the original
deployment subsequently sent; replaying it would duplicate real email. A restore cannot recover
mail received after the snapshot or undo already accepted email. Keep the old resources and use
an explicit cutover/recovery-point decision; never roll schema backward or delete live data as a
normal rollback.

## Shortest production activation checklist

1. Authorize a scoped read-only inventory of any existing installation; choose reuse/upgrade or
   isolated new resources. Record the exact Worker, D1/R2, hostname, product and mailbox.
2. Review a full backup and the pending migration list, then separately authorize migration,
   deployment and an owner-only Access policy. Keep sending disabled until sender configuration
   and approval behavior have been checked. Recheck alternate hostnames for JWT denial.
3. Authorize one exact Email Routing rule without replacing third-party MX. If using forms,
   authorize the narrow intake Access bypass and Turnstile configuration. Never use catch-all
   or broad DNS automation for this acceptance test.
4. Authorize test email only between named controlled addresses: inbound + attachment + duplicate,
   approved reply + external answer into the same conversation, then next action and opportunity.
   Compare the received RFC Message-ID with the stored provider ID; distinguish acceptance from
   delivery. Verify a wrong identity cannot read pages, downloads or submit management actions.
5. Rehearse an authorized restore into fresh remote resources with sending disabled, verify data
   and attachment bytes, and keep a current private backup. Push/release only after separately
   reviewing the exact branch and destination. Until these gates pass, call the installation
   **pending production acceptance**, not production-ready.

## Behavior and troubleshooting

- Idempotency is mailbox + normalized Message-ID, or mailbox + SHA-256 of canonical parsed sender, recipients, Date, subject, text/HTML hashes, RFC thread headers, and attachment facts when absent. Transport-added raw headers, receive/ingest time, and randomness are excluded.
- Threading uses only normalized `References` and `In-Reply-To`; equal subjects do not thread.
- `sent_at`, `received_at`, and `ingested_at` are separate columns.
- R2 writes occur before the atomic D1 metadata batch. A failed attempt can leave an unreferenced deterministic R2 object for later manual cleanup, but it never leaves successful D1 metadata; avoiding compensating deletion also prevents one concurrent duplicate from deleting another's committed attachment. Malformed MIME, missing sender, oversized mail, and unknown mailbox produce an explicit code and leave no CRM state.
- Logs contain event names, internal IDs, counts, and errors, never a full body or raw MIME.

If mail is rejected, inspect `wrangler tail` for `unknown_mailbox`, `malformed_mime`, `message_too_large`, or `attachment_storage_failed`; then verify the exact lowercase mailbox seed, routing rule, size, and R2 binding. If the UI returns 403 in production, use the Access-protected hostname and verify the Access application/policy. If tests fail before starting, verify `node --version` is 22+.

## Retirement (not rollback)

Do not delete resources to roll back a deployment. Use a compatible previous Worker version or a forward fix while preserving the database and send-attempt history. For explicitly authorized permanent retirement only: verify a backup and rehearse restore first, disable the exact Email Routing custom-address rule, then separately authorize deletion of the named Worker and resources:

```sh
npx wrangler delete
npx wrangler d1 delete domain-desk
npx wrangler r2 bucket delete domain-desk-attachments
```

Remove the Access application last. These deletion commands are destructive; there is no automated data rollback. Schema changes should instead be made by a new forward migration.

## License

Apache-2.0; see [LICENSE](./LICENSE).
