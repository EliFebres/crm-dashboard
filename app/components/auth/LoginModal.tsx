'use client';

import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ArrowRight, X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToSignup: () => void;
}

export default function LoginModal({ isOpen, onClose, onSwitchToSignup }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setPassword('');
      setShowPassword(false);
      setError('');
      setIsLoading(false);
    }
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Login failed. Please try again.');
        return;
      }

      // Full reload on purpose: the session cookie just changed, so drop all
      // client state and the router cache rather than soft-navigating.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/dashboard/interactions-and-trends/client-interactions';
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ fontFamily: 'var(--font-geist-sans)' }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#08070b]/80 backdrop-blur-md" />

      {/* Modal */}
      <div
        className="relative w-full max-w-[400px] animate-[landingFadeIn_0.35s_ease-out_both]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top border gradient */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-cyan-500/20 via-transparent to-transparent pointer-events-none" />

        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0a0a0f]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Top gradient shine */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />

          <div className="p-8">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-[#6b6b76] hover:text-white hover:border-white/[0.12] transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="mb-8">
              <h2 className="text-[22px] font-[500] tracking-[-0.02em] leading-[1.2] landing-gradient-text">
                Welcome back
              </h2>
              <p className="text-[14px] text-[#6b6b76] mt-1.5">Sign in to your account</p>
            </div>

            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-red-400 text-[13px]">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-white text-[14px] placeholder-[#4b4b54] focus:outline-none focus:border-cyan-500/30 focus:ring-1 focus:ring-cyan-500/20 focus:bg-white/[0.04] transition-all"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-white text-[14px] placeholder-[#4b4b54] focus:outline-none focus:border-cyan-500/30 focus:ring-1 focus:ring-cyan-500/20 focus:bg-white/[0.04] transition-all pr-11"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#4b4b54] hover:text-[#9b9ba4] transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2.5 px-5 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-[14px] rounded-xl transition-all mt-1 shadow-[0_0_20px_-4px_rgba(6,182,212,0.3)] hover:shadow-[0_0_24px_-4px_rgba(6,182,212,0.4)]"
              >
                {isLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[12px] text-[#4b4b54] uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <p className="text-center text-[13px] text-[#6b6b76]">
              Don&apos;t have an account?{' '}
              <button onClick={onSwitchToSignup} className="text-cyan-500 hover:text-cyan-400 transition-colors">
                Request access
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
