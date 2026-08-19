'use client';

export type MeetingDetailTab = 'summary' | 'transcript' | 'term-sheet';

interface TabItem {
  id: MeetingDetailTab;
  label: string;
  count?: number | undefined;
}

interface MeetingDetailTabsProps {
  activeTab: MeetingDetailTab;
  onSelectTab: (tab: MeetingDetailTab) => void;
  termSheetCount?: number;
  flagCount?: number;
}

export function MeetingDetailTabs({
  activeTab,
  onSelectTab,
  termSheetCount,
  flagCount,
}: MeetingDetailTabsProps) {
  const tabs: readonly TabItem[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'term-sheet', label: 'Term Sheet', count: termSheetCount },
  ];

  return (
    <div className="border-b border-line bg-surface/50 backdrop-blur-sm sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6">
      <nav className="flex space-x-1 sm:space-x-2" aria-label="Meeting detail sections" role="tablist">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-controls={`tabpanel-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-2 py-3 px-3 sm:px-4 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                isActive
                  ? 'text-brand font-semibold'
                  : 'text-muted hover:text-text hover:bg-raised/50'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-mono font-medium transition ${
                    isActive
                      ? 'bg-brand/15 text-brand border border-brand/30'
                      : 'bg-raised text-muted group-hover:text-text border border-line'
                  }`}
                >
                  {tab.count}
                </span>
              )}
              {tab.id === 'summary' && flagCount !== undefined && flagCount > 0 && (
                <span
                  title={`${String(flagCount)} Shariah concern(s) flagged`}
                  className="inline-flex h-2 w-2 rounded-full bg-warn animate-pulse"
                  aria-label={`${String(flagCount)} Shariah concern(s)`}
                />
              )}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-t-sm shadow-sm" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
