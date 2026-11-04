import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Los services se mockean: estos tests prueban rutas, validación y formato de errores,
// sin tocar Supabase.
vi.mock('../src/services/diputados.service.js', () => ({
  listDiputados: vi.fn(),
  getDiputado: vi.fn(),
  getVotosDiputado: vi.fn(),
  getAllDiputados: vi.fn(),
}));
vi.mock('../src/services/votaciones.service.js', () => ({
  listVotaciones: vi.fn(),
  getVotacion: vi.fn(),
  latestVotaciones: vi.fn(),
}));
vi.mock('../src/services/poroteos.service.js', () => ({
  createPoroteo: vi.fn(),
  listPoroteos: vi.fn(),
  getPoroteo: vi.fn(),
  updatePoroteo: vi.fn(),
  saveVotos: vi.fn(),
  deletePoroteo: vi.fn(),
}));

const diputados = await import('../src/services/diputados.service.js');
const votaciones = await import('../src/services/votaciones.service.js');
const poroteos = await import('../src/services/poroteos.service.js');
const { AppError } = await import('../src/utils/AppError.js');
const { createApp } = await import('../src/app.js');

const app = createApp();
const UUID = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('incluye headers de seguridad de helmet', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('permite el origen configurado', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rechaza orígenes desconocidos', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://malicioso.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_FORBIDDEN');
  });
});

describe('GET /api/diputados', () => {
  it('pasa los filtros validados al service', async () => {
    diputados.listDiputados.mockResolvedValue({ data: [], meta: { total: 0 } });
    const res = await request(app).get('/api/diputados?q=banfi&bloque=PRO&page=2&pageSize=10');
    expect(res.status).toBe(200);
    expect(diputados.listDiputados).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'banfi',
        bloque: 'PRO',
        page: 2,
        pageSize: 10,
        orden: 'apellido',
      }),
    );
  });

  it('rechaza paginación inválida', async () => {
    const res = await request(app).get('/api/diputados?page=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details[0].campo).toBe('query.page');
  });
});

describe('GET /api/diputados/:id', () => {
  it('devuelve el perfil', async () => {
    diputados.getDiputado.mockResolvedValue({ id: 1, apellido: 'Banfi' });
    const res = await request(app).get('/api/diputados/1');
    expect(res.status).toBe(200);
    expect(res.body.data.apellido).toBe('Banfi');
  });

  it('404 con formato consistente', async () => {
    diputados.getDiputado.mockRejectedValue(AppError.notFound('No existe el diputado 9'));
    const res = await request(app).get('/api/diputados/9');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'No existe el diputado 9' } });
  });

  it('valida que el id sea numérico', async () => {
    const res = await request(app).get('/api/diputados/abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/votaciones', () => {
  it('rechaza fechas inexistentes', async () => {
    const res = await request(app).get('/api/votaciones?desde=2025-13-01');
    expect(res.status).toBe(400);
    expect(votaciones.listVotaciones).not.toHaveBeenCalled();
  });

  it('rechaza rango de fechas invertido', async () => {
    const res = await request(app).get('/api/votaciones?desde=2025-05-01&hasta=2025-01-01');
    expect(res.status).toBe(400);
  });

  it('convierte soloGeneral a booleano', async () => {
    votaciones.listVotaciones.mockResolvedValue({ data: [], meta: {} });
    await request(app).get('/api/votaciones?soloGeneral=true&resultado=AFIRMATIVO');
    expect(votaciones.listVotaciones).toHaveBeenCalledWith(
      expect.objectContaining({ soloGeneral: true, resultado: 'AFIRMATIVO' }),
    );
  });
});

describe('Poroteos', () => {
  it('POST crea un poroteo (JSON)', async () => {
    poroteos.createPoroteo.mockResolvedValue({ id: UUID, titulo: 'Ley de prueba' });
    const res = await request(app).post('/api/poroteos').send({ titulo: 'Ley de prueba' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/poroteos/${UUID}`);
    expect(poroteos.createPoroteo).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: 'Ley de prueba', tipoMayoria: 'simple' }),
      undefined,
    );
  });

  it('POST rechaza títulos cortos', async () => {
    const res = await request(app).post('/api/poroteos').send({ titulo: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST rechaza archivos que no son PDF', async () => {
    const res = await request(app)
      .post('/api/poroteos')
      .field('titulo', 'Ley de prueba')
      .attach('archivo', Buffer.from('hola'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PDF/);
  });

  it('GET /:id valida UUID', async () => {
    const res = await request(app).get('/api/poroteos/123');
    expect(res.status).toBe(400);
  });

  it('PUT /:id/votos valida los tipos de voto', async () => {
    const res = await request(app)
      .put(`/api/poroteos/${UUID}/votos`)
      .send({ votos: [{ diputadoId: 1, voto: 'QUIZAS' }] });
    expect(res.status).toBe(400);
  });

  it('PUT /:id/votos rechaza diputados repetidos', async () => {
    const res = await request(app)
      .put(`/api/poroteos/${UUID}/votos`)
      .send({
        votos: [
          { diputadoId: 1, voto: 'AFIRMATIVO' },
          { diputadoId: 1, voto: 'NEGATIVO' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('PUT /:id/votos guarda con modo merge por defecto', async () => {
    poroteos.saveVotos.mockResolvedValue({ id: UUID, votos: [] });
    const res = await request(app)
      .put(`/api/poroteos/${UUID}/votos`)
      .send({ votos: [{ diputadoId: 1, voto: 'AFIRMATIVO' }] });
    expect(res.status).toBe(200);
    expect(poroteos.saveVotos).toHaveBeenCalledWith(UUID, {
      modo: 'merge',
      votos: [{ diputadoId: 1, voto: 'AFIRMATIVO', origen: 'manual' }],
    });
  });

  it('DELETE responde 204', async () => {
    poroteos.deletePoroteo.mockResolvedValue();
    const res = await request(app).delete(`/api/poroteos/${UUID}`);
    expect(res.status).toBe(204);
  });
});

describe('Errores', () => {
  it('404 para rutas inexistentes', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('JSON malformado → 400', async () => {
    const res = await request(app)
      .post('/api/poroteos')
      .set('Content-Type', 'application/json')
      .send('{"titulo":');
    expect(res.status).toBe(400);
  });

  it('errores inesperados → 500 sin filtrar detalles internos del service', async () => {
    diputados.getDiputado.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/diputados/1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
