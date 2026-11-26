import { z } from 'zod';
import { listResponse, successResponse } from '@secure360/shared';
import { toListEnvelope, toSuccessEnvelope } from '../../src/http/respond';

const Item = z.object({ id: z.string() }).strict();

describe('toSuccessEnvelope', () => {
  it('matches the shared success envelope', () => {
    const body = toSuccessEnvelope<typeof Item>({ id: 'a' });

    expect(body).toEqual({ success: true, data: { id: 'a' } });
    expect(successResponse(Item).safeParse(body).success).toBe(true);
  });

  it('adds a message only when given', () => {
    const body = toSuccessEnvelope<typeof Item>({ id: 'a' }, 'Saved.');

    expect(body.message).toBe('Saved.');
    expect(successResponse(Item).safeParse(body).success).toBe(true);
  });
});

describe('toListEnvelope', () => {
  it('matches the shared list envelope with meta.nextCursor', () => {
    const body = toListEnvelope<typeof Item>([{ id: 'a' }, { id: 'b' }], 'QUJD');

    expect(body).toEqual({
      success: true,
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { nextCursor: 'QUJD' },
    });
    expect(listResponse(Item).safeParse(body).success).toBe(true);
  });

  it('uses null on the last page', () => {
    const body = toListEnvelope<typeof Item>([], null);

    expect(body.meta.nextCursor).toBeNull();
    expect(listResponse(Item).safeParse(body).success).toBe(true);
  });
});
