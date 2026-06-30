import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

import SignUpPage from './page';

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects authenticated users home instead of rendering the sign-up form', async () => {
    const redirectSignal = new Error('NEXT_REDIRECT');
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123' } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims } });
    mocks.redirect.mockImplementation(() => {
      throw redirectSignal;
    });

    await expect(Promise.resolve().then(() => SignUpPage())).rejects.toBe(redirectSignal);
    expect(mocks.redirect).toHaveBeenCalledWith('/');
  });

  it('renders the sign-up form for signed-out users', async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: null },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims } });

    const page = await SignUpPage();

    expect(page).toMatchObject({
      props: { mode: 'sign-up' },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
