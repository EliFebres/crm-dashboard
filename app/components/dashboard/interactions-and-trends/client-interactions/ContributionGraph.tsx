'use client';

import React, { useMemo } from 'react';
import type { DayData } from '@/app/lib/types/engagements';
import type { ChangeFlash } from '@/app/lib/hooks/useDashboardChanges';
import { FLASH_CLASS } from '@/app/lib/hooks/useDashboardChanges';

interface ContributionGraphProps {
  data: DayData[][];
  contributionChanges?: Map<string, ChangeFlash>;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ContributionGraph({ data, contributionChanges }: ContributionGraphProps) {
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const getLevelColor = (level: number): string => {
    switch (level) {
      case 0: return '#27272a';
      case 1: return '#164e63';
      case 2: return '#0e7490';
      case 3: return '#06b6d4';
      case 4: return '#22d3ee';
      default: return '#27272a';
    }
  };

  // Render exactly the weeks the server sends — the window now tracks the active
  // period filter (see computeContributionData / getContributionWindow).
  const weekCount = Math.max(data.length, 1);
  const flatData = data.flat();

  const monthMarkers = useMemo(() => {
    const markers: { label: string; colIndex: number }[] = [];
    let lastMonth = -1;
    data.forEach((week, weekIndex) => {
      const firstDay = new Date(week[0].date);
      const month = firstDay.getMonth();
      if (month !== lastMonth) {
        markers.push({ label: MONTH_NAMES[month], colIndex: weekIndex });
        lastMonth = month;
      }
    });
    return markers;
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'relative', marginLeft: '32px', marginBottom: '8px', height: '16px' }}>
        {monthMarkers.map(({ label, colIndex }, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${(colIndex / weekCount) * 100}%`,
              fontSize: '10px',
              color: '#71717a',
              fontWeight: 500,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        <div style={{
          display: 'grid',
          gridTemplateRows: 'repeat(5, 1fr)',
          paddingRight: '8px',
          width: '28px',
          alignItems: 'center'
        }}>
          {dayLabels.map((day, i) => (
            <span key={i} style={{ fontSize: '10px', color: '#71717a', textAlign: 'right' }}>{day}</span>
          ))}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${weekCount}, 1fr)`,
          gridTemplateRows: 'repeat(5, 1fr)',
          gap: '3px',
          flex: 1,
          gridAutoFlow: 'column'
        }}>
          {flatData.map((day, index) => {
            const flash = contributionChanges?.get(String(day.date));
            const flashClass = flash ? FLASH_CLASS[flash.kind] : '';
            return (
              <div
                key={index}
                style={{
                  backgroundColor: getLevelColor(day.level),
                  borderRadius: '2px',
                  cursor: 'pointer',
                  minWidth: 0,
                  minHeight: 0,
                  transition: 'background-color 600ms ease-out, transform 200ms ease-out',
                  transform: 'scale(1)',
                }}
                className={`hover:scale-110 ${flashClass}`.trim()}
                title={`${new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n${day.projectCount} project${day.projectCount !== 1 ? 's' : ''}, ${day.adHocCount} ad-hoc${day.adHocCount !== 1 ? 's' : ''}`}
              />
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
        <span style={{ fontSize: '10px', color: '#71717a' }}>Less</span>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: getLevelColor(level),
                borderRadius: '2px'
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: '10px', color: '#71717a' }}>More</span>
      </div>
    </div>
  );
}
