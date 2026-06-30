import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  headers: vi.fn(),
}));

vi.mock('../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}));

import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from './actions';

function credentials(email = 'ada@example.com', password = 'correct-horse-battery') {
  const formData = new FormData();
  formData.set('email', email);
  formData.set('password', password);
  return formData;
}

describe('Supabase auth actions', () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(new Headers({
      host: 'code.example.com',
      'x-forwarded-proto': 'https',
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('validates credentials before calling Supabase', async () => {
    const result = await signIn(undefined, credentials('invalid', 'short'));

    expect(result).toMatchObject({ ok: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('signs in with email and password then returns a client redirect state', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });
    const redirectSignal = new Error('NEXT_REDIRECT');
    mocks.redirect.mockImplementation(() => {
      throw redirectSignal;
    });

    const result = await signIn(undefined, credentials());

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse-battery',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/');
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: '登录成功。',
      redirectTo: '/?auth=success',
    });
  });

  it('uses the PKCE callback for email confirmation', async () => {
    const signUpWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signUp: signUpWithPassword } });
    const result = await signUp(undefined, credentials());

    expect(signUpWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      options: {
        emailRedirectTo: 'https://code.example.com/auth/callback',
      },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('sends password reset links through the callback route', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { resetPasswordForEmail } });
    const formData = new FormData();
    formData.set('email', 'ada@example.com');
    await requestPasswordReset(undefined, formData);

    expect(resetPasswordForEmail).toHaveBeenCalledWith('ada@example.com', {
      redirectTo: 'https://code.example.com/auth/callback?next=%2Fupdate-password',
    });
  });

  it('updates the authenticated user password', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { updateUser } });
    const formData = new FormData();
    formData.set('password', 'a-new-secure-password');
    formData.set('confirmPassword', 'a-new-secure-password');

    await updatePassword(undefined, formData);

    expect(updateUser).toHaveBeenCalledWith({ password: 'a-new-secure-password' });
    expect(mocks.redirect).toHaveBeenCalledWith('/');
  });
});
