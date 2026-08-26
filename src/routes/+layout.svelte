<script lang="ts">
  import '../styles.css';
  import Nav from '$lib/Nav.svelte';
  import { page } from '$app/state';

  let { children } = $props();
  let goPending = false;

  function keys(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return;
    if (goPending && (event.key === 'i' || event.key === 's')) {
      location.href = event.key === 'i' ? '/inbox' : '/settings';
      goPending = false;
      return;
    }
    if (event.key === 'g') {
      goPending = true;
      setTimeout(() => (goPending = false), 900);
      return;
    }
    if (event.key === '/') {
      event.preventDefault();
      document.querySelector<HTMLInputElement>('[name=q]')?.focus();
    }
    if (event.key === '?') document.querySelector<HTMLDialogElement>('#key-help')?.showModal();
  }
</script>

<svelte:window onkeydown={keys} />

<div class="min-h-screen min-[1120px]:grid min-[1120px]:grid-cols-[220px_minmax(0,1fr)]">
  <aside class="sticky top-0 hidden h-screen flex-col bg-sidebar px-4 py-6 text-paper min-[1120px]:flex">
    <a class="font-bold tracking-[0.01em] no-underline" href="/today">
      Domain CRM
      <small class="mt-1 block text-[0.72rem] font-normal text-[#bbbdb6]">Inbound operations desk</small>
    </a>
    <nav class="mt-8 grid gap-1" aria-label="Primary">
      <a
        class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/today') ? 'bg-sidebar-soft text-white' : 'text-[#e8e5dc] hover:bg-white/6'}`}
        aria-current={page.url.pathname.startsWith('/today') ? 'page' : undefined}
        href="/today">Today</a
      >
      <a
        class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/inbox') || page.url.pathname.startsWith('/conversations') ? 'bg-sidebar-soft text-white' : 'text-[#e8e5dc] hover:bg-white/6'}`}
        aria-current={page.url.pathname.startsWith('/inbox') || page.url.pathname.startsWith('/conversations')
          ? 'page'
          : undefined}
        href="/inbox">Inbox</a
      >
      <a
        class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/contacts') ? 'bg-sidebar-soft text-white' : 'text-[#e8e5dc] hover:bg-white/6'}`}
        aria-current={page.url.pathname.startsWith('/contacts') ? 'page' : undefined}
        href="/contacts">Contacts</a
      >
      <a
        class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/opportunities') ? 'bg-sidebar-soft text-white' : 'text-[#e8e5dc] hover:bg-white/6'}`}
        aria-current={page.url.pathname.startsWith('/opportunities') ? 'page' : undefined}
        href="/opportunities">Opportunities</a
      >
      <a
        class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/settings') ? 'bg-sidebar-soft text-white' : 'text-[#e8e5dc] hover:bg-white/6'}`}
        aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
        href="/settings">Settings</a
      >
    </nav>
    <p class="mt-auto text-xs leading-relaxed text-[#d7d5cc]">
      Self-hosted · Cloudflare<br /><span class="text-[#aeb4af]">D1 + R2 · Access protected</span>
    </p>
  </aside>

  <div class="grid min-h-screen grid-rows-[56px_minmax(0,1fr)] min-[1120px]:contents">
    <header class="flex items-center justify-between border-b border-line bg-paper px-4 min-[1120px]:hidden">
      <Nav />
      <a class="font-bold tracking-[0.01em] no-underline" href="/inbox">Domain CRM</a>
      <button
        class="grid size-8 place-items-center rounded-full border border-line bg-transparent text-sm font-bold text-ink hover:bg-paper-soft"
        aria-label="Keyboard shortcuts"
        onclick={() => document.querySelector<HTMLDialogElement>('#key-help')?.showModal()}>?</button
      >
    </header>
    <main
      class="min-w-0 min-[720px]:grid min-[720px]:h-[calc(100vh-56px)] min-[720px]:grid-cols-[330px_minmax(0,1fr)] min-[1120px]:h-screen min-[1120px]:grid-cols-[minmax(320px,370px)_minmax(0,1fr)]"
    >
      {@render children()}
    </main>
  </div>
</div>

<dialog
  id="key-help"
  class="m-auto w-[min(90vw,26rem)] rounded-lg border border-line bg-paper p-6 text-ink shadow-drawer"
>
  <p class="mb-1 text-[0.68rem] font-extrabold tracking-[0.14em] text-copper uppercase">Navigation</p>
  <h2 class="font-reading text-2xl font-semibold">Keyboard shortcuts</h2>
  <dl class="my-6 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-3 text-sm">
    <dt class="font-bold">/</dt>
    <dd>Focus Inbox search</dd>
    <dt class="font-bold">?</dt>
    <dd>Open this help</dd>
    <dt class="font-bold">g then i / s</dt>
    <dd>Go to Inbox / Settings</dd>
  </dl>
  <form method="dialog" class="text-right">
    <button
      class="rounded-md border border-teal-dark bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark"
      >Close</button
    >
  </form>
</dialog>
