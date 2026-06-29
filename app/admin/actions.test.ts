import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  updateUserQuotaForAdmin: vi.fn(),
}));

vi.mock('../../lib/supabase/server', () => ({
  createClient: actionMocks.createClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: actionMocks.revalidatePath,
}));

vi.mock('next/navigation', () => ({
  redirect: actionMocks.redirect,
}));

vi.mock('../../lib/usage', () => ({
  updateUserQuotaForAdmin: actionMocks.updateUserQuotaForAdmin,
}));

import { updateQuotaAction } from './actions';

describe('updateQuotaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getClaims.mockResolvedValue({
      data: { claims: { sub: '96cf1ca3-ac70-480d-a733-00f30c751c05' } },
      error: null,
    });
    actionMocks.createClient.mockResolvedValue({ auth: { getClaims: actionMocks.getClaims } });
    actionMocks.updateUserQuotaForAdmin.mockResolvedValue({});
  });

  it('保存成功后跳转到新的管理页请求，避免内联 RSC 重渲染失败', async () => {
    const redirectSignal = new Error('NEXT_REDIRECT');
    actionMocks.redirect.mockImplementation(() => {
      throw redirectSignal;
    });

    const formData = new FormData();
    formData.set('userId', '17e0fe25-7549-46c9-92a8-4df1180a9503');
    formData.set('tokenQuota', '1000000');
    formData.set('status', 'active');

    await expect(updateQuotaAction(formData)).rejects.toBe(redirectSignal);
    expect(actionMocks.updateUserQuotaForAdmin).toHaveBeenCalledWith(
      '96cf1ca3-ac70-480d-a733-00f30c751c05',
      '17e0fe25-7549-46c9-92a8-4df1180a9503',
      1000000,
      'active',
    );
    expect(actionMocks.revalidatePath).not.toHaveBeenCalled();
    expect(actionMocks.redirect).toHaveBeenCalledWith('/admin');
  });
});
