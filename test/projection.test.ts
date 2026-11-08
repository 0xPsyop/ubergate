import { describe, it, expect } from 'vitest';
import { project } from '../src/gateway/projection.js';

describe('Response Projection', () => {
  it('returns data unchanged when paths is empty or omitted', () => {
    const data = { user: { id: 1, name: 'Alice' } };
    expect(project(data, [])).toEqual(data);
  });

  it('projects top-level and nested paths', () => {
    const data = {
      id: 1,
      name: 'Alice',
      profile: {
        role: 'engineer',
        address: {
          city: 'San Francisco',
          zip: '94103',
        },
      },
      secret: 'hidden',
    };

    const result = project(data, ['id', 'profile.address.city']);
    expect(result).toEqual({
      id: 1,
      profile: {
        address: {
          city: 'San Francisco',
        },
      },
    });
  });

  it('implicitly traverses arrays for path segments', () => {
    const data = {
      orderId: 'ORD-123',
      items: [
        { sku: 'ITEM-1', qty: 2, price: 10, internalRef: 'x1' },
        { sku: 'ITEM-2', qty: 1, price: 25, internalRef: 'x2' },
      ],
      other: 'skip',
    };

    const result = project(data, ['orderId', 'items.sku', 'items.price']);
    expect(result).toEqual({
      orderId: 'ORD-123',
      items: [
        { sku: 'ITEM-1', price: 10 },
        { sku: 'ITEM-2', price: 25 },
      ],
    });
  });

  it('projects root-level arrays', () => {
    const data = [
      { id: 1, name: 'Alice', extra: 'ignore' },
      { id: 2, name: 'Bob', extra: 'ignore' },
    ];

    const result = project(data, ['name']);
    expect(result).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('silently skips missing paths without error', () => {
    const data = { id: 1, name: 'Alice' };
    const result = project(data, ['id', 'nonexistent', 'missing.nested.path']);
    expect(result).toEqual({ id: 1 });
  });

  it('handles null and undefined input gracefully', () => {
    expect(project(null, ['a.b'])).toBeNull();
    expect(project(undefined, ['a.b'])).toBeUndefined();
  });
});
