import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trinity World Water Consumption',
  description: 'Daily water consumption tracking for Trinity World residential community',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
