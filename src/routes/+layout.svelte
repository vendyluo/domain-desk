<script lang="ts">
  import '../styles.css';
  import Nav from '$lib/Nav.svelte';
  import { page } from '$app/state';

  let { children } = $props();
  let goPending = false;
  const links = [
    { href: '/today', label: 'Today', icon: 'today' },
    { href: '/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/contacts', label: 'Contacts', icon: 'contacts' },
    { href: '/opportunities', label: 'Opportunities', icon: 'opportunities' },
    { href: '/settings', label: 'Settings', icon: 'settings' }
  ] as const;
  const active = (href: string) =>
    page.url.pathname.startsWith(href) || (href === '/inbox' && page.url.pathname.startsWith('/conversations'));
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
<a href="#main-content" class="skip-link">Skip to content</a>
<div class="min-h-screen">
  <header class="flex min-h-20 items-center justify-between gap-6 border-b border-line bg-paper px-4 min-[720px]:px-8">
    <div class="min-[1120px]:hidden"><Nav /></div>
    <a
      class="flex shrink-0 items-center gap-3 text-base font-semibold tracking-tight"
      href="/today"
      aria-label="Domain Desk Inbound operations desk"
    >
      <span aria-hidden="true" class="hidden h-4 w-3 border-x-[4px] border-teal min-[400px]:block"></span>Domain Desk
    </a>
    <nav class="hidden self-stretch min-[1120px]:flex" aria-label="Primary">
      {#each links as link}
        <a
          class={`flex items-center border-b-2 px-5 text-sm ${active(link.href) ? 'border-teal font-semibold text-teal' : 'border-transparent text-muted hover:text-ink'}`}
          aria-current={active(link.href) ? 'page' : undefined}
          href={link.href}>{link.label}</a
        >
      {/each}
    </nav>
    <div class="flex items-center gap-5">
      <span class="hidden font-mono text-[10px] text-muted min-[720px]:inline">PERSONAL · UTC</span><button
        class="size-10 border border-line font-mono text-xs text-muted hover:border-ink"
        aria-label="Keyboard shortcuts"
        onclick={() => document.querySelector<HTMLDialogElement>('#key-help')?.showModal()}>?</button
      >
    </div>
  </header>
  <main id="main-content" tabindex="-1" class="min-w-0">{@render children()}</main>
</div>
<dialog
  id="key-help"
  class="m-auto w-[min(90vw,26rem)] rounded-2xl border border-line bg-paper p-6 text-ink shadow-drawer"
>
  <p class="eyebrow">Keyboard reference</p>
  <h2 class="mt-2 text-2xl font-semibold">Keyboard shortcuts</h2>
  <dl class="my-6 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-3 text-sm">
    <dt class="font-bold">/</dt>
    <dd>Focus Inbox search</dd>
    <dt class="font-bold">?</dt>
    <dd>Open this help</dd>
    <dt class="font-bold">g then i / s</dt>
    <dd>Go to Inbox / Settings</dd>
  </dl>
  <form method="dialog" class="text-right">
    <button class="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-white">Close</button>
  </form>
</dialog>
