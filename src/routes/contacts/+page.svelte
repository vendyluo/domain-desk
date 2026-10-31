<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Contacts · Domain Desk</title></svelte:head>

<article class="workspace-page">
  <div class="mx-auto max-w-6xl">
    <p class="eyebrow">03 / Relationship register</p>
    <h1 class="mt-2 border-b border-ink pb-4 text-2xl font-semibold">Contacts</h1>
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
      <ul class="record-list list-none divide-y divide-line p-0">
        {#each data.rows as contact}
          <li>
            <a
              class="flex items-center gap-4 py-5 no-underline focus-visible:outline-2 focus-visible:outline-teal"
              href={'/contacts/' + contact.id}
            >
              <span class="avatar" aria-hidden="true"
                >{Array.from(String(contact.display_name || contact.primary_email || '?'))
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}</span
              >
              <div class="min-w-0 flex-1">
                <strong class="text-sm">{contact.display_name || contact.primary_email}</strong>
                <p class="text-sm text-muted">
                  {contact.primary_email} · {contact.products} product(s) · {contact.open_actions} open action(s)
                </p>
              </div>
              <Icon name="arrow" size={16} />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</article>
