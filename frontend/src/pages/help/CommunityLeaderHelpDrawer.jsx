import { useEffect, useState } from 'react';
import { SECTIONS } from './communityLeaderHelpContent.jsx';

// Slide-out "?" drawer for the community-leader dashboard. Renders the same
// content as the public /help/community-leader page. Contextual jump: pass
// initialSection to open on a specific accordion by default (e.g., "invite"
// from the referral toolkit page).

export function CommunityLeaderHelpDrawer({ open, onClose, initialSection = 'what' }) {
  const [expanded, setExpanded] = useState(initialSection);

  useEffect(() => {
    if (open) setExpanded(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
      aria-hidden={!open}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Community leader help"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Community leader — help</h2>
            <p className="text-xs text-slate-500">
              <a
                href="/help/community-leader"
                target="_blank"
                rel="noreferrer"
                className="text-rk-700 hover:underline"
              >
                Open the full guide in a new tab
              </a>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close help"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {SECTIONS.map((s) => {
              const isOpen = expanded === s.id;
              return (
                <div key={s.id} className="rounded border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    aria-expanded={isOpen}
                  >
                    {s.title}
                    <span className="text-slate-400">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen ? (
                    <div className="prose prose-sm max-w-none px-3 pb-3 text-slate-700">
                      {s.body}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default CommunityLeaderHelpDrawer;
