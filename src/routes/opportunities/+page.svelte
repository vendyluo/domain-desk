<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Opportunities · Domain Desk</title></svelte:head>
<section class="workspace-page">
  <div class="mx-auto max-w-6xl">
    <p class="eyebrow">04 / Commercial intent</p>
    <h1 class="mt-2 border-b border-ink pb-4 text-2xl font-semibold">Opportunities</h1>
    <p class="mt-2 text-sm text-muted">Concrete intent, evidence, and one explicit next step.</p>
    <form class="my-6 flex gap-2">
      <label for="state" class="self-center font-semibold">State</label><select
        id="state"
        name="state"
        class="rounded border border-line bg-white px-3 py-2"
        ><option value="">All</option>{#each ['new', 'qualified', 'active', 'won', 'lost', 'archived'] as state}<option
            value={state}
            selected={data.state === state}>{state}</option
          >{/each}</select
      ><button class="rounded bg-teal px-4 text-white">Filter</button>
    </form>
    {#if data.error}<p role="alert">{data.error}</p>{:else if !data.opportunities.length}<p
        class="border-t border-line py-8 text-muted"
      >
        {data.state
          ? 'No opportunities match this filter. Choose All to reset.'
          : 'No opportunities yet. Open an Inbox conversation with real evidence to create one.'}
      </p>{:else}
      <ul class="record-list list-none divide-y divide-line p-0 min-[720px]:hidden">
        {#each data.opportunities as o}
          <li class="py-5">
            <span class="status-pill mb-3">{o.state}</span>
            <a class="block text-sm font-semibold text-teal underline" href={'/opportunities/' + o.id}>{o.title}</a>
            <dl class="mt-3 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt class="text-muted">Contact</dt>
              <dd>{o.display_name || o.contact_email}</dd>
              <dt class="text-muted">Product</dt>
              <dd>{o.product} · {o.domain}</dd>
              <dt class="text-muted">Value</dt>
              <dd>{o.value_minor === null ? '—' : `${o.value_minor} ${o.currency}`}</dd>
              <dt class="text-muted">Next action</dt>
              <dd>{o.next_action || '—'}</dd>
            </dl>
          </li>
        {/each}
      </ul>
      <div class="hidden overflow-x-auto rounded-xl border border-line bg-paper min-[720px]:block">
        <table class="w-full border-collapse text-left text-sm">
          <thead
            ><tr class="border-b border-line bg-paper-soft text-xs text-muted"
              ><th class="p-3">Opportunity</th><th>Contact</th><th>Product / domain</th><th>State</th><th>Value</th><th
                >Next action</th
              ></tr
            ></thead
          ><tbody
            >{#each data.opportunities as o}<tr class="border-b border-line hover:bg-paper-soft"
                ><td class="p-3"
                  ><a class="font-semibold text-teal underline" href={'/opportunities/' + o.id}>{o.title}</a></td
                ><td>{o.display_name || o.contact_email}</td><td>{o.product} · {o.domain}</td><td
                  ><span class="status-pill">{o.state}</span></td
                ><td>{o.value_minor === null ? '—' : `${o.value_minor} ${o.currency}`}</td><td
                  >{o.next_action || '—'}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>{/if}
  </div>
</section>
