import type { Env } from '../../types';

type AttachmentMetadata = {
  id: string;
  filename: string | null;
  media_type: string;
  size: number;
  object_key: string;
};

function safeMediaType(value: string) {
  return /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value) ? value : 'application/octet-stream';
}

function contentDisposition(filename: string | null) {
  const name = filename?.trim() || 'attachment';
  const fallback =
    name
      .replace(/[\u0000-\u001f\u007f/\\"]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_')
      .slice(0, 160) || 'attachment';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function attachmentResponse(db: Env['DB'], bucket: Env['ATTACHMENTS'], id: string): Promise<Response> {
  const metadata = await db
    .prepare(
      `SELECT a.id,a.filename,a.media_type,a.size,a.object_key
       FROM attachments a
       JOIN messages m ON m.id=a.message_id
       JOIN conversations c ON c.id=m.conversation_id
       WHERE a.id=?`
    )
    .bind(id)
    .first<AttachmentMetadata>();

  if (!metadata) return new Response('Attachment not found.', { status: 404 });

  const object = await bucket.get(metadata.object_key);
  if (!object) {
    console.error(JSON.stringify({ event: 'attachment_binary_missing', attachment_id: id }));
    return new Response('Attachment metadata exists, but its stored binary is missing.', { status: 410 });
  }
  if (object.size !== metadata.size) {
    console.error(
      JSON.stringify({
        event: 'attachment_size_mismatch',
        attachment_id: id,
        expected_size: metadata.size,
        stored_size: object.size
      })
    );
    return new Response('Attachment storage is inconsistent.', { status: 409 });
  }

  return new Response(object.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDisposition(metadata.filename),
      'Content-Length': String(object.size),
      'Content-Type': safeMediaType(metadata.media_type),
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
