import { LocalizedClerkProvider } from './clerk-provider';
import './globals.css';

type Metadata = {
  title?: string;
  description?: string;
};

export const metadata: Metadata = {
  title: 'Web Dev Agent',
  description: 'Build, preview, and download sandbox projects with an AI agent.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <LocalizedClerkProvider>{children}</LocalizedClerkProvider>
      </body>
    </html>
  );
}
