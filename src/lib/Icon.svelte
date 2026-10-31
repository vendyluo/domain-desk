<script lang="ts">
  let {
    name,
    size = 18
  }: {
    name:
      | 'today'
      | 'inbox'
      | 'contacts'
      | 'opportunities'
      | 'settings'
      | 'arrow'
      | 'search'
      | 'globe'
      | 'check'
      | 'clock'
      | 'attachment';
    size?: number;
  } = $props();
  const paths = {
    today: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m3 11 3 3 5-5',
    inbox: 'M4 4h16l2 11v5H2v-5L4 4Zm-2 11h6l2 3h4l2-3h6',
    contacts:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m7 .13a4 4 0 0 1 0 7.75',
    opportunities: 'M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z',
    settings:
      'm12 3 2 3 3-.2.8 3.2 2.7 2-2.7 2 .2 3.2-3 .8-2 3-2-3-3 .2-.8-3.2L3.5 12l2.7-2L6 6.8l3-.8 3-3Zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    search: 'm21 21-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
    globe: 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Zm0 0a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    check: 'm5 12 4 4L19 6',
    clock: 'M12 8v5l3 2m-3-12a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    attachment: 'm8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9'
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="shrink-0"><path d={paths[name]} /></svg
>
