<script lang="ts">
  let { data, form } = $props();
  const conversation = $derived(data.conversation);
  const date = (value: unknown) =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(String(value)))
      : 'Unknown';
  const recipients = (id: string, kind: string) => data.recipients.filter((recipient: any) => recipient.message_id === id && recipient.kind === kind);
  const files = (id: string) => data.attachments.filter((attachment: any) => attachment.message_id === id);
</script>

<svelte:head><title>{conversation.subject || 'No subject'} · Domain CRM</title></svelte:head>

<article class="col-span-full min-h-[calc(100vh-56px)] overflow-auto bg-paper min-[1120px]:min-h-0">
  <header class="border-b border-line px-4 py-5 min-[720px]:px-6">
    <a class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-dark" href="/inbox">← Back to Inbox</a>
    <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Conversation</p>
    <h1 class="max-w-4xl font-reading text-[clamp(1.75rem,4vw,2.4rem)] leading-tight font-semibold">{conversation.subject || 'No subject'}</h1>
    <p class="mt-2 text-sm text-muted">{conversation.display_name || conversation.contact_email} · {conversation.contact_email}</p>
    <p class="mt-2 text-xs font-semibold text-teal">{conversation.product} · {conversation.domain} · {conversation.mailbox}</p>
    <div class="mt-4 flex items-center gap-3">
      <span class={`text-xs ${conversation.needs_attention ? 'font-extrabold text-copper-dark' : 'font-semibold text-muted'}`}>
        {conversation.needs_attention ? 'Needs attention' : 'Handled'}
      </span>
      <form method="POST" action="?/state">
        <input type="hidden" name="state" value={conversation.needs_attention ? 'handled' : 'attention'} />
        <button class="rounded-md border border-teal-dark bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-teal-dark">
          {conversation.needs_attention ? 'Mark handled' : 'Reopen'}
        </button>
      </form>
    </div>
    {#if form?.message}<p class="mt-3 text-sm font-semibold text-[#8e2f24]" role="alert">{form.message}</p>{/if}
    <form method="POST" action="?/action" class="mt-4 flex flex-wrap gap-2"><input required maxlength="500" name="description" placeholder="Next action" class="rounded border border-line px-3 py-2 text-sm"><input aria-label="Due time UTC" type="datetime-local" name="due" class="rounded border border-line px-3 py-2 text-sm"><button class="rounded border border-teal px-3 py-2 text-sm font-semibold text-teal">Add next action</button></form>
  </header>

  <div class="mx-auto max-w-[1120px] min-[920px]:grid min-[920px]:grid-cols-[minmax(0,1fr)_270px]">
    <section class="p-4 min-[720px]:p-6" aria-label="Message timeline">
      {#each data.messages as message}
        <article class="mb-5 overflow-hidden border-y border-line bg-white min-[720px]:rounded-lg min-[720px]:border">
          <header class="flex flex-col gap-2 bg-paper-soft px-4 py-3 min-[560px]:flex-row min-[560px]:items-start min-[560px]:justify-between">
            <div class="min-w-0">
              <strong class="block text-sm">{message.sender_name || message.sender_address}</strong>
              <p class="mt-0.5 text-xs text-muted">{message.sender_address}</p>
            </div>
            <time class="shrink-0 text-[0.72rem] text-muted" datetime={String(message.received_at)} title={new Date(String(message.received_at)).toISOString()}>{date(message.received_at)}</time>
          </header>

          <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-xs text-ink-soft">
            {#each ['to', 'cc', 'bcc'] as kind}
              {@const matches = recipients(String(message.id), kind)}
              {#if matches.length}
                <dt class="font-bold">{kind.toUpperCase()}</dt>
                <dd>{matches.map((recipient: any) => recipient.display_name ? `${recipient.display_name} <${recipient.address}>` : recipient.address).join(', ')}</dd>
              {/if}
            {/each}
            <dt class="font-bold">Envelope mailbox</dt><dd>{conversation.mailbox}</dd>
          </dl>

          <div class="whitespace-pre-wrap border-t border-line px-4 py-5 font-reading text-[1rem] leading-[1.75] [overflow-wrap:anywhere]" dir="auto">{message.text_body || 'No plain-text body'}</div>

          {#if files(String(message.id)).length}
            <section class="border-t border-line px-4 py-4">
              <h3 class="mb-2 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Attachments</h3>
              <ul class="m-0 grid list-none gap-2 p-0">
                {#each files(String(message.id)) as attachment}
                  <li class="border-l-2 border-copper/50 pl-3">
                    <a class="block text-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4" href={'/attachments/' + encodeURIComponent(String(attachment.id))}>
                      {attachment.filename || 'Unnamed file'}
                    </a>
                    <span class="text-xs leading-relaxed text-muted">{attachment.media_type} · {Number(attachment.size).toLocaleString()} bytes · {attachment.disposition || 'unspecified'}{attachment.content_id ? ` · Content-ID ${attachment.content_id}` : ''}</span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          <details class="border-t border-line px-4 py-3 text-xs text-muted">
            <summary class="font-semibold text-ink-soft">Operational timestamps</summary>
            <dl class="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt class="font-bold">Sent</dt><dd>{date(message.sent_at)}</dd>
              <dt class="font-bold">Received</dt><dd>{date(message.received_at)}</dd>
              <dt class="font-bold">Ingested</dt><dd>{date(message.ingested_at)}</dd>
            </dl>
          </details>
        </article>
      {/each}
    </section>

    <aside class="border-t border-line bg-paper-soft p-5 min-[920px]:border-t-0 min-[920px]:border-l min-[920px]:bg-transparent min-[920px]:p-6">
      <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Relationship</p>
      <h2 class="font-reading text-xl font-semibold">Contact context</h2>
      <strong class="mt-5 block text-sm">{conversation.display_name || 'Unnamed contact'}</strong>
      <p class="mt-1 text-xs text-muted">{conversation.contact_email}</p>
      <dl class="mt-5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt class="font-bold text-ink-soft">First seen</dt><dd class="text-muted">{date(conversation.first_seen)}</dd>
        <dt class="font-bold text-ink-soft">Last seen</dt><dd class="text-muted">{date(conversation.last_seen)}</dd>
        <dt class="font-bold text-ink-soft">Product</dt><dd>{conversation.product}</dd>
        <dt class="font-bold text-ink-soft">Domain</dt><dd>{conversation.domain}</dd>
      </dl>
    </aside>
  </div>
  <section class="mt-8 border-t border-line pt-5"><h2 class="font-reading text-2xl">Create opportunity from this evidence</h2><form method="POST" action="?/opportunity" class="mt-3 grid gap-2"><label>Title <input required maxlength="200" name="title" class="w-full rounded border border-line p-2" /></label><label>Desired outcome <textarea required name="desiredOutcome" class="w-full rounded border border-line p-2"></textarea></label><div class="flex gap-2"><label>Value (minor units) <input type="number" min="0" name="valueMinor" class="rounded border p-2" /></label><label>Currency <input maxlength="3" name="currency" class="w-24 rounded border p-2 uppercase" /></label></div><button class="justify-self-start rounded bg-copper px-4 py-2 text-white">Create as new</button></form></section>
</article>
