<svelte:head><title>Settings · Domain CRM</title></svelte:head>

<article class="col-span-full min-h-[calc(100vh-56px)] overflow-auto px-5 py-8 min-[720px]:px-10 min-[720px]:py-12 min-[1120px]:min-h-0">
  <div class="mx-auto max-w-3xl">
    <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Deployment</p>
    <h1 class="font-reading text-[2.25rem] leading-tight font-semibold">Settings</h1>
    <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Safety boundaries and runtime requirements for this self-hosted deployment.</p>

    <div class="mt-10 divide-y divide-line border-y border-line">
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Runtime bindings</h2>
        <p class="text-sm leading-relaxed text-ink-soft">This application requires the <code class="rounded bg-paper px-1.5 py-0.5 text-xs">DB</code> D1 and <code class="rounded bg-paper px-1.5 py-0.5 text-xs">ATTACHMENTS</code> R2 bindings. A working page confirms D1 is bound and migration <code class="rounded bg-paper px-1.5 py-0.5 text-xs">0001_initial.sql</code> has the Slice 1 tables.</p>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Access protection</h2>
        <p class="text-sm leading-relaxed text-ink-soft">Production HTTP requests fail closed unless Cloudflare Access supplies a valid JWT for the configured team issuer and audience. <code class="rounded bg-paper px-1.5 py-0.5 text-xs">LOCAL_DEV=true</code> is an explicit local-only bypass and must never be set in production.</p>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Data and recovery</h2>
        <p class="text-sm leading-relaxed text-ink-soft">Retention is currently indefinite. Secrets are never displayed. Full D1 plus referenced R2 export is not included in this migration; use the documented Cloudflare export tooling before destructive cleanup.</p>
      </section>
    </div>
  </div>
</article>
