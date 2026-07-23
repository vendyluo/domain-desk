<script lang="ts">
  let { data, form } = $props();

  const formatTime = (value: unknown) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(value)));
  const groups = $derived([
    { title: 'Overdue', items: data.overdue },
    { title: 'Unhandled inbound', items: data.inbound },
    { title: 'Due today', items: data.due }
  ]);
</script>

<svelte:head><title>Today · Domain CRM</title></svelte:head>

<article class="col-span-full overflow-auto px-5 py-8 min-[720px]:px-10">
  <div class="mx-auto max-w-4xl">
    <p class="text-xs font-bold tracking-widest text-copper uppercase">Action queue · UTC</p>
    <h1 class="font-reading text-4xl font-semibold">Today</h1>

    {#if form?.message}<p role="alert" class="my-4 text-copper-dark">{form.message}</p>{/if}

    {#if !data.overdue.length && !data.due.length && !data.inbound.length}
      <section class="mt-12 border-l-2 border-copper pl-6">
        <h2 class="font-reading text-2xl">Nothing needs attention</h2>
        <a class="text-teal underline" href="/inbox">Review Inbox</a>
      </section>
    {/if}

    {#each groups as group}
      {#if group.items.length}
        <section class="mt-9">
          <h2 class="font-reading text-2xl font-semibold">{group.title}</h2>
          <ul class="mt-3 list-none divide-y divide-line border-y border-line p-0">
            {#each group.items as item}
              <li class="py-4">
                <a
                  class="font-semibold text-ink"
                  href={item.description
                    ? item.source_type === 'conversation'
                      ? `/conversations/${item.source_id}`
                      : `/contacts/${item.contact_id}`
                    : `/conversations/${item.id}`}
                >{item.description || item.subject || 'No subject'}</a>
                <p class="mt-1 text-xs text-teal">
                  {item.product ? [item.product, item.domain, item.mailbox].join(' · ') : item.display_name || item.contact_email}
                </p>
                <time class="text-xs text-muted">{formatTime(item.due_at || item.updated_at)}</time>

                {#if item.description}
                  <div class="mt-3 flex flex-wrap gap-2">
                    <form method="POST" action="?/action">
                      <input type="hidden" name="id" value={item.id} />
                      <button name="command" value="complete" class="rounded bg-teal px-3 py-2 text-xs font-bold text-white">Complete</button>
                    </form>
                    <form class="flex flex-wrap gap-2" method="POST" action="?/action">
                      <input type="hidden" name="id" value={item.id} />
                      <input required aria-label="New due time UTC" type="datetime-local" name="due" class="rounded border border-line px-2 text-xs" />
                      <button name="command" value="reschedule" class="rounded border border-line px-3 py-2 text-xs">Reschedule</button>
                    </form>
                    <form class="flex flex-wrap gap-2" method="POST" action="?/action">
                      <input type="hidden" name="id" value={item.id} />
                      <input required name="reason" aria-label="Cancellation reason" placeholder="Cancellation reason" class="rounded border border-line px-2 text-xs" />
                      <button name="command" value="cancel" class="rounded border border-line px-3 py-2 text-xs">Cancel</button>
                    </form>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>
</article>
