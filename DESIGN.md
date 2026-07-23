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

For an eligible domain, the user selects explicit addresses such as `hello@`, `sales@`, or `support@`. Catch-all routing is deferred until after Slice 4 because exact envelope-recipient attribution is a core invariant and the current identity model deliberately resolves only configured addresses.

Before mutation, the product displays:

- existing relevant DNS records
- records and routing rules to create, update, or remove
- the selected Email Worker destination
- conflicts and irreversible consequences
- rollback information

Activation is complete only after a real inbound test reaches the CRM.

### 4.4 Daily use

Beginning with Slice 3A, the default landing page is **Today**, an action queue rather than a dashboard. Through Slice 2B, `/` redirects to `/inbox`. Today answers only what the user should handle now:

- Which inbound conversations are unhandled?
- Which next actions are due or overdue?
- Which migrated or inconsistent active opportunities need a replacement next action?
- Which domain activations or drift incidents require a decision?

Portfolio counts, message volume charts, conversion charts, and decorative health scores do not belong on Today. Domain health belongs in Domains, relationship history belongs in Contacts, and work is removed from Today only by an explicit state transition with a recorded reason.

## 5. Information architecture and application shell

### 5.1 Primary navigation

The final authenticated application has six stable top-level destinations in this order:

1. **Today** — action queues requiring attention now.
2. **Inbox** — all product-attributed conversations.
3. **Contacts** — canonical people and their cross-product history.
4. **Opportunities** — explicit commercial intent and its next step.
5. **Domains** — portfolio readiness, activation, drift, and rollback.
6. **Settings** — deployment, security, retention, export, and optional integrations.

The desktop shell uses a persistent left sidebar, a page header with the page's single primary action, and one main work region. The sidebar shows the product name, implemented destinations in the final order above, small actionable counts only for Today and Inbox, and deployment identity/settings at the bottom. Unimplemented destinations are omitted rather than linked to mock screens or errors. It does not show vanity totals. At widths below 720 px the sidebar becomes a modal navigation drawer opened by a labelled button; the current page remains visible in the header and focus returns to the trigger when the drawer closes.

Navigation preserves the user's list filter and scroll position when opening and closing a record. URLs are durable and directly addressable: `/today`, `/inbox`, `/conversations/:id`, `/contacts`, `/contacts/:id`, `/opportunities`, `/opportunities/:id`, `/domains`, `/domains/:id`, and `/settings`. Browser Back returns to the prior list context rather than a reset list.

### 5.2 Shared attribution signature

Domain, product, and mailbox attribution is the product's visual and informational signature. Every conversation, contact timeline event, opportunity, and next action that originated from inbound email displays this chain:

```text
product name · domain.tld · mailbox@domain.tld
```

Product is the strongest label, domain is the stable context, and mailbox is the precise receiving identity. The chain is text, not color alone and appears directly beneath or beside the record title, never hidden in a generic metadata drawer. Domain links to `/domains/:id` once Domains exists; product and mailbox links apply durable Inbox/Contacts filters until dedicated detail surfaces are intentionally introduced. Unknown or historical attribution is labelled explicitly and is never silently reassigned.

### 5.3 Shared page states

Every surface implements the following states consistently:

- **Loading:** keep the application shell and page title stable, mark the changing region `aria-busy="true"`, and use text-shaped placeholders only when a request cannot complete within normal navigation time. Never replace the entire page with a spinner.
- **Empty:** explain whether there is no data, no result for the current filters, or no setup. Offer exactly one relevant next action and a secondary link to documentation or reset filters.
- **Error:** preserve entered filters or form values, state what failed in plain language, provide a request or event identifier when available, and offer retry without implying success.
- **Permission denied:** state which Cloudflare Access boundary or scoped permission prevents the action. Read-only data remains visible when only mutation permission is absent.
- **Drift:** show the last known state, observed live state, detection time, and safe actions. Drift never appears as a generic error and never triggers automatic repair.
- **Not found:** distinguish a missing record from an inaccessible one only when that distinction does not disclose private data; provide a route back to the owning list.

Destructive or externally visible actions use a confirmation surface that names the target, effect, and rollback boundary. Success messages describe the persisted outcome, not merely that a button was clicked.

## 6. Surface specifications

### 6.1 Today

**User goal:** decide and complete the smallest set of actions that keeps conversations, opportunities, and domain operations moving.

**Desktop layout:** one chronological work column, grouped in this order: overdue next actions, unhandled inbound, due today, opportunity integrity recovery, and domain decisions. Each group is omitted when empty. Rows show record title, attribution signature, reason it is here, due/received time, and one direct action. A narrow right rail may show keyboard help and the next seven days, but never analytics.

**Mobile flow:** groups become a single stacked list. Selecting a row opens its owning record as a full page; completing it returns to the same queue position. Queue filters are in a compact disclosure above the list.

**Primary actions:** open conversation, mark handled, complete/reschedule/cancel next action, add missing next action, review domain plan or drift. Bulk completion is not allowed because each transition needs explicit intent.

**States:** the empty state reads “Nothing needs attention” and links to Inbox; loading preserves group headings; partial failure identifies only the unavailable queue; permission state keeps readable items but disables unavailable mutations; drift items retain their domain warning until reviewed or resolved.

### 6.2 Inbox

**User goal:** triage inbound mail while always knowing which product, domain, and mailbox produced the relationship.

**Desktop layout:** a three-region application shell:

```text
┌──────────────┬──────────────────────────┬────────────────────────────────────┐
│ navigation   │ conversation list        │ conversation workspace             │
│              │ filters + rows           │ header / timeline / context rail   │
└──────────────┴──────────────────────────┴────────────────────────────────────┘
```

At 1120 px and above, navigation is 208–232 px, the conversation list is 320–380 px, and the workspace receives all remaining width. The list and workspace scroll independently; the page itself does not create a third competing scroll container. At 720–1119 px the navigation collapses and the list is 300–340 px. Below 720 px, list and workspace are separate full-width routes with a visible Back to Inbox control.

**Conversation list:** the toolbar provides search and filters for handling state, product, domain, and mailbox. Default ordering is latest message time descending, with unhandled rows visually stronger but not reordered unpredictably. Each row contains sender/contact, subject, one-line safe text preview when available, attribution signature, last-message time, attachment indicator, and the explicit state `Needs attention` or `Handled`. Missing subjects render “No subject”; long text truncates visually without changing accessible text.

**Conversation workspace header:** subject, contact identity, attribution signature, current handling state, last activity time, and actions: Mark handled/Reopen, Add next action, and Link opportunity. Reply is absent until reliable outbound exists. Actions that are unavailable explain why rather than appearing to work.

**Timeline:** messages render oldest to newest as readable correspondence, grouped by calendar day when useful. Each item shows sender, To/Cc/Bcc header recipients when present, the separately labelled resolved envelope mailbox, sent time, received time when operationally relevant, safe plain text, and attachment metadata. Quoted history may be visually subdued only when detection is deterministic; it remains accessible. Raw HTML is never rendered unsanitized. Operational ingestion facts live in a disclosure, not in the reading path.

**Context rail:** canonical contact name and addresses, first/last seen, products/domains contacted, open next action, and linked opportunities. It is supplementary: collapsing it must not hide the conversation's attribution. On mobile it appears after the timeline under “Contact context”.

**Attachments:** show filename, media type, byte size, disposition, and content ID when present. A download action is added only when it can authorize the D1 relation before reading R2 and emit a safe content disposition. Missing R2 binary is an actionable storage error, never a successful download.

**States and actions:** an empty inbox explains mailbox setup and test ingestion; an empty filter state resets filters; loading preserves selected-row geometry; a deleted/missing conversation returns a record-level not-found state; ingestion errors link to operational guidance without exposing message bodies. Mark handled is an explicit reversible transition. Adding a next action and linking an opportunity are unavailable until their respective slices add the required data state.

### 6.3 Contacts

**User goal:** recognize one person across addresses, domains, products, and conversations without losing provenance.

**Desktop layout:** searchable contact list on the left and detail workspace on the right. Contact rows show canonical display name, primary email, products contacted, last activity, and open next-action indicator. The primary email defaults to the earliest-seen canonical address and can be changed explicitly by the user. Detail begins with identity and explicit merge/edit actions, followed by a cross-product chronological timeline and a compact relationship summary.

**Mobile flow:** list and detail are separate routes. Identity, current next action, and latest event appear before the full timeline. Filters open in a bottom sheet or native disclosure, not a permanently fixed side panel.

**Canonical timeline:** every event names its type, exact time, source conversation or manual actor, and attribution signature. Messages remain linked to their original mailbox/product even after contact merge. Multiple email addresses belong to one canonical contact only after deterministic identity resolution or explicit user-approved merge. Display-name similarity never merges contacts automatically. A merge preview lists surviving identity, moved addresses, affected conversations/opportunities, and the fact that the merge is reversible through recorded history before approval.

**Primary actions:** edit display name, choose primary email, add a manually confirmed address, merge duplicate with confirmation, add next action, create/link opportunity, open source conversation. Manually confirmed records actor, time, and provenance; it does not claim an ownership challenge occurred. Permanent delete is absent; archival operations preserve auditability.

**States:** no contacts points to Inbox/setup rather than “Create contact” because inbound sender identity is canonical; no search result offers reset; partial timeline errors retain identity context and retry only the timeline; permission restrictions disable merges/edits while retaining read access; historical attribution drift is displayed but never rewritten from live domain configuration.

### 6.4 Opportunities

**User goal:** track concrete commercial intent and ensure every active opportunity has an explicit next step.

**Lifecycle:** `new → qualified → active → won | lost`, with `archived` available from terminal states. `new` records evidence but not commitment; `qualified` means the user confirmed a real potential outcome; `active` requires an owner-equivalent personal responsibility and exactly one designated open next action; `won` and `lost` require an outcome note and timestamp. Completing or cancelling the designated action is one atomic command that must either designate/create its replacement or transition the opportunity out of `active`; otherwise it is rejected. Reopening a terminal opportunity atomically creates or designates an open action. AI may propose a state or opportunity but never performs a transition.

**Desktop layout:** a dense, filterable table/list rather than a kanban board. Columns are opportunity, contact, product/domain, state, value/currency when known, next action, and last activity. The detail workspace shows outcome, evidence conversations, contact context, state history, and next actions. State transitions use a labelled menu followed by a compact confirmation that captures required reason or next action.

**Mobile flow:** opportunity rows become stacked summaries; detail is a full route. State and next action remain above evidence/history. Editing uses one-field-at-a-time sections to avoid a wide desktop form compressed onto mobile.

**Primary actions:** create from a conversation/contact, qualify, activate with next action, update value, link evidence, mark won/lost with reason, reopen, archive. Positive feedback alone is insufficient evidence; the creation form asks for desired outcome and supporting conversation.

**States:** empty explains the evidence threshold and links to Inbox; filtered empty resets filters; active-without-next-action appears on Today only as an integrity/migration recovery item and cannot be created through normal commands; permission errors preserve the opportunity and entered notes; stale source conversations remain as immutable evidence links.

### 6.5 Next actions

Next actions are not a separate primary navigation destination; they are created in conversations, contacts, or opportunities and executed from Today.

**Lifecycle:** `open → completed | cancelled`. Open actions have description, due time or explicit “no date”, source record, and creation actor. Rescheduling changes due time and records history; it does not complete the old action and create an indistinguishable replacement. Completion records time and source: explicit manual completion, or a verified outbound acceptance/delivery rule introduced in Slice 4. Drafting or queueing mail never completes an action. Cancel requires a reason. Completed/cancelled actions are immutable except through an explicit reopen transition that records who and why. Completing/cancelling an active opportunity's designated action obeys the atomic replacement-or-transition rule above.

**Primary actions:** create, reschedule, complete, cancel, reopen. Only one action may be designated as the current next action for an active opportunity, while contacts and conversations may have multiple open actions when their purposes differ.

### 6.6 Domains

**User goal:** understand portfolio email readiness and make Cloudflare configuration changes without surprising DNS or routing mutations.

**Desktop layout:** portfolio table with domain, mapped products, readiness, mailbox identities, last verified time, and drift indicator. A domain may map to many products; each exact mailbox identity maps to exactly one product. Domain detail has Overview, Mailboxes, Change plan, and History sections. Live observed state and last-known applied state are displayed side by side when they differ.

**Mobile flow:** portfolio rows become domain summaries ordered by required attention, then name. Detail sections are sequential; a sticky bottom action appears only when one safe next step exists, such as Review plan or Verify again.

**State dimensions:** readiness observation is `unscanned | ready | needs_review | error`. Independently, an activation plan is `planned | approved | applying | verifying | active | failed | drifted | rolled_back`. Readiness is evidence, not a promise. Existing non-Cloudflare MX or ambiguous routing always yields `needs_review` and blocks automatic mutation. Slice 1 manually seeded identities migrate as `manually_configured/unverified`: they remain ingest-capable, but the UI never represents them as installer-verified `active` until a real test is recorded.

**Change-plan UX:** read-only discovery first. A plan lists every current relevant DNS/routing record, proposed create/update/remove operation, permission used, conflict, expected effect, verification step, and rollback operation. Approval is per domain and bound to a hash of the displayed plan; any live-state change invalidates approval and requires review again. Apply shows stepwise results without calling partial work “active”. Activation becomes active only after a real inbound test reaches the expected mailbox and CRM attribution.

**Drift and rollback:** drift displays expected versus observed values, detection source/time, customer impact, and choices: accept as new baseline, create repair plan, or leave unchanged. No automatic repair. Rollback is itself a previewed plan and never promises restoration of third-party state it did not create. Credentials used for mutation are revocable and not retained by the normal CRM runtime.

**Control-plane ownership:** the local installer exclusively holds scoped Cloudflare credentials and performs discovery, apply, verification orchestration, and rollback. The browser/SSR Worker never receives that token. The SvelteKit Worker records the authenticated user's approval of one plan hash in D1, then displays the exact resumable installer command. The installer re-fetches live state, rejects a changed hash, applies approved steps, and records results through a narrow Access-authenticated setup endpoint/command contract. The Worker displays persisted progress but never pretends it can mutate Cloudflare itself.

**Primary actions:** request/inspect a scan, map products, propose exact mailboxes, review a plan, record approval, copy/resume the installer command, inspect verification/drift, and preview/approve rollback. Slice 2A exposes only read actions; apply/rollback controls do not appear until Slice 2B.

**States:** no domains explains scoped discovery; permission state lists the exact missing read or write scope; loading identifies the domain being scanned; API errors retain last verified data with staleness; drift has its own warning treatment; partially applied plans show completed and failed steps with a safe recovery path.

### 6.7 Settings

**User goal:** verify that the self-hosted deployment is safe, understandable, exportable, and recoverable.

**Desktop layout:** a single narrow settings column with sections for Deployment, Access protection, Data policy, Export, Cloudflare connections, and Optional AI. Each section reports current state before controls. Secrets are never echoed after entry.

**Mobile flow:** the same sections are separate anchored pages or disclosures; critical security status appears first. Saving one section never submits unrelated settings.

**Owned actions by slice:** Slice 1 verifies bindings/migration/Access health and links to the documented Cloudflare D1/R2 export and cleanup procedure; an integrated export surface is deferred because a correct export must include D1 plus every referenced R2 binary and manifest. Slices 2A/2B report that setup credentials are not retained and show installer-side revocation instructions; the Worker cannot revoke credentials it does not own. Slice 3C lets the user enable/disable AI and verify that its Worker secret is present, while secret provisioning remains a Wrangler/local-installer action. Through Slice 4 retention is indefinite and deletion controls are absent; documented resource export and cleanup are the recovery boundary.

**States:** initial setup identifies missing bindings/migrations without exposing values; permission errors name the boundary; export shows scope, generated-at time, and failure recovery; drift between documented and detected deployment configuration is informational until the user explicitly reconciles it.

## 7. Data and state model

The global CRM graph belongs in D1 rather than separate per-mailbox Durable Object databases.

The verified Slice 1 schema contains only:

```text
domains
products
mailbox_identities
contacts
contact_email_addresses
conversations
messages
message_recipients
attachments
```

Later slices introduce only the entities they exercise. The intended model after those slices is:

```text
domains
products
mailbox_identities
contacts
contact_email_addresses
contact_merges
conversations
conversation_participants
messages
message_recipients
attachments
opportunities
opportunity_contacts
opportunity_conversations
next_actions
activity_events
domain_observations
domain_change_plans
configuration_changes
ai_suggestions
outbound_messages
outbound_delivery_attempts
```

Important invariants:

1. Slice 1 stores one canonical message per resolved receiving-mailbox context. Multiple owned addresses in parsed To/Cc/Bcc metadata do not duplicate it, and redelivery to the same mailbox deduplicates; delivery of the same RFC message through a second configured mailbox remains a distinct mailbox-context record unless a later migration introduces a message-to-mailbox relation and an explicit attribution policy.
2. RFC `Message-ID` plus resolved mailbox context provides the primary idempotency key; messages without it require a deterministic stable-content fingerprint in that same context.
3. A conversation is a first-class entity, not only a repeated `thread_id` string on messages.
4. RFC `References` and `In-Reply-To` are strong threading evidence. Subject equality never auto-threads messages. A later UI may offer a clearly labelled manual merge suggestion, but only user confirmation changes canonical conversation membership.
5. `sent_at`, `received_at`, and `ingested_at` are distinct facts.
6. D1 is the only canonical source for CRM entities, relations, state, and object references. R2 is binary-only storage for attachments and, if explicitly introduced with retention controls, raw MIME archives; R2 is never a registry or canonical mailbox store.
7. CRM state transitions and delivery outcomes are activity events, not agent-chat history.

Additional product-state invariants:

8. `needs_attention`/handled is an explicit conversation state, not inferred from whether the message was opened. Reopening is always available and both transitions are recorded once activity events exist.
9. A canonical contact email address belongs to one contact. Automatic identity resolution may use exact normalized addresses only; merges across addresses require manual approval and preserve provenance.
10. An active opportunity has exactly one designated open current next action. Completing/cancelling it atomically designates a replacement or exits active state. Won/lost transitions require outcome evidence; AI cannot perform them.
11. Important mutations—contact merge, opportunity terminal state, DNS/routing plan approval, rollback, and outbound send approval—record actor, prior state, desired state, outcome, and time.
12. No schema is pre-created merely for a future slice. Each migration arrives with the first user-observable behavior that uses its state.
13. A contact's primary email is an explicit canonical relation. Merges retain the duplicate contact as a hidden alias, move CRM relations without rewriting message mailbox/product/domain attribution, and store the exact moved relation IDs and prior identities needed by a future explicit inverse command.

## 8. Runtime and UI architecture

```text
Cloudflare Email Routing
        │
        ▼
Inbound Email Worker
  bounded read / MIME parse / dedupe
        │
        ├── attachment binary ──────────▶ R2
        │
        └── atomic CRM metadata batch ──▶ D1
                                           │
                           ┌───────────────┼───────────────┐
                           ▼               ▼               ▼
                    SvelteKit SSR     future API      future adapters
                                                       agent / MCP
```

The current synchronous ingestion path is valid and remains the baseline. A Queue or Workflow may be introduced only when a later slice demonstrates a retry, fan-out, or long-running orchestration need that cannot be handled safely in the Email Worker; it must not change D1's canonical role. Durable Objects are appropriate only for demonstrated serialized or live-session state. They are not the canonical mailbox-by-mailbox CRM store.

The web application remains one Cloudflare Worker using SvelteKit 5 server-first rendering and the official Cloudflare adapter. A project-owned thin entrypoint delegates `fetch` to the adapter-generated Worker and exports the Email Routing `email` handler, preserving one deployment. Bits UI supplies headless accessible primitives where interaction warrants them (beginning with the mobile navigation Dialog). Tailwind CSS v4 provides layout and state utilities over project-owned CSS-first semantic tokens for the warm-light visual language; it is an implementation tool, not a source of generic component aesthetics. SvelteKit routes use links and ordinary server form actions for critical behavior before optional progressive enhancement, with minimal client JavaScript and no client-side-only application shell, shadcn preset, third-party theme, or large frontend framework beyond SvelteKit itself.

Routes and views own HTTP concerns and presentation only. Query, command, validation, authorization, and lifecycle rules live in plain business functions so the same behavior can later be called by web routes, an API, an agent adapter, or MCP without duplication. This is the required implementation direction for future work, not authorization to refactor the verified ingestion core during this design task.

## 9. Inbound lifecycle

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

## 10. Outbound lifecycle

The system must never record an intent as a completed send.

```text
draft → approved → queued → sending → accepted → delivered | bounced
  │         │         │          ├──→ failed (confirmed non-acceptance only)
  │         │         │          └──→ indeterminate → accepted | failed
  │         │         └──→ cancelled
  │         └── content or recipient edit ──→ draft
  └── abandoned draft ──→ cancelled
```

The first adapter is Cloudflare Email Service through its Worker binding. Slice 4 begins only for an account where that service can send from the configured domain to arbitrary intended recipients; the product does not silently substitute a non-Cloudflare provider. If the available API reports provider acceptance but has no delivery/bounce callbacks, `accepted` is the final honest state.

Confirmed non-acceptance may become `failed`; a timeout or lost response becomes `indeterminate`, never `failed` or `accepted` by guess. No retry is allowed while indeterminate. Resolving it requires provider evidence or an explicit user decision; a retry retains the approved content hash and records a new attempt with its own idempotency key. Queued work can be cancelled before sending begins. Editing recipients or content invalidates approval and returns the message to draft. Every attempt records provider identifiers, precise times, errors, evidence, and retry decision. AI can create or revise drafts but cannot approve them.

## 11. Cloudflare permissions and safety

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

## 12. Agent boundary

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

## 13. Relationship to Agentic Inbox

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

## 14. Vertical delivery slices

Each slice ends in a user-observable outcome in a running self-hosted deployment. A migration, component library, API, or mocked screen is not a completed slice by itself. Every slice names what it does not include, verifies behavior through the public user flow plus focused automated tests, and has a rollback boundary that does not silently destroy canonical CRM history.

### Slice 1 — complete a daily-use inbound inbox

**User-observable outcome:** the user can receive real mail for one configured mailbox, identify its product/domain/mailbox at a glance, read and triage conversations in the responsive Inbox shell, inspect contact context and attachment metadata, mark a conversation handled or reopen it, and return the next day to a stable handling state. Duplicate delivery remains one canonical message.

**Scope:** retain the verified bounded PostalMime ingestion, D1/R2 persistence, Message-ID/fingerprint dedupe, RFC threading, Access JWT boundary, and safe plain-text rendering. Replace the proof UI with the navigation shell, conversation list/workspace, responsive mobile routes, filtering, empty/error states, and explicit handled/reopen forms. Settings reports deployment/binding/Access health; complete D1 plus referenced-R2 export is explicitly deferred from this migration because it materially expands the safety surface. Add authorized attachment download only if D1 relation checks, safe headers, and missing-binary behavior are complete.

**Non-scope:** portfolio discovery, DNS or Email Routing mutation, contact merge, next actions, opportunities, outbound, AI, and analytics.

**Data/state impact:** keep the nine-table schema as the canonical ingestion graph. Use the existing conversation attention field for the handling state; no speculative tables are added. If transition history is not yet available, the UI states that detailed audit history begins with Slice 3A rather than fabricating events.

**Verification:** Worker-runtime fixtures continue to cover first ingestion, duplicate, fingerprint, threading, attachment failure, unknown mailbox, and malformed mail. Add route/view tests for attribution, escaped body, handled/reopen, filters, empty/not-found/error, Access failure, keyboard focus, and mobile markup. Complete a local E2E and one real Email Routing test with an attachment; redeliver the same message and verify one message, one conversation, and resolvable R2 metadata.

**Rollback boundary:** UI and route code can roll back to the prior Worker without a schema rollback. Existing D1/R2 records remain readable. Disabling the Email Routing rule stops new ingestion without deleting CRM data.

The current baseline commit completes the ingestion foundation and proof SSR, but this slice is product-complete only after the daily-use UI and handling flow above pass verification.

### Slice 2A — read-only domain portfolio

**User-observable outcome:** the user runs a scoped local installer discovery command, then sees Cloudflare zones, existing MX/Email Routing state, mapped products, readiness, conflicts, staleness, and exact missing read permissions in Domains. Nothing in Cloudflare changes.

**Scope:** scoped Zone/DNS/Email Routing read access held only by the local installer, zone selection, readiness rules, import preview, mapped products, observation timestamps, read-only domain list/detail, and a UI instruction to run/resume the scan command. Existing external MX always produces `needs_review`.

**Non-scope:** DNS/routing writes, mailbox activation, catch-all creation, OAuth, retained broad runtime credentials, drift repair, and automatic migration from another provider.

**Data/state impact:** introduce `domain_observations` for immutable observed snapshots and readiness evidence; extend domain/product mapping only when the user confirms import. Discovery credentials remain in the local installer/session and are not written to CRM runtime storage.

**Verification:** fixture Cloudflare API responses cover ready, existing provider, ambiguous records, no Email Routing permission, pagination, API failure, and stale snapshot. A no-write assertion verifies the installer issues only read operations and never transmits its Cloudflare token to the Worker. The UI shows source and observed time for every readiness claim.

**Rollback boundary:** because Cloudflare is untouched, rollback removes only unactivated imported portfolio records and observations after export/confirmation. Existing Slice 1 domain attribution cannot be removed while referenced.

### Slice 2B — safe mailbox activation

**User-observable outcome:** for one eligible domain, the user reviews a complete change plan, approves that exact plan, applies it, receives a real verification email at the intended mailbox, sees `active`, detects later drift, and can preview a rollback.

**Scope:** exact addresses only. Plans include current/proposed state, plan hash, permissions, conflicts, apply steps, verification, and rollback. Per-domain browser approval, a resumable local installer command, stale-plan invalidation, step results, inbound activation test, drift scan, and previewed rollback are required. The setup endpoint accepts persisted observations/results using a dedicated Access service credential and never receives the Cloudflare API token.

**Non-scope:** catch-all, replacing existing third-party MX automatically, bulk approval, silent repair, permanent broad credentials, non-Cloudflare providers, and treating partial application as active.

**Data/state impact:** introduce `domain_change_plans` and `configuration_changes`; persist desired/previous state, approval actor/time, plan hash, each apply result, verification evidence, drift observations, and rollback relation. Installer-managed mailbox identities become `active` only after verification; migrated Slice 1 identities retain `manually_configured/unverified` until the same evidence exists.

**Verification:** contract tests prove stale plans cannot apply, existing MX blocks mutation, unapproved plans cannot apply, the installer re-fetches live state, partial failure is resumable, Cloudflare credentials are absent from requests and runtime storage, setup-service authorization is narrow, real inbound verification attributes to the planned mailbox, and drift is visible without auto-repair. Run mutation E2E only against an explicitly isolated test domain.

**Rollback boundary:** each applied operation has a displayed compensating operation limited to state created by this product. Rollback is separately approved and logged; it does not overwrite unrelated live changes. Revoking the setup credential ends mutation capability without affecting CRM runtime.

### Slice 3A — personal follow-up loop

**User-observable outcome:** Today becomes the default work queue. The user can see unhandled inbound and due/overdue work, add a next action from a conversation or contact, complete/reschedule/cancel it, and inspect one canonical cross-product contact timeline.

**Scope:** `next_actions`, `activity_events`, Today queues, contact list/detail, exact-email canonical identity, explicit contact merge preview/approval, handled/reopen audit, due-time handling, and source links back to conversations.

**Non-scope:** opportunities, AI, outbound sending, organization automation, task assignment to teams, recurring tasks, and automatic contact merges based on name.

**Data/state impact:** add `next_actions`, `activity_events`, and participant relations needed for cross-product history. Contact email metadata gains `first_seen_at`, explicit primary selection, and manual-confirmation actor/time/provenance. Backfill current conversation handling state as a baseline event without inventing an actor or timestamp earlier than migration time. Contact merge stores survivor, aliases, moved relations, and reversible history.

**Verification:** cross-domain fixtures prove exact normalized address resolution, earliest-seen default primary, explicit primary changes, manual-confirmation provenance, provenance preservation after merge, queue ordering, timezone boundaries, overdue/due states, reversible handled state, action lifecycle, and no completion from draft/queued mail. Keyboard and mobile flows complete the same actions as desktop.

**Rollback boundary:** feature rollback hides new routes/actions but preserves next actions and activity history in D1. Contact merges require an explicit inverse operation rather than schema rollback or record deletion.

### Slice 3B — opportunities

**User-observable outcome:** the user can turn evidence in a conversation into a qualified opportunity, advance it through the defined lifecycle, keep exactly one current next action while active, and mark won/lost with a reason visible in Today and the contact timeline.

**Scope:** opportunity list/detail, evidence links, contact/product relation, optional value/currency, `new/qualified/active/won/lost/archived` transitions, terminal outcome reasons, reopen, and missing-next-action invariant.

**Non-scope:** generic custom pipelines, kanban customization, forecasting dashboards, billing, team ownership, campaigns, and AI-created state changes.

**Data/state impact:** add `opportunities`, `opportunity_contacts`, and `opportunity_conversations` for immutable evidence provenance; reuse `next_actions` and `activity_events`. State transitions are commands with validation and immutable activity records. Active state requires one designated open next action.

**Implemented schema decision:** migration `0003` snapshots product, mailbox, and domain on each opportunity evidence relation, uses integer minor units paired with an uppercase three-letter currency, and extends next actions only with an opportunity relation and designated flag. Normal commands atomically maintain the active/designated-action invariant; no recovery queue is shown because the migration has no legacy opportunity rows to repair.

**Verification:** tests reject invalid transitions, active-without-action, terminal-without-reason, AI/system actor terminal changes, and cross-product attribution loss. E2E starts from a real conversation and ends with a visible won/lost history; reopening creates a required next action.

**Rollback boundary:** disabling the surface leaves canonical opportunity/history rows intact. Individual mistakes are corrected with recorded inverse transitions or archive, never destructive deletion.

### Slice 3C — optional, non-authoritative AI

**User-observable outcome:** an opted-in user may request a classification, summary, opportunity/next-action suggestion, or reply draft for a selected conversation, review the provenance and model output, then accept, edit, or dismiss it. Inbound and manual CRM use remain fully functional with AI disabled or unavailable.

**Scope:** per-deployment opt-in and request-only invocation for one selected conversation, minimal data disclosure, provider/model/time provenance, pending/accepted/edited/dismissed suggestions, and graceful provider failure. Subject and safe plain text are included by default; attachments are excluded unless the user selects each attachment in the request review.

**Non-scope:** scheduled or automatic AI processing, automatic sending, DNS/routing changes, contact merge, terminal opportunity transitions, silent CRM mutation, unconditional processing of every email, or AI as the only way to use any surface.

**Data/state impact:** add `ai_suggestions` in D1 for proposal type, source record/version, model provenance, status, and accepted resulting entity relation. Provider credentials are Worker secrets, never D1 values or UI echoes. Accepted suggestions call the same business commands as manual UI actions.

**Verification:** tests prove disabled mode makes no provider call, failures do not block ingestion, stale-source suggestions require regeneration, prompt output cannot bypass command validation, and accepting/dismissing records the actor. Security review covers body/attachment disclosure and log redaction.

**Rollback boundary:** disable AI and remove provider secrets; pending suggestions become unavailable for action and remain in the indefinite-retention export through Slice 4. Accepted canonical CRM changes remain ordinary auditable user changes.

### Slice 4 — reliable outbound

**User-observable outcome:** the user drafts a reply in its conversation, explicitly approves the exact content and recipients, sends once through Cloudflare Email Service, and sees precise queued/sending/accepted/delivered/bounced/failed/cancelled/indeterminate evidence without a false Sent state.

**Scope:** the lifecycle in Section 10 including `cancelled`, `failed`, and `indeterminate`; the Cloudflare Email Service Worker binding; immutable approval content hash; recipient review; attempt idempotency; retry decision; provider evidence; and conversation timeline integration. When delivery callbacks are unavailable, the final honest state is `accepted`, not `delivered`.

**Non-scope:** campaigns, bulk send, automatic AI approval, provider-independent abstraction beyond the selected adapter, optimistic Sent insertion, prompt-only confirmation, and completing a next action merely because mail was drafted or queued.

**Data/state impact:** add `outbound_messages` and `outbound_delivery_attempts`; canonical inbound `messages` remain unchanged. Approval, attempts, provider identifiers, errors, and precise times live in D1. R2 remains binary-only if outbound attachments are introduced. An accepted/delivered result may complete a linked next action only under its explicit configured rule; manual completion remains available.

**Verification:** tests cover duplicate clicks, queued cancellation, confirmed non-acceptance, indeterminate timeout with retry blocked, explicit resolution/retry, recipient/content changes returning approval to draft, accepted versus delivered rendering, bounce, next-action completion rule, and AI inability to approve. E2E uses Cloudflare Email Service to send only to a controlled test recipient and reconciles provider evidence.

**Rollback boundary:** stop the sender/adapter to prevent new attempts; queued unsent work can be cancelled with history. Already accepted mail cannot be recalled and the UI states that boundary before approval. Deployment rollback preserves every draft, approval, attempt, and outcome.

## 15. Success criteria

The first meaningful success is not repository stars. It is that the maintainer can connect a real domain, receive real product inquiries, identify the responsible product and contact, and reliably know what needs a reply next.

Public-project quality is demonstrated by:

- one-command or clearly guided deployment
- honest permission and data-flow documentation
- reproducible end-to-end verification
- safe failure behavior
- a coherent UI for daily use
- no required proprietary control plane

## 16. Visual direction

The interface is a **warm-light operations desk**: quiet, precise, and optimized for reading correspondence and making careful decisions. It should feel closer to a well-kept paper inbox on a daylight desk than to a software metrics console.

### 16.1 Color and luminance

The default light palette uses these roles; implementations may adjust values only to preserve or improve WCAG contrast:

- canvas: warm gray `#F3F0E9`
- primary working surface: `#FCFBF8`
- raised or selected surface: `#FFFFFF`
- subtle recessed surface: `#EAE5DC`
- primary ink: `#25231F`
- secondary ink: `#666158`
- quiet border: `#D8D1C5`
- accent copper: `#9A5A32`
- muted amber background: `#F2E3C6`
- critical ink/background: `#8A2F2A` / `#F7E3DF`
- success ink/background: `#356047` / `#E3EEE6`

Surfaces are distinguished first by luminance and borders, not shadows. One subtle shadow is permitted for an overlay, menu, or mobile drawer. Accent color identifies focus, selected context, and consequential action; it is not used as decoration or as the sole state signal.

### 16.2 Typography and density

Application chrome uses a native humanist sans stack (`ui-sans-serif`, system UI) at 14–16 px with tabular numerals for timestamps and counts. Email body reading uses a 16 px, 1.6 line-height readable stack; it may use `ui-serif` only when tests show no CJK fallback or alignment regression, otherwise it remains system sans. Subjects use weight and spacing rather than oversized display typography. The content measure for message bodies is 68–76 characters while metadata may span wider.

Spacing follows a 4 px base with common gaps of 8, 12, 16, 24, and 32 px. Inbox rows are compact enough for triage but never below a 44 px interactive target on touch. Dense operational tables use 40 px rows on pointer devices with distinct focus and selected treatments.

### 16.3 Composition rules

The application is cardless by default. Lists use rows, section boundaries, whitespace, and quiet rules; details use a continuous reading surface. Cards are reserved for a genuinely movable or independently actionable object, not for every metric or settings section. There is no hero area after authentication.

The design explicitly rejects a Linear clone, purple/blue gradients, glassmorphism, translucent blur, floating card dashboards, neon status colors, oversized rounded containers, generic analytics tiles, and motion used to imply sophistication. Rounded corners are restrained at 4–8 px and do not turn every surface into a pill.

## 17. Interaction, responsive, and accessibility acceptance criteria

These criteria are release gates for every implemented surface, not optional polish.

### 17.1 Responsive behavior

- At 1120 px and above, Inbox uses the three-region layout; at 720–1119 px navigation collapses; below 720 px lists and details become separate routes. Other split views use the same boundaries.
- Layout works without horizontal page scrolling at 320 CSS px. Operational tables transform into labelled stacked rows rather than shrinking unreadably.
- Mobile actions remain reachable without hover. Sticky controls must not cover focused content, system safe areas, or the final timeline item.
- Zoom to 200% and text-only zoom do not hide actions or truncate state labels. Orientation changes preserve selected record and entered form values.

### 17.2 Keyboard and focus

- All actions are reachable in logical DOM order with Tab/Shift+Tab. Visible focus is at least a 2 px copper outline with sufficient contrast and is never removed without an equivalent.
- Enter activates links/buttons; Space activates buttons and checkboxes; Escape closes the topmost modal/drawer and restores focus to its trigger. Arrow-key behavior is used only for widgets with the corresponding ARIA pattern.
- `/` focuses Inbox search when no editable field is active. Two-key navigation shortcuts are `g` then `t/i/c/o/d/s` for Today/Inbox/Contacts/Opportunities/Domains/Settings. `j`/`k` move between conversation rows and `Enter` opens the selected row. Shortcuts never fire while typing, are listed in a `?` help dialog, and are not the only way to act.
- Route navigation moves focus to the page heading or selected workspace heading. Validation errors focus the summary, link to fields, and preserve user input.

### 17.3 Semantics and WCAG baseline

- Meet WCAG 2.2 AA for contrast, keyboard operation, focus visibility, labels, status announcements, and 24-by-24 CSS pixel minimum targets; primary mobile controls meet 44-by-44.
- Use one `main`, labelled `nav`, real headings without skipped hierarchy, `article` for messages, `aside` only for supplementary contact context, `time datetime`, and real tables for tabular data. Clickable `div` elements are prohibited.
- Every form control has a persistent label; placeholder text is not a label. Errors are associated with fields and summarized. Async completion uses a restrained `aria-live` status region; incoming mail never steals focus.
- State is never communicated by color alone. Icons have text or accessible names; decorative icons are hidden from assistive technology. Respect `prefers-reduced-motion` and do not require motion to understand state.
- HTML email remains non-rendered until a proven sanitizer and content-security policy are introduced. Remote images, tracking pixels, scripts, forms, and embedded active content never execute in the CRM reading view.

### 17.4 Content resilience

- Store timestamps in UTC with their distinct semantics. Display in one IANA timezone configured by the local setup command and reported read-only in Settings; default to UTC until explicitly set. Use locale-aware formatting. Relative time is supplemental for recent activity; every relative value exposes the exact date, time, timezone, and ISO value through visible detail or accessible text.
- Subjects, names, email addresses, domains, IDs, and filenames use `overflow-wrap: anywhere` in detail views. Lists may truncate to two lines but expose the complete value accessibly. No data is truncated before persistence.
- Message bodies preserve meaningful line breaks with safe wrapping; they do not force horizontal scroll for long unbroken strings. Code-like content may scroll inside its own labelled region.
- CJK, emoji, combining marks, and Unicode addresses/names render without clipping or mojibake. User-visible text uses Unicode-safe operations; canonical email normalization remains a separately tested identity rule. Content containers use `dir="auto"` where sender text direction is unknown.
- Attachment names are treated as untrusted text. The UI shows filename, media type, and human-readable plus exact byte size; it handles unnamed, zero-byte, duplicate-name, very large, inline, and missing-binary attachments without layout failure.
- Subjects with no value, missing optional dates/display names, malformed optional headers, and bodyless messages have explicit neutral labels rather than blank UI or ingestion failure.

## 18. Design acceptance and change control

A surface is ready to implement when its owning slice can map every visible action to a named business command and state transition above. A surface is complete only when desktop and mobile flows, all shared states, keyboard behavior, semantic structure, content-resilience fixtures, and authorization failures have been verified.

Product reviews use realistic fixtures: multiple products on one domain, the same contact across two domains, CJK sender/subject/body, a 200-character subject, long unbroken address and URL, missing Date/subject/display name, To/Cc/Bcc attribution, multiple attachments with duplicate names, an R2-missing attachment, an Access denial, a stale domain observation, a drifted plan, and an outbound attempt with ambiguous provider response.

Changes to lifecycle states, canonical ownership, approval requirements, or rollback boundaries require an update to this document before implementation. Visual refinements may evolve within the defined direction, but they may not introduce dashboard vanity, hide attribution, weaken manual approval, or move canonical CRM state out of D1.
