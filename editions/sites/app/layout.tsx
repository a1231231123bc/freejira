import type { Metadata } from 'next';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import '../src/styles.css';
export const metadata: Metadata = {
  title: 'Freejira — проекты и команда',
  description:
    'Рабочее пространство для параллельного ведения проектов, совместной работы и AI через MCP.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
