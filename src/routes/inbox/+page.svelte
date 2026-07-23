<script lang="ts">
  let { data } = $props();

  const date = (value: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const hasFilters = $derived(Object.values(data.filters).some(Boolean));
</script>

<svelte:head><title>Inbox · Domain CRM</title></svelte:head>

<section class="overflow-auto border-line bg-paper min-[720px]:border-r">
  <header class="flex items-start justify-between border-b border-line px-4 py-5 min-[720px]:px-6">
    <div>
      <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Operations</p>
      <h1 class="font-reading text-[1.9rem] leading-tight font-semibold">Inbox</h1>
      <p class="mt-1 text-xs text-muted">{data.rows.length} {data.rows.length === 1 ? 'conversation' : 'conversations'}</p>
    </div>
    <button
      class="hidden size-8 place-items-center rounded-full border border-line bg-transparent text-sm font-bold hover:bg-paper-soft min-[1120px]:grid"
      aria-label="Keyboard shortcuts"
      onclick={() => (document.querySelector<HTMLDialogElement>('#key-help'))?.showModal()}>?</button
    >
  </header>

  <form class="border-b border-line p-4" method="GET">
    <label>
      <span class="mb-1.5 block text-xs font-bold text-ink-soft">Search conversations</span>
      <input
        class="w-full rounded-md border border-line-strong bg-white px-3 py-2.5 text-sm placeholder:text-muted/75 hover:border-muted focus:border-teal"
        name="q"
        value={data.filters.q || ''}
        placeholder="Sender, subject, or text…"
      />
    </label>
    <div class="mt-2.5 flex flex-wrap gap-1.5">
      <select class="min-w-0 flex-1 basis-[45%] rounded-md border border-line bg-white px-2 py-2 text-xs text-ink min-[720px]:basis-auto" name="state" aria-label="Handling state">
        <option value="">All states</option>
        <option value="attention" selected={data.filters.state === 'attention'}>Needs attention</option>
        <option value="handled" selected={data.filters.state === 'handled'}>Handled</option>
      </select>
      <select class="min-w-0 flex-1 basis-[45%] rounded-md border border-line bg-white px-2 py-2 text-xs text-ink min-[720px]:basis-auto" name="product" aria-label="Product">
        <option value="">All products</option>
        {#each [...new Map(data.options.map((option: any) => [option.product_id, option])).values()] as option}
          <option value={option.product_id} selected={data.filters.product === option.product_id}>{option.product}</option>
        {/each}
      </select>
      <select class="min-w-0 flex-1 basis-[45%] rounded-md border border-line bg-white px-2 py-2 text-xs text-ink min-[720px]:basis-auto" name="domain" aria-label="Domain">
        <option value="">All domains</option>
        {#each [...new Map(data.options.map((option: any) => [option.domain_id, option])).values()] as option}
          <option value={option.domain_id} selected={data.filters.domain === option.domain_id}>{option.domain}</option>
        {/each}
      </select>
      <select class="min-w-0 flex-1 basis-[45%] rounded-md border border-line bg-white px-2 py-2 text-xs text-ink min-[720px]:basis-auto" name="mailbox" aria-label="Mailbox">
        <option value="">All mailboxes</option>
        {#each data.options as option}
          <option value={option.mailbox_id} selected={data.filters.mailbox === option.mailbox_id}>{option.mailbox}</option>
        {/each}
      </select>
      <button class="rounded-md border border-teal-dark bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-teal-dark">Apply</button>
    </div>
  </form>

  {#if !data.rows.length}
    <div class="mx-auto max-w-md px-6 py-16">
      <p class="mb-2 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">{hasFilters ? 'No results' : 'Ready for mail'}</p>
      <h2 class="font-reading text-2xl font-semibold">{hasFilters ? 'No matching conversations' : 'Your inbox is ready'}</h2>
      <p class="my-3 text-sm leading-relaxed text-muted">
        {hasFilters ? 'No conversations match these filters.' : 'Route an exact configured mailbox to this Email Worker, then send an external test message.'}
      </p>
      {#if hasFilters}
        <a class="inline-block rounded-md border border-teal-dark bg-teal px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-teal-dark" href="/inbox">Reset filters</a>
      {:else}
        <a class="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-teal-dark" href="/settings">Review setup safety</a>
      {/if}
    </div>
  {:else}
    <ol class="m-0 list-none p-0" aria-label="Conversations">
      {#each data.rows as row}
        <li class="border-b border-line">
          <a class="group block px-4 py-4 no-underline hover:bg-paper-soft focus-visible:bg-paper-soft focus-visible:outline-offset-[-3px] min-[720px]:px-5" href={'/conversations/' + encodeURIComponent(row.id)}>
            <div class="flex items-baseline justify-between gap-3">
              <strong class="min-w-0 truncate text-sm text-ink">{row.sender_name || row.sender_address}</strong>
              <time class="shrink-0 text-[0.68rem] text-muted" datetime={row.updated_at} title={new Date(row.updated_at).toISOString()}>{date(row.updated_at)}</time>
            </div>
            <h2 class="my-1 truncate text-[0.94rem] font-semibold text-ink-soft group-hover:text-ink">{row.subject || 'No subject'}</h2>
            <p class="my-1 truncate text-[0.8rem] text-muted">{row.preview || 'No plain-text preview'}</p>
            <p class="my-2 truncate text-[0.72rem] font-semibold text-teal">{row.product} · {row.domain} · {row.mailbox}</p>
            <div class="flex items-center justify-between gap-3 text-[0.7rem] text-muted">
              <span class={row.needs_attention ? 'font-extrabold text-copper-dark' : ''}>{row.needs_attention ? 'Needs attention' : 'Handled'}</span>
              {#if row.attachment_count}
                <span aria-label={`${row.attachment_count} attachments`}><span aria-hidden="true">⌕</span> {row.attachment_count}</span>
              {/if}
            </div>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<section class="hidden place-items-center bg-canvas-deep px-12 min-[720px]:grid">
  <div class="max-w-sm border-l-2 border-copper/55 pl-6">
    <p class="mb-2 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Conversation workspace</p>
    <h2 class="font-reading text-2xl font-semibold">Select a conversation</h2>
    <p class="mt-2 text-sm leading-relaxed text-muted">Read the full plain-text timeline and contact context here.</p>
  </div>
</section>
