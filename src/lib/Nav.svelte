<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { page } from '$app/state';

  let open = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger
    class="rounded-md border border-line bg-transparent px-3 py-2 text-sm font-semibold text-ink hover:bg-paper-soft"
    aria-label="Open navigation"
  >
    <span aria-hidden="true">☰</span> <span>Menu</span>
  </Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-[#181b18aa]" />
    <Dialog.Content
      class="fixed inset-y-0 left-0 z-50 w-[min(85vw,320px)] border-0 bg-paper p-6 text-ink shadow-drawer"
    >
      <Dialog.Title class="font-reading text-2xl font-semibold">Domain CRM</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted">Daily inbound operations</Dialog.Description>
      <nav class="mt-8 grid gap-1" aria-label="Mobile navigation">
        <a
          class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/today') ? 'bg-[#e3ece8] font-semibold text-teal-dark' : 'hover:bg-paper-soft'}`}
          aria-current={page.url.pathname.startsWith('/today') ? 'page' : undefined}
          href="/today"
          onclick={() => (open = false)}>Today</a
        >
        <a
          class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/inbox') || page.url.pathname.startsWith('/conversations') ? 'bg-[#e3ece8] font-semibold text-teal-dark' : 'hover:bg-paper-soft'}`}
          aria-current={page.url.pathname.startsWith('/inbox') || page.url.pathname.startsWith('/conversations')
            ? 'page'
            : undefined}
          href="/inbox"
          onclick={() => (open = false)}>Inbox</a
        >
        <a
          class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/contacts') ? 'bg-[#e3ece8] font-semibold text-teal-dark' : 'hover:bg-paper-soft'}`}
          aria-current={page.url.pathname.startsWith('/contacts') ? 'page' : undefined}
          href="/contacts"
          onclick={() => (open = false)}>Contacts</a
        >
        <a
          class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/opportunities') ? 'bg-[#e3ece8] font-semibold text-teal-dark' : 'hover:bg-paper-soft'}`}
          aria-current={page.url.pathname.startsWith('/opportunities') ? 'page' : undefined}
          href="/opportunities"
          onclick={() => (open = false)}>Opportunities</a
        >
        <a
          class={`rounded-md px-3 py-2.5 no-underline ${page.url.pathname.startsWith('/settings') ? 'bg-[#e3ece8] font-semibold text-teal-dark' : 'hover:bg-paper-soft'}`}
          aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
          href="/settings"
          onclick={() => (open = false)}>Settings</a
        >
      </nav>
      <Dialog.Close
        class="mt-8 rounded-md border border-line-strong bg-transparent px-4 py-2 text-sm font-semibold hover:bg-paper-soft"
        >Close</Dialog.Close
      >
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
