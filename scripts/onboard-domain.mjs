// Onboard one domain/product/mailbox from the operator's machine.
// The Cloudflare token stays local (CLOUDFLARE_API_TOKEN) and is never deployed.
// The command never touches DNS: Email Routing must already be enabled on the
// zone, which is exactly the manual step where the operator verifies that no
// third-party mail provider would be replaced.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const mode = args.includes('--remote') ? 'remote' : args.includes('--local') ? 'local' : null;
if (!mode || (args.includes('--remote') && args.includes('--local'))) {
  throw new Error('Choose exactly one target: --local or --remote.');
}
const domain = (flag('domain') || '').toLowerCase();
const product = (flag('product') || '').trim();
const localPart = (flag('mailbox') || '').toLowerCase();
const workerName = flag('worker') || 'domain-desk';
const persistTo = flag('persist-to');
if (!/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
  throw new Error('Provide --domain <registrable-domain> (lowercase, e.g. example.com).');
}
if (!product || product.length > 100 || product.includes(';')) {
  throw new Error('Provide --product <name> (up to 100 characters, no semicolons).');
}
if (!/^[a-z0-9._+-]{1,64}$/.test(localPart)) {
  throw new Error('Provide --mailbox <local-part> (lowercase, e.g. hello).');
}
const address = `${localPart}@${domain}`;
const domainId = `domain:${domain}`;
const productId = `product:${domain}:${product
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')}`;
const mailboxId = `mailbox:${address}`;
const modeArgs = [`--${mode}`, ...(persistTo ? ['--persist-to', persistTo] : [])];
const sq = (value) => `'${value.replace(/'/g, "''")}'`;

function wrangler(commandArgs, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./node_modules/wrangler/bin/wrangler.js', ...commandArgs], {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`Wrangler exited with ${code}.`))));
  });
}
async function query(sql) {
  const raw = await wrangler(['d1', 'execute', 'domain-desk', ...modeArgs, '--command', sql, '--json'], true);
  return JSON.parse(raw)[0]?.results ?? [];
}
async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const data = await response.json();
  if (!data.success) throw new Error(`Cloudflare API ${path} failed: ${JSON.stringify(data.errors)}`);
  return data.result;
}

// --- Current CRM state: reuse matching rows, refuse conflicts. ---
const existing = await query(
  `SELECT 'domain' kind, id, name value FROM domains WHERE name=${sq(domain)}
   UNION ALL SELECT 'product', p.id, p.name FROM products p JOIN domains d ON d.id=p.domain_id WHERE d.name=${sq(domain)}
   UNION ALL SELECT 'mailbox', mi.id, mi.address FROM mailbox_identities mi WHERE mi.address=${sq(address)}`
);
const existingDomain = existing.find((row) => row.kind === 'domain');
const existingProduct = existing.find((row) => row.kind === 'product' && row.value === product);
const existingMailbox = existing.find((row) => row.kind === 'mailbox');
const useDomainId = existingDomain?.id ?? domainId;
const useProductId = existingProduct?.id ?? productId;
if (existingMailbox) {
  const owner = await query(`SELECT product_id FROM mailbox_identities WHERE address=${sq(address)}`);
  if (owner[0]?.product_id !== useProductId) {
    throw new Error(`Mailbox ${address} already belongs to another product; refusing to change it.`);
  }
  console.log(`Mailbox ${address} is already seeded; continuing to routing.`);
} else {
  const statements = [
    ...(existingDomain ? [] : [`INSERT INTO domains(id,name) VALUES(${sq(domainId)},${sq(domain)})`]),
    ...(existingProduct
      ? []
      : [`INSERT INTO products(id,domain_id,name) VALUES(${sq(productId)},${sq(useDomainId)},${sq(product)})`]),
    `INSERT INTO mailbox_identities(id,product_id,address) VALUES(${sq(mailboxId)},${sq(useProductId)},${sq(address)})`
  ];
  await query(statements.join('; '));
  console.log(
    `Seeded ${existingDomain ? 'existing domain' : `domain ${domainId}`}, ${existingProduct ? 'existing product' : `product ${useProductId}`}, mailbox ${mailboxId}.`
  );
}

// --- Email Routing rule (remote only; reads state, then adds one address rule). ---
if (mode === 'remote') {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Set CLOUDFLARE_API_TOKEN (Zone:Read + Email Routing Rules:Edit) to create the routing rule.');
  }
  const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
  if (!zones.length) throw new Error(`No Cloudflare zone found for ${domain}.`);
  const zone = zones[0].id;
  const routing = await cf(`/zones/${zone}/email/routing`);
  if (routing.enabled !== true) {
    throw new Error(
      `Email Routing is not enabled for ${domain}. Review the zone's existing MX records first ` +
        `(never replace a third-party mail provider), then enable Email Routing in the dashboard and re-run; ` +
        `this command intentionally never changes DNS.`
    );
  }
  const rules = await cf(`/zones/${zone}/email/routing/rules?per_page=50`);
  const conflict = rules.find((rule) =>
    (rule.matchers ?? []).some((matcher) => matcher.type === 'literal' && matcher.value === address)
  );
  if (conflict) {
    console.log(`Routing rule for ${address} already exists (${conflict.tag}); leaving it unchanged.`);
  } else {
    await cf(`/zones/${zone}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        name: `domain-desk ${address}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: address }],
        actions: [{ type: 'worker', value: [workerName] }]
      })
    });
    console.log(`Created Email Routing rule: ${address} -> worker ${workerName}.`);
  }
} else {
  console.log('Local target: skipped Cloudflare Email Routing (only meaningful for --remote).');
}

// --- Verify the seeded graph before claiming success. ---
const verified = await query(
  `SELECT d.name domain, p.name product, mi.address mailbox FROM mailbox_identities mi
   JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id WHERE mi.address=${sq(address)}`
);
if (verified.length !== 1 || verified[0].domain !== domain || verified[0].product !== product) {
  throw new Error('Post-onboarding verification failed: the seeded rows do not match the request.');
}
console.log(
  `Verified onboarding: ${verified[0].mailbox} -> ${verified[0].product} (${verified[0].domain}). ` +
    `Send an external test email${mode === 'remote' ? '' : ' after deploying'} to confirm end to end.`
);
