# Cloudflare Domain CRM

A personal-first, self-hosted inbound CRM running as one TypeScript Cloudflare Worker. Email Routing invokes the `email` handler; bounded raw MIME (10 MiB) is parsed with `postal-mime`; D1 is the sole canonical CRM graph; attachment bytes are written to R2 before their D1 metadata. SvelteKit 5 provides the server-first responsive Inbox, conversation triage, and Settings UI; Bits UI supplies accessible interaction primitives and Tailwind CSS v4 implements the project-owned warm-light visual language. A thin project entrypoint combines the official adapter's `fetch` output with Email Routing's `email` handler. Raw MIME archiving is intentionally deferred.

This first slice supports exactly manually configured domains, products, and mailboxes. It does **not** configure DNS, send mail, use AI, queues, Durable Objects, or act as a generic CRM.

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
npx wrangler d1 create domain-crm
npx wrangler r2 bucket create domain-crm-attachments
```

Copy the D1 UUID printed by the first command into `database_id` in the top-level `[[d1_databases]]` block of `wrangler.toml` (leave the local environment placeholder alone). Names and bindings must remain `domain-crm`/`DB` and `domain-crm-attachments`/`ATTACHMENTS`.

```sh
npm run build                              # validates/bundles; never deploys
npx wrangler d1 migrations apply domain-crm --remote
```

Manually seed the one initial context, replacing all sample values. IDs are stable labels you choose:

```sh
npx wrangler d1 execute domain-crm --remote --command "INSERT INTO domains(id,name) VALUES('domain-main','example.com'); INSERT INTO products(id,domain_id,name) VALUES('product-main','domain-main','Example Product'); INSERT INTO mailbox_identities(id,product_id,address,display_name) VALUES('mailbox-hello','product-main','hello@example.com','Hello');"
```

The initial migration creates the nine ingestion tables; Slice 3A adds `next_actions`, `activity_events`, and reversible `contact_merges` history. Slice 3B adds `opportunities`, `opportunity_contacts`, and `opportunity_conversations`, plus the designated-action relation and opportunity activity subject needed by that surface.

## Safe local development

Local development requires `LOCAL_DEV=true` in a local, uncommitted environment and local D1/R2 bindings; it must not touch production resources. The Vite development command does not provision or migrate bindings. Never set `LOCAL_DEV=true` in the top-level production vars.

```sh
npx wrangler d1 migrations apply domain-crm --local --env local
npx wrangler d1 execute domain-crm --local --env local --command "INSERT INTO domains(id,name) VALUES('domain-main','example.test'); INSERT INTO products(id,domain_id,name) VALUES('product-main','domain-main','Test Product'); INSERT INTO mailbox_identities(id,product_id,address) VALUES('mailbox-hello','product-main','hello@example.test');"
LOCAL_DEV=true npm run dev
```

## Protect with Cloudflare Access, deploy, and route email

1. In Zero Trust → Access → Applications, create a **Self-hosted** application for the Worker's exact production hostname and an allow policy restricted to your identity. Keep the application's path broad enough to cover `/*`; do not leave another Worker custom domain or route outside Access.
2. In `wrangler.toml`, replace `ACCESS_TEAM_DOMAIN` with the full `https://<team>.cloudflareaccess.com` URL and `ACCESS_AUD` with that Access application's audience tag. The Worker verifies the JWT signature, issuer, audience, and lifetime and fails closed when configuration is missing or invalid. The email handler is not an HTTP route and remains callable by Email Routing.
3. Deploy only after Access is ready: `npx wrangler deploy`.
4. In the domain's Email Routing settings, enable routing without replacing an existing mail provider unintentionally. Create an exact custom-address rule (for example `hello@example.com`) whose action sends to this Worker. The envelope recipient must exactly match a seeded `mailbox_identities.address`; unknown mailboxes are rejected and create no CRM state.

Send a plain-text test email with a small attachment from an external account. Check structured, body-free logs with `npx wrangler tail`, open the Access-protected Worker UI, and verify the inbox row, contact, text body, timestamps, and attachment metadata. Re-deliver the same message and verify it remains one message. HTML is parsed only to obtain MIME structure and is never stored/rendered as UI content; the UI displays `email.text` only.

## Behavior and troubleshooting

- Idempotency is mailbox + normalized Message-ID, or mailbox + SHA-256 of canonical parsed sender, recipients, Date, subject, text/HTML hashes, RFC thread headers, and attachment facts when absent. Transport-added raw headers, receive/ingest time, and randomness are excluded.
- Threading uses only normalized `References` and `In-Reply-To`; equal subjects do not thread.
- `sent_at`, `received_at`, and `ingested_at` are separate columns.
- R2 writes occur before the atomic D1 metadata batch. A failed attempt can leave an unreferenced deterministic R2 object for later manual cleanup, but it never leaves successful D1 metadata; avoiding compensating deletion also prevents one concurrent duplicate from deleting another's committed attachment. Malformed MIME, missing sender, oversized mail, and unknown mailbox produce an explicit code and leave no CRM state.
- Logs contain event names, internal IDs, counts, and errors, never a full body or raw MIME.

If mail is rejected, inspect `wrangler tail` for `unknown_mailbox`, `malformed_mime`, `message_too_large`, or `attachment_storage_failed`; then verify the exact lowercase mailbox seed, routing rule, size, and R2 binding. If the UI returns 403 in production, use the Access-protected hostname and verify the Access application/policy. If tests fail before starting, verify `node --version` is 22+.

## Cleanup / rollback

First disable/delete the Email Routing custom-address rule, then delete the Worker and resources only after exporting anything needed:

```sh
npx wrangler delete
npx wrangler d1 delete domain-crm
npx wrangler r2 bucket delete domain-crm-attachments
```

Remove the Access application last. These deletion commands are destructive; there is no automated data rollback. Schema changes should instead be made by a new forward migration.

## License

Apache-2.0; see [LICENSE](./LICENSE).
