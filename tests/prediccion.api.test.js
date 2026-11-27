import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas, validación y formato de errores del poroteo con IA, con el service simulado.
vi.mock('../src/services/auth.service.js', () => ({
  getUsuario: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', rol: 'usuario' })),
}));
vi.mock('../src/services/prediccion.service.js', () => ({
  getModelo: vi.fn(),
  analizarProyecto: vi.fn(),
  generarPrediccion: vi.fn(),
  getPrediccion: vi.fn(),
  ajustarVotos: vi.fn(),
  getResultado: vi.fn(),
}));

const servicio = await import('../src/services/prediccion.service.js');
const { AppError } = await import('../src/utils/AppError.js');
const { createApp } = await import('../src/app.js');
const app = createApp();
const UUID = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';
const USER = '11111111-1111-4111-8111-111111111111';

function conSesion() {
  const agent = supertest(app);
  for (const m of ['get', 'post']) {
    const original = agent[m].bind(agent);
    agent[m] = (...args) => original(...args).set('Authorization', 'Bearer prueba');
  }
  return agent;
}

beforeEach(() => vi.clearAllMocks());

describe('rutas públicas de predicción', () => {
  it('GET /api/prediccion/modelo devuelve la versión', async () => {
    servicio.getModelo.mockReturnValue({ version: 'logistica-x', tipo: 'logistica' });
    const res = await supertest(app).get('/api/prediccion/modelo');
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe('logistica-x');
  });

  it('POST /api/prediccion/analizar valida el título', async () => {
    const res = await supertest(app)
      .post('/api/prediccion/analizar')
      .set('X-Session-Mode', 'cookie')
      .set('Origin', 'http://localhost:5173')
      .send({ titulo: 'ab' });
    expect(res.status).toBe(400);
    expect(servicio.analizarProyecto).not.toHaveBeenCalled();
  });
});

describe('POST /api/poroteos/:id/prediccion', () => {
  it('genera con supuestos válidos', async () => {
    servicio.generarPrediccion.mockResolvedValue({
      poroteo: { id: UUID },
      prediccion: { predicciones: [] },
    });
    const body = {
      version: 3,
      supuestos: {
        posturaOficialismo: 'AFIRMATIVO',
        posturasBloque: { 'UNIÓN POR LA PATRIA': 'NEGATIVO' },
      },
    };
    const res = await conSesion().post(`/api/poroteos/${UUID}/prediccion`).send(body);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(servicio.generarPrediccion).toHaveBeenCalledWith(UUID, body, USER);
  });

  it('rechaza supuestos desconocidos y posturas inválidas', async () => {
    let res = await conSesion()
      .post(`/api/poroteos/${UUID}/prediccion`)
      .send({ version: 1, supuestos: { inventado: true } });
    expect(res.status).toBe(400);
    res = await conSesion()
      .post(`/api/poroteos/${UUID}/prediccion`)
      .send({ version: 1, supuestos: { posturaOficialismo: 'AUSENTE' } });
    expect(res.status).toBe(400);
    expect(servicio.generarPrediccion).not.toHaveBeenCalled();
  });

  it('exige sesión', async () => {
    const res = await supertest(app).post(`/api/poroteos/${UUID}/prediccion`).send({ version: 1 });
    expect(res.status).toBe(401);
  });

  it('propaga el conflicto de versión', async () => {
    servicio.generarPrediccion.mockRejectedValue(new AppError(409, 'VERSION_CONFLICT', 'cambió'));
    const res = await conSesion().post(`/api/poroteos/${UUID}/prediccion`).send({ version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('ajustes manuales', () => {
  it('acepta voto null para volver a la predicción', async () => {
    servicio.ajustarVotos.mockResolvedValue({ poroteo: { id: UUID } });
    const body = {
      version: 4,
      ajustes: [
        { diputadoId: 10, voto: null },
        { diputadoId: 11, voto: 'NEGATIVO', motivo: 'Cambió tras la negociación' },
      ],
    };
    const res = await conSesion().post(`/api/poroteos/${UUID}/ajustes`).send(body);
    expect(res.status).toBe(200);
    expect(servicio.ajustarVotos).toHaveBeenCalledWith(UUID, body, USER);
  });

  it('rechaza diputados repetidos, votos inválidos y motivos largos', async () => {
    const casos = [
      {
        version: 1,
        ajustes: [
          { diputadoId: 1, voto: 'AFIRMATIVO' },
          { diputadoId: 1, voto: 'NEGATIVO' },
        ],
      },
      { version: 1, ajustes: [{ diputadoId: 1, voto: 'TALVEZ' }] },
      { version: 1, ajustes: [{ diputadoId: 1, voto: 'NEGATIVO', motivo: 'x'.repeat(501) }] },
      { version: 1, ajustes: [] },
    ];
    for (const body of casos) {
      const res = await conSesion().post(`/api/poroteos/${UUID}/ajustes`).send(body);
      expect(res.status).toBe(400);
    }
    expect(servicio.ajustarVotos).not.toHaveBeenCalled();
  });
});

describe('lecturas', () => {
  it('GET prediccion y resultado con mayoría especial', async () => {
    servicio.getPrediccion.mockResolvedValue({ predicciones: [] });
    servicio.getResultado.mockResolvedValue({ tipoMayoria: 'dos_tercios' });
    expect((await conSesion().get(`/api/poroteos/${UUID}/prediccion`)).status).toBe(200);
    const res = await conSesion().get(`/api/poroteos/${UUID}/resultado?tipoMayoria=dos_tercios`);
    expect(res.status).toBe(200);
    expect(servicio.getResultado).toHaveBeenCalledWith(UUID, 'dos_tercios', USER);
    expect(
      (await conSesion().get(`/api/poroteos/${UUID}/resultado?tipoMayoria=tres_cuartos`)).status,
    ).toBe(400);
  });

  it('id inválido → 400', async () => {
    expect((await conSesion().get('/api/poroteos/no-es-uuid/prediccion')).status).toBe(400);
  });
});
