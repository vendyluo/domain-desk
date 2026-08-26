<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Opportunities · Domain CRM</title></svelte:head>
<section class="col-span-full overflow-auto px-5 py-8 min-[720px]:px-10">
  <div class="mx-auto max-w-6xl">
    <h1 class="font-reading text-4xl">Opportunities</h1>
    <p class="text-muted">Concrete intent, evidence, and one explicit next step.</p>
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
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <thead
            ><tr class="border-b border-line"
              ><th class="p-3">Opportunity</th><th>Contact</th><th>Product / domain</th><th>State</th><th>Value</th><th
                >Next action</th
              ></tr
            ></thead
          ><tbody
            >{#each data.opportunities as o}<tr class="border-b border-line"
                ><td class="p-3"
                  ><a class="font-semibold text-teal underline" href={'/opportunities/' + o.id}>{o.title}</a></td
                ><td>{o.display_name || o.contact_email}</td><td>{o.product} · {o.domain}</td><td>{o.state}</td><td
                  >{o.value_minor === null ? '—' : `${o.value_minor} ${o.currency}`}</td
                ><td>{o.next_action || '—'}</td></tr
              >{/each}</tbody
          >
        </table>
      </div>{/if}
  </div>
</section>
