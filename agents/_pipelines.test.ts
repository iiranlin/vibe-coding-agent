import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryMocks = vi.hoisted(() => ({
  appendTurn: vi.fn(),
  getHistory: vi.fn(),
  getProjectState: vi.fn(),
  saveProjectState: vi.fn(),
}));

const usageMocks = vi.hoisted(() => ({
  ensureAppUser: vi.fn(),
  reserveTokensForRun: vi.fn(),
  finalizeTokenUsage: vi.fn(),
}));

vi.mock('./_memory', () => memoryMocks);
vi.mock('../lib/usage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/usage')>(),
  ensureAppUser: usageMocks.ensureAppUser,
  reserveTokensForRun: usageMocks.reserveTokensForRun,
  finalizeTokenUsage: usageMocks.finalizeTokenUsage,
}));

import { runChatPipeline } from './_pipelines';

describe('runChatPipeline usage reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageMocks.ensureAppUser.mockResolvedValue({});
    usageMocks.reserveTokensForRun.mockResolvedValue({
      eventId: 'event_123',
      userId: '2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
      reservedTokens: 20_000,
      remainingTokens: 80_000,
    });
    usageMocks.finalizeTokenUsage.mockResolvedValue({
      remainingTokens: 100_000,
      tokenQuota: 100_000,
      tokenUsed: 0,
    });
  });

  it('releases a reservation when the pipeline fails after reserving tokens', async () => {
    memoryMocks.getProjectState.mockRejectedValue(new Error('state unavailable'));

    await expect(runChatPipeline(
      { conversation_id: 'conversation_123' },
      'Build a page',
      vi.fn(),
      {
        auth: {
          supabaseUserId: '2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
          systemUserId: 'supabase:2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
          userId: '2d3859ad-5ea7-4f78-a0f8-437ae7862fd2',
        },
      },
    )).rejects.toThrow('state unavailable');

    expect(usageMocks.finalizeTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event_123' }),
      0,
      expect.objectContaining({
        status: 'aborted',
        usageSource: 'release',
      }),
      expect.any(Object),
    );
  });
});
