<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  let { data, form } = $props();

  const formatTime = (value: unknown) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'long' }).format(
      new Date(String(value))
    );
  const groups = $derived([
    { title: 'Overdue', items: data.overdue },
    { title: 'Unhandled inbound', items: data.inbound },
    { title: 'Due today', items: data.due }
  ]);
</script>

<svelte:head><title>Today · Domain Desk</title></svelte:head>

<article class="workspace-page">
  <div class="mx-auto max-w-6xl">
    <header class="flex flex-wrap items-end justify-between gap-4 pb-8">
      <div>
        <p class="text-sm text-muted">Your daily workspace <span class="mx-2">/</span> {data.today} · UTC</p>
        <h1 class="mt-3 text-4xl font-semibold tracking-tight min-[720px]:text-5xl">Today</h1>
        <p class="mt-4 text-base text-muted">Conversations to pick up. Commitments to keep.</p>
      </div>
      <a href="/inbox" class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-teal"
        >Open Inbox <Icon name="arrow" size={16} /></a
      >
    </header>
    <div class="flex flex-wrap gap-x-8 gap-y-3 border-y border-line py-4" aria-label="Current action queues">
      {#each groups as group, i}
        <a href={`#queue-${i}`} class="inline-flex min-h-8 items-center gap-3 text-sm no-underline hover:text-teal">
          <span>{group.title}</span><strong
            class={`tabular-nums ${i === 0 && group.items.length ? 'text-copper-dark' : 'text-ink'}`}
            >{group.items.length}</strong
          >
        </a>
      {/each}
    </div>

    {#if form?.message}<p role="alert" class="my-4 text-copper-dark">{form.message}</p>{/if}

    {#if !data.overdue.length && !data.due.length && !data.inbound.length}
      <section class="mt-12 border-l-2 border-copper pl-6">
        <h2 class="font-reading text-2xl">Nothing needs attention</h2>
        <a class="text-teal underline" href="/inbox">Review Inbox</a>
      </section>
    {/if}

    <div class="mt-9 grid items-start gap-10 min-[1250px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <section id="queue-1" class="min-w-0 scroll-mt-6">
        <div class="mb-6 flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-[6px] bg-sidebar-soft text-teal"
            ><Icon name="inbox" size={20} /></span
          >
          <div>
            <h2 class="text-xl font-semibold">Waiting for your attention</h2>
            <p class="mt-1 text-sm text-muted">Unhandled inbound · Oldest activity first</p>
          </div>
        </div>
        <ul class="grid list-none gap-4 p-0">
          {#each data.inbound as item}
            <li class="rounded-[6px] border border-line bg-paper p-5 min-[720px]:p-6">
              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span class="font-medium"
                  >{item.sender_name || item.sender_address || item.display_name || item.contact_email}</span
                >
                <span class="text-muted">{item.product}</span>
              </div>
              <h3 class="mt-5 text-xl leading-snug font-semibold">
                <a class="hover:text-teal" href={`/conversations/${item.id}`}>{item.subject || 'No subject'}</a>
              </h3>
              <p class="mt-3 line-clamp-2 text-base leading-relaxed text-muted">
                {item.preview || 'No plain-text preview. Open the conversation to read its details.'}
              </p>
              <p class="mt-3 text-xs text-muted">{item.sender_address || item.contact_email} → {item.mailbox}</p>
              <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <time class="text-xs text-muted" datetime={String(item.updated_at)}>{formatTime(item.updated_at)}</time>
                <a
                  href={`/conversations/${item.id}`}
                  class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal"
                  aria-label={`Open conversation: ${item.subject || 'No subject'}`}
                  >Open conversation <Icon name="arrow" size={16} /></a
                >
              </div>
            </li>
          {:else}
            <li class="rounded-[6px] border border-line bg-paper p-6">
              <h3 class="text-lg font-medium">You’re caught up.</h3>
              <p class="mt-2 text-sm text-muted">No unhandled inquiries. Your next actions stay available alongside.</p>
            </li>
          {/each}
        </ul>
      </section>
      <div
        class="min-w-0 border-t border-line pt-6 min-[1250px]:border-t-0 min-[1250px]:border-l min-[1250px]:pl-8 min-[1250px]:pt-0"
      >
        <h2 class="text-xl font-semibold">Follow-through</h2>
        <p class="mt-2 text-sm text-muted">Explicit next steps. Nothing closes automatically.</p>
        {#each groups.filter((group) => group.title !== 'Unhandled inbound') as group}
          <section id={`queue-${groups.indexOf(group)}`} class="mt-7 scroll-mt-6">
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              {group.title}<span class="rounded bg-sidebar px-2 py-0.5 text-xs text-muted">{group.items.length}</span>
            </h3>
            {#if group.title === 'Due today'}<p class="mt-2 text-xs leading-relaxed text-muted">
                Also includes undated actions and designated opportunity next steps.
              </p>{/if}
            {#if !group.items.length}<p
                class="mt-3 rounded-xl border border-dashed border-line-strong p-5 text-sm text-muted"
              >
                {group.title === 'Overdue'
                  ? 'All clear. No overdue actions.'
                  : group.title === 'Due today'
                    ? 'Nothing scheduled for today.'
                    : 'You’re all caught up on inbound.'}
              </p>{/if}
            <ul class="mt-3 list-none divide-y divide-line border-y border-line p-0 empty:hidden">
              {#each group.items as item}
                <li class="py-4">
                  <a
                    class="font-semibold text-ink"
                    href={item.description
                      ? item.source_type === 'conversation'
                        ? `/conversations/${item.source_id}`
                        : `/contacts/${item.contact_id}`
                      : `/conversations/${item.id}`}>{item.description || item.subject || 'No subject'}</a
                  >
                  <p class="mt-2 text-sm text-muted">
                    {item.product
                      ? [item.product, item.domain, item.mailbox].join(' · ')
                      : item.display_name || item.contact_email}
                  </p>
                  {#if item.due_at || item.updated_at}
                    <time class="text-xs text-muted" datetime={String(item.due_at || item.updated_at)}
                      >{formatTime(item.due_at || item.updated_at)}</time
                    >
                  {:else}
                    <span class="text-xs text-muted">No due date</span>
                  {/if}

                  {#if item.description && item.opportunity_id && item.is_designated}
                    <p class="mt-3 text-sm leading-relaxed">
                      Designated action for <a class="underline" href={'/opportunities/' + item.opportunity_id}
                        >{item.opportunity_title}</a
                      >. Complete or cancel it together with its replacement or outcome.
                    </p>
                    <details class="mt-3 rounded-lg border border-line bg-paper p-3" open={Boolean(form?.message)}>
                      <summary class="min-h-8 cursor-pointer text-sm font-medium text-teal"
                        >Update next step or record outcome</summary
                      >
                      <div class="mt-4 grid items-start gap-5">
                        <form class="grid gap-2" method="POST" action="?/action">
                          <h3 class="text-sm font-semibold">Complete and continue</h3>
                          <input type="hidden" name="id" value={item.id} />
                          <label
                            >Replacement action<input
                              required
                              name="replacement"
                              class="w-full rounded border border-line px-2 py-1"
                            /></label
                          >
                          <button
                            name="command"
                            value="complete"
                            class="justify-self-start rounded bg-teal px-3 py-2 text-xs font-bold text-white"
                            >Complete and replace</button
                          >
                        </form>
                        <form class="grid gap-2" method="POST" action="?/action">
                          <h3 class="text-sm font-semibold">Cancel and replace</h3>
                          <input type="hidden" name="id" value={item.id} />
                          <label
                            >Replacement action<input
                              required
                              name="replacement"
                              class="w-full rounded border border-line px-2 py-1"
                            /></label
                          >
                          <label
                            >Cancellation reason<input
                              required
                              name="reason"
                              class="w-full rounded border border-line px-2 py-1"
                            /></label
                          >
                          <button
                            name="command"
                            value="cancel"
                            class="justify-self-start rounded border border-line px-3 py-2 text-xs"
                            >Cancel and replace</button
                          >
                        </form>
                        <form class="grid gap-2" method="POST" action="?/action">
                          <h3 class="text-sm font-semibold">Close the opportunity</h3>
                          <input type="hidden" name="id" value={item.id} />
                          <label
                            >Outcome reason<textarea
                              required
                              name="outcomeReason"
                              class="w-full rounded border border-line px-2 py-1"></textarea></label
                          >
                          <div>
                            <button name="exit" value="won" class="rounded bg-copper px-3 py-2 text-xs text-white"
                              >Complete as won</button
                            >
                          </div>
                          <input type="hidden" name="command" value="complete" />
                          <button
                            name="exit"
                            value="lost"
                            class="justify-self-start rounded border border-line px-3 py-2 text-xs"
                            >Complete as lost</button
                          >
                        </form>
                      </div>
                    </details>
                  {:else if item.description}
                    <details class="mt-3" open={Boolean(form?.message)}>
                      <summary class="min-h-11 cursor-pointer py-2 text-sm font-medium text-teal"
                        >Manage next action</summary
                      >
                      <div class="mt-3 flex flex-wrap gap-2">
                        <form method="POST" action="?/action">
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            name="command"
                            value="complete"
                            class="rounded bg-teal px-3 py-2 text-xs font-bold text-white">Complete</button
                          >
                        </form>
                        <form class="flex flex-wrap gap-2" method="POST" action="?/action">
                          <input type="hidden" name="id" value={item.id} />
                          <input
                            required
                            aria-label="New due time UTC"
                            type="datetime-local"
                            name="due"
                            class="rounded border border-line px-2 text-xs"
                          />
                          <button name="command" value="reschedule" class="rounded border border-line px-3 py-2 text-xs"
                            >Reschedule</button
                          >
                        </form>
                        <form class="flex flex-wrap gap-2" method="POST" action="?/action">
                          <input type="hidden" name="id" value={item.id} />
                          <input
                            required
                            name="reason"
                            aria-label="Cancellation reason"
                            placeholder="Cancellation reason"
                            class="rounded border border-line px-2 text-xs"
                          />
                          <button name="command" value="cancel" class="rounded border border-line px-3 py-2 text-xs"
                            >Cancel</button
                          >
                        </form>
                      </div>
                    </details>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </div>
</article>
