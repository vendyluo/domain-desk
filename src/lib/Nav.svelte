<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { page } from '$app/state';

  let open = $state(false);
  const links = ['Today', 'Inbox', 'Contacts', 'Opportunities', 'Settings'];
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
      <Dialog.Title class="font-reading text-2xl font-semibold">Domain Desk</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted">Daily inbound operations</Dialog.Description>
      <nav class="mt-8 grid border-y border-line" aria-label="Mobile navigation">
        {#each links as label, i}
          {@const href = `/${label.toLowerCase()}`}
          {@const active =
            page.url.pathname.startsWith(href) || (label === 'Inbox' && page.url.pathname.startsWith('/conversations'))}
          <a
            class={`flex min-h-11 items-center gap-4 border-l-2 px-3 py-2.5 no-underline ${active ? 'border-teal bg-sidebar-soft font-semibold text-ink' : 'border-transparent hover:bg-paper-soft'}`}
            aria-current={active ? 'page' : undefined}
            {href}
            onclick={() => (open = false)}
            ><span aria-hidden="true" class="font-mono text-[10px] text-muted">0{i + 1}</span>{label}</a
          >
        {/each}
      </nav>
      <Dialog.Close
        class="mt-8 rounded-md border border-line-strong bg-transparent px-4 py-2 text-sm font-semibold hover:bg-paper-soft"
        >Close</Dialog.Close
      >
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
