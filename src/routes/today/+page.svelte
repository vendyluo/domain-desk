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

<svelte:head><title>Today · Domain Desk</title></svelte:head>

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
                    : `/conversations/${item.id}`}>{item.description || item.subject || 'No subject'}</a
                >
                <p class="mt-1 text-xs text-teal">
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
                  <p class="mt-2 text-sm">
                    Designated action for <a class="underline" href={'/opportunities/' + item.opportunity_id}
                      >{item.opportunity_title}</a
                    >. Complete or cancel it together with its replacement or outcome.
                  </p>
                  <div class="mt-3 grid gap-3 min-[700px]:grid-cols-2">
                    <form class="grid gap-2" method="POST" action="?/action">
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
                        class="justify-self-start rounded border border-line px-3 py-2 text-xs">Complete as lost</button
                      >
                    </form>
                  </div>
                {:else if item.description}
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
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>
</article>
