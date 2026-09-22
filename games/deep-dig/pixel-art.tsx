/** Original interface icons; canonical Friend artwork is rendered separately, unchanged. */
export type PixelIconName = 'flag' | 'orb' | 'source' | 'mine' | 'find' | 'left' | 'up' | 'down' | 'right';
const ring = 'M5 0h6v2h3v3h2v6h-2v3h-3v2H5v-2H2v-3H0V5h2V2h3z M5 2v2H4v1H2v6h2v1h1v2h6v-2h1v-1h2V5h-2V4h-1V2z';
const coreRing = 'M6 4h4v2h2v4h-2v2H6v-2H4V6h2z M6 6v4h4V6z';
// Stepped silhouette and inset keep the outline pixel-aligned (no SVG stroke).
const arrowOutline = 'M7 1h2v1h1v1h1v1h1v1h1v1h1v1h1v2H12v6H4V9H1V7h1V6h1V5h1V4h1V3h1V2h1z';
const arrowInset = 'M7 2h2v1h1v1h1v1h1v1h1v1h1v1H11v6H5V8H2V7h1V6h1V5h1V4h1V3h1z';

export function PixelIcon({ name }: { name: PixelIconName }) {
  return <svg className="pixel-icon" data-icon={name} viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    {name === 'flag' && <path fill="currentColor" d="M3 1h2v14H3zM5 2h9v6H5z" />}
    {name === 'source' && <><path className="source-outer" fill="var(--pixel-orb)" fillRule="evenodd" d={ring} /><path className="source-inner" fill="var(--pixel-mine)" fillRule="evenodd" d={coreRing} /></>}
    {name === 'orb' && <><path fill="var(--pixel-orb)" fillRule="evenodd" d={ring} /><path fill="var(--pixel-orb)" d="M6 4h4v2h2v4h-2v2H6v-2H4V6h2z" /><path fill="var(--pixel-paper)" d="M5 5h3v2H5z" /></>}
    {name === 'mine' && <><path fill="currentColor" d="M7 0h2v3h2V1h2v2h2v2h-2v2h3v2h-3v2h2v2h-2v2h-2v-2H9v3H7v-3H5v2H3v-2H1v-2h2V9H0V7h3V5H1V3h2V1h2v2h2z" /><path fill="var(--pixel-ink)" d="M5 5h6v6H5z" /><path fill="var(--pixel-paper)" d="M5 5h2v2H5z" /></>}
    {name === 'find' && <><path fill="currentColor" d="M6 0h4v4h2v2h4v4h-4v2h-2v4H6v-4H4v-2H0V6h4V4h2z" /><path fill="var(--pixel-paper)" d="M6 5h2v3H5V6h1z" /></>}
    {['left', 'up', 'down', 'right'].includes(name) && <g transform={`rotate(${{ up: 0, right: 90, down: 180, left: 270 }[name as 'up' | 'right' | 'down' | 'left']} 8 8)`}><path fill="currentColor" fillRule="evenodd" d={`${arrowOutline} ${arrowInset}`} /></g>}
  </svg>;
}

export function SettingsIcon() {
  return <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2.5h5l.6 2.4 1.6.9 2.4-.7 2.5 4.3-1.8 1.7v1.8l1.8 1.7-2.5 4.3-2.4-.7-1.6.9-.6 2.4h-5l-.6-2.4-1.6-.9-2.4.7-2.5-4.3 1.8-1.7v-1.8L2.4 9.4l2.5-4.3 2.4.7 1.6-.9z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9h4l5-4v14l-5-4H3z" />
    {muted ? <path d="m17 9 5 6m0-6-5 6" /> : <><path d="M16 8a6 6 0 0 1 0 8" /><path d="M19 4a11 11 0 0 1 0 16" /></>}
  </svg>;
}
