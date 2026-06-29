'use server';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import {
  updateUserQuotaForAdmin,
  type AppUserStatus,
} from '../../lib/usage';

function parseStatus(value: FormDataEntryValue | null): AppUserStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

export async function updateQuotaAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Authentication required.');
  }

  const targetUserId = String(formData.get('userId') || '');
  const tokenQuota = Number(formData.get('tokenQuota') || 0);
  const status = parseStatus(formData.get('status'));

  if (!targetUserId) {
    throw new Error('Missing target user.');
  }
  if (!Number.isFinite(tokenQuota) || tokenQuota < 0) {
    throw new Error('Token quota must be a non-negative number.');
  }

  await updateUserQuotaForAdmin(userId, targetUserId, Math.floor(tokenQuota), status);
  redirect('/admin');
}
