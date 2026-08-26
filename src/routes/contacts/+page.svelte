<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Contacts · Domain CRM</title></svelte:head>

<article class="col-span-full overflow-auto px-5 py-8 min-[720px]:px-10">
  <div class="mx-auto max-w-4xl">
    <h1 class="font-reading text-4xl font-semibold">Contacts</h1>
    <form class="my-6 flex gap-2" aria-label="Search contacts">
      <label class="sr-only" for="contact-search">Name or email</label>
      <input
        id="contact-search"
        class="min-w-0 flex-1 rounded border border-line bg-white px-3 py-2"
        name="q"
        value={data.q}
        placeholder="Search name or email"
      />
      <button class="rounded bg-teal px-4 py-2 text-white">Search</button>
    </form>
    {#if !data.rows.length}
      <section class="border-l-2 border-copper pl-5">
        <h2 class="font-reading text-xl">{data.q ? 'No matching contacts' : 'No contacts yet'}</h2>
        <p class="text-muted">
          {data.q ? 'Try another name or email.' : 'Contacts appear when verified inbound mail arrives.'}
        </p>
        {#if data.q}<a class="text-teal underline" href="/contacts">Clear search</a>{:else}<a
            class="text-teal underline"
            href="/inbox">Go to Inbox</a
          >{/if}
      </section>
    {:else}
      <ul class="list-none divide-y divide-line p-0">
        {#each data.rows as contact}
          <li>
            <a
              class="block px-1 py-4 no-underline focus-visible:outline-2 focus-visible:outline-teal"
              href={'/contacts/' + contact.id}
            >
              <strong>{contact.display_name || contact.primary_email}</strong>
              <p class="text-sm text-muted">
                {contact.primary_email} · {contact.products} product(s) · {contact.open_actions} open action(s)
              </p>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</article>
