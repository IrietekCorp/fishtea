/**
 * The Fishtea menu on its own, with the linen-shop data from the v1 prototype — the page menu-harness.html
 * loads, for e2e/menu.e2e.ts (SPEC §9). Development only: it is not part of the build.
 *
 * It reports what the menu calls back on `window.menuCalls`, so a test can count them, and takes a few
 * switches from the URL: ?open (the drawer starts open), ?busy, ?theme=oak, ?empty (no turns).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { FishteaMenu } from './FishteaMenu';
import type { Turn } from './types';

const q = new URLSearchParams(location.search);
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme')!;
const calls: { name: string; arg?: unknown }[] = ((window as any).menuCalls = []);
const record = (name: string, arg?: unknown) => calls.push({ name, arg });


const sampleTurns: Turn[] = [
  {
    id: 't1', index: 1, roomId: 'browse', roomLabel: 'Browse',
    utterance: 'something linen for a summer wedding, under £80',
    short: 'linen · wedding · under £80', summary: '12 pieces, £48 to £80',
    shape: 'findProducts', vessel: 'list', at: '2026-10-06T14:14:00',
    preview: { kind: 'swatches', colors: ['#4a3527', '#6b4c36', '#3d3128', '#b08a66'] },
  },
  {
    id: 't2', index: 2, roomId: 'browse', roomLabel: 'Browse',
    utterance: 'something warmer', short: 'warmer', summary: '7 pieces in rust, sand and terracotta',
    shape: 'findProducts', vessel: 'list', at: '2026-10-06T14:16:00',
    preview: { kind: 'swatches', colors: ['#8a4a2e', '#b08a66', '#6b4c36'] },
  },
  {
    id: 't3', index: 3, roomId: 'browse', roomLabel: 'Browse',
    utterance: 'tell me about the Ardmore', short: 'Ardmore shirt', summary: 'Ardmore shirt, £68, 9 in stock',
    shape: 'showProduct', vessel: 'detail', at: '2026-10-06T14:19:00',
  },
  {
    id: 't4', index: 4, roomId: 'browse', roomLabel: 'Browse',
    utterance: 'Ardmore or Harlow?', short: 'Ardmore or Harlow', summary: 'Ardmore £68 against Harlow £74',
    shape: 'compareProducts', vessel: 'compare', at: '2026-10-06T14:22:00',
  },
];

function FishteaMenuDemo() {
  const [current, setCurrent] = useState('t4');
  const [busy, setBusy] = useState(q.has('busy'));

  return (
    <div style={{ background: 'var(--ft-ground)', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <FishteaMenu
          turns={q.has('empty') ? [] : sampleTurns}
          defaultTrailOpen={q.has('open')}
          currentTurnId={current}
          suggestions={[
            'something linen for a summer wedding',
            'where is my order?',
            'how do I wash linen?',
            'can I book a fitting on Saturday?',
          ]}
          busy={busy}
          onSubmit={(text) => { record('submit', text); setBusy(true); }}
          onStop={() => { record('stop'); setBusy(false); }}
          onRewind={(id) => { record('rewind', id); setCurrent(id); }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<FishteaMenuDemo />);
