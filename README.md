# Cloudflare Domain CRM

A self-hosted, open-source CRM that turns domains in your Cloudflare account into working business inboxes.

> Your domains, your inbox, your CRM, your Cloudflare account.

## Why

Buying a domain and publishing a landing page is easy. Giving every experiment a real inbox, remembering which product a conversation belongs to, and following up consistently is not.

Cloudflare Domain CRM is personal-first software for people who operate many domains and products. It connects selected Cloudflare zones to Email Routing, receives mail in a Worker, and organizes each message into a product-aware relationship timeline.

```text
Cloudflare domains
→ business inboxes
→ contacts and conversations
→ opportunities
→ next actions
```

## Intended experience

```text
Deploy to Cloudflare
→ choose an account and domains
→ inspect current DNS and email configuration
→ preview the proposed changes
→ approve Email Routing setup
→ send a test email
→ see the first conversation in the CRM
```

Everything runs in the user's own Cloudflare account. There is no required central SaaS control plane.

## Initial product surface

- Domain portfolio and email-readiness status
- Safe Email Routing setup with change previews
- Business inboxes for selected domains and addresses
- Contacts, conversations, products, opportunities, and next actions
- Attachments and RFC-compatible email threading
- AI-assisted classification, summaries, and reply drafts
- Human confirmation before sending email
- Audit history for DNS, routing, and CRM mutations

## Cloudflare-native architecture

- **Workers** for the application, API, and inbound email handler
- **D1** for CRM and message metadata
- **R2** for attachments and optional raw MIME archives
- **Queues or Workflows** for reliable ingestion and outbound delivery
- **Durable Objects** only where serialized state or agent sessions are useful
- **Workers AI** for optional classification, summarization, and drafting
- **Email Routing** for inbound mail

See [DESIGN.md](./DESIGN.md) for the product boundary, setup flow, data model, security constraints, and first development slices.

## Status

The repository currently contains the approved product direction. Implementation is beginning.

## Reference

The project is informed by Cloudflare's [agentic-inbox](https://github.com/cloudflare/agentic-inbox), especially its Email Routing ingestion, attachment storage, RFC threading utilities, draft-first agent behavior, and shared tool business layer. The CRM model and cross-domain storage architecture intentionally differ.

No source code from `agentic-inbox` has been copied into this repository yet. If code is adapted later, the applicable Apache 2.0 attribution and modification requirements must be preserved.

## License

[Apache License 2.0](./LICENSE)
