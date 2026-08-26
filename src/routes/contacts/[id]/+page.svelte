<script lang="ts">
  let { data, form } = $props();
  const date = (value: unknown) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(value)));
  const preview: any = $derived(data.mergePreview);
</script>

<svelte:head><title>{data.contact.display_name || data.contact.primary_email} · Contacts</title></svelte:head>

<article class="col-span-full overflow-auto px-5 py-8 min-[720px]:px-10">
  <div class="mx-auto max-w-4xl">
    <a href="/contacts" class="text-teal underline">← Contacts</a>
    <h1 class="mt-4 font-reading text-4xl">{data.contact.display_name || data.contact.primary_email}</h1>
    <p class="text-muted">Primary: {data.contact.primary_email}</p>
    {#if data.mergedAlias}<p role="status" class="my-4 border-l-2 border-copper pl-4">
        Merged alias <code>{data.mergedAlias}</code> now belongs to this contact.
      </p>{/if}
    {#if form?.message}<p role="alert" class="my-4 text-copper-dark">{form.message}</p>{/if}

    <section class="my-8 border-t border-line pt-5">
      <h2 class="font-reading text-2xl">Identity</h2>
      <form method="POST" action="?/rename" class="mt-3 flex flex-wrap gap-2">
        <label class="sr-only" for="display-name">Display name</label>
        <input
          id="display-name"
          required
          maxlength="200"
          name="displayName"
          value={data.contact.display_name || ''}
          class="min-w-0 flex-1 rounded border border-line px-3 py-2"
        />
        <button class="rounded bg-teal px-4 py-2 text-white">Save name</button>
      </form>
      <form method="POST" action="?/primary" class="mt-3 flex flex-wrap gap-2">
        <label for="primary-email" class="self-center font-semibold">Primary email</label>
        <select id="primary-email" name="emailId" class="min-w-0 flex-1 rounded border border-line bg-white px-3 py-2">
          {#each data.addresses as address}<option value={address.id} selected={address.is_primary === 1}
              >{address.address}</option
            >{/each}
        </select>
        <button class="rounded border border-line px-4 py-2">Choose primary</button>
      </form>
    </section>

    <section class="my-8 border-t border-line pt-5">
      <h2 class="font-reading text-2xl">Merge a duplicate</h2>
      <p class="text-sm text-muted">
        Exact normalized email resolves identity automatically. Similar names are never merged automatically.
      </p>
      <form method="GET" class="mt-3 flex flex-wrap gap-2">
        <label for="duplicate">Duplicate contact ID</label>
        <input
          id="duplicate"
          required
          name="duplicate"
          value={preview?.duplicate?.id || ''}
          class="min-w-0 flex-1 rounded border border-line px-3 py-2"
        />
        <button class="rounded border border-line px-4 py-2">Preview merge</button>
      </form>
      {#if preview?.error}<p role="alert" class="text-copper-dark">{preview.error}</p>{/if}
      {#if preview?.duplicate}
        <div class="mt-4 border-l-2 border-copper pl-4">
          <h3 class="font-semibold">
            Confirm merge into {preview.survivor.display_name || preview.survivor.primary_email}
          </h3>
          <p>Duplicate: {preview.duplicate.display_name || preview.duplicate.primary_email}</p>
          <p>Addresses moved: {preview.addresses.map((address: { address: string }) => address.address).join(', ')}</p>
          <p>
            Affected: {preview.counts.conversations} conversations, {preview.counts.messages} messages, {preview.counts
              .next_actions} next actions, {preview.counts.activity_events} history events.
          </p>
          <p class="text-sm text-muted">
            Original message mailbox/product/domain attribution is unchanged. The duplicate remains an auditable alias
            and the recorded relation snapshot supports a future explicit inverse operation.
          </p>
          <form method="POST" action="?/merge" class="mt-3 grid gap-2">
            <input type="hidden" name="duplicateId" value={preview.duplicate.id} />
            <label for="confirmation">Type the duplicate ID <code>{preview.duplicate.id}</code> to confirm</label>
            <input
              id="confirmation"
              required
              name="confirmation"
              autocomplete="off"
              class="rounded border border-line px-3 py-2"
            />
            <button class="justify-self-start rounded bg-copper px-4 py-2 font-semibold text-white"
              >Merge duplicate</button
            >
          </form>
        </div>
      {/if}
    </section>

    <section class="my-8 border-t border-line pt-5">
      <h2 class="font-reading text-2xl">Add next action</h2>
      <form method="POST" action="?/create" class="mt-3 grid gap-2 min-[600px]:grid-cols-[1fr_auto_auto]">
        <input
          required
          maxlength="500"
          name="description"
          aria-label="Next action description"
          placeholder="What needs to happen?"
          class="rounded border border-line px-3 py-2"
        />
        <input
          aria-label="Due time UTC (optional)"
          name="due"
          type="datetime-local"
          class="rounded border border-line px-3 py-2"
        />
        <button class="rounded bg-teal px-4 text-white">Add</button>
      </form>
    </section>

    <section class="my-8 border-t border-line pt-5">
      <h2 class="font-reading text-2xl">Create opportunity</h2>
      {#if data.conversations.length}
        <p class="text-sm text-muted">Choose the inbound conversation that proves this commercial intent.</p>
        <form method="POST" action="?/opportunity" class="mt-3 grid max-w-xl gap-3">
          <label for="evidence">Evidence conversation</label>
          <select id="evidence" required name="conversationId" class="rounded border border-line bg-white p-2">
            {#each data.conversations as conversation}
              <option value={conversation.id}
                >{conversation.subject || 'No subject'} · {conversation.product} · {conversation.domain} · {conversation.mailbox}</option
              >
            {/each}
          </select>
          <label for="opportunity-title">Title</label>
          <input id="opportunity-title" required maxlength="200" name="title" class="rounded border border-line p-2" />
          <label for="desired-outcome">Desired outcome</label>
          <textarea
            id="desired-outcome"
            required
            maxlength="500"
            name="desiredOutcome"
            class="rounded border border-line p-2"></textarea>
          <div class="grid grid-cols-2 gap-3">
            <label
              >Value in minor units (optional)<input
                type="number"
                min="0"
                step="1"
                name="valueMinor"
                class="w-full rounded border border-line p-2"
              /></label
            >
            <label
              >Currency (with value)<input
                name="currency"
                maxlength="3"
                pattern="[A-Z]{3}"
                class="w-full rounded border border-line p-2 uppercase"
              /></label
            >
          </div>
          <button class="justify-self-start rounded bg-copper px-4 py-2 text-white">Create opportunity</button>
        </form>
      {:else}
        <p class="text-muted">
          No evidence conversations exist for this contact. Receive or open a real Inbox conversation first.
        </p>
      {/if}
    </section>

    <section>
      <h2 class="font-reading text-2xl">Next actions</h2>
      {#if !data.actions.length}<p class="text-muted">No next actions.</p>{/if}
      {#each data.actions as action}<div class="my-2 border-l-2 border-copper pl-3">
          <strong>{action.description}</strong> · {action.status}
        </div>{/each}
    </section>
    <section class="mt-8">
      <h2 class="font-reading text-2xl">Inbound timeline</h2>
      {#if !data.messages.length}<p class="text-muted">No inbound history.</p>{/if}
      {#each data.messages as message}
        <article class="my-4 border-t border-line pt-4">
          <time class="text-xs text-muted">{date(message.received_at)}</time><a
            class="block font-semibold"
            href={'/conversations/' + message.conversation_id}>{message.subject || 'No subject'}</a
          >
          <p class="text-xs text-teal">{message.product} · {message.domain} · {message.mailbox}</p>
          <p class="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{message.text_body || 'No plain text'}</p>
        </article>
      {/each}
    </section>
    <details class="mt-8">
      <summary>Activity history ({data.events.length})</summary>{#each data.events as event}<p class="my-2 text-sm">
          {date(event.occurred_at)} · {event.event_type} · {event.actor}{event.reason ? ' · ' + event.reason : ''}
        </p>{/each}
    </details>
  </div>
</article>
