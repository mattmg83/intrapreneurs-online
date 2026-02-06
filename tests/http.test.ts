import { describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../src/lib/http';

describe('fetchJson', () => {
  it('returns notModified for 304 without parsing body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));

    const result = await fetchJson('/api/rooms/abc');

    expect(result.notModified).toBe(true);
    expect(result.data).toBeNull();
  });

  it('throws helpful error for non-ok responses with empty body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {
            'Content-Length': '0',
          },
        }),
      ),
    );

    await expect(fetchJson('/api/rooms/abc')).rejects.toThrow(
      'Request failed with status 500 Internal Server Error.',
    );
  });

  it('parses success responses normally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      ),
    );

    const result = await fetchJson<{ ok: boolean }>('/api/rooms/abc');

    expect(result.notModified).toBe(false);
    expect(result.data).toEqual({ ok: true });
  });
});
