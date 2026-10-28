'use client';
import { useEffect, useState } from 'react';
import App from '../src/App';
export default function Client() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? (
    <App />
  ) : (
    <div className="loading-screen">
      <span className="logo">f</span>
    </div>
  );
}
