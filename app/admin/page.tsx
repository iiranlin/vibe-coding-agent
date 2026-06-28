import { auth, clerkClient } from '@clerk/nextjs/server';
import {
  ensureAppUserForClerkUser,
  listUsersForAdmin,
  UsageConfigurationError,
  UsagePermissionError,
  type AppUser,
} from '../../lib/usage';
import { updateQuotaAction } from './actions';

export const dynamic = 'force-dynamic';

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function getPrimaryEmail(user: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>['users']['getUser']>>) {
  return user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress
    || user.emailAddresses[0]?.emailAddress
    || null;
}

function getDisplayName(user: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>['users']['getUser']>>) {
  return user.fullName || user.username || getPrimaryEmail(user) || user.id;
}

function SetupNotice() {
  return (
    <main className="min-h-screen bg-[#0a0d0b] px-6 py-10 text-[#ecf8f2]">
      <div className="mx-auto max-w-3xl rounded-lg border border-[#f2c779]/30 bg-[#141917] p-6">
        <h1 className="text-2xl font-semibold">权限数据库未配置</h1>
        <p className="mt-3 text-sm leading-6 text-[#b5c4be]">
          请先在 EdgeOne 环境变量中配置 <code>SUPABASE_URL</code> 和
          <code> SUPABASE_SERVICE_ROLE_KEY</code>，并执行
          <code> db/migrations/usage_permissions.sql</code>。
        </p>
      </div>
    </main>
  );
}

function Forbidden() {
  return (
    <main className="min-h-screen bg-[#0a0d0b] px-6 py-10 text-[#ecf8f2]">
      <div className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-[#141917] p-6">
        <h1 className="text-2xl font-semibold">无权访问</h1>
        <p className="mt-3 text-sm leading-6 text-[#b5c4be]">
          只有管理员可以访问额度管理页面。第一个登录并完成用户初始化的账号会自动成为管理员。
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-md bg-[#45b98e] px-4 py-2 text-sm font-semibold text-white"
        >
          返回首页
        </a>
      </div>
    </main>
  );
}

function SignedOut() {
  return (
    <main className="min-h-screen bg-[#0a0d0b] px-6 py-10 text-[#ecf8f2]">
      <div className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-[#141917] p-6">
        <h1 className="text-2xl font-semibold">请先登录</h1>
        <p className="mt-3 text-sm leading-6 text-[#b5c4be]">
          登录后才能访问额度管理页面。
        </p>
        <a
          href="/sign-in"
          className="mt-6 inline-flex rounded-md bg-[#45b98e] px-4 py-2 text-sm font-semibold text-white"
        >
          登录
        </a>
      </div>
    </main>
  );
}

function UserRow({ user }: { user: AppUser }) {
  return (
    <tr className="border-t border-white/10">
      <td className="px-4 py-4 align-top">
        <div className="font-medium text-white">{user.displayName || user.email || '未命名用户'}</div>
        <div className="mt-1 max-w-[260px] truncate text-xs text-[#84938d]">{user.email || user.clerkUserId}</div>
      </td>
      <td className="px-4 py-4 align-top text-sm">
        <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-[#dff8ef]">
          {user.role === 'admin' ? '管理员' : '用户'}
        </span>
      </td>
      <td className="px-4 py-4 align-top text-sm text-[#d8e5df]">
        {formatNumber(user.tokenUsed)}
      </td>
      <td className="px-4 py-4 align-top text-sm text-[#d8e5df]">
        {formatNumber(user.remainingTokens)}
      </td>
      <td className="px-4 py-4 align-top">
        <form action={updateQuotaAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input
            name="tokenQuota"
            type="number"
            min="0"
            step="1000"
            defaultValue={user.tokenQuota}
            className="h-9 w-36 rounded-md border border-white/10 bg-[#0d1210] px-3 text-sm text-white outline-none focus:border-[#45b98e]"
          />
          <select
            name="status"
            defaultValue={user.status}
            className="h-9 rounded-md border border-white/10 bg-[#0d1210] px-2 text-sm text-white outline-none focus:border-[#45b98e]"
          >
            <option value="active">启用</option>
            <option value="disabled">禁用</option>
          </select>
          <button
            type="submit"
            className="h-9 rounded-md bg-[#f2c779] px-3 text-sm font-semibold text-[#21170a] hover:bg-[#ffd98a]"
          >
            保存
          </button>
        </form>
      </td>
    </tr>
  );
}

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) {
    return <SignedOut />;
  }

  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);
    const currentUser = await ensureAppUserForClerkUser({
      clerkUserId: userId,
      email: getPrimaryEmail(clerkUser),
      displayName: getDisplayName(clerkUser),
      locale: 'zh',
    });

    if (currentUser.role !== 'admin' || currentUser.status !== 'active') {
      return <Forbidden />;
    }

    const users = await listUsersForAdmin(userId);

    return (
      <main className="min-h-screen bg-[#0a0d0b] px-6 py-8 text-[#ecf8f2]">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <a href="/" className="text-sm font-medium text-[#7bd8b4]">返回首页</a>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal">额度管理</h1>
              <p className="mt-2 text-sm text-[#b5c4be]">
                为已登录用户分配 AI token 使用额度；扣减由 Agent 运行结束后的 SDK usage 结算。
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#141917] px-4 py-3 text-right">
              <div className="text-xs text-[#84938d]">当前管理员</div>
              <div className="mt-1 text-sm font-semibold">{currentUser.displayName || currentUser.email || userId}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#101512]">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="text-xs uppercase text-[#84938d]">
                  <th className="px-4 py-3 font-semibold">用户</th>
                  <th className="px-4 py-3 font-semibold">角色</th>
                  <th className="px-4 py-3 font-semibold">已用 token</th>
                  <th className="px-4 py-3 font-semibold">剩余额度</th>
                  <th className="px-4 py-3 font-semibold">分配额度</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow key={user.id} user={user} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof UsageConfigurationError) {
      return <SetupNotice />;
    }
    if (error instanceof UsagePermissionError && error.reason === 'admin_required') {
      return <Forbidden />;
    }
    throw error;
  }
}
