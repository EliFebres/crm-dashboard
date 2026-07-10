'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import LoginModal from '@/app/components/auth/LoginModal';
import SignupModal from '@/app/components/auth/SignupModal';
import HeroSection from '@/app/components/landing-page/HeroSection';
import DashboardPreview from '@/app/components/landing-page/DashboardPreview';
import FeatureSections from '@/app/components/landing-page/FeatureSections';
import PlatformRoadmap from '@/app/components/landing-page/PlatformRoadmap';

/* ────────────────────────────────────────────────────────────────
   Linear-style landing page — faithful reproduction of layout,
   typography, and visual design. Swap content to make it your own.
   ──────────────────────────────────────────────────────────────── */

const DASHBOARD_HOME = '/dashboard/interactions-and-trends/client-interactions';

export default function Home() {
  const [authModal, setAuthModal] = useState<'login' | 'signup' | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detect an existing session so signed-in visitors get a single "Go to
  // Dashboard" CTA instead of Sign Up / Log In.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then(res => { if (!cancelled) setIsAuthenticated(res.ok); })
      .catch(() => { if (!cancelled) setIsAuthenticated(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targets = el.querySelectorAll('.scroll-fade-in');
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } }),
      { threshold: 0.2 }
    );
    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      className="min-h-screen bg-[#08070b] text-white overflow-x-hidden"
      style={{ fontFamily: 'var(--font-geist-sans)' }}
    >
      {/* ── Background effects ──────────────────────────────────── */}
      <div className="hero-glow fixed inset-0 pointer-events-none" />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <HeroSection
        announcementText="Now tracking Client Interactions"
        announcementCta="See what's new"
        heading={<>A better way to<br />work together</>}
        description="Meet the new standard for modern software development."
        signUpLabel="Sign Up"
        logInLabel="Log In"
        onAnnouncementClick={() => setAuthModal('login')}
        onSignUp={() => setAuthModal('signup')}
        onLogIn={() => setAuthModal('login')}
        isAuthenticated={isAuthenticated}
        dashboardLabel="Go to Dashboard"
        onGoToDashboard={() => { window.location.href = DASHBOARD_HOME; }}
      />

      {/* ── Hero product image ──────────────────────────────────── */}
      <DashboardPreview className="fade-in-d4" />

      {/* ── Scroll cue — hints that there's more content below the fold ── */}
      <div className="flex justify-center pb-10 -mt-2">
        <button
          type="button"
          onClick={() => window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' })}
          aria-label="Scroll down to see more"
          className="scroll-cue group flex flex-col items-center gap-1.5 cursor-pointer fade-in-d5"
        >
          <span className="text-[11px] uppercase tracking-[0.2em] text-[#6b6b76] transition-colors group-hover:text-[#b4b4bc]">
            Scroll
          </span>
          <ChevronDown size={22} strokeWidth={2.5} className="scroll-cue-arrow text-cyan-400" />
        </button>
      </div>

      {/* ── Feature sections ───────────────────────────────────── */}
      <FeatureSections
        className="scroll-fade-in"
        dashboardHeading={<>Every insight,<br />one dashboard</>}
        dashboardDescription="Track client interactions, analyze portfolio characteristics, and see the tickers clients are using most all from a single platform."
        cards={[
          {
            title: 'Client Interaction Tracking',
            description: 'Visualize team-wide interactions at a glance or dive deep into specific interactions',
            visual: {
              type: 'heatmap',
              grid: [
                [0,1,0,2,1,0,3],
                [1,2,1,0,2,3,1],
                [0,3,2,1,0,1,2],
                [2,1,3,2,1,0,1],
                [1,0,2,3,2,1,0],
                [0,2,1,0,3,2,1],
                [3,1,0,2,1,3,2],
                [1,2,3,1,0,2,0],
                [0,1,2,3,2,1,3],
                [2,0,1,2,3,0,1],
                [1,3,0,1,2,1,2],
                [0,2,1,3,1,2,0],
              ],
            },
          },
          {
            title: 'Portfolio Construction Trends',
            description: 'Analyze the average client portfolio by Department, RD, or other filters',
            visual: {
              type: 'scatter',
              xLabel: 'Value / Growth',
              yLabel: 'Small / Large',
              points: [
                { x: 65, y: 45, r: 5, color: '#06b6d4', o: 0.9 },
                { x: 88, y: 72, r: 6, color: '#06b6d4', o: 1 },
                { x: 120, y: 38, r: 4, color: '#06b6d4', o: 0.7 },
                { x: 145, y: 58, r: 7, color: '#06b6d4', o: 0.85 },
                { x: 72, y: 95, r: 5, color: '#06b6d4', o: 0.75 },
                { x: 155, y: 85, r: 4, color: '#06b6d4', o: 0.6 },
                { x: 100, y: 52, r: 5, color: '#06b6d4', o: 0.8 },
                { x: 132, y: 100, r: 6, color: '#06b6d4', o: 0.7 },
                { x: 50, y: 68, r: 4, color: '#06b6d4', o: 0.65 },
                { x: 170, y: 42, r: 5, color: '#06b6d4', o: 0.9 },
                { x: 110, y: 65, r: 5, color: '#6b6b76', o: 0.9 },
                { x: 78, y: 55, r: 7, color: '#6b6b76', o: 0.75 },
                { x: 140, y: 78, r: 4, color: '#6b6b76', o: 0.8 },
                { x: 58, y: 85, r: 6, color: '#6b6b76', o: 0.65 },
                { x: 165, y: 55, r: 5, color: '#6b6b76', o: 0.7 },
                { x: 95, y: 98, r: 3, color: '#6b6b76', o: 0.6 },
                { x: 125, y: 28, r: 5, color: '#6b6b76', o: 0.85 },
                { x: 48, y: 38, r: 4, color: '#6b6b76', o: 0.7 },
              ],
            },
          },
          {
            title: 'Ticker Trends',
            description: 'Track the tickers clients are using most and easily identify opportunities for NNA',
            visual: { type: 'bars', widths: [100, 86, 73, 54, 45] },
          },
        ]}
        realtimeHeading={<>Stay in sync,<br />in real time</>}
        realtimeDescription="A shared view of your team's activity as it happens; so nothing slips through the cracks."
        features={[
          { title: 'Live activity feed', desc: 'See engagements, portfolio logs, and report requests as they happen.' },
          { title: 'Team-wide visibility', desc: 'One view of what everyone is working on across departments.' },
          { title: 'Filterable by role', desc: 'Drill down to your office, your department, or your own activity.' },
          { title: 'Exportable data', desc: 'Pull what you need into spreadsheets for leadership or compliance.' },
        ]}
        chartTitle="Weekly Activity"
        days={[
          { day: 'Mon', eng: 9, port: 4, rep: 2 },
          { day: 'Tue', eng: 12, port: 3, rep: 4 },
          { day: 'Wed', eng: 7, port: 5, rep: 1 },
          { day: 'Thu', eng: 11, port: 3, rep: 3 },
          { day: 'Fri', eng: 8, port: 3, rep: 2 },
        ]}
        legend={[
          { gradient: 'linear-gradient(180deg, #22d3ee, #0e7490)', label: 'Engagements' },
          { gradient: 'linear-gradient(180deg, #34d399, #047857)', label: 'Portfolios' },
          { gradient: 'linear-gradient(180deg, #38bdf8, #0369a1)', label: 'Reports' },
        ]}
      />

      {/* ── Platform roadmap ───────────────────────────────────── */}
      <PlatformRoadmap
        className="scroll-fade-in"
        heading="Platform Roadmap"
        description="Follow what's shipping, what's next, and where the platform is headed."
        months={[
          { label: 'Jan', year: '26' }, { label: 'Feb', year: '26' }, { label: 'Mar', year: '26' },
          { label: 'Apr', year: '26' }, { label: 'May', year: '26' }, { label: 'Jun', year: '26' },
          { label: 'Jul', year: '26' }, { label: 'Aug', year: '26' }, { label: 'Sep', year: '26' },
          { label: 'Oct', year: '26' }, { label: 'Nov', year: '26' }, { label: 'Dec', year: '26' },
          { label: 'Jan', year: '27' },
        ]}
        currentMonthIndex={3}
        projects={[
          { name: 'Client Interactions', color: '#0891b2', borderColor: '#0891b2', start: 0, width: 46 },
          { name: 'Portfolio Trends', color: '#e90e0e', borderColor: '#e90e0e', start: 46, width: 31 },
          { name: 'Landing Page and User Management', color: '#10b981', borderColor: '#10b981', start: 15, width: 39 },
          { name: 'Ticker Trends', color: '#f59e0b', borderColor: '#f59e0b', start: 31, width: 31 },
        ]}
        features={[
          { title: 'Multi-team projects', desc: 'Collaborate across teams and departments.' },
          { title: 'Interaction automation', desc: 'Auto-log client engagements and reduce manual data entry.' },
          { title: 'Leadership report automation', desc: 'Generate executive summaries and team activity reports on demand.' },
          { title: 'Cross-dashboard insights', desc: 'Data flows between dashboards so actions in one surface automatically in others.' },
          { title: 'Market monitoring dashboard', desc: 'Track yield curves, spreads, and macro signals in one place.' },
          { title: 'Notifications', desc: 'Stay informed with personal project updates.' },
        ]}
      />

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#22d3ee"/>
                  <stop offset="100%" stopColor="#0891b2"/>
                </linearGradient>
              </defs>
              <path d="M50 5A45 45 0 1 1 12 32" stroke="url(#logoGrad)" strokeWidth="8" strokeLinecap="round" fill="none"/>
              <path d="M50 24A26 26 0 1 0 72 66" stroke="url(#logoGrad)" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.4"/>
              <circle cx="50" cy="50" r="7" fill="url(#logoGrad)"/>
            </svg>
            <span className="text-[12px] text-[#6b6b76]">CRM &amp; Insights &copy; {new Date().getFullYear()}</span>
          </div>
          <span className="text-[12px] text-[#6b6b76]">Developed by Eli Febres</span>
        </div>
      </footer>

      {/* Auth modals */}
      <LoginModal
        isOpen={authModal === 'login'}
        onClose={() => setAuthModal(null)}
        onSwitchToSignup={() => setAuthModal('signup')}
      />
      <SignupModal
        isOpen={authModal === 'signup'}
        onClose={() => setAuthModal(null)}
        onSwitchToLogin={() => setAuthModal('login')}
      />
    </div>
  );
}
