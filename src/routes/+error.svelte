<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status === 404 ? 'Not found' : 'Application error'} · Domain Desk</title></svelte:head>

<section class="col-span-full mx-auto w-full max-w-2xl px-6 py-16 min-[720px]:py-24">
  <p class="mb-2 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Error {page.status}</p>
  <h1 class="font-reading text-3xl font-semibold">
    {page.status === 404 ? 'Conversation not found' : 'Something went wrong'}
  </h1>
  <p class="my-4 text-sm leading-relaxed text-muted">
    {page.status === 404
      ? 'This record does not exist or is no longer available.'
      : 'The request could not be completed. Verify the D1 migration and Worker bindings, then retry.'}
  </p>
  <a
    class="inline-block rounded-md border border-teal-dark bg-teal px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-teal-dark"
    href="/inbox">Return to Inbox</a
  >
</section>
