import type { Staff } from '../env';
import { Layout } from './Layout';

type Props = {
  status: number;
  title: string;
  message: string;
  staff?: Staff;
};

/**
 * エラー画面。内部のエラー内容や個人情報は出さない。
 */
export const ErrorPage = ({ status, title, message, staff }: Props) => (
  <Layout title={title} staff={staff}>
    <section class="card">
      <p class="error-code">{status}</p>
      <h1 class="page-title">{title}</h1>
      <p class="error-message">{message}</p>
      <a class="btn btn-primary btn-block" href="/">
        検索画面へ戻る
      </a>
    </section>
  </Layout>
);
