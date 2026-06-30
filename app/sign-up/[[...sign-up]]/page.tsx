import { AuthForm } from '../../auth/auth-form';
import { createClient } from '../../../lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function SignUpPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (!error && data?.claims?.sub) {
    redirect('/');
  }

  return <AuthForm mode="sign-up" />;
}
