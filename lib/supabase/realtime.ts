import type {
  RealtimeClientOptions,
  WebSocketLikeConstructor,
} from '@supabase/supabase-js';

class AuthOnlyServerWebSocket {
  constructor() {
    throw new Error('Supabase Realtime is disabled for auth-only server clients.');
  }
}

export const authOnlyRealtimeOptions = {
  transport: AuthOnlyServerWebSocket as unknown as WebSocketLikeConstructor,
} satisfies RealtimeClientOptions;
