'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { zhCN } from '@clerk/localizations';
import { PropsWithChildren, useEffect, useState } from 'react';
import {
  LANGUAGE_CHANGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  type AppLocale,
} from './language';

function normalizeLocale(value: unknown): AppLocale | null {
  return value === 'zh' || value === 'en' ? value : null;
}

function getInitialLocale(): AppLocale {
  if (typeof window === 'undefined') {
    return 'zh';
  }

  const stored = normalizeLocale(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function LocalizedClerkProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<AppLocale>('zh');

  useEffect(() => {
    setLocale(getInitialLocale());

    const handleLanguageChange = (event: Event) => {
      const next = normalizeLocale((event as CustomEvent).detail);
      if (next) {
        setLocale(next);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) {
        return;
      }
      const next = normalizeLocale(event.newValue);
      if (next) {
        setLocale(next);
      }
    };

    window.addEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <ClerkProvider localization={locale === 'zh' ? zhCN : undefined}>
      {children}
    </ClerkProvider>
  );
}
