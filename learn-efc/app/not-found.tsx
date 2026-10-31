import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="tool-page not-found">
      <span className="not-found-code">404</span>
      <h1>This page doesn&apos;t exist</h1>
      <p>
        That&apos;s the status code a server sends when nothing matches the path you asked for. You
        learn exactly how that works in chapter 4.
      </p>
      <div className="hero-actions">
        <Link className="button button-primary" href="/">
          Back to the handbook
        </Link>
        <Link className="button button-quiet" href="/learn/http-basics">
          Read about status codes
        </Link>
      </div>
    </div>
  );
}
