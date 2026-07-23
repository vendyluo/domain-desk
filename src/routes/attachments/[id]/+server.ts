import { attachmentResponse } from '$lib/server/attachments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, platform }) =>
  attachmentResponse(platform!.env.DB, platform!.env.ATTACHMENTS, params.id);
