<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  let { data, form } = $props();
  const conversation = $derived(data.conversation);
  const date = (value: unknown) =>
    value
      ? new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'long' }).format(
          new Date(String(value))
        )
      : 'Unknown';
  const recipients = (id: string, kind: string) =>
    data.recipients.filter((recipient: any) => recipient.message_id === id && recipient.kind === kind);
  const files = (id: string) => data.attachments.filter((attachment: any) => attachment.message_id === id);
  const draft = $derived(data.replies.find((reply) => ['draft', 'approved'].includes(reply.state)));
  const blocked = $derived(data.replies.some((reply) => ['sending', 'indeterminate'].includes(reply.state)));
</script>

<svelte:head><title>{conversation.subject || 'No subject'} · Domain Desk</title></svelte:head>

<article class="mx-auto max-w-[1400px]">
  <header class="border-b border-ink bg-canvas px-4 py-6 min-[720px]:px-8">
    <a
      class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-dark"
      href="/inbox">← Back to Inbox</a
    >
    <p class="eyebrow mb-2">Conversation</p>
    <h1 class="max-w-4xl text-[clamp(1.4rem,3vw,1.8rem)] leading-tight font-semibold">
      {conversation.subject || 'No subject'}
    </h1>
    <p class="mt-2 text-sm text-muted">
      {conversation.display_name || conversation.contact_email} · {conversation.contact_email}
    </p>
    <p class="mt-2 text-xs font-semibold text-teal">
      {conversation.product} · {conversation.domain} · {conversation.mailbox}
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <span class={`status-pill ${conversation.needs_attention ? 'status-attention' : ''}`}>
        {conversation.needs_attention ? 'Needs attention' : 'Handled'}
      </span>
      <form method="POST" action="?/state">
        <input type="hidden" name="state" value={conversation.needs_attention ? 'handled' : 'attention'} />
        <button
          class="rounded-md border border-teal-dark bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-teal-dark"
        >
          {conversation.needs_attention ? 'Mark handled' : 'Reopen'}
        </button>
      </form>
    </div>
    {#if form?.message}<p class="mt-3 text-sm font-semibold text-[#8e2f24]" role="alert">{form.message}</p>{/if}
    <form
      method="POST"
      action="?/action"
      class="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper-soft p-3"
    >
      <span class="flex w-full items-center gap-2 text-xs font-semibold text-muted"
        ><Icon name="today" size={15} />Next action</span
      >
      <input
        required
        maxlength="500"
        name="description"
        aria-label="Next action"
        placeholder="Next action"
        class="min-w-0 flex-1 basis-[220px] rounded-lg border border-line bg-paper px-3 py-2 text-sm"
      /><input
        aria-label="Due time UTC"
        type="datetime-local"
        name="due"
        class="rounded border border-line px-3 py-2 text-sm"
      /><button class="rounded border border-teal px-3 py-2 text-sm font-semibold text-teal">Add next action</button>
    </form>
  </header>

  <div class="min-[920px]:grid min-[920px]:grid-cols-[minmax(0,1fr)_280px]">
    <section class="min-w-0 p-4 min-[720px]:p-8" aria-label="Message timeline">
      <h2 class="mb-5 flex items-center gap-2 text-xs font-medium text-muted">
        <Icon name="inbox" size={15} />Message history
        <span class="ml-auto tabular-nums">{data.messages.length} messages</span>
      </h2>
      {#each data.messages as message}
        <article
          class={`mb-5 overflow-hidden rounded-xl border border-line bg-paper ${message.direction === 'outbound' ? 'border-l-[3px] border-l-teal' : ''}`}
        >
          <header
            class="flex flex-col gap-2 bg-paper-soft px-4 py-3 min-[560px]:flex-row min-[560px]:items-start min-[560px]:justify-between"
          >
            <div class="min-w-0">
              <strong class="block text-sm">{message.sender_name || message.sender_address}</strong>
              <p class="mt-0.5 text-xs text-muted">{message.sender_address}</p>
              {#if message.channel === 'form'}
                <p class="mt-1 text-xs font-semibold text-copper-dark">Landing-page form submission</p>
              {/if}
              {#if message.direction === 'outbound'}
                <p
                  class={`mt-1 text-xs font-semibold ${message.delivery_status === 'failed' ? 'text-copper-dark' : 'text-teal'}`}
                >
                  {message.delivery_status === 'sent'
                    ? 'Reply accepted by provider · delivery unverified'
                    : message.delivery_status === 'sending'
                      ? 'Reply · delivery not yet confirmed'
                      : `Reply failed · ${message.delivery_error || 'unknown error'}`}
                </p>
              {/if}
            </div>
            <time
              class="shrink-0 text-[0.72rem] text-muted"
              datetime={String(message.received_at)}
              title={new Date(String(message.received_at)).toISOString()}>{date(message.received_at)}</time
            >
          </header>

          <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-xs text-ink-soft">
            {#each ['to', 'cc', 'bcc'] as kind}
              {@const matches = recipients(String(message.id), kind)}
              {#if matches.length}
                <dt class="font-bold">{kind.toUpperCase()}</dt>
                <dd>
                  {matches
                    .map((recipient: any) =>
                      recipient.display_name ? `${recipient.display_name} <${recipient.address}>` : recipient.address
                    )
                    .join(', ')}
                </dd>
              {/if}
            {/each}
            <dt class="font-bold">Envelope mailbox</dt>
            <dd>{conversation.mailbox}</dd>
          </dl>

          <div
            class="max-w-prose whitespace-pre-wrap border-t border-line px-4 py-5 text-[15px] leading-[1.75] [overflow-wrap:anywhere]"
            dir="auto"
          >
            {message.text_body || 'No plain-text body'}
          </div>

          {#if files(String(message.id)).length}
            <section class="border-t border-line px-4 py-4">
              <h3 class="mb-2 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Attachments</h3>
              <ul class="m-0 grid list-none gap-2 p-0">
                {#each files(String(message.id)) as attachment}
                  <li class="border-l-2 border-copper/50 pl-3">
                    <a
                      class="block text-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4"
                      href={'/attachments/' + encodeURIComponent(String(attachment.id))}
                    >
                      {attachment.filename || 'Unnamed file'}
                    </a>
                    <span class="text-xs leading-relaxed text-muted"
                      >{attachment.media_type} · {Number(attachment.size).toLocaleString()} bytes · {attachment.disposition ||
                        'unspecified'}{attachment.content_id ? ` · Content-ID ${attachment.content_id}` : ''}</span
                    >
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          <details class="border-t border-line px-4 py-3 text-xs text-muted">
            <summary class="font-semibold text-ink-soft">Operational timestamps</summary>
            <dl class="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt class="font-bold">Sent</dt>
              <dd>{date(message.sent_at)}</dd>
              <dt class="font-bold">Received</dt>
              <dd>{date(message.received_at)}</dd>
              <dt class="font-bold">Ingested</dt>
              <dd>{date(message.ingested_at)}</dd>
            </dl>
          </details>
        </article>
      {/each}

      <section
        class="mt-7 grid gap-3 rounded-xl border border-line bg-paper p-4 min-[720px]:p-5"
        aria-label="Reply workspace"
      >
        <h2 class="flex items-center gap-2 text-base font-semibold"><Icon name="arrow" />Reply</h2>
        <p class="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted">
          <span>01 DRAFT /</span><span>02 REVIEW /</span><span>03 APPROVE /</span><span>04 SEND ONCE</span>
        </p>
        {#if blocked}
          <p role="status" class="rounded-lg bg-orange-50 p-3 text-sm font-semibold text-copper-dark">
            Send outcome unresolved. Further replies are blocked to prevent duplicates.
          </p>
        {:else}
          <form method="POST" action="?/reply" class="grid gap-2">
            <input type="hidden" name="operation" value="save" />
            <input type="hidden" name="id" value={draft?.id || ''} />
            <label for="reply-body" class="text-sm font-semibold">Reply text</label>
            <textarea
              id="reply-body"
              required
              maxlength="50000"
              name="body"
              rows="5"
              class="w-full rounded border border-line bg-white p-3 text-base"
              value={(form && 'replyBody' in form && typeof form.replyBody === 'string' ? form.replyBody : undefined) ??
                draft?.body ??
                ''}></textarea>
            <button class="min-h-11 justify-self-start rounded border border-teal px-4 py-2 font-semibold text-teal"
              >Save draft for review</button
            >
          </form>
        {/if}
        {#if draft}
          <div class="grid gap-3 rounded-lg border border-line bg-paper-soft p-4 text-sm [overflow-wrap:anywhere]">
            <h3 class="font-semibold">Review saved reply · {draft.state}</h3>
            <dl
              class="grid grid-cols-1 gap-x-4 gap-y-1 min-[560px]:grid-cols-[max-content_minmax(0,1fr)] min-[560px]:gap-y-2"
            >
              <dt>From</dt>
              <dd>{draft.context.from}</dd>
              <dt>To</dt>
              <dd>{draft.context.to}</dd>
              <dt>Subject</dt>
              <dd>{draft.context.subject}</dd>
            </dl>
            <p class="whitespace-pre-wrap" dir="auto">{draft.body}</p>
            <p class="text-muted">
              Only this saved text will be sent. Saving edits revokes approval. Sending cannot be recalled.
            </p>
            <form method="POST" action="?/reply" class="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="hash" value={draft.content_hash} />
              <button
                name="operation"
                value={draft.state === 'approved' ? 'send' : 'approve'}
                class="min-h-11 rounded bg-teal px-4 py-2 font-semibold text-white"
              >
                {draft.state === 'approved' ? 'Send approved reply once' : 'Approve this exact reply'}
              </button>
              <button name="operation" value="cancel" class="min-h-11 rounded border border-line px-3 py-2"
                >Cancel draft</button
              >
            </form>
          </div>
        {/if}
        {#each data.replies.filter((reply) => !['draft', 'approved'].includes(reply.state)) as reply}
          <section
            class="grid gap-2 border-b border-line py-4 text-sm [overflow-wrap:anywhere]"
            aria-label="Reply outcome"
          >
            <h3 class="font-semibold">Reply outcome · {reply.state}</h3>
            <p class="text-xs text-muted">Attempt: {reply.id} · {date(reply.updated_at)}</p>
            {#if reply.provider_id}<p>Provider Message-ID: {reply.provider_id}</p>{/if}
            {#if reply.error_code}<p>{reply.error_code}</p>{/if}
            {#if reply.state === 'accepted'}<p>Accepted by provider; delivery is not verified.</p>{/if}
            {#if reply.state === 'failed'}<p>
                Confirmed non-acceptance. Correct the cause, then create and approve a new draft.
              </p>{/if}
            {#if reply.evidence}<p>Recorded evidence: {reply.evidence}</p>{/if}
            {#if ['sending', 'indeterminate'].includes(reply.state)}
              <p>
                Do not resend. Check Email Service records or contact support using this attempt, sender, recipient and
                time. An empty recipient inbox does not prove non-acceptance.
              </p>
              <details>
                <summary class="min-h-11 py-2 font-semibold">Reconcile with provider evidence</summary>
                <form method="POST" action="?/reply" class="mt-3 grid gap-3">
                  <input type="hidden" name="operation" value="reconcile" />
                  <input type="hidden" name="id" value={reply.id} />
                  <label
                    >Evidenced outcome<select
                      name="outcome"
                      required
                      value={form?.reconciliation?.id === reply.id ? form.reconciliation.outcome : ''}
                      class="mt-1 w-full rounded border border-line p-2 text-base"
                    >
                      <option value="">Select confirmed result</option><option value="accepted"
                        >Provider accepted</option
                      ><option value="failed">Provider confirms non-acceptance</option>
                    </select></label
                  >
                  <label
                    >Provider Message-ID (required for acceptance)<input
                      name="providerId"
                      value={form?.reconciliation?.id === reply.id ? form.reconciliation.providerId : ''}
                      class="mt-1 w-full rounded border border-line p-2 text-base"
                    /></label
                  >
                  <label
                    >Provider evidence<textarea
                      name="evidence"
                      required
                      minlength="10"
                      maxlength="2000"
                      value={form?.reconciliation?.id === reply.id ? form.reconciliation.evidence : ''}
                      class="mt-1 w-full rounded border border-line p-2 text-base"></textarea></label
                  >
                  <p>
                    For interrupted sending, wait at least 15 minutes and verify the attempt has ended. This records
                    evidence only; it never sends mail.
                  </p>
                  <button
                    class="min-h-11 justify-self-start rounded border border-teal px-3 py-2 font-semibold text-teal"
                    >Record confirmed outcome</button
                  >
                </form>
              </details>
            {/if}
          </section>
        {/each}
      </section>
    </section>

    <aside class="border-t border-line bg-canvas p-5 min-[920px]:border-t-0 min-[920px]:border-l min-[920px]:p-6">
      <p class="eyebrow mb-2">Relationship</p>
      <h2 class="text-base font-semibold">Contact context</h2>
      <span class="avatar mt-5" aria-hidden="true"
        >{Array.from(String(conversation.display_name || conversation.contact_email || '?'))
          .slice(0, 2)
          .join('')
          .toUpperCase()}</span
      >
      <strong class="mt-5 block text-sm">{conversation.display_name || 'Unnamed contact'}</strong>
      <p class="mt-1 text-xs text-muted">{conversation.contact_email}</p>
      <dl class="mt-5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt class="font-bold text-ink-soft">First seen</dt>
        <dd class="text-muted">{date(conversation.first_seen)}</dd>
        <dt class="font-bold text-ink-soft">Last seen</dt>
        <dd class="text-muted">{date(conversation.last_seen)}</dd>
        <dt class="font-bold text-ink-soft">Product</dt>
        <dd>{conversation.product}</dd>
        <dt class="font-bold text-ink-soft">Domain</dt>
        <dd>{conversation.domain}</dd>
      </dl>
      <a
        href={'/contacts/' + encodeURIComponent(String(conversation.contact_id))}
        class="mt-6 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-teal"
        >View contact <Icon name="arrow" size={14} /></a
      >
    </aside>
  </div>
  <section class="m-4 rounded-xl border border-line bg-paper p-5 min-[720px]:m-8 min-[720px]:p-6">
    <p class="eyebrow mb-2">Opportunity / New record</p>
    <h2 class="text-lg font-semibold">Create opportunity from this evidence</h2>
    <form method="POST" action="?/opportunity" class="mt-4 grid max-w-2xl gap-3 text-sm">
      <label>Title <input required maxlength="200" name="title" class="w-full rounded border border-line p-2" /></label
      ><label
        >Desired outcome <textarea required name="desiredOutcome" class="w-full rounded border border-line p-2"
        ></textarea></label
      >
      <div class="flex flex-wrap gap-2">
        <label
          >Value (minor units) <input
            type="number"
            min="0"
            name="valueMinor"
            class="w-full rounded border p-2"
          /></label
        ><label>Currency <input maxlength="3" name="currency" class="w-24 rounded border p-2 uppercase" /></label>
      </div>
      <button class="justify-self-start rounded bg-copper px-4 py-2 text-white">Create as new</button>
    </form>
  </section>
</article>
