'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Calendar, ChevronDown, Check, Filter } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/app/components/ui/Popover';
import { Select } from '@/app/components/ui/Select';

export interface FilterOptionGroup {
  label: string;
  options: string[];
}

export interface FilterDropdown {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  options: string[];
  optionGroups?: FilterOptionGroup[]; // Optional grouped options with category headers
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiSelect?: boolean; // Enable multi-select mode
  // When true, the multi-select has no "All X" sentinel: every option is a normal toggle.
  // The trigger label falls back to `label` while nothing is selected. Pair with caller-side
  // logic if you want to enforce a minimum selection.
  noAllOption?: boolean;
}

// Escape hatch for one-off filter buttons that don't fit the standard FilterDropdown
// shape (e.g. hybrid radio + checkbox controls). The caller renders its own trigger via
// `render()`; pass `isActive` to feed the collapsed-pill cyan ring + signature so the
// collapse timer resets when the custom value changes.
export interface CustomFilterEntry {
  id: string;
  render: () => React.ReactNode;
  isActive?: boolean;
  signature?: string;
}

export type FilterEntry = FilterDropdown | CustomFilterEntry;

function isCustomFilterEntry(entry: FilterEntry): entry is CustomFilterEntry {
  return 'render' in entry;
}

export interface PeriodOption {
  value: string;
  label: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '1W', label: '1 Week' },
  { value: '1M', label: '1 Month' },
  { value: '3M', label: '3 Months' },
  { value: '6M', label: '6 Months' },
  { value: 'YTD', label: 'Year to Date' },
  { value: '1Y', label: '1 Year' },
  { value: 'ALL', label: 'All Time' },
];

export interface HeaderTab {
  label: string;
  href: string;
  active: boolean;
}

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filters: FilterEntry[];
  tabs?: HeaderTab[];
  period?: string;
  onPeriodChange?: (value: string) => void;
  periodOptions?: string[]; // Custom period options (e.g., ['1M', '3M', '6M', '1Y', 'ALL'])
  className?: string;
  actionButtonLabel?: string;
  onActionButtonClick?: () => void;
  secondaryActionButtonLabel?: string;
  onSecondaryActionButtonClick?: () => void;
  rightContent?: React.ReactNode;
  alwaysShowFilters?: boolean;
}

// Dropdown component for filters — Popover-based so portal, click-outside,
// keyboard nav, and positioning all come from Radix for free. The body JSX
// (grouped / multi-select / flat) is unchanged.
function FilterDropdownButton({ filter }: { filter: FilterDropdown }) {
  const [isOpen, setIsOpen] = useState(false);
  const IconComponent = filter.icon;

  const isMultiSelect = filter.multiSelect ?? false;
  const noAllOption = isMultiSelect && (filter.noAllOption ?? false);
  const selectedValues = isMultiSelect
    ? (Array.isArray(filter.value) ? filter.value : [])
    : [];
  const allOption = filter.options[0]; // First option is "All" (unless noAllOption)

  const isFiltered = isMultiSelect
    ? selectedValues.length > 0
    : filter.value !== allOption;

  const getDisplayText = () => {
    if (isMultiSelect) {
      if (selectedValues.length === 0) return noAllOption ? filter.label : allOption;
      if (selectedValues.length === 1) return selectedValues[0];
      return `${selectedValues.length} selected`;
    }
    return filter.value as string;
  };

  const handleMultiSelectClick = (option: string) => {
    if (!noAllOption && option === allOption) {
      filter.onChange([]);
      return;
    }
    const newValues = selectedValues.includes(option)
      ? selectedValues.filter(v => v !== option)
      : [...selectedValues, option];
    filter.onChange(newValues);
  };

  const isOptionSelected = (option: string) => {
    if (!noAllOption && option === allOption) return selectedValues.length === 0;
    return selectedValues.includes(option);
  };

  // Select an option in single-select mode and close the popover.
  const selectSingle = (option: string) => {
    filter.onChange(option);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-3 py-2 backdrop-blur-sm border text-sm transition-colors ${
            isFiltered
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
              : 'bg-zinc-900/50 border-zinc-700/50 text-muted hover:bg-zinc-800/50 hover:border-zinc-600/50'
          }`}
        >
          <IconComponent className={`w-4 h-4 ${isFiltered ? 'text-cyan-400' : 'text-muted'}`} />
          {getDisplayText()}
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''} ${isFiltered ? 'text-cyan-400' : 'text-muted'}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[var(--radix-popover-trigger-width)] w-max">
        {filter.optionGroups ? (
          // Grouped options with category headers (single-select only)
          <>
            <button
              key={filter.options[0]}
              onClick={() => selectSingle(filter.options[0])}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                filter.value === filter.options[0]
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-muted hover:bg-white/[0.05]'
              }`}
            >
              {filter.options[0]}
              {filter.value === filter.options[0] && <Check className="w-4 h-4" />}
            </button>
            {filter.optionGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
                  {group.label}
                </div>
                {group.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => selectSingle(option)}
                    className={`w-full flex items-center justify-between pl-5 pr-3 py-2 text-sm text-left transition-colors ${
                      filter.value === option
                        ? 'bg-cyan-500/10 text-cyan-400'
                        : 'text-muted hover:bg-white/[0.05]'
                    }`}
                  >
                    {option}
                    {filter.value === option && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            ))}
          </>
        ) : isMultiSelect ? (
          // Multi-select options with checkboxes
          filter.options.map((option) => (
            <button
              key={option}
              onClick={() => handleMultiSelectClick(option)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                isOptionSelected(option)
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-muted hover:bg-white/[0.05]'
              }`}
            >
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                isOptionSelected(option)
                  ? 'bg-cyan-500 border-cyan-500'
                  : 'border-zinc-600'
              }`}>
                {isOptionSelected(option) && <Check className="w-3 h-3 text-white" />}
              </div>
              {option}
            </button>
          ))
        ) : (
          // Flat single-select options
          filter.options.map((option) => (
            <button
              key={option}
              onClick={() => selectSingle(option)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                filter.value === option
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-muted hover:bg-white/[0.05]'
              }`}
            >
              {option}
              {filter.value === option && <Check className="w-4 h-4" />}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

// Period dropdown — thin wrapper over Select to preserve the blue→cyan gradient trigger.
function PeriodDropdown({ value, onChange, customOptions }: { value: string; onChange: (value: string) => void; customOptions?: string[] }) {
  const options = customOptions
    ? customOptions.map(val => ({ value: val, label: PERIOD_OPTIONS.find(p => p.value === val)?.label || val }))
    : PERIOD_OPTIONS;

  return (
    <Select
      value={value}
      onValueChange={onChange}
      options={options}
      matchTriggerWidth={false}
      triggerClassName="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all focus:outline-none"
      triggerIcon={<Calendar className="w-4 h-4" />}
      triggerLabel={value}
    />
  );
}

export default function DashboardHeader({
  title,
  subtitle,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filters,
  tabs,
  period = '1Y',
  onPeriodChange,
  periodOptions,
  className = '',
  actionButtonLabel,
  onActionButtonClick,
  secondaryActionButtonLabel,
  onSecondaryActionButtonClick,
  rightContent,
  alwaysShowFilters = false,
}: DashboardHeaderProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(alwaysShowFilters);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevFiltersRef = useRef<string>(
    JSON.stringify(filters.map(f => isCustomFilterEntry(f) ? f.signature ?? '' : f.value))
  );
  const isHoveringRef = useRef(false);

  // Check if any filter is active (not on default "All" option)
  const hasActiveFilters = filters.some(filter => {
    if (isCustomFilterEntry(filter)) return filter.isActive ?? false;
    if (filter.multiSelect) {
      return Array.isArray(filter.value) && filter.value.length > 0;
    }
    return filter.value !== filter.options[0];
  });

  // Start or restart the collapse timeout.
  // Wrapped in useCallback so the useEffects below can list it as a dep
  // without firing on every render. Applying or changing a filter counts
  // as activity (resets the timer); only `alwaysShowFilters` suppresses it.
  const startCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
    }
    if (alwaysShowFilters) return;

    collapseTimeoutRef.current = setTimeout(() => {
      if (!isHoveringRef.current && !alwaysShowFilters) {
        setFiltersExpanded(false);
      }
    }, 10000);
  }, [alwaysShowFilters]);

  // Auto-collapse filters after 10 seconds of inactivity
  useEffect(() => {
    if (filtersExpanded) {
      startCollapseTimeout();
    }

    return () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, [filtersExpanded, startCollapseTimeout]);

  // Reset timeout whenever a filter value changes — changing a filter
  // counts as activity, so we restart the countdown rather than cancel it.
  useEffect(() => {
    const currentFilters = JSON.stringify(
      filters.map(f => isCustomFilterEntry(f) ? f.signature ?? '' : f.value)
    );
    if (prevFiltersRef.current !== currentFilters && filtersExpanded) {
      prevFiltersRef.current = currentFilters;
      startCollapseTimeout();
    }
  }, [filters, filtersExpanded, startCollapseTimeout]);

  // Hover handlers for the filters container
  const handleMouseEnter = () => {
    isHoveringRef.current = true;
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
    }
  };

  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    if (filtersExpanded) {
      startCollapseTimeout();
    }
  };

  return (
    <header className={`flex-shrink-0 bg-transparent backdrop-blur-md border-b border-zinc-800/50 relative z-50 ${className}`}>
      <div className="px-6 py-4">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="text-muted text-sm">{subtitle}</p>
        </div>
        {/* Global Filters + Tabs */}
        <div className="flex items-center gap-2 h-9">
          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden ${
              filtersExpanded ? 'max-w-0 opacity-0' : 'max-w-[360px] opacity-100'
            }`}
          >
            <div className="relative w-[360px]">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-zinc-900/50 backdrop-blur-sm border border-zinc-700/50 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
          </div>

          {/* Filter Toggle Button */}
          <button
            onClick={() => { if (!alwaysShowFilters) setFiltersExpanded(!filtersExpanded); }}
            className={`relative flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-500 hover:to-cyan-400 transition-all duration-300 overflow-hidden group/filter ${
              hasActiveFilters ? 'ring-2 ring-cyan-400/50' : ''
            } ${filtersExpanded ? 'w-0 h-0 p-0 opacity-0 -ml-2' : 'w-9 h-9 opacity-100'}`}
          >
            {/* Glass shine animation */}
            {!filtersExpanded && (
              <span
                className="absolute inset-0 pointer-events-none animate-[shine_3s_ease-in-out_infinite]"
                style={{
                  background: 'linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.35) 50%, transparent 80%)',
                }}
              />
            )}
            <Filter className={`relative z-10 w-4 h-4 transition-all duration-300 ${filtersExpanded ? 'scale-0' : 'scale-100'}`} />
            {hasActiveFilters && !filtersExpanded && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-cyan-400 rounded-full z-20" />
            )}
          </button>

          {/* Animated Filters Container */}
          <div
            className={`flex items-center -ml-2 transition-all duration-1000 ease-out whitespace-nowrap ${
              filtersExpanded ? 'max-w-[1000px] opacity-100 gap-2 overflow-visible' : 'max-w-0 opacity-0 gap-0 overflow-hidden'
            }`}
            style={{
              transitionDelay: filtersExpanded ? '200ms' : '0ms'
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {filters.map((filter) =>
              isCustomFilterEntry(filter) ? (
                <React.Fragment key={filter.id}>{filter.render()}</React.Fragment>
              ) : (
                <FilterDropdownButton key={filter.id} filter={filter} />
              )
            )}
            {onPeriodChange ? (
              <PeriodDropdown value={period} onChange={onPeriodChange} customOptions={periodOptions} />
            ) : (
              <button className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all">
                <Calendar className="w-4 h-4" />
                {period}
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
          </div>

          {(actionButtonLabel || secondaryActionButtonLabel || rightContent || (tabs && tabs.length > 0)) && (
            <>
              <div className="flex-1" />
              {rightContent}
              {tabs && tabs.length > 0 && (
                <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 p-1 rounded-lg">
                  {tabs.map((tab) => (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        tab.active
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                          : 'text-muted hover:text-white hover:bg-zinc-700/50'
                      }`}
                    >
                      {tab.label}
                    </Link>
                  ))}
                </div>
              )}
              {secondaryActionButtonLabel && onSecondaryActionButtonClick && (
                <button
                  onClick={onSecondaryActionButtonClick}
                  className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800/80 border border-zinc-700/50 text-white text-sm font-medium hover:bg-zinc-700/80 transition-all rounded-[6px]"
                >
                  {secondaryActionButtonLabel}
                </button>
              )}
              {actionButtonLabel && onActionButtonClick && (
                <button
                  onClick={onActionButtonClick}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all rounded-[6px]"
                >
                  {actionButtonLabel}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
