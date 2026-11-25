// One small line-icon set: 24-unit grid drawn at 16–20 px, 1.75 stroke, currentColor, always decorative.
import type { ReactNode } from "react";

const I = (d: ReactNode) => ({ size = 18 }: { size?: number }) => (
  <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{d}</svg>
);

export const IconOverview = I(<><rect x="3.5" y="3.5" width="7" height="8" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="3.5" y="14.5" width="7" height="6" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /></>);
export const IconPlaybooks = I(<><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /><path d="M9 8h6M9 11.5h4" /></>);
export const IconAudit = I(<><path d="M9 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H15" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 11.5h6M9 15h6M9 18.5h3" /></>);
export const IconDemo = I(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IconStore = I(<><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5" /><path d="M5.5 12v8h13v-8M10 20v-4.5h4V20" /></>);
export const IconExternal = I(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>);
export const IconLogout = I(<><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>);

// KPIs
export const IconAvailability = I(<><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></>);
export const IconIncidents = I(<><path d="M12 3.5 21 19.5H3z" /><path d="M12 10v4M12 17h0" /></>);
export const IconReady = I(<><path d="M12 3 19.5 6v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>);

// incident status
export const IconInvestigating = I(<><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>);
export const IconMitigated = I(<><path d="M12 3 19.5 6v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" /></>);
export const IconRecovering = I(<><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4.5h-4.5" /></>);
export const IconResolved = I(<><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);

// files
export const IconDownload = I(<><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 17v2.5h15V17" /></>);
export const IconReport = I(<><path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" /></>);
export const IconPrint = I(<><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="7.5" rx="1.5" /><path d="M7 14h10v6.5H7z" /></>);

const STATUS: Record<string, ReturnType<typeof I>> = {
  Investigating: IconInvestigating, Mitigated: IconMitigated, Recovering: IconRecovering, Resolved: IconResolved,
};
export const StatusIcon = ({ status, size = 14 }: { status?: string; size?: number }) => {
  const C = status ? STATUS[status] : undefined;
  return C ? <C size={size} /> : null;
};
