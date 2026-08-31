<script lang="ts">
  let { data } = $props();
  const snippet = (mailbox: { id: string; domain: string }) =>
    `<form action="${data.intakeEmbed.origin}/intake/${mailbox.id}" method="POST">
  <input type="email" name="email" required placeholder="Your email">
  <input name="name" placeholder="Your name">
  <input name="subject" placeholder="Subject">
  <textarea name="message" required placeholder="How can we help?"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <input type="hidden" name="redirect" value="https://${mailbox.domain}/thanks">
  <div class="cf-turnstile" data-sitekey="${data.intakeEmbed.siteKey ?? 'YOUR_TURNSTILE_SITE_KEY'}"></div>
  <button>Send</button>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer><\/script>`;
</script>

<svelte:head><title>Settings · Domain Desk</title></svelte:head>

<article
  class="col-span-full min-h-[calc(100vh-56px)] overflow-auto px-5 py-8 min-[720px]:px-10 min-[720px]:py-12 min-[1120px]:min-h-0"
>
  <div class="mx-auto max-w-3xl">
    <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Deployment</p>
    <h1 class="font-reading text-[2.25rem] leading-tight font-semibold">Settings</h1>
    <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
      Safety boundaries and runtime requirements for this self-hosted deployment.
    </p>

    <div class="mt-10 divide-y divide-line border-y border-line">
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Runtime bindings</h2>
        <div class="text-sm leading-relaxed text-ink-soft">
          <p>
            <strong class={data.database.ready ? 'text-teal-dark' : 'text-copper-dark'}
              >{data.database.ready ? 'Ready' : 'Needs attention'}</strong
            > · D1 binding and schema
          </p>
          <ul class="mt-2 list-none p-0">
            {#each data.database.migrations as migration}
              <li>
                {migration.ready ? '✓' : '✕'}
                {migration.name}{migration.missing.length ? ` — missing ${migration.missing.join(', ')}` : ''}
              </li>
            {/each}
          </ul>
          <p class="mt-3">
            <strong class={data.attachments.ready ? 'text-teal-dark' : 'text-copper-dark'}
              >{data.attachments.ready ? 'Ready' : 'Unavailable'}</strong
            >
            · R2 <code class="rounded bg-paper px-1.5 py-0.5 text-xs">ATTACHMENTS</code> binding (read-only probe)
          </p>
        </div>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Outbound replies</h2>
        <div class="text-sm leading-relaxed text-ink-soft">
          <p>
            <strong class={data.outbound.configured ? 'text-teal-dark' : 'text-copper-dark'}
              >{data.outbound.configured ? 'Configured' : 'Not configured'}</strong
            >
            · <code class="rounded bg-paper px-1.5 py-0.5 text-xs">EMAIL</code> send binding
          </p>
          <p class="mt-2">
            Replies send through Cloudflare Email Service from the conversation's mailbox address. Each send is recorded
            before delivery and every outcome — sent, failed, or unconfirmed — stays visible on the message.
          </p>
        </div>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Form intake</h2>
        <div class="text-sm leading-relaxed text-ink-soft">
          <p>
            <strong class={data.intake.configured ? 'text-teal-dark' : 'text-copper-dark'}
              >{data.intake.configured ? 'Configured' : 'Not configured'}</strong
            >
            · Turnstile server verification
          </p>
          <p class="mt-2">
            <code class="rounded bg-paper px-1.5 py-0.5 text-xs">POST /intake/&lt;mailbox&gt;</code> is the only unauthenticated
            route. Every submission must pass Turnstile and originate from the mailbox's own domain; nothing submitted is
            ever echoed back.
          </p>
          {#each data.intakeEmbed.mailboxes as mailbox}
            <details class="mt-3">
              <summary class="cursor-pointer font-semibold">Embed snippet for {mailbox.address}</summary>
              <pre class="mt-2 overflow-x-auto rounded border border-line bg-paper p-3 text-xs leading-relaxed"><code
                  >{snippet(mailbox)}</code
                ></pre>
            </details>
          {/each}
        </div>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Access protection</h2>
        <div class="text-sm leading-relaxed text-ink-soft">
          <p>
            <strong class={data.access.configured ? 'text-teal-dark' : 'text-copper-dark'}
              >{data.access.configured ? 'Configured' : 'Needs attention'}</strong
            >
            · {data.access.mode}
          </p>
          <p class="mt-2">
            Production HTTP requests fail closed unless Cloudflare Access supplies a valid JWT for the configured team
            issuer and audience. <code class="rounded bg-paper px-1.5 py-0.5 text-xs">LOCAL_DEV=true</code> is an explicit
            local-only bypass and must never be set in production.
          </p>
        </div>
      </section>
      <section class="grid gap-2 py-6 min-[720px]:grid-cols-[180px_minmax(0,1fr)] min-[720px]:gap-8">
        <h2 class="font-reading text-lg font-semibold">Data and recovery</h2>
        <p class="text-sm leading-relaxed text-ink-soft">
          Retention is currently indefinite and permanent deletion is not available in the CRM. Run the documented
          read-only <code class="rounded bg-paper px-1.5 py-0.5 text-xs">npm run backup</code> command before destructive
          resource cleanup. It exports D1, downloads only D1-referenced R2 objects, verifies each size and SHA-256 hash, and
          writes a manifest. Secrets and unreferenced objects are not included.
        </p>
      </section>
    </div>
  </div>
</article>
