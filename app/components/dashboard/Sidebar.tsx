'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ChevronDown, PieChart, Flame, User, LogOut, Users, PanelLeftClose, PanelLeftOpen, Swords, TrendingUp, Landmark, Bell, Activity, FileChartPie, ChartCandlestick, Settings } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { useAlerts } from '@/app/lib/hooks/useAlerts';
import { NotificationsPopover } from '@/app/components/dashboard/NotificationsPopover';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
  disabled?: boolean;
  activePrefix?: string; // Highlight when pathname starts with this prefix
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Interactions & KPIs',
    items: [
      { label: 'Client Interactions', href: '/dashboard/interactions-and-trends/client-interactions', icon: LayoutDashboard },
      {
        label: 'Client Trends',
        href: '#',
        icon: TrendingUp,
        children: [
          { label: 'Portfolio Trends', href: '/dashboard/interactions-and-trends/portfolio-trends', icon: PieChart },
          { label: 'Ticker Trends', href: '/dashboard/interactions-and-trends/ticker-trends', icon: Flame, disabled: true },
        ],
      },
      { label: 'Team KPIs', href: '/dashboard/kpis', icon: FileChartPie },
    ],
  },
  {
    title: 'Competitive Landscape',
    items: [
      { label: 'Equity', href: '/dashboard/competitive-landscape/equity', icon: ChartCandlestick, disabled: true },
      { label: 'Fixed Income', href: '/dashboard/competitive-landscape/fixed-income', icon: Landmark, disabled: true },
      { label: 'vs. Competitor', href: '/dashboard/competitive-landscape/vs-competitor', icon: Swords, disabled: true },
    ],
  },
];

interface SidebarProps {
  className?: string;
}

// Always display as "First L." (e.g., "Alex Morgan" → "Alex M.")
function formatDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default function Sidebar({ className = '' }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { alerts, refetch: refetchAlerts, dismiss: dismissAlert, clearAll: clearAllAlerts } = useAlerts();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Restore collapsed state from localStorage after mount. Can't use
  // useState lazy-init here because it runs during SSR where localStorage
  // doesn't exist, and a `typeof window` branch would create a hydration
  // mismatch between the SSR HTML (always false) and the first client render.
  // This one-time mount-only setState is exactly the "subscribe to external
  // system" case the rule's docs allow.
  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const getExpandedItemsForPath = (path: string) => {
    const items: string[] = [];
    navSections.forEach(section => {
      section.items.forEach(item => {
        if (item.children && item.children.some(child => path === child.href)) {
          items.push(item.label);
        }
      });
    });
    return items;
  };

  const [expandedItems, setExpandedItems] = useState<string[]>(() => getExpandedItemsForPath(pathname));
  const [disabledTooltipPos, setDisabledTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const prevPathnameRef = useRef(pathname);

  const isActive = (href: string, activePrefix?: string) =>
    activePrefix ? pathname.startsWith(activePrefix) : pathname === href;
  const isParentActive = (item: NavItem) => {
    if (item.children) {
      return item.children.some(child => pathname === child.href);
    }
    return false;
  };

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      const newExpanded = getExpandedItemsForPath(pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedItems(newExpanded);
    }
  }, [pathname]);

  const toggleExpanded = (label: string) => {
    setExpandedItems(prev =>
      prev.includes(label)
        ? prev.filter(item => item !== label)
        : [...prev, label]
    );
  };

  const displayName = user ? formatDisplayName(`${user.firstName} ${user.lastName}`) : '...';

  return (
    <aside className={`${isCollapsed ? 'w-14' : 'w-56'} transition-all duration-200 ${isCollapsed ? '' : 'overflow-x-hidden'} bg-[#111113] flex flex-col font-[family-name:var(--font-inter)] ${className}`}>

      {/* Header: brand (left) + collapse toggle (right) */}
      <div className={`px-2 pt-6 pb-3 flex items-center flex-shrink-0 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!isCollapsed && (
          <span className="ml-2 text-[1.05rem] font-semibold tracking-wide text-white">Insights</span>
        )}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {!isCollapsed && (
            <NotificationsPopover
              alerts={alerts}
              onDismiss={dismissAlert}
              onClearAll={clearAllAlerts}
              onOpen={refetchAlerts}
            >
              <button
                type="button"
                title="Notifications"
                className="relative p-1.5 rounded-md text-muted hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {alerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-red-600 text-white text-[9px] font-bold flex items-center justify-center rounded-full leading-none">
                    {alerts.length > 9 ? '9+' : alerts.length}
                  </span>
                )}
              </button>
            </NotificationsPopover>
          )}
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-muted hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
          >
            {isCollapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        </div>
      </div>

      <div className="border-t border-zinc-800/50 mx-2 my-1.5" />

      {/* Navigation */}
      <nav className="relative flex-1 px-1.5 py-2 ${isCollapsed ? '' : 'overflow-y-auto overflow-x-hidden'}">
        {navSections.map((section) => (
          <div key={section.title} className="mb-3">
            {!isCollapsed && (
              <p className="px-2 text-xs font-medium text-muted uppercase tracking-wider mb-1 opacity-70">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href, item.activePrefix);
                const parentActive = isParentActive(item);
                const hasChildren = item.children && item.children.length > 0;
                const isExpanded = expandedItems.includes(item.label);
                const isDisabled = item.disabled === true;

                if (hasChildren) {
                  if (isDisabled) {
                    return (
                      <div key={item.label} className="relative group">
                        <div className={`w-full flex items-center border-l-2 border-transparent opacity-50 cursor-not-allowed ${isCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-2 py-2'}`}>
                          <div className={`flex items-center ${isCollapsed ? '' : 'gap-2.5'}`}>
                            <Icon className="w-5 h-5 flex-shrink-0 text-muted" />
                            {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide text-muted">{item.label}</span>}
                          </div>
                          {!isCollapsed && <ChevronDown className="w-4 h-4 text-muted" />}
                        </div>
                        {/* Tooltip — "In Development" always; also serves as label when collapsed */}
                        <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                          In Development
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={item.label} className="relative group">
                      <button
                        onClick={() => !isCollapsed && toggleExpanded(item.label)}
                        className={`w-full flex items-center transition-colors border-l-2 ${isCollapsed ? `justify-center px-0 py-2 ${parentActive ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}` : `justify-between px-2 py-2 ${parentActive ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}`}`}
                      >
                        <div className={`flex items-center ${isCollapsed ? '' : 'gap-2.5'}`}>
                          <Icon className="w-5 h-5 flex-shrink-0" />
                          {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">{item.label}</span>}
                        </div>
                        {!isCollapsed && <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                      </button>
                      {/* Tooltip (label in collapsed mode) */}
                      {isCollapsed && (
                        <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                          {item.label}
                        </span>
                      )}
                      {isExpanded && !isCollapsed && (
                        <div className="ml-4 mt-0.5 space-y-0.5">
                          {item.children!.map((child) => {
                            const ChildIcon = child.icon;
                            const childActive = isActive(child.href);
                            const childDisabled = child.disabled === true;

                            if (childDisabled) {
                              return (
                                <div
                                  key={child.href}
                                  className="relative"
                                  onMouseMove={(e) => setDisabledTooltipPos({ x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => setDisabledTooltipPos(null)}
                                >
                                  <div className="w-full flex items-center gap-2.5 px-2 py-1.5 border-l-2 border-transparent opacity-50 cursor-not-allowed">
                                    <ChildIcon className="w-4 h-4 flex-shrink-0 text-muted" />
                                    <span className="text-[0.85rem] font-semibold tracking-wide text-muted">{child.label}</span>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={`w-full flex items-center gap-2.5 px-2 py-1.5 transition-colors border-l-2 ${
                                  childActive
                                    ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm'
                                    : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'
                                }`}
                              >
                                <ChildIcon className="w-4 h-4 flex-shrink-0" />
                                <span className="text-[0.85rem] font-semibold tracking-wide">{child.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                if (isDisabled) {
                  return (
                    <div
                      key={item.href}
                      className="relative"
                      onMouseMove={(e) => setDisabledTooltipPos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setDisabledTooltipPos(null)}
                    >
                      <div className={`w-full flex items-center border-l-2 border-transparent opacity-50 cursor-not-allowed ${isCollapsed ? 'justify-center px-0 py-2' : 'px-2 py-2 gap-2.5'}`}>
                        <Icon className="w-5 h-5 flex-shrink-0 text-muted" />
                        {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide text-muted">{item.label}</span>}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={item.href} className="relative group">
                    <Link
                      href={item.href}
                      className={`w-full flex items-center transition-colors border-l-2 ${isCollapsed ? `justify-center px-0 py-2 ${active ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}` : `px-2 py-2 gap-2.5 ${active ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}`}`}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">{item.label}</span>}
                    </Link>
                    {/* Tooltip (label in collapsed mode) */}
                    {isCollapsed && (
                      <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                        {item.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Admin section — only visible to admins */}
      {user?.role === 'admin' && (
        <div className="px-1.5 pb-1">
          <div className="mb-1">
            {!isCollapsed && (
              <p className="px-2 text-xs font-medium text-muted uppercase tracking-wider mb-0.5 opacity-70">Admin</p>
            )}
            <div className="relative group">
              <Link
                href="/dashboard/activity"
                className={`w-full flex items-center transition-colors border-l-2 ${isCollapsed ? `justify-center px-0 py-2 ${pathname === '/dashboard/activity' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}` : `px-2 py-2 gap-2.5 ${pathname === '/dashboard/activity' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}`}`}
              >
                <Activity className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">Activity</span>}
              </Link>
              {isCollapsed && (
                <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                  Activity
                </span>
              )}
            </div>
            <div className="relative group">
              <Link
                href="/admin/users"
                className={`w-full flex items-center transition-colors border-l-2 ${isCollapsed ? `justify-center px-0 py-2 ${pathname === '/admin/users' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}` : `px-2 py-2 gap-2.5 ${pathname === '/admin/users' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}`}`}
              >
                <Users className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">User Management</span>}
              </Link>
              {isCollapsed && (
                <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                  User Management
                </span>
              )}
            </div>
            <div className="relative group">
              <Link
                href="/admin/settings"
                className={`w-full flex items-center transition-colors border-l-2 ${isCollapsed ? `justify-center px-0 py-2 ${pathname === '/admin/settings' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}` : `px-2 py-2 gap-2.5 ${pathname === '/admin/settings' ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-cyan-400 border-cyan-400 backdrop-blur-sm' : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200 border-transparent'}`}`}
              >
                <Settings className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">Settings</span>}
              </Link>
              {isCollapsed && (
                <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
                  Settings
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer: Logout + divider + User Profile */}
      <div className="relative px-1.5 pt-3 pb-[20px] flex-shrink-0">
        {/* Logout */}
        <div className="relative group">
          <button
            className={`w-full flex items-center text-red-400/70 hover:bg-red-500/[0.06] hover:text-red-400 border-l-2 border-transparent transition-colors ${isCollapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2 py-2'}`}
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/';
            }}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span className="text-[0.9rem] font-semibold tracking-wide">Log Out</span>}
          </button>
          {isCollapsed && (
            <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
              Log Out
            </span>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-800/50 my-2" />

        {/* User Profile */}
        <div className={`relative group flex items-center px-2 py-2 rounded-lg ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-white" />
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[1.21rem] font-semibold text-zinc-200 truncate tracking-wide leading-tight">
                  {displayName}
                </p>
                {user?.role === 'admin' && (
                  <span className="flex-shrink-0 text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider">
                    Admin
                  </span>
                )}
              </div>
            </div>
          )}
          {/* Tooltip with full name when collapsed */}
          {isCollapsed && (
            <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity">
              {user ? `${user.firstName} ${user.lastName}` : '...'}
            </span>
          )}
        </div>
      </div>

      {disabledTooltipPos && (
        <span
          className="fixed px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md whitespace-nowrap pointer-events-none z-50"
          style={{ left: disabledTooltipPos.x + 14, top: disabledTooltipPos.y + 4 }}
        >
          In Development
        </span>
      )}
    </aside>
  );
}
