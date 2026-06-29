import { runCodingAgent } from './_agent';
import type { SupabaseAuthContext } from './_auth';
import { AUTO_FIX_MAX_ATTEMPTS } from './_constants';
import {
  appendTurn,
  getHistory,
  getProjectState,
  saveProjectState,
} from './_memory';
import {
  createProjectState,
  getFileTree,
  readFileFromSandbox,
  resetProjectWorkspace,
  runVerification,
} from './_project';
import type {
  AgentProgressEvent,
  BuildStatus,
  FileTreeItem,
  ScaffoldLog,
  StreamSend,
} from './_types';
import { buildAutoFixPrompt } from './utils/_build-errors';
import { debugLog } from './utils/_debug';
import { normalizeRelPath } from './utils/_paths';
import { sanitizeAssistantText } from './utils/_text';
import {
  ensureAppUser,
  estimateTokensFromText,
  finalizeTokenUsage,
  reserveTokensForRun,
  UsageConfigurationError,
  UsagePermissionError,
  type UsageReservation,
} from '../lib/usage';

const SANDBOX_EXTENSION_SECONDS = 1800;

type SandboxWithTimeoutExtension = {
  extendTimeout?: (seconds: number) => unknown;
};

type ChatPipelineOptions = {
  resetProject?: boolean;
  auth?: SupabaseAuthContext;
};

type FilePipelineOptions = {
  auth?: SupabaseAuthContext;
};

function hashUserScope(value: string) {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x811c9dc5) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

function scopeConversationIdForUser(conversationId: string, userId?: string) {
  if (!conversationId || !userId) {
    return conversationId;
  }
  const prefix = `u_${hashUserScope(userId)}_`;
  return conversationId.startsWith(prefix) ? conversationId : `${prefix}${conversationId}`;
}

function stripReturnedPreviewLinks(text: string, previewUrl?: string) {
  if (!text || !previewUrl) {
    return text;
  }
  const escapedUrl = escapeRegExp(previewUrl);
  return text
    .replace(new RegExp(`\\s*\\[[^\\]]*(?:打开预览|预览|preview)[^\\]]*\\]\\(${escapedUrl}\\)`, 'gi'), '')
    .replace(new RegExp(`\\s*${escapedUrl}`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRequirementConclusionFallback(
  request: string,
  status: 'pending' | 'ready' | 'generated',
) {
  const summary = summarizeUserRequest(request);
  const isEnglish = !/[\u3400-\u9fff]/.test(request);

  if (isEnglish) {
    if (status === 'ready') {
      return `Built this for your request: ${summary}. The preview is ready in the right preview panel.`;
    }
    if (status === 'generated') {
      return `Generated the project for your request: ${summary}.`;
    }
    return `Handled your request: ${summary}. Verification and preview results are being prepared.`;
  }

  if (status === 'ready') {
    return `Built this for your request: ${summary}. The preview is ready in the right preview panel.`;
  }
  if (status === 'generated') {
    return `Generated the project for your request: ${summary}.`;
  }
  return `Handled your request: ${summary}. Verification and preview results are being prepared.`;
}

function summarizeUserRequest(request: string) {
  const normalized = request.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'your web project';
  }
  const maxLength = 80;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function isGenericCompletionReply(text: string) {
  const normalized = text.replace(/\s+/g, '').replace(/[。.!！]+$/g, '');
  return normalized === '已编写完成，请查看结果'
    || normalized === '已完成，请查看结果'
    || /^theagentdidnotreturnanythingdisplayable$/i.test(normalized);
}

export function createStreamResponse(run: (send: StreamSend) => Promise<void>) {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send: StreamSend = (event) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      run(send)
        .catch((error) => {
          send({
            type: 'error',
            error: error instanceof Error ? error.message : 'Request processing failed.',
          });
        })
        .finally(() => {
          closed = true;
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-stream': 'true',
    },
  });
}

function getRequestHeader(context: any, name: string): string {
  const headers = context?.request?.headers;
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    return String(headers.get(name) || '');
  }

  const lowerName = name.toLowerCase();
  const value = headers[name] ?? headers[lowerName];
  return typeof value === 'string' ? value : String(value || '');
}

function queryValueToString(value: unknown): string {
  if (Array.isArray(value)) {
    return queryValueToString(value[0]);
  }
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

function getSearchParamFromString(rawValue: unknown, name: string): string {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return '';
  }

  const raw = rawValue.trim();
  try {
    if (raw.startsWith('?')) {
      return new URLSearchParams(raw.slice(1)).get(name) || '';
    }
    if (raw.includes('?') || raw.startsWith('/') || /^https?:\/\//i.test(raw)) {
      return new URL(raw, 'http://local').searchParams.get(name) || '';
    }
    if (raw.includes('=')) {
      return new URLSearchParams(raw).get(name) || '';
    }
  } catch {
    return '';
  }

  return '';
}

function getRequestQueryParam(context: any, name: string): {
  value: string;
  source: string;
} {
  const request = context?.request || {};
  const stringFields = [
    'url',
    'path',
    'pathname',
    'search',
    'queryString',
    'rawUrl',
    'originalUrl',
  ];
  for (const field of stringFields) {
    const value = getSearchParamFromString(request[field], name);
    if (value) {
      return { value, source: `request.${field}` };
    }
  }

  const queryObjects = [
    { source: 'request.query', value: request.query },
    { source: 'request.params', value: request.params },
    { source: 'request.searchParams', value: request.searchParams },
    { source: 'context.query', value: context?.query },
    { source: 'context.params', value: context?.params },
  ];
  for (const query of queryObjects) {
    if (query.value && typeof query.value.get === 'function') {
      const value = query.value.get(name);
      if (value) {
        return { value: queryValueToString(value), source: query.source };
      }
      continue;
    }
    if (!query || typeof query !== 'object') continue;
    const value = query.value?.[name];
    const normalized = queryValueToString(value);
    if (normalized) {
      return { value: normalized, source: query.source };
    }
  }

  return { value: '', source: 'none' };
}

function getRequestDebugSnapshot(context: any): Record<string, unknown> {
  const request = context?.request || {};
  const snapshot: Record<string, unknown> = {
    requestKeys: Object.keys(request).slice(0, 24),
  };
  for (const field of ['url', 'path', 'pathname', 'search', 'queryString', 'rawUrl', 'originalUrl']) {
    if (typeof request[field] === 'string' && request[field]) {
      snapshot[field] = request[field].slice(0, 300);
    }
  }
  for (const field of ['query', 'params', 'searchParams']) {
    const value = request[field];
    if (value && typeof value === 'object') {
      snapshot[field] = typeof value.entries === 'function'
        ? Object.fromEntries(Array.from(value.entries() as Iterable<[PropertyKey, unknown]>).slice(0, 20))
        : Object.keys(value).slice(0, 20);
    }
  }
  return snapshot;
}

function maskConversationId(value: string): string {
  if (!value) return '<empty>';
  if (value.length <= 12) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

async function extendExistingSandboxTimeout(context: any) {
  const sandbox = context?.sandbox as SandboxWithTimeoutExtension | undefined;
  if (!sandbox || typeof sandbox.extendTimeout !== 'function') {
    return;
  }

  try {
    await sandbox.extendTimeout(SANDBOX_EXTENSION_SECONDS);
    debugLog(context, '[sandbox]', {
      stage: 'extend-timeout',
      seconds: SANDBOX_EXTENSION_SECONDS,
    });
  } catch (error) {
    console.warn('[sandbox]', {
      stage: 'extend-timeout-failed',
      seconds: SANDBOX_EXTENSION_SECONDS,
      error: error instanceof Error ? error.message : String(error || ''),
    });
  }
}

function getQuotaErrorReply(error: unknown) {
  if (error instanceof UsageConfigurationError) {
    return 'Usage quota database is not configured. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.';
  }
  if (error instanceof UsagePermissionError) {
    if (error.reason === 'insufficient_quota') {
      return 'Your token quota is insufficient. Please contact an administrator to allocate more quota.';
    }
    if (error.reason === 'user_disabled') {
      return 'Your account has been disabled. Please contact an administrator.';
    }
    return error.reason || 'Unable to verify token quota.';
  }
  return error instanceof Error ? error.message : 'Unable to verify token quota.';
}

function sendQuotaFailure(send: StreamSend, conversationId: string, error: unknown) {
  const reply = getQuotaErrorReply(error);
  send({
    type: 'result',
    data: {
      ok: false,
      conversation_id: conversationId,
      reply,
      error: reply,
      build: { status: 'skipped' as BuildStatus },
      preview: {},
    },
  });
}

function getBilledTokenFallback(message: string, reply: string) {
  return estimateTokensFromText(`${message}\n${reply}`);
}

export async function runFileReadPipeline(
  context: any,
  options: FilePipelineOptions = {},
): Promise<Response> {
  const contextConversationId = String(context.conversation_id || '');
  const pagesHeaderConversationId = getRequestHeader(context, 'makers-conversation-id');
  const headerConversationId = getRequestHeader(context, 'conversationId');
  const rawConversationId = contextConversationId || pagesHeaderConversationId || headerConversationId;
  const conversationId = scopeConversationIdForUser(rawConversationId, options.auth?.userId);
  const conversationSource = contextConversationId
    ? 'context.conversation_id'
    : pagesHeaderConversationId
      ? 'makers-conversation-id'
      : headerConversationId
        ? 'conversationId'
        : 'none';
  const diagnosticBase = {
    contextConversationId: maskConversationId(contextConversationId),
    pagesHeaderConversationId: maskConversationId(pagesHeaderConversationId),
    headerConversationId: maskConversationId(headerConversationId),
    selectedConversationId: maskConversationId(conversationId),
    selectedConversationSource: conversationSource,
  };
  const pathParam = getRequestQueryParam(context, 'path');
  const relPath = pathParam.value;
  if (!conversationId) {
    debugLog(context, '[file-read]', {
      ...diagnosticBase,
      rawPath: relPath,
      pathSource: pathParam.source,
      normalizedPath: null,
      error: 'missing conversation_id',
    });
    return new Response(JSON.stringify({ ok: false, error: 'missing conversation_id' }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const norm = normalizeRelPath(relPath);
  if (!norm) {
    debugLog(context, '[file-read]', {
      ...diagnosticBase,
      rawPath: relPath,
      pathSource: pathParam.source,
      normalizedPath: null,
      error: 'invalid path',
      request: getRequestDebugSnapshot(context),
    });
    return new Response(JSON.stringify({ ok: false, error: 'invalid path' }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const state = await getProjectState(context, conversationId);
  debugLog(context, '[file-read]', {
    ...diagnosticBase,
    rawPath: relPath,
    pathSource: pathParam.source,
    normalizedPath: norm,
    appDir: state.appDir,
    stage: 'before-read',
  });
  const res = await readFileFromSandbox(context, state, norm);
  debugLog(context, '[file-read]', {
    ...diagnosticBase,
    normalizedPath: norm,
    appDir: state.appDir,
    ok: res.ok,
    error: res.error,
    size: res.size,
    truncated: res.truncated,
    stage: 'after-read',
  });
  return new Response(
    JSON.stringify({ path: norm, ...res }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

export async function runChatPipeline(
  context: any,
  message: string,
  send: StreamSend,
  options: ChatPipelineOptions = {},
) {
  const contextConversationId = String(context.conversation_id || '');
  const pagesHeaderConversationId = getRequestHeader(context, 'makers-conversation-id');
  const headerConversationId = getRequestHeader(context, 'conversationId');
  const rawConversationId = contextConversationId || pagesHeaderConversationId || headerConversationId;
  const conversationId = scopeConversationIdForUser(rawConversationId, options.auth?.userId);

  if (!message) {
    send({
      type: 'result',
      data: {
        ok: false,
        conversation_id: conversationId,
        reply: 'Please describe the page or feature you want to build first.',
        build: { status: 'skipped' as BuildStatus },
        preview: {},
      },
    });
    return;
  }

  if (!conversationId) {
    send({
      type: 'result',
      data: {
        ok: false,
        conversation_id: '',
        reply: 'Missing conversationId. The project workspace cannot be prepared.',
        build: { status: 'skipped' as BuildStatus },
        preview: {},
      },
    });
    return;
  }

  const auth = options.auth;
  if (!auth?.userId) {
    send({
      type: 'result',
      data: {
        ok: false,
        conversation_id: conversationId,
        reply: 'Authentication context is missing. Please sign in again.',
        build: { status: 'skipped' as BuildStatus },
        preview: {},
      },
    });
    return;
  }

  let usageReservation: UsageReservation | null = null;
  let usageFinalized = false;
  try {
    await ensureAppUser({
      userId: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
    }, { context });
    usageReservation = await reserveTokensForRun(auth.userId, conversationId, { context });
    send({
      type: 'quota',
      data: {
        reservedTokens: usageReservation.reservedTokens,
        remainingTokens: usageReservation.remainingTokens,
      },
    });
  } catch (error) {
    sendQuotaFailure(send, conversationId, error);
    return;
  }

  const finalizeUsageOnce = async (
    actualTokens: number,
    metadata: Record<string, unknown>,
  ) => {
    if (!usageReservation || usageFinalized) {
      return;
    }
    try {
      const user = await finalizeTokenUsage(usageReservation, actualTokens, metadata, { context });
      usageFinalized = true;
      send({
        type: 'quota',
        data: {
          usedTokens: actualTokens,
          remainingTokens: user.remainingTokens,
          tokenQuota: user.tokenQuota,
          tokenUsed: user.tokenUsed,
        },
      });
    } catch (error) {
      const message = getQuotaErrorReply(error);
      send({
        type: 'log',
        phase: 'agent',
        stream: 'stderr',
        message,
      });
    }
  };

  let billedTokens = 0;
  const executeReservedRun = async () => {
    await extendExistingSandboxTimeout(context);

  send({
    type: 'status',
    message: 'Running the agent workflow',
  });

  const shouldResetProject = options.resetProject === true;
  const state = shouldResetProject
    ? createProjectState(conversationId)
    : await getProjectState(context, conversationId);
  if (shouldResetProject) {
    await resetProjectWorkspace(context, state);
  }
  const history = shouldResetProject ? [] : await getHistory(context, conversationId);
  const isInitialProjectTurn = !state.created;
  const hiddenScaffoldToolUseIds = new Set<string>();

  const handleScaffoldLog = (log: ScaffoldLog) => {
    if (!isInitialProjectTurn) {
      return;
    }
    send({
      type: 'log',
      phase: 'scaffold',
      stream: log.stream,
      message: log.content,
    });
  };
  const forwardProgress = (event: AgentProgressEvent) => {
    // Forward structured progress events directly; the frontend renders by type.
    if (
      !isInitialProjectTurn
      && event.type === 'tool_use'
      && (event.data.name === 'ensure_project_scaffold' || event.data.name.endsWith('__ensure_project_scaffold'))
    ) {
      hiddenScaffoldToolUseIds.add(event.data.id);
      return;
    }
    if (!isInitialProjectTurn && event.type === 'tool_result' && hiddenScaffoldToolUseIds.has(event.data.tool_use_id)) {
      return;
    }
    if (event.type === 'text_segment') {
      const text = state.previewUrl
        ? stripReturnedPreviewLinks(event.data.text, state.previewUrl)
        : event.data.text;
      if (text.length === 0) {
        return;
      }
      send({
        ...event,
        data: {
          ...event.data,
          text,
        },
      } as unknown as Record<string, unknown>);
      return;
    }
    send(event as unknown as Record<string, unknown>);
  };
  const pushFileTree = async (fallbackMessage: string): Promise<FileTreeItem[]> => {
    try {
      const tree = await getFileTree(context, state);
      send({
        type: 'file_tree',
        data: {
          root: state.appDir,
          items: tree,
        },
      });
      return tree;
    } catch (error) {
      send({
        type: 'log',
        phase: 'agent',
        stream: 'stderr',
        message: error instanceof Error ? error.message : fallbackMessage,
      });
      return [];
    }
  };
  const pushEarlyFileTree = async () => {
    // Push file_tree as soon as scaffold succeeds so the Files panel does not
    // have to wait for the whole turn. Failures are non-fatal because the final
    // state is pushed again at turn completion.
    await pushFileTree('Failed to read the file list after scaffold.');
  };

  // The model handles creative code work; build and service steps remain deterministic.
  const modelResult = await runCodingAgent(
    context,
    conversationId,
    message,
    history,
    state,
    !state.created,
    handleScaffoldLog,
    forwardProgress,
    pushEarlyFileTree,
  );
  billedTokens = modelResult.usageTokens || 0;
  const sanitizedModelOutput = modelResult.success && modelResult.output
    ? sanitizeAssistantText(modelResult.output)
    : '';
  const modelOutput = sanitizedModelOutput && !isGenericCompletionReply(sanitizedModelOutput)
    ? sanitizedModelOutput
    : '';
  const fallbackReply = modelResult.success
    ? buildRequirementConclusionFallback(message, state.previewUrl ? 'ready' : 'pending')
    : (modelResult.error || 'An error occurred during processing. Please try again.');
  const assistantReply = stripReturnedPreviewLinks(sanitizeAssistantText(
    modelOutput || fallbackReply
  ) || fallbackReply, state.previewUrl);
  const getActualTokens = (replyText: string) => (
    billedTokens > 0 ? billedTokens : getBilledTokenFallback(message, replyText)
  );

  send({
    type: 'agent',
    data: {
      ok: modelResult.success,
      reply: assistantReply,
      ...(modelResult.error ? { error: modelResult.error } : {}),
    },
  });

  if (modelResult.fatal) {
    await appendTurn(context, conversationId, 'user', message);
    await appendTurn(context, conversationId, 'assistant', assistantReply);
    await saveProjectState(context, conversationId, state);
    await finalizeUsageOnce(getActualTokens(assistantReply), {
      status: 'fatal',
      error: modelResult.error || null,
      usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
    });

    send({
      type: 'result',
      data: {
        ok: false,
        reply: assistantReply,
        conversation_id: conversationId,
        build: {
          status: 'skipped' as BuildStatus,
          stderr: modelResult.error || assistantReply,
        },
        preview: {},
      },
    });
    return;
  }

  if (!modelResult.projectTouched && modelResult.previewTouched) {
    if (state.previewUrl) {
      send({
        type: 'preview_ready',
        data: {
          preview: {
            url: state.previewUrl,
            sandboxDebugUrl: state.sandboxDebugUrl,
          },
        },
      });
    }

    await appendTurn(context, conversationId, 'user', message);
    await appendTurn(context, conversationId, 'assistant', assistantReply);
    await saveProjectState(context, conversationId, state);
    await finalizeUsageOnce(getActualTokens(assistantReply), {
      status: modelResult.success ? 'success' : 'failed',
      previewTouched: true,
      usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
    });

    send({
      type: 'result',
      data: {
        ok: modelResult.success && Boolean(state.previewUrl),
        reply: assistantReply,
        conversation_id: conversationId,
        build: { status: 'skipped' as BuildStatus },
        preview: {
          url: state.previewUrl,
          sandboxDebugUrl: state.sandboxDebugUrl,
          ...(!state.previewUrl ? { error: 'The agent did not complete publish_preview.' } : {}),
        },
      },
    });
    return;
  }

  if (!modelResult.projectTouched) {
    await appendTurn(context, conversationId, 'user', message);
    await appendTurn(context, conversationId, 'assistant', assistantReply);
    await finalizeUsageOnce(getActualTokens(assistantReply), {
      status: modelResult.success ? 'success' : 'failed',
      projectTouched: false,
      usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
    });

    send({
      type: 'result',
      data: {
        ok: modelResult.success,
        reply: assistantReply,
        conversation_id: conversationId,
        build: { status: 'skipped' as BuildStatus },
        preview: {},
      },
    });
    return;
  }

  let fileTree = await pushFileTree('Failed to read the file list.');
  let build = await runVerification(context, state);
  let autoFixAttempts = 0;
  let autoFixApplied = false;
  let autoFixReply = '';

  if (build.fatal) {
    const fatalReply = build.stderr || 'The task failed, and the remaining workflow was stopped.';
    await appendTurn(context, conversationId, 'user', message);
    await appendTurn(context, conversationId, 'assistant', fatalReply);
    await saveProjectState(context, conversationId, state);
    await finalizeUsageOnce(getActualTokens(fatalReply), {
      status: 'build_fatal',
      usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
    });

    send({
      type: 'result',
      data: {
        ok: false,
        reply: fatalReply,
        conversation_id: conversationId,
        project: {
          dir: state.appDir,
          created: modelResult.wasCreated,
        },
        build,
        files: {
          root: state.appDir,
          items: fileTree,
        },
        preview: {},
      },
    });
    return;
  }

  if (build.status === 'failed' && modelResult.success) {
    autoFixAttempts = AUTO_FIX_MAX_ATTEMPTS;
    autoFixApplied = true;
    send({
      type: 'status',
      message: `Verification failed. Running auto-fix 1/${AUTO_FIX_MAX_ATTEMPTS}`,
    });

    const autoFixPrompt = buildAutoFixPrompt(
      message,
      assistantReply,
      build,
      1,
      AUTO_FIX_MAX_ATTEMPTS,
    );
    const autoFixResult = await runCodingAgent(
      context,
      conversationId,
      autoFixPrompt,
      [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: assistantReply },
      ],
      state,
      false,
      handleScaffoldLog,
      forwardProgress,
      pushEarlyFileTree,
    );
    billedTokens += autoFixResult.usageTokens || 0;
    autoFixReply = stripReturnedPreviewLinks(sanitizeAssistantText(
      autoFixResult.success && autoFixResult.output
        ? autoFixResult.output
        : autoFixResult.error || ''
    ), state.previewUrl);

    if (autoFixReply) {
      send({
        type: 'agent',
        data: {
          ok: autoFixResult.success,
          reply: autoFixReply,
          ...(autoFixResult.error ? { error: autoFixResult.error } : {}),
        },
      });
    }

    fileTree = await pushFileTree('Failed to read the file list after auto-fix.');
    build = await runVerification(context, state);
    if (build.fatal) {
      const fatalReply = build.stderr || 'The task failed, and the remaining workflow was stopped.';
      await appendTurn(context, conversationId, 'user', message);
      await appendTurn(context, conversationId, 'assistant', fatalReply);
      await saveProjectState(context, conversationId, state);
      await finalizeUsageOnce(getActualTokens(fatalReply), {
        status: 'auto_fix_build_fatal',
        autoFixAttempts,
        usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
      });

      send({
        type: 'result',
        data: {
          ok: false,
          reply: fatalReply,
          conversation_id: conversationId,
          project: {
            dir: state.appDir,
            created: modelResult.wasCreated,
          },
          build,
          files: {
            root: state.appDir,
            items: fileTree,
          },
          preview: {},
        },
      });
      return;
    }
  }

  build = {
    ...build,
    ...(autoFixAttempts > 0 ? { autoFixAttempts, autoFixApplied } : {}),
  };

  // Preview startup, HTTP readiness checks, and link generation are handled by publish_preview.
  // publish_preview, or the legacy get_preview_link alias, writes state.previewUrl / state.sandboxDebugUrl.
  if (state.previewUrl) {
    send({
      type: 'preview_ready',
      data: {
        preview: {
          url: state.previewUrl,
          sandboxDebugUrl: state.sandboxDebugUrl,
        },
      },
    });
  }

  const autoFixSuffix = autoFixAttempts > 0
    ? build.status === 'success'
      ? ` Auto-fix ran ${autoFixAttempts} time(s) based on the verification error, and verification now passes.`
      : ` Auto-fix ran ${autoFixAttempts} time(s), but verification still fails. The final logs are preserved for further debugging.`
    : '';
  const buildFailedSuffix = build.status === 'failed' && autoFixAttempts === 0
    ? ' Verification currently fails, so I did not describe the update as successful. Please continue debugging from the logs.'
    : '';
  const missingPreviewSuffix = state.previewUrl
    ? ''
    : ' No preview link was obtained. Please continue by asking the agent to call publish_preview.';
  const finalFallbackReply = buildRequirementConclusionFallback(
    message,
    build.status !== 'failed' && state.previewUrl ? 'ready' : 'generated',
  );
  const baseReply = autoFixReply || (modelOutput ? assistantReply : finalFallbackReply);
  const reply = stripReturnedPreviewLinks(
    `${baseReply}${autoFixSuffix}${buildFailedSuffix}${missingPreviewSuffix}`,
    state.previewUrl,
  );

  // Append this turn first, which also creates the conversation, then write projectState to metadata.
  await appendTurn(context, conversationId, 'user', message);
  await appendTurn(context, conversationId, 'assistant', reply);
  await saveProjectState(context, conversationId, state);
  await finalizeUsageOnce(getActualTokens(reply), {
    status: modelResult.success && build.status !== 'failed' ? 'success' : 'failed',
    buildStatus: build.status,
    autoFixAttempts,
    usageSource: billedTokens > 0 ? 'sdk' : 'estimate',
  });

  send({
    type: 'result',
    data: {
      ok: modelResult.success && build.status !== 'failed' && Boolean(state.previewUrl),
      reply,
      conversation_id: conversationId,
      project: {
        dir: state.appDir,
        created: modelResult.wasCreated,
      },
      build,
      files: {
        root: state.appDir,
        items: fileTree,
      },
      preview: {
        url: state.previewUrl,
        sandboxDebugUrl: state.sandboxDebugUrl,
        ...(!state.previewUrl ? { error: 'The agent did not complete publish_preview.' } : {}),
      },
    },
  });
  };

  try {
    return await executeReservedRun();
  } finally {
    if (!usageFinalized) {
      await finalizeUsageOnce(billedTokens, {
        status: 'aborted',
        usageSource: billedTokens > 0 ? 'sdk' : 'release',
      });
    }
  }
}
