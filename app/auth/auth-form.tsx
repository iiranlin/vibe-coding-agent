'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  type AuthActionState,
} from './actions';

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'update-password';

const COPY: Record<AuthMode, {
  title: string;
  description: string;
  submit: string;
  pending: string;
}> = {
  'sign-in': {
    title: '登录',
    description: '登录后即可使用 AI 构建工作流。',
    submit: '登录',
    pending: '登录中…',
  },
  'sign-up': {
    title: '创建账号',
    description: '使用邮箱和密码注册 Supabase 账号。',
    submit: '注册',
    pending: '注册中…',
  },
  'forgot-password': {
    title: '重置密码',
    description: '输入注册邮箱，我们会发送密码重置链接。',
    submit: '发送重置邮件',
    pending: '发送中…',
  },
  'update-password': {
    title: '设置新密码',
    description: '请输入至少 8 个字符的新密码。',
    submit: '保存新密码',
    pending: '保存中…',
  },
};

const ACTIONS = {
  'sign-in': signIn,
  'sign-up': signUp,
  'forgot-password': requestPasswordReset,
  'update-password': updatePassword,
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const [state, action, pending] = useActionState<AuthActionState | undefined, FormData>(
    ACTIONS[mode],
    undefined,
  );
  const needsEmail = mode !== 'update-password';
  const needsPassword = mode !== 'forgot-password';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0d0b] px-4 py-12 text-[#ecf8f2]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101512] p-7 shadow-2xl shadow-black/30">
        <a href="/" className="text-sm font-medium text-[#7bd8b4]">返回首页</a>
        <h1 className="mt-5 text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#9fb0a9]">{copy.description}</p>

        <form action={action} className="mt-7 space-y-4">
          {needsEmail && (
            <label className="block text-sm font-medium">
              邮箱
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#0a0d0b] px-3 outline-none focus:border-[#45b98e]"
              />
            </label>
          )}
          {needsPassword && (
            <label className="block text-sm font-medium">
              {mode === 'update-password' ? '新密码' : '密码'}
              <input
                name="password"
                type="password"
                minLength={8}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#0a0d0b] px-3 outline-none focus:border-[#45b98e]"
              />
            </label>
          )}
          {mode === 'update-password' && (
            <label className="block text-sm font-medium">
              确认新密码
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#0a0d0b] px-3 outline-none focus:border-[#45b98e]"
              />
            </label>
          )}

          {state?.message && (
            <p
              role="status"
              className={`rounded-lg border px-3 py-2 text-sm ${
                state.ok
                  ? 'border-[#45b98e]/30 bg-[#45b98e]/10 text-[#9ff0cf]'
                  : 'border-red-400/30 bg-red-400/10 text-red-200'
              }`}
            >
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full rounded-lg bg-[#f2c779] px-4 font-semibold text-[#21170a] transition hover:bg-[#ffd98a] disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? copy.pending : copy.submit}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-[#9fb0a9]">
          {mode === 'sign-in' && (
            <>
              <Link href="/forgot-password" className="text-[#7bd8b4]">忘记密码？</Link>
              <Link href="/sign-up" className="text-[#7bd8b4]">创建账号</Link>
            </>
          )}
          {mode === 'sign-up' && (
            <Link href="/sign-in" className="text-[#7bd8b4]">已有账号？返回登录</Link>
          )}
          {mode === 'forgot-password' && (
            <Link href="/sign-in" className="text-[#7bd8b4]">返回登录</Link>
          )}
        </div>
      </div>
    </main>
  );
}
