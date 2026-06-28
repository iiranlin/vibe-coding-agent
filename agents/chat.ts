import {
  createStreamResponse,
  runChatPipeline,
} from './_pipelines';
import { AuthError, authErrorResponse, requireClerkAuth } from './_auth';

export async function onRequest(context: any) {
  let auth;
  try {
    auth = await requireClerkAuth(context);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    throw error;
  }

  const body = context?.request?.body || {};
  const message = String(body?.message || '').trim();
  const resetProject = body?.resetProject === true;
  return createStreamResponse((send) => runChatPipeline(context, message, send, {
    resetProject,
    auth,
  }));
}
