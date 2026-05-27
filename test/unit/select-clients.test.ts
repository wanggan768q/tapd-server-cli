import { describe, expect, it, vi } from 'vitest';

import { claudeCodeAdapter } from '../../src/installer/adapters/claude-code.js';
import { codexAdapter } from '../../src/installer/adapters/codex.js';
import { cursorAdapter } from '../../src/installer/adapters/cursor.js';
import { opencodeAdapter } from '../../src/installer/adapters/opencode.js';
import {
  NoClientsSelectedError,
  NonInteractiveNoClientError,
  resolveClients,
  UserCancelledError,
} from '../../src/installer/select-clients.js';

const ADAPTERS = [claudeCodeAdapter, codexAdapter, opencodeAdapter, cursorAdapter];

describe('resolveClients — non-empty parsedClients passes through', () => {
  it('returns clients unchanged when single value provided', async () => {
    const result = await resolveClients(['claude-code'], { adapters: ADAPTERS });
    expect(result).toEqual(['claude-code']);
  });

  it('returns clients in input order when multiple values provided', async () => {
    const result = await resolveClients(['codex', 'claude-code'], {
      adapters: ADAPTERS,
    });
    expect(result).toEqual(['codex', 'claude-code']);
  });

  it('dedupes while preserving first-seen order', async () => {
    const result = await resolveClients(
      ['codex', 'claude-code', 'codex', 'cursor', 'claude-code'],
      { adapters: ADAPTERS },
    );
    expect(result).toEqual(['codex', 'claude-code', 'cursor']);
  });

  it('does not invoke prompt when parsedClients is non-empty', async () => {
    const prompt = vi.fn();
    const result = await resolveClients(['claude-code'], {
      adapters: ADAPTERS,
      prompt,
    });
    expect(result).toEqual(['claude-code']);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('resolveClients — TTY interactive entry', () => {
  it('invokes prompt with all adapter choices and returns selection', async () => {
    const prompt = vi.fn().mockResolvedValue(['claude-code', 'codex']);
    const result = await resolveClients([], {
      adapters: ADAPTERS,
      isStdinTty: true,
      isStdoutTty: true,
      prompt,
    });
    expect(result).toEqual(['claude-code', 'codex']);
    expect(prompt).toHaveBeenCalledTimes(1);
    const arg = prompt.mock.calls[0]?.[0] as { message: string; choices: { value: string; name: string }[] };
    expect(arg.choices.map((c) => c.value)).toEqual([
      'claude-code',
      'codex',
      'opencode',
      'cursor',
    ]);
    expect(arg.choices.map((c) => c.name)).toEqual([
      'Claude Code',
      'Codex',
      'OpenCode',
      'Cursor',
    ]);
  });

  it('throws NoClientsSelectedError when prompt returns empty selection', async () => {
    const prompt = vi.fn().mockResolvedValue([]);
    await expect(
      resolveClients([], {
        adapters: ADAPTERS,
        isStdinTty: true,
        isStdoutTty: true,
        prompt,
      }),
    ).rejects.toBeInstanceOf(NoClientsSelectedError);
  });

  it('maps inquirer ExitPromptError to UserCancelledError (Ctrl-C)', async () => {
    const cancelErr = Object.assign(new Error('User force closed the prompt'), {
      name: 'ExitPromptError',
    });
    const prompt = vi.fn().mockRejectedValue(cancelErr);
    await expect(
      resolveClients([], {
        adapters: ADAPTERS,
        isStdinTty: true,
        isStdoutTty: true,
        prompt,
      }),
    ).rejects.toBeInstanceOf(UserCancelledError);
  });
});

describe('resolveClients — non-TTY zero-arg fails fast', () => {
  it('throws NonInteractiveNoClientError when stdin is not TTY', async () => {
    const prompt = vi.fn();
    await expect(
      resolveClients([], {
        adapters: ADAPTERS,
        isStdinTty: false,
        isStdoutTty: true,
        prompt,
      }),
    ).rejects.toBeInstanceOf(NonInteractiveNoClientError);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('throws NonInteractiveNoClientError when stdout is not TTY', async () => {
    const prompt = vi.fn();
    await expect(
      resolveClients([], {
        adapters: ADAPTERS,
        isStdinTty: true,
        isStdoutTty: false,
        prompt,
      }),
    ).rejects.toBeInstanceOf(NonInteractiveNoClientError);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('error includes supported client list', async () => {
    try {
      await resolveClients([], {
        adapters: ADAPTERS,
        isStdinTty: false,
        isStdoutTty: false,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NonInteractiveNoClientError);
      const e = err as NonInteractiveNoClientError;
      expect(e.supported).toEqual(['claude-code', 'codex', 'opencode', 'cursor']);
      expect(e.message).toContain('claude-code');
      expect(e.message).toContain('cursor');
    }
  });
});
