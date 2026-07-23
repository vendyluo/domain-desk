<script lang="ts">
  let { data, form } = $props();
  const opportunity: any = $derived(data.opportunity);
</script>

<svelte:head><title>{opportunity.title} · Opportunities</title></svelte:head>

<article class="col-span-full overflow-auto px-5 py-8 min-[720px]:px-10">
  <div class="mx-auto max-w-4xl">
    <a href="/opportunities" class="text-teal underline">← Opportunities</a>
    <h1 class="mt-4 font-reading text-4xl">{opportunity.title}</h1>
    <p>{opportunity.state} · <a href={'/contacts/' + opportunity.contact_id}>{opportunity.display_name || opportunity.contact_email}</a> · {opportunity.product} / {opportunity.domain}</p>
    <h2 class="mt-8 font-reading text-2xl">Desired outcome</h2>
    <p>{opportunity.desired_outcome}</p>
    {#if opportunity.outcome_reason}<p><strong>Outcome:</strong> {opportunity.outcome_reason} · {opportunity.outcome_at}</p>{/if}
    {#if form?.message}<p role="alert" class="text-copper-dark">{form.message}</p>{/if}

    {#if opportunity.state !== 'archived'}
      <section class="mt-8 border-t border-line pt-5">
        <h2 class="font-reading text-2xl">Lifecycle</h2>
        {#if opportunity.state === 'new'}
          <form method="POST" action="?/transition"><button name="command" value="qualify" class="rounded bg-copper px-4 py-2 text-white">Qualify</button></form>
        {:else if opportunity.state === 'qualified'}
          <form method="POST" action="?/transition" class="grid max-w-lg gap-2">
            <label for="activate-action">Required next action</label>
            <input id="activate-action" required name="nextAction" class="rounded border p-2" />
            <button name="command" value="activate" class="justify-self-start rounded bg-copper px-4 py-2 text-white">Activate</button>
          </form>
        {:else if opportunity.state === 'active'}
          <div class="grid gap-5 min-[700px]:grid-cols-2">
            <form method="POST" action="?/transition" class="grid gap-2">
              <label for="won-reason">Why was it won?</label>
              <textarea id="won-reason" required name="reason" class="rounded border p-2"></textarea>
              <button name="command" value="win" class="justify-self-start rounded bg-copper px-4 py-2 text-white">Mark won</button>
            </form>
            <form method="POST" action="?/transition" class="grid gap-2">
              <label for="lost-reason">Why was it lost?</label>
              <textarea id="lost-reason" required name="reason" class="rounded border p-2"></textarea>
              <button name="command" value="lose" class="justify-self-start rounded border border-line px-4 py-2">Mark lost</button>
            </form>
          </div>
        {:else}
          <div class="grid gap-5 min-[700px]:grid-cols-2">
            <form method="POST" action="?/transition" class="grid gap-2">
              <label for="reopen-action">Required next action</label>
              <input id="reopen-action" required name="nextAction" class="rounded border p-2" />
              <button name="command" value="reopen" class="justify-self-start rounded bg-copper px-4 py-2 text-white">Reopen</button>
            </form>
            <form method="POST" action="?/transition">
              <button name="command" value="archive" class="rounded border border-line px-4 py-2">Archive</button>
            </form>
          </div>
        {/if}
      </section>
    {/if}

    <section class="mt-8"><h2 class="font-reading text-2xl">Evidence</h2>
      {#each data.evidence as evidence}
        <p><a class="text-teal underline" href={'/conversations/' + evidence.conversation_id}>{evidence.subject || 'No subject'}</a> · {evidence.product} · {evidence.domain} · {evidence.mailbox}</p>
      {/each}
    </section>
    <section class="mt-8"><h2 class="font-reading text-2xl">History</h2>
      {#each data.history as event}<p class="border-t border-line py-2">{event.occurred_at} · {event.event_type} · {event.actor}{event.reason ? ' · ' + event.reason : ''}</p>{/each}
    </section>
  </div>
</article>
