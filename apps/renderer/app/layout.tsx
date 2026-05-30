import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { AppHeader } from '@/components/layout/AppHeader';

export const metadata: Metadata = {
  title: 'AudioMorph Studio',
  description: 'Next generation audio transformation',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={cn(GeistSans.variable, GeistMono.variable, 'font-sans')}
    >
      <body className="antialiased">
        <AppHeader />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
