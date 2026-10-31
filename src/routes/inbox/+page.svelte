<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  let { data } = $props();
  const date = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  const hasFilters = $derived(Object.values(data.filters).some(Boolean));
  const attention = $derived(data.rows.filter((row) => row.needs_attention).length);
</script>

<svelte:head><title>Inbox · Domain Desk</title></svelte:head>
<div class="workspace-page">
  <header class="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
    <div>
      <p class="eyebrow">02 / Correspondence</p>
      <h1 class="mt-2 text-2xl font-semibold">Inbox</h1>
    </div>
    <a href="/today" class="inline-flex min-h-11 items-center gap-2 font-mono text-xs text-teal"
      >View next actions <Icon name="arrow" size={16} /></a
    >
  </header>
  <section class="panel" aria-label="Inbox workspace">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
      <div class="flex items-center gap-2.5">
        <h2 class="font-mono text-[10px] tracking-wide uppercase">
          {hasFilters ? 'Filtered conversations' : 'All conversations'}
        </h2>
        <span class="font-mono text-xs tabular-nums">/ {data.rows.length}</span>
      </div>
      <p class="font-mono text-[10px] text-muted">
        {attention} need attention in this view <span class="ml-2 text-line-strong">·</span>
        <span class="ml-2">UTC</span>
      </p>
    </div>
    <form class="grid gap-3 border-b border-ink py-4 min-[900px]:grid-cols-[minmax(180px,1fr)_2fr]" method="GET">
      <label class="relative flex items-center"
        ><span class="sr-only">Search conversations</span><span class="pointer-events-none absolute left-3 text-muted"
          ><Icon name="search" size={16} /></span
        ><input
          class="w-full rounded-lg border border-line bg-paper py-2.5 pr-3 pl-10 text-sm"
          name="q"
          value={data.filters.q || ''}
          placeholder="Search conversations…"
        /></label
      >
      <div class="flex flex-wrap gap-2">
        <select
          class="min-w-0 flex-1 basis-[40%] rounded-lg border border-line bg-paper px-2 text-xs min-[720px]:basis-0"
          name="state"
          aria-label="Handling state"
          ><option value="">All states</option><option value="attention" selected={data.filters.state === 'attention'}
            >Needs attention</option
          ><option value="handled" selected={data.filters.state === 'handled'}>Handled</option></select
        >
        {#each ['product', 'domain', 'mailbox'] as filter}
          <select
            class="min-w-0 flex-1 basis-[40%] rounded-lg border border-line bg-paper px-2 text-xs min-[720px]:basis-0"
            name={filter}
            aria-label={filter[0].toUpperCase() + filter.slice(1)}
          >
            <option value="">All {filter === 'mailbox' ? 'mailboxes' : `${filter}s`}</option>
            {#each [...new Map(data.options.map((option: any) => [option[`${filter}_id`], option])).values()] as option}
              <option value={option[`${filter}_id`]} selected={data.filters[filter] === option[`${filter}_id`]}
                >{option[filter]}</option
              >
            {/each}
          </select>
        {/each}
        <button class="rounded-lg bg-teal px-4 py-2 text-xs font-semibold text-white">Apply</button>
      </div>
    </form>
    {#if !data.rows.length}
      <div class="mx-auto max-w-md px-6 py-20 text-center">
        <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-sidebar text-teal"
          ><Icon name="inbox" size={26} /></span
        >
        <h2 class="mt-5 text-xl font-semibold">{hasFilters ? 'No matching conversations' : 'Your inbox is ready'}</h2>
        <p class="mt-2 mb-5 text-sm leading-relaxed text-muted">
          {hasFilters
            ? 'No conversations match these filters. Try a different search or start fresh.'
            : 'Connect an exact mailbox and let your first conversation find its way here.'}
        </p>
        <a
          class="inline-flex min-h-11 items-center rounded-lg bg-teal px-4 text-sm font-medium text-white"
          href={hasFilters ? '/inbox' : '/settings'}>{hasFilters ? 'Reset filters' : 'Review setup safety'}</a
        >
      </div>
    {:else}
      <div
        class="hidden grid-cols-[160px_minmax(0,1fr)_180px_150px] gap-4 border-b border-line px-2 py-3 font-mono text-[10px] text-muted uppercase min-[900px]:grid"
      >
        <span>Contact / sender</span><span>Subject / preview</span><span>Product / mailbox</span><span
          class="text-right">Last activity · UTC</span
        >
      </div>
      <ol class="m-0 list-none divide-y divide-line p-0" aria-label="Conversations">
        {#each data.rows as row}
          <li>
            <a
              class="group grid gap-3 px-2 py-4 no-underline hover:bg-paper-soft focus-visible:outline-offset-[-3px] min-[900px]:grid-cols-[160px_minmax(0,1fr)_180px_150px] min-[900px]:items-center min-[900px]:gap-4"
              href={'/conversations/' + encodeURIComponent(row.id)}
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{row.sender_name || row.sender_address}</p>
                <p class="mt-1 truncate font-mono text-[10px] text-muted" title={row.sender_address}>
                  {row.sender_address}
                </p>
              </div>
              <div class="min-w-0">
                <h2 class="truncate text-sm font-semibold group-hover:text-teal">{row.subject || 'No subject'}</h2>
                <p class="mt-1 truncate text-xs leading-relaxed text-muted">
                  {row.preview || 'No plain-text preview'}
                </p>
              </div>
              <div class="min-w-0">
                <p class="truncate text-xs font-semibold text-ink-soft">{row.product}</p>
                <p class="mt-1 truncate font-mono text-[10px] text-muted" title={`${row.domain} · ${row.mailbox}`}>
                  {row.mailbox}
                </p>
                <span class="sr-only">{row.domain}</span>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 min-[900px]:justify-end">
                <time
                  class="font-mono text-[10px] text-muted"
                  datetime={row.updated_at}
                  title={new Date(row.updated_at).toISOString()}>{date(row.updated_at)}</time
                ><span class={`status-pill ${row.needs_attention ? 'status-attention' : ''}`}
                  ><Icon name={row.needs_attention ? 'clock' : 'check'} size={12} />{row.needs_attention
                    ? 'Needs attention'
                    : 'Handled'}</span
                >{#if row.attachment_count}<span
                    class="flex items-center gap-1 text-xs text-muted"
                    aria-label={`${row.attachment_count} attachments`}
                    ><Icon name="attachment" size={13} />{row.attachment_count}</span
                  >{/if}
              </div>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
  <p class="mt-4 font-mono text-[10px] leading-relaxed text-muted">
    Email + form intake. Opening a conversation does not mark it handled.
  </p>
</div>
