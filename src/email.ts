import { ingestRaw, readBounded } from './ingest';
import type { Env } from './types';
import { IngestError } from './types';

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  try {
    const result = await ingestRaw(env, message.to, await readBounded(message.raw), new Date());
    console.log(
      JSON.stringify({ event: 'email_delivery_complete', duplicate: result.duplicate, message_id: result.id })
    );
  } catch (error) {
    const code = error instanceof IngestError ? error.code : 'unexpected';
    console.error(JSON.stringify({ event: 'email_ingestion_failed', code }));
    if (error instanceof IngestError && ['unknown_mailbox', 'malformed_mime', 'message_too_large'].includes(code)) {
      message.setReject(`Domain CRM rejected this message: ${code}`);
      return;
    }
    throw error;
  }
}
