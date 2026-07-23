# Product and Technical Direction

## 1. Product definition

Cloudflare Domain CRM is a personal-first, self-hosted CRM for people who operate many domains and product experiments in one or more Cloudflare accounts.

The product begins with the domain portfolio rather than a manually maintained sales database:

```text
Domain
→ Product
→ Mailbox identity
→ Contact
→ Conversation
→ Opportunity
→ Next action
```

The primary user is initially the maintainer. The repository is open source to produce a useful public reference application, invite outside use and contribution, and build reputation through a complete Cloudflare-native product.

## 2. Goals

1. Deploy into the user's own Cloudflare account.
2. Discover and select domains without manually duplicating a domain inventory.
3. Configure inbound email safely and show every proposed DNS or Email Routing change before applying it.
4. Preserve which domain, product, and address caused each conversation to enter the system.
5. Convert inbound messages into contacts, conversations, opportunities, and explicit next actions.
6. Let AI classify, summarize, and draft without silently sending mail or mutating important CRM state.
7. Keep the system understandable, inspectable, reversible, and useful without AI.

## 3. Non-goals for the first usable release

- Multi-tenant SaaS hosting
- Billing and subscriptions
- Enterprise team roles and territory management
- A generic no-code CRM schema builder
- Marketing campaigns or bulk outbound email
- Supporting every registrar or email provider
- Replacing an existing Google Workspace, Microsoft 365, or other production MX setup
- Making Tonetify a required dependency

## 4. Core user flow

### 4.1 Installation

The intended experience is:

```text
Authenticate with Cloudflare
→ deploy Worker and storage resources
→ inspect available zones
→ select domains
→ inspect DNS and Email Routing readiness
→ preview a per-domain change plan
→ explicitly approve
→ apply and verify
```

Cloudflare control-plane access belongs to installation and configuration, not routine CRM operation. The runtime Worker must not retain broad DNS write credentials merely to receive and organize email.

The first implementation should use a local installer authenticated with a scoped Cloudflare API token or Wrangler session. A future web-only setup may use Cloudflare self-managed OAuth once callback, client-registration, and token-lifecycle behavior are proven for self-hosted deployments.

### 4.2 Domain readiness

Each selected domain receives one of these user-visible states:

- **Ready:** no conflicting MX configuration; Email Routing can be proposed.
- **Needs review:** an existing mail provider or ambiguous DNS state is present.
- **Active:** routing is configured and an inbound test passed.
- **Drifted:** live DNS or routing differs from the last applied plan.
- **Error:** configuration or verification failed with an actionable reason.

The installer must never replace an existing MX provider automatically. Domains using Google Workspace, Microsoft 365, Fastmail, Zoho, or another mail service remain untouched until the user makes a separate migration decision.

### 4.3 Email activation

For an eligible domain, the user selects explicit addresses such as `hello@`, `sales@`, or `support@`, and may separately enable catch-all routing.

Before mutation, the product displays:

- existing relevant DNS records
- records and routing rules to create, update, or remove
- the selected Email Worker destination
- conflicts and irreversible consequences
- rollback information

Activation is complete only after a real inbound test reaches the CRM.

### 4.4 Daily use

The primary dashboard answers:

- Which domains are connected and healthy?
- Which conversations need a reply?
- Which product generated each contact?
- Has this person contacted another product before?
- Which opportunities have no next action?
- What actually happened after a reply was drafted or sent?

## 5. Product surfaces

### Domains

Portfolio inventory, product mapping, DNS and Email Routing readiness, active addresses, setup history, and drift.

### Inboxes

Product-aware conversation views across all selected mailbox identities.

### Contacts

Canonical people and organizations with multiple email addresses and a cross-product timeline.

### Opportunities

Lightweight commercial intent attached to a contact, organization, product, and relevant conversations. The system must distinguish positive feedback from evidence of a concrete next step.

### Next actions

Explicit follow-ups with due dates and completion state. A draft or queued email does not complete an action; delivery acceptance or manual completion does.

### Settings

Cloudflare account information, domain configuration, AI settings, retention, export, and deployment health.

## 6. Data model

The global CRM graph belongs in D1 rather than separate per-mailbox Durable Object databases.

Initial entities:

```text
domains
products
mailbox_identities
contacts
contact_email_addresses
organizations
conversations
conversation_participants
messages
message_recipients
attachments
opportunities
opportunity_contacts
next_actions
activity_events
outbound_deliveries
configuration_changes
```

Important invariants:

1. A message is stored canonically once even when multiple owned addresses participated.
2. RFC `Message-ID` plus mailbox context provides the primary idempotency key; messages without it require a content fingerprint.
3. A conversation is a first-class entity, not only a repeated `thread_id` string on messages.
4. RFC `References` and `In-Reply-To` are strong threading evidence. Subject matching is only a low-confidence suggestion and must support merge or split correction.
5. `sent_at`, `received_at`, and `ingested_at` are distinct facts.
6. Attachments and optional raw MIME live in R2; D1 stores metadata, hashes, and object keys.
7. CRM state transitions and delivery outcomes are activity events, not agent-chat history.

## 7. Runtime architecture

```text
Cloudflare Email Routing
        │
        ▼
Inbound Email Worker
  bounded read / MIME parse / dedupe
        │
        ├── attachments and raw MIME ──▶ R2
        │
        └── ingestion job ─────────────▶ Queue or Workflow
                                              │
                                              ▼
                                             D1
                                              │
                           ┌──────────────────┼──────────────────┐
                           ▼                  ▼                  ▼
                        Web UI           Agent tools          MCP/API
```

Durable Objects are appropriate for agent sessions, live state, or a serialization boundary that is demonstrated to be necessary. They are not the canonical mailbox-by-mailbox CRM store.

## 8. Inbound lifecycle

```text
received
→ parsed
→ deduplicated
→ mailbox identities resolved
→ contact resolved or proposed
→ conversation resolved or proposed
→ product attributed
→ persisted
→ optional classification and next-action proposal
```

Email ingestion must succeed even when AI classification is unavailable. AI errors stop optional automation, not message storage.

## 9. Outbound lifecycle

The system must never record an intent as a completed send.

```text
draft
→ approved
→ queued
→ sending
→ accepted
→ delivered | bounced | failed
```

The initial release may stop at provider acceptance if delivery and bounce callbacks are unavailable, but the UI and data model must use the precise state rather than label queued mail as sent.

Every outbound attempt requires an idempotency key, attempt history, error information, and a retry decision. AI can create or revise drafts but cannot provide its own approval to send.

## 10. Cloudflare permissions and safety

Setup should request the least available scope and separate discovery from mutation.

Discovery permissions:

- Zone Read
- DNS Read
- Email Routing Rules Read
- Email Routing Addresses Read when destination forwarding is used

Activation permissions, only when required:

- DNS Write
- Email Routing Rules Write
- Email Routing Addresses Write when destination forwarding is used
- Workers Scripts or related deployment permissions when the installer deploys runtime resources

Safety requirements:

1. Show a dry-run diff before each domain mutation.
2. Require explicit per-domain approval.
3. Refuse automatic mutation when an existing MX provider is detected.
4. Record the actor, previous state, desired state, result, and verification evidence.
5. Make revocation and credential removal visible.
6. Keep broad Cloudflare configuration credentials out of normal runtime storage.
7. Provide a documented rollback for every setup mutation.

## 11. Agent boundary

AI may:

- classify an inbound message
- summarize a conversation
- suggest contact or product links
- propose an opportunity or next action
- draft a new email or reply

AI may not silently:

- send email
- change DNS or Email Routing
- merge contacts
- mark an opportunity won or lost
- permanently delete messages or CRM history

Business logic must be plain service functions shared by the web API, agent adapters, background jobs, and eventual MCP tools. Protocol-specific wrappers must not reimplement domain rules.

## 12. Relationship to Agentic Inbox

Cloudflare's `agentic-inbox` is the reference implementation for:

- Email Routing ingestion
- bounded MIME parsing
- R2 attachment storage
- RFC threading helpers
- Cloudflare Email Service adapter patterns
- draft-first human interaction
- shared business functions wrapped by Agent and MCP tools

This project intentionally does not inherit:

- mailbox as the CRM aggregate root
- R2 objects as the mailbox registry
- separate canonical databases per mailbox
- writing a message to Sent before delivery succeeds
- prompt-only confirmation for sending
- permanent delete tools
- unconditional AI drafting for every inbound message

`agentic-inbox` is Apache-2.0 licensed. Any adapted source files must retain applicable notices, identify modifications, and remain accompanied by the Apache 2.0 license. Cloudflare trademarks are not granted by that license.

## 13. First development slices

Each slice must leave a runnable, verifiable product outcome.

### Slice 1: one-domain inbound CRM

- Deploy the Worker application and D1/R2 resources.
- Configure one domain and one mailbox identity through documented setup.
- Receive a real email through Email Routing.
- Idempotently store the message, attachment metadata, contact, and conversation.
- Display the conversation in an authenticated web UI.
- Verify duplicate delivery does not create duplicate messages.

### Slice 2: safe domain portfolio onboarding

- Discover available zones through the installer.
- Scan DNS and Email Routing readiness.
- Select multiple domains and mailbox identities.
- Produce a dry-run change plan.
- Apply only explicitly approved safe changes.
- Verify routing with an inbound test and report drift later.

### Slice 3: useful personal CRM loop

- Link contacts and conversations across domains.
- Create opportunities and next actions.
- Show reply-needed and overdue-action views.
- Add optional classification, summaries, and reply drafts.
- Preserve manual confirmation for important mutations.

### Slice 4: reliable outbound email

- Introduce draft approval and an outbox lifecycle.
- Send through the selected Cloudflare-compatible adapter.
- Record attempts and precise accepted/failed state.
- Complete next actions only from verified delivery state or an explicit manual action.

## 14. Success criteria

The first meaningful success is not repository stars. It is that the maintainer can connect a real domain, receive real product inquiries, identify the responsible product and contact, and reliably know what needs a reply next.

Public-project quality is demonstrated by:

- one-command or clearly guided deployment
- honest permission and data-flow documentation
- reproducible end-to-end verification
- safe failure behavior
- a coherent UI for daily use
- no required proprietary control plane
