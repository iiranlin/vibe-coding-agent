'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '../../lib/supabase/server';

export type AuthActionState = {
  ok: boolean;
  message: string;
  redirectTo?: string;
};

const emailSchema = z.string().trim().email('请输入有效的邮箱地址。');
const passwordSchema = z.string().min(8, '密码至少需要 8 个字符。');

function failure(message: string): AuthActionState {
  return { ok: false, message };
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const host = (requestHeaders.get('x-forwarded-host') || requestHeaders.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  const protocol = (requestHeaders.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https'))
    .split(',')[0]
    .trim();
  return `${protocol}://${host}`;
}

function parseCredentials(formData: FormData) {
  return z.object({
    email: emailSchema,
    password: passwordSchema,
  }).safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
}

export async function signIn(
  _state: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState | undefined> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message || '登录信息无效。');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return failure('邮箱或密码不正确。');
  }

  revalidatePath('/');
  return {
    ok: true,
    message: '登录成功。',
    redirectTo: '/?auth=success',
  };
}

export async function signUp(
  _state: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message || '注册信息无效。');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      emailRedirectTo: `${await getRequestOrigin()}/auth/callback`,
    },
  });
  if (error) {
    return failure(error.message);
  }

  return {
    ok: true,
    message: '注册成功，请打开验证邮件完成登录。',
  };
}

export async function requestPasswordReset(
  _state: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message || '邮箱地址无效。');
  }

  const supabase = await createClient();
  const callback = new URL('/auth/callback', await getRequestOrigin());
  callback.searchParams.set('next', '/update-password');
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: callback.toString(),
  });
  if (error) {
    return failure(error.message);
  }

  return {
    ok: true,
    message: '如果该邮箱已注册，密码重置邮件将很快送达。',
  };
}

export async function updatePassword(
  _state: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState | undefined> {
  const parsed = z.object({
    password: passwordSchema,
    confirmPassword: passwordSchema,
  }).refine((value) => value.password === value.confirmPassword, {
    message: '两次输入的密码不一致。',
  }).safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message || '新密码无效。');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return failure(error.message);
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/');
  redirect('/');
}
