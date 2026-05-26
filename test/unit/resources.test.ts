import { describe, expect, it, vi } from 'vitest';

import type { TapdHttpClient } from '../../src/api/client.js';
import { TapdApiError } from '../../src/api/errors.js';
import { createProbeService } from '../../src/permissions/probe.js';
import { createSnapshot } from '../../src/permissions/snapshot.js';
import {
  methodForAction,
  pathForAction,
  RESOURCES,
  toolName,
} from '../../src/resources/definitions.js';
import {
  buildInputSchema,
  describeTool,
  executeResourceTool,
} from '../../src/resources/factory.js';

function fakeClient(impl: Partial<TapdHttpClient>): TapdHttpClient {
  return {
    get: impl.get ?? (() => Promise.reject(new Error('not impl'))),
    post: impl.post ?? (() => Promise.reject(new Error('not impl'))),
    close: impl.close ?? (() => Promise.resolve()),
  };
}

const STORIES = RESOURCES.find((r) => r.resource === 'stories')!;
const STORIES_LIST = STORIES.actions.find((a) => a.action === 'list')!;
const STORIES_CREATE = STORIES.actions.find((a) => a.action === 'create')!;

describe('resource definitions', () => {
  it('covers all core resources from §6', () => {
    const names = RESOURCES.map((r) => r.resource);
    for (const expected of [
      'stories',
      'bugs',
      'tasks',
      'iterations',
      'releases',
      'timesheets',
      'comments',
      'attachments',
      'workflows',
      'users',
      'categories',
      'modules',
      'custom-fields',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('builds tool names as tapd.<resource>.<action>', () => {
    expect(toolName(STORIES, STORIES_LIST)).toBe('tapd.stories.list');
    expect(toolName(STORIES, STORIES_CREATE)).toBe('tapd.stories.create');
  });

  it('list path = /<resource>, count path = /<resource>/count', () => {
    expect(pathForAction(STORIES, STORIES_LIST)).toBe('/stories');
    const count = STORIES.actions.find((a) => a.action === 'count')!;
    expect(pathForAction(STORIES, count)).toBe('/stories/count');
  });

  it('list = GET, create = POST', () => {
    expect(methodForAction(STORIES_LIST)).toBe('GET');
    expect(methodForAction(STORIES_CREATE)).toBe('POST');
  });

  it('describeTool prefixes [写操作] for write actions', () => {
    expect(describeTool(STORIES, STORIES_LIST).startsWith('[写操作]')).toBe(false);
    expect(describeTool(STORIES, STORIES_CREATE).startsWith('[写操作]')).toBe(true);
  });
});

describe('buildInputSchema', () => {
  it('enforces workspace_id enum from snapshot', () => {
    const schema = buildInputSchema(STORIES, STORIES_LIST, ['61376769']);
    expect(() => schema.parse({ workspace_id: '99999999' })).toThrow();
    expect(schema.parse({ workspace_id: '61376769' })).toMatchObject({
      workspace_id: '61376769',
    });
  });

  it('requires data for create', () => {
    const schema = buildInputSchema(STORIES, STORIES_CREATE, ['1']);
    expect(() => schema.parse({ workspace_id: '1' })).toThrow();
    expect(
      schema.parse({ workspace_id: '1', data: { name: 'X' } }),
    ).toMatchObject({ data: { name: 'X' } });
  });

  it('falls back to free string when no workspaces (e.g., before snapshot loaded)', () => {
    const schema = buildInputSchema(STORIES, STORIES_LIST, []);
    expect(schema.parse({ workspace_id: 'whatever' })).toMatchObject({
      workspace_id: 'whatever',
    });
  });
});

describe('executeResourceTool', () => {
  it('GET list passes workspace_id, page, limit and filters to query', async () => {
    const snapshot = createSnapshot([{ id: '61376769', name: 'GSTM', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient({ get: () => Promise.resolve([]) }),
      snapshot,
      readTtlSec: 600,
    });
    const get = vi.fn(() => Promise.resolve([{ Story: { id: '1', name: 'x' } }]));
    const client = fakeClient({ get });
    await executeResourceTool(
      STORIES,
      STORIES_LIST,
      {
        workspace_id: '61376769',
        page: 2,
        limit: 50,
        filters: { status: 'open' },
      },
      { client, snapshot, probes },
    );
    expect(get).toHaveBeenLastCalledWith('/stories', {
      workspace_id: '61376769',
      page: 2,
      limit: 50,
      status: 'open',
    });
  });

  it('projects fields via `fields` option', async () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient({ get: () => Promise.resolve([]) }),
      snapshot,
      readTtlSec: 600,
    });
    const get = vi.fn(() =>
      Promise.resolve([
        { Story: { id: '1', name: 'a', status: 'open', custom_field_1: 'noise' } },
        { Story: { id: '2', name: 'b', status: 'open', custom_field_1: 'noise' } },
      ]),
    );
    const result = (await executeResourceTool(
      STORIES,
      STORIES_LIST,
      { workspace_id: '1', fields: ['id', 'name'] },
      { client: fakeClient({ get }), snapshot, probes },
    )) as Array<{ Story: Record<string, unknown> }>;
    expect(result).toHaveLength(2);
    expect(result[0]!.Story).toEqual({ id: '1', name: 'a' });
    expect(result[1]!.Story).toEqual({ id: '2', name: 'b' });
  });

  it('POST create includes workspace_id in body', async () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient({}),
      snapshot,
      readTtlSec: 600,
    });
    const post = vi.fn(() => Promise.resolve({ Story: { id: '99' } }));
    const client = fakeClient({ post });
    await executeResourceTool(
      STORIES,
      STORIES_CREATE,
      { workspace_id: '1', data: { name: 'new', priority: 'P0' } },
      { client, snapshot, probes },
    );
    expect(post).toHaveBeenCalledWith('/stories', {
      name: 'new',
      priority: 'P0',
      workspace_id: '1',
    });
  });

  it('marks write as denied when create returns 403', async () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient({}),
      snapshot,
      readTtlSec: 600,
    });
    const post = vi.fn(() =>
      Promise.reject(
        new TapdApiError({
          kind: 'permission_denied',
          tapdStatus: 403,
          httpStatus: 200,
          info: 'no permission',
        }),
      ),
    );
    const client = fakeClient({ post });
    await expect(
      executeResourceTool(
        STORIES,
        STORIES_CREATE,
        { workspace_id: '1', data: { name: 'x' } },
        { client, snapshot, probes },
      ),
    ).rejects.toMatchObject({ kind: 'permission_denied' });
    expect(probes.isWriteDenied('stories', '1')).toBe(true);
  });

  it('rejects subsequent write calls within 1h cache', async () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient({}),
      snapshot,
      readTtlSec: 600,
    });
    probes.markWriteDenied('stories', '1');
    const post = vi.fn();
    const client = fakeClient({ post });
    await expect(
      executeResourceTool(
        STORIES,
        STORIES_CREATE,
        { workspace_id: '1', data: { name: 'x' } },
        { client, snapshot, probes },
      ),
    ).rejects.toMatchObject({ kind: 'permission_denied' });
    expect(post).not.toHaveBeenCalled();
  });
});
