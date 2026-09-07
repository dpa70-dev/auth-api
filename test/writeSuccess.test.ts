import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { writeSuccess } from '../src/api/protocol/success.js';

/** Mock mínimo del Response de Express: status() encadena y json()/end() capturan la salida. */
const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  } as unknown as Response);

describe('writeSuccess — envelope de éxito del contrato ({ data })', () => {
  it('emite { data: payload } con el status indicado', () => {
    const res = mockRes();
    writeSuccess(res, 201, { id: 1, email: 'a@b.c' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: { id: 1, email: 'a@b.c' } });
  });

  it('el envelope contiene el payload tal cual: ninguna clave se filtra fuera de { data }', () => {
    const res = mockRes();
    writeSuccess(res, 200, { ok: true });
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } });
    expect(res.json).not.toHaveBeenCalledWith({ ok: true });
  });

  it('data === null: sin body — solo status + end() (204 No Content)', () => {
    const res = mockRes();
    writeSuccess(res, 204, null);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});