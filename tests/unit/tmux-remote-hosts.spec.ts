import { describe, it, expect } from 'vitest';
import { TmuxService } from '../../src/tmux/tmux-service.js';

// Remote tmux hosts: a pane on ssh alias "140" is addressed as "140~session:0.0".
describe('TmuxService remote hosts', () => {
  const tmux = new TmuxService(['140']);

  it('splits a known host prefix off a target', () => {
    expect(tmux.splitHost('140~agj:0.1')).toEqual({ host: '140', local: 'agj:0.1' });
    expect(tmux.splitHost('agj:0.1')).toEqual({ host: null, local: 'agj:0.1' });
  });

  it('treats an unknown host prefix as local (and so invalid)', () => {
    expect(tmux.isRemote('999~agj:0.0')).toBe(false);
    expect(() => tmux.ensureValidTarget('999~agj:0.0')).toThrow();
  });

  it('accepts remote session and pane targets', () => {
    expect(() => tmux.ensureValidTarget('140~agj')).not.toThrow();
    expect(() => tmux.ensureValidTarget('140~agj:0.0')).not.toThrow();
    expect(() => tmux.ensureValidTarget('140~agj;rm -rf ~:0.0')).toThrow();
  });

  it('has no remote hosts unless configured', () => {
    expect(new TmuxService([]).isRemote('140~agj:0.0')).toBe(false);
  });

  it('labels remote sessions for the UI', () => {
    const labelled = new TmuxService(new Map([['140', 'MN'], ['182', 'HS']]));
    expect(labelled.displayName('140~wflow')).toBe('wflow (MN)');
    expect(labelled.displayName('182~media')).toBe('media (HS)');
    expect(labelled.displayName('agj')).toBe('agj');
  });
});
