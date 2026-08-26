import { deploymentHealth } from '$lib/server/health';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ platform }) => deploymentHealth(platform!.env);
