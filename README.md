# Domain Desk

A personal-first, self-hosted inbound CRM running as one TypeScript Cloudflare Worker. Email Routing invokes the `email` handler; bounded raw MIME (10 MiB) is parsed with `postal-mime`; D1 is the sole canonical CRM graph; attachment bytes are written to R2 before their D1 metadata. SvelteKit 5 provides the server-first responsive Today, Inbox, Contacts, Opportunities, and Settings UI. A thin project entrypoint combines the official adapter's `fetch` output with Email Routing's `email` handler. Raw MIME archiving is intentionally deferred.

Version 1 supports exactly manually configured domains, products, and mailboxes. It does **not** configure DNS or Email Routing, send mail, use AI, embed in another product, use queues or Durable Objects, or act as a generic workflow/CRM platform. Outbound replies require a later explicit provider and lifecycle decision.

## Prerequisites and install

- Cloudflare account with Workers, D1, R2, Email Routing, and Access
- Wrangler login (`npx wrangler login`) or appropriately scoped CI credentials
- Node.js 22 or later (Wrangler 4 requires it)

```sh
npm install
npm run check                 # typecheck, Worker-runtime tests, dry-run bundle
```

Apply all three D1 migrations in order. Migration 0003 adds Slice 3B opportunities, immutable contact/conversation evidence attribution, and designated opportunity actions. Date/time form values are interpreted as UTC.

## Create and configure production resources

Do not deploy before completing the Access steps below.

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

Send a plain-text test email with a small attachment from an external account. Check structured, body-free logs with `npx wrangler tail`, open the Access-protected Worker UI, and verify the inbox row, contact, text body, timestamps, attachment metadata, and authorized download. Downloads resolve the D1 relation before reading R2, force a safe content disposition, and fail explicitly when the referenced binary is missing or inconsistent. Re-deliver the same message and verify it remains one message. Raw HTML is never stored or rendered as UI content; the UI displays plain text only. A message that has no text/plain part stores a server-side plain-text extraction of its HTML body, so HTML-only mail remains readable without rendering HTML.

Settings performs read-only probes of the D1 schema, all three migration-owned table groups, the R2 binding, and the configured Access mode. It displays status only, never issuer, audience, credentials, or other secret values.

## Outbound replies (Cloudflare Email Service)

Replies are sent from the conversation's mailbox address through the `EMAIL` send binding
(already declared in `wrangler.toml`). Before the first reply from a domain:

```sh
npx wrangler email sending list
npx wrangler email sending enable example.com   # per sending domain; Workers paid plan
```

Behavior and guarantees:

- The reply is recorded in D1 **before** the external send. Its `delivery_status` is `sending`
  until the service confirms; a crash between send and confirmation leaves the message visibly
  unconfirmed instead of silently losing the record of an external effect.
- Success stores the returned message id and marks `sent`; failure marks `failed` with the
  `E_*` error code on the message and in the activity history. Nothing retries automatically.
- Replies carry `In-Reply-To`/`References` from the latest inbound message so the customer's
  client threads them. After the first deployment, verify threading end to end: send a reply,
  answer it from an external mailbox, and confirm the answer lands in the same conversation
  (this also confirms the service's returned message id matches the delivered `Message-ID`).
- Only plain text is sent. Sending is unavailable (with an explicit error) when the binding or
  domain onboarding is missing; the Settings page shows the binding status.

If a reply fails with `E_SENDER_NOT_VERIFIED` or `E_SENDER_DOMAIN_NOT_AVAILABLE`, complete
`wrangler email sending enable` for that domain. `E_RECIPIENT_SUPPRESSED` means the recipient
previously bounced or complained; do not force resends.

## Verified backup and recovery boundary

Create a new backup directory from either local or remote resources. The command is read-only: it exports the complete D1 schema/data, queries canonical attachment references, downloads exactly those R2 objects, verifies D1 size and SHA-256 metadata, and writes `manifest.json`. It refuses an ambiguous source, an existing destination, unsafe object paths, missing objects, and hash/size drift. Unreferenced R2 objects are intentionally excluded.

```sh
npm run backup -- --local --output /safe/path/domain-desk-local-2026-08-26
# Remote is an explicit separate choice and uses the configured Wrangler identity:
npm run backup -- --remote --output /safe/path/domain-desk-production-2026-08-26
```

Treat a backup as complete only when the command prints `Verified backup created`. Protect the directory like mailbox data. Recovery is deliberately operator-run: create fresh D1/R2 resources, inspect `manifest.json`, import `database.sql`, upload each listed `backup_path` to its exact `object_key`, then run the Settings probes and download representative attachments before changing routing. This v1 command does not delete, retain credentials, schedule backups, upload backups, or mutate the source resources.

## Behavior and troubleshooting

- Idempotency is mailbox + normalized Message-ID, or mailbox + SHA-256 of canonical parsed sender, recipients, Date, subject, text/HTML hashes, RFC thread headers, and attachment facts when absent. Transport-added raw headers, receive/ingest time, and randomness are excluded.
- Threading uses only normalized `References` and `In-Reply-To`; equal subjects do not thread.
- `sent_at`, `received_at`, and `ingested_at` are separate columns.
- R2 writes occur before the atomic D1 metadata batch. A failed attempt can leave an unreferenced deterministic R2 object for later manual cleanup, but it never leaves successful D1 metadata; avoiding compensating deletion also prevents one concurrent duplicate from deleting another's committed attachment. Malformed MIME, missing sender, oversized mail, and unknown mailbox produce an explicit code and leave no CRM state.
- Logs contain event names, internal IDs, counts, and errors, never a full body or raw MIME.

If mail is rejected, inspect `wrangler tail` for `unknown_mailbox`, `malformed_mime`, `message_too_large`, or `attachment_storage_failed`; then verify the exact lowercase mailbox seed, routing rule, size, and R2 binding. If the UI returns 403 in production, use the Access-protected hostname and verify the Access application/policy. If tests fail before starting, verify `node --version` is 22+.

## Cleanup / rollback

First disable/delete the exact Email Routing custom-address rule. Run and verify the backup command above, then delete the Worker and resources only after separately confirming that the backup is readable:

```sh
npx wrangler delete
npx wrangler d1 delete domain-desk
npx wrangler r2 bucket delete domain-desk-attachments
```

Remove the Access application last. These deletion commands are destructive; there is no automated data rollback. Schema changes should instead be made by a new forward migration.

## License

Apache-2.0; see [LICENSE](./LICENSE).
