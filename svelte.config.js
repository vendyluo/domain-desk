import adapter from '@sveltejs/adapter-cloudflare';
export default { kit: { adapter: adapter({ config: 'wrangler.svelte.toml' }) } };
