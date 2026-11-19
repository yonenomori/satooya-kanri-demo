import type { Child } from 'hono/jsx';
import type { Staff } from '../env';

type Props = {
  title: string;
  staff?: Staff;
  children: Child;
};

/**
 * 全画面共通の枠。外部 CDN・外部フォントは使わない（CSS は /style.css の1ファイル）。
 */
export const Layout = ({ title, staff, children }: Props) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="theme-color" content="#1E5F52" />
      <title>{title} | 里親・ブリーダー管理</title>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <header class="app-header">
        <a class="app-title" href="/">
          里親・ブリーダー管理
        </a>
        {staff ? <span class="app-staff">{staff.name}</span> : null}
      </header>
      <main class="app-main">{children}</main>
    </body>
  </html>
);
