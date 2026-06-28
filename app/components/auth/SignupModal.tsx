'use client';

import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ArrowRight, CheckCircle, X } from 'lucide-react';
import { Select } from '@/app/components/ui/Select';

const TEAMS = [
  'Portfolio Consulting Group',
  'Equity Specialist',
  'Fixed Income Specialist',
  'Leadership',
  'Guest',
] as const;

const OFFICES = ['Austin', 'Charlotte', 'Santa Monica', 'UK', 'Sydney'] as const;

interface SignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
}

export default function SignupModal({ isOpen, onClose, onSwitchToLogin }: SignupModalProps) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    title: '',
    team: '',
    office: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<'pending' | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', title: '', team: '', office: '' });
      setShowPassword(false);
      setShowConfirm(false);
      setError('');
      setFieldErrors({});
      setIsLoading(false);
      setSuccess(null);
    }
  }, [isOpen]);

  function set(
    field: keyof typeof form,
    transform?: (raw: string) => string
  ) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const next = transform ? transform(e.target.value) : e.target.value;
      setForm(prev => ({ ...prev, [field]: next }));
      setFieldErrors(prev => ({ ...prev, [field]: '' }));
    };
  }

  const capitalizeFirst = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.firstName.trim()) errors.firstName = 'Required';
    if (!form.lastName.trim()) errors.lastName = 'Required';
    if (!form.email.trim()) {
      errors.email = 'Required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Invalid email address';
    }
    if (!form.password) {
      errors.password = 'Required';
    } else if (form.password.length < 10) {
      errors.password = 'Must be at least 10 characters';
    } else if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      errors.password = 'Must contain at least one letter and one number';
    }
    if (!form.confirmPassword) {
      errors.confirmPassword = 'Required';
    } else if (form.password !== form.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    if (!form.title.trim()) errors.title = 'Required';
    if (!form.team) errors.team = 'Required';
    if (!form.office) errors.office = 'Required';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.');
        return;
      }

      if (data.isFirstUser) {
        window.location.href = '/dashboard/interactions-and-trends/client-interactions';
        return;
      }

      setSuccess('pending');
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  // Success state
  if (success === 'pending') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ fontFamily: 'var(--font-geist-sans)' }}
      >
        <div className="absolute inset-0 bg-[#08070b]/80 backdrop-blur-md" />
        <div
          className="relative w-full max-w-[400px] animate-[landingFadeIn_0.35s_ease-out_both]"
          onClick={e => e.stopPropagation()}
        >
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-cyan-500/20 via-transparent to-transparent pointer-events-none" />
          <div className="relative rounded-2xl border border-white/[0.08] bg-[#0a0a0f]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
            <div className="p-8 text-center">
              <button
                onClick={onClose}
                className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-[#6b6b76] hover:text-white hover:border-white/[0.12] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex justify-center mb-4">
                <CheckCircle className="w-12 h-12 text-cyan-500" />
              </div>
              <h2 className="text-[22px] font-[500] tracking-[-0.02em] leading-[1.2] landing-gradient-text mb-2">
                Registration Submitted
              </h2>
              <p className="text-[14px] text-[#6b6b76] mb-6 leading-relaxed">
                Your account is pending admin approval. You&apos;ll be able to sign in once an admin approves your request.
              </p>
              <button
                onClick={onSwitchToLogin}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-[14px] text-cyan-500 border border-white/[0.08] rounded-xl hover:bg-white/[0.04] transition-all"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const inputClass = (field: string) =>
    `w-full px-4 py-3 bg-white/[0.03] border rounded-xl text-white text-[14px] placeholder-[#4b4b54] focus:outline-none focus:ring-1 focus:bg-white/[0.04] transition-all ${
      fieldErrors[field]
        ? 'border-red-500/20 focus:border-red-500/30 focus:ring-red-500/20'
        : 'border-white/[0.06] focus:border-cyan-500/30 focus:ring-cyan-500/20'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ fontFamily: 'var(--font-geist-sans)' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#08070b]/80 backdrop-blur-md" />

      {/* Modal */}
      <div
        className="relative w-full max-w-[440px] animate-[landingFadeIn_0.35s_ease-out_both]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top border gradient */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-cyan-500/20 via-transparent to-transparent pointer-events-none" />

        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0a0a0f]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Top gradient shine */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />

          <div className="p-8 max-h-[90vh] overflow-y-auto">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-[#6b6b76] hover:text-white hover:border-white/[0.12] transition-all z-10"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="mb-8">
              <h2 className="text-[22px] font-[500] tracking-[-0.02em] leading-[1.2] landing-gradient-text">
                Request access
              </h2>
              <p className="text-[14px] text-[#6b6b76] mt-1.5">Create your account to get started</p>
            </div>

            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-red-400 text-[13px]">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">First name</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={set('firstName', capitalizeFirst)}
                    className={inputClass('firstName')}
                    placeholder="First"
                    autoComplete="given-name"
                  />
                  {fieldErrors.firstName && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.firstName}</p>}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Last name</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={set('lastName', capitalizeFirst)}
                    className={inputClass('lastName')}
                    placeholder="Last"
                    autoComplete="family-name"
                  />
                  {fieldErrors.lastName && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.lastName}</p>}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Email address</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  className={inputClass('email')}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                {fieldErrors.email && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.email}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    className={`${inputClass('password')} pr-11`}
                    placeholder="Min 10 characters"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#4b4b54] hover:text-[#9b9ba4] transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.password}</p>}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    className={`${inputClass('confirmPassword')} pr-11`}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#4b4b54] hover:text-[#9b9ba4] transition-colors" tabIndex={-1}>
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.confirmPassword && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.confirmPassword}</p>}
              </div>

              {/* Title */}
              <div>
                <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={set('title')}
                  className={inputClass('title')}
                  placeholder="e.g. Associate, Analyst"
                  autoComplete="organization-title"
                />
                {fieldErrors.title && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.title}</p>}
              </div>

              {/* Team + Office row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Team</label>
                  <Select
                    value={form.team}
                    onValueChange={v => { setForm(prev => ({ ...prev, team: v })); setFieldErrors(prev => ({ ...prev, team: '' })); }}
                    options={TEAMS}
                    placeholder="Select team"
                    hasError={!!fieldErrors.team}
                  />
                  {fieldErrors.team && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.team}</p>}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#9b9ba4] mb-2">Office</label>
                  <Select
                    value={form.office}
                    onValueChange={v => { setForm(prev => ({ ...prev, office: v })); setFieldErrors(prev => ({ ...prev, office: '' })); }}
                    options={OFFICES}
                    placeholder="Select office"
                    hasError={!!fieldErrors.office}
                  />
                  {fieldErrors.office && <p className="text-red-400 text-[12px] mt-1">{fieldErrors.office}</p>}
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
                    Request access
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
              Already have an account?{' '}
              <button onClick={onSwitchToLogin} className="text-cyan-500 hover:text-cyan-400 transition-colors">
                Sign in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
