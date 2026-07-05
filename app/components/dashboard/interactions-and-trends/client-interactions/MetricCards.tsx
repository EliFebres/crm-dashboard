'use client';

import React, { useSyncExternalStore } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { ResponsiveContainer, Cell, AreaChart, Area, PieChart, Pie, Tooltip } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { EngagementMetric } from '@/app/lib/types/engagements';
import type { ChangeFlash, MetricKey } from '@/app/lib/hooks/useDashboardChanges';

// useSyncExternalStore subscription for window.innerWidth — avoids the
// setState-in-effect pattern that fires on mount and on every resize.
const subscribeToResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const getWindowWidth = () => window.innerWidth;
const getServerWindowWidth = () => 0;

interface MetricCardsProps {
  metrics: EngagementMetric[];
  flippedCard: string | null;
  onCardEnter: (cardLabel: string) => void;
  onCardLeave: () => void;
  metricChanges?: Partial<Record<MetricKey, ChangeFlash>>;
}

export default function MetricCards({ metrics, flippedCard, onCardEnter, onCardLeave, metricChanges }: MetricCardsProps) {
  const windowWidth = useSyncExternalStore(subscribeToResize, getWindowWidth, getServerWindowWidth);
  const showCharts = windowWidth >= 1600;

  return (
    <div className="grid grid-cols-4 gap-4">
      {metrics.map((metric, index) => {
        const hasIntakeBreakdown = metric.intakeBreakdown && metric.intakeBreakdown.length > 0;
        const hasIntakeSourceBreakdown = !!metric.intakeSourceBreakdown;
        const isFlippable = hasIntakeBreakdown || hasIntakeSourceBreakdown;
        const isFlipped = flippedCard === metric.label;
        const metricFlash = metricChanges?.[metric.label as MetricKey];
        const metricFlashClass =
          metricFlash?.kind === 'green' ? 'flash-text-green'
          : metricFlash?.kind === 'red' ? 'flash-text-red'
          : '';

        return (
          <div
            key={index}
            className="relative h-[140px] group/card"
            style={{ perspective: '1000px' }}
            onMouseEnter={isFlippable ? () => onCardEnter(metric.label) : undefined}
            onMouseLeave={isFlippable ? onCardLeave : undefined}
          >
            <div
              className="relative w-full h-full transition-transform duration-500"
              style={{
                transformStyle: 'preserve-3d',
                transform: isFlipped ? 'rotateX(180deg)' : 'rotateX(0deg)',
              }}
            >
              {/* Front Face */}
              <div
                className="absolute inset-0 overflow-visible bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl hover:border-zinc-700/50 transition-all duration-300"
                style={{ backfaceVisibility: 'hidden' }}
              >
                {isFlippable && (
                  <div className="absolute top-5 right-4 flex items-center gap-0.5">
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                  </div>
                )}
                <div className="absolute top-3.5 left-5 z-10">
                  <p className="text-white text-[0.8rem]">{metric.label}</p>
                </div>
                <div className="relative z-10 pt-6">
                  <p className={`text-[3rem] font-bold text-white mb-2 tracking-tight leading-none ${metricFlashClass}`}>
                    {metric.value}
                  </p>
                  <div className="flex items-center gap-2 ml-1">
                    <span
                      className={`flex items-center gap-1 text-[0.9rem] font-medium ${metric.isPositive ? 'text-[#39FF14]' : 'text-[#FF3131]'}`}
                      style={{
                        textShadow: metric.isPositive
                          ? '0 0 4px rgba(57, 255, 20, 0.3)'
                          : '0 0 4px rgba(255, 49, 49, 0.3)'
                      }}
                    >
                      {metric.percent === undefined && !metric.sparklineData && !metric.pieData && (metric.isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />)}
                      {metric.change}
                    </span>
                    <span className="text-xs text-muted">{metric.sublabel}</span>
                  </div>
                </div>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                {/* Progress bar for metrics with percent */}
                {metric.percent !== undefined && (
                  <div className="absolute bottom-8 right-4 w-[45%]">
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${metric.percent}%`,
                          backgroundColor: '#39FF14',
                          boxShadow: '0 0 8px rgba(57, 255, 20, 0.5)'
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Sparkline for metrics with trend data */}
                {metric.sparklineData && showCharts && (
                  <div className="absolute bottom-4 right-4 w-[45%] h-10">
                    <ClientOnlyChart>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metric.sparklineData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id={`sparklineGradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={metric.isPositive ? '#39FF14' : '#FF3131'} stopOpacity={0.3} />
                              <stop offset="100%" stopColor={metric.isPositive ? '#39FF14' : '#FF3131'} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke={metric.isPositive ? '#39FF14' : '#FF3131'}
                            strokeWidth={1.5}
                            fill={`url(#sparklineGradient-${index})`}
                            isAnimationActive={true}
                            animationDuration={700}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ClientOnlyChart>
                  </div>
                )}

                {/* Mini donut chart for metrics with pie data */}
                {metric.pieData && metric.pieData.length > 0 && (
                  <div className="absolute bottom-2 right-2 w-16 h-16">
                    <ClientOnlyChart>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={metric.pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={18}
                            outerRadius={28}
                            paddingAngle={2}
                            isAnimationActive={true}
                            animationDuration={700}
                          >
                            {metric.pieData.map((entry, i) => (
                              <Cell key={`cell-${i}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                const total = metric.pieData!.reduce((sum, d) => sum + d.value, 0);
                                const percent = Math.round((data.value / total) * 100);
                                return (
                                  <div className="bg-zinc-800 border border-zinc-700 px-2 py-1 rounded text-xs">
                                    <span style={{ color: data.color }}>{data.name}</span>
                                    <span className="text-muted ml-1">{percent}%</span>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </ClientOnlyChart>
                  </div>
                )}

                {/* NNA distribution tiers */}
                {metric.nnaTiers && metric.nnaTiers.length > 0 && (
                  <div className="absolute bottom-3 right-4 w-[50%] hidden min-[1600px]:block">
                    <div className="space-y-1">
                      {metric.nnaTiers.map((tier, i) => {
                        const maxCount = Math.max(...metric.nnaTiers!.map(t => t.count), 1);
                        const widthPercent = (tier.count / maxCount) * 100;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[9px] text-muted w-12 text-right">{tier.label}</span>
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${widthPercent}%`,
                                  backgroundColor: tier.color,
                                  boxShadow: `0 0 4px ${tier.color}40`
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted w-4 font-mono">{tier.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Back Face - Intake Breakdown (for Ad-Hoc) */}
              {hasIntakeBreakdown && (
                <div
                  className="absolute inset-0 overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-4 rounded-xl"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateX(180deg)',
                  }}
                >
                  <div className="absolute top-4 right-4 flex items-center gap-0.5">
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                  </div>
                  <div className="absolute top-3 left-4 z-10">
                    <p className="text-white text-[0.75rem]">Intake Breakdown</p>
                  </div>
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  <div className="relative z-10 pt-6 space-y-1.5">
                    {metric.intakeBreakdown!.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-[70px] text-[11px] text-muted truncate">{item.intake}</div>
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${item.percent}%`,
                              backgroundColor: item.color,
                              boxShadow: `0 0 6px ${item.color}40`
                            }}
                          />
                        </div>
                        <div className="w-14 text-right">
                          <span className="text-xs text-muted">{item.count}</span>
                          <span className="text-[11px] text-muted ml-1.5">({item.percent}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Back Face - Intake Source Breakdown (for Client Projects) */}
              {hasIntakeSourceBreakdown && (
                <div
                  className="absolute inset-0 overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-4 rounded-xl"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateX(180deg)',
                  }}
                >
                  <div className="absolute top-4 right-4 flex items-center gap-0.5">
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                    <div className="w-1 h-1 bg-white/80 rounded-full" />
                  </div>
                  <div className="absolute top-3 left-4 z-10">
                    <p className="text-white text-[0.75rem]">Source & Portfolios</p>
                  </div>
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  <div className="relative z-10 pt-6 space-y-1">
                    {/* IRQ Bar */}
                    <div className="flex items-center gap-2">
                      <div className="w-[45px] text-[11px] text-muted">IRQ</div>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${metric.intakeSourceBreakdown!.irqPercent}%`,
                            backgroundColor: metric.intakeSourceBreakdown!.irqColor,
                            boxShadow: `0 0 6px ${metric.intakeSourceBreakdown!.irqColor}40`
                          }}
                        />
                      </div>
                      <div className="w-14 text-right">
                        <span className="text-xs text-muted">{metric.intakeSourceBreakdown!.irqCount}</span>
                        <span className="text-[11px] text-muted ml-1.5">({metric.intakeSourceBreakdown!.irqPercent}%)</span>
                      </div>
                    </div>
                    {/* SERF Bar */}
                    <div className="flex items-center gap-2">
                      <div className="w-[45px] text-[11px] text-muted">SERF</div>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${metric.intakeSourceBreakdown!.serfPercent}%`,
                            backgroundColor: metric.intakeSourceBreakdown!.serfColor,
                            boxShadow: `0 0 6px ${metric.intakeSourceBreakdown!.serfColor}40`
                          }}
                        />
                      </div>
                      <div className="w-14 text-right">
                        <span className="text-xs text-muted">{metric.intakeSourceBreakdown!.serfCount}</span>
                        <span className="text-[11px] text-muted ml-1.5">({metric.intakeSourceBreakdown!.serfPercent}%)</span>
                      </div>
                    </div>
                    {/* Divider */}
                    <div className="border-t border-zinc-700/50 my-1" />
                    {/* Portfolios Logged */}
                    <div className="flex items-center gap-2">
                      <div className="w-[45px] text-[11px] text-muted">Logged</div>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${metric.intakeSourceBreakdown!.portfoliosPercent}%`,
                            backgroundColor: '#39FF14',
                            boxShadow: '0 0 6px #39FF1440'
                          }}
                        />
                      </div>
                      <div className="w-14 text-right">
                        <span className="text-xs text-muted">{metric.intakeSourceBreakdown!.portfoliosLogged}</span>
                        <span className="text-[11px] text-muted ml-1.5">({metric.intakeSourceBreakdown!.portfoliosPercent}%)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
