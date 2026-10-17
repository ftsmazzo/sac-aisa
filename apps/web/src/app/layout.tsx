import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AISA — SAC',
  description: 'SAC em nuvem — reclamações, KPIs, alertas e WhatsApp',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
