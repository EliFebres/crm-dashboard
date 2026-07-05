'use client';

import { ArrowRight, ChevronRight } from 'lucide-react';

interface HeroSectionProps {
  announcementText: string;
  announcementCta: string;
  heading: React.ReactNode;
  description: string;
  signUpLabel: string;
  logInLabel: string;
  onAnnouncementClick: () => void;
  onSignUp: () => void;
  onLogIn: () => void;
  // When the visitor is already signed in, show a single "Go to Dashboard" CTA
  // instead of the Sign Up / Log In pair.
  isAuthenticated?: boolean;
  dashboardLabel?: string;
  onGoToDashboard?: () => void;
}

export default function HeroSection({
  announcementText,
  announcementCta,
  heading,
  description,
  signUpLabel,
  logInLabel,
  onAnnouncementClick,
  onSignUp,
  onLogIn,
  isAuthenticated = false,
  dashboardLabel = 'Go to Dashboard',
  onGoToDashboard,
}: HeroSectionProps) {
  return (
    <section className="relative pt-[72px] pb-12 px-6">
      <div className="max-w-[740px] mx-auto text-center">
        {/* Announcement pill */}
        <button onClick={onAnnouncementClick} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.03] mb-8 fade-in cursor-pointer hover:bg-white/[0.06] transition-colors">
          <span className="text-[13px] text-[#b4b4bc]">{announcementText}</span>
          <span className="text-[13px] text-cyan-500 flex items-center gap-0.5">
            {announcementCta} <ChevronRight size={13} />
          </span>
        </button>

        <h1 className="text-[clamp(36px,7vw,72px)] font-[500] leading-[1.05] tracking-[-0.04em] landing-gradient-text mb-6 fade-in-d1">
          {heading}
        </h1>

        <p className="text-[17px] leading-[1.7] text-[#9b9ba4] max-w-[600px] mx-auto mb-10 fade-in-d2">
          {description}
        </p>

        <div className="flex items-center justify-center gap-4 fade-in-d3">
          {isAuthenticated ? (
            <button
              onClick={onGoToDashboard}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-[10px] text-[14px] font-medium transition-colors"
            >
              {dashboardLabel}
              <ArrowRight size={15} />
            </button>
          ) : (
            <>
              <button
                onClick={onSignUp}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-[10px] text-[14px] font-medium transition-colors"
              >
                {signUpLabel}
                <ArrowRight size={15} />
              </button>
              <button
                onClick={onLogIn}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[10px] border border-white/[0.1] text-[14px] font-medium text-[#b4b4bc] hover:text-white hover:border-white/[0.2] transition-colors"
              >
                {logInLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
