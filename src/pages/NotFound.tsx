import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <h2 style={{ color: '#e03131' }}>404 Not Found</h2>
        <p style={{ color: '#868e96', textAlign: 'center' }}>お探しのページは見つかりませんでした。</p>
        <Link to='/'>ホームに戻る</Link>
      </div>
    </div>
  );
}
