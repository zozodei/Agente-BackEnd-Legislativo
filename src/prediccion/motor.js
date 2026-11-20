// Motor de predicción: arma features para los diputados actuales frente a un proyecto nuevo,
// aplica el modelo entrenado y construye los factores auditables + la explicación.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Historia, CLASES, COD, diaDe } from './historia.js';
import { calcularFeatures, buscarVecinos, K_VECINOS, VENTANA_RECIENTES } from './features.js';
import { representar, textoDeProyecto } from './similitud.js';
import { analizarTitulo, clasificarTema, nombreTema, normalizarTexto } from './proyecto.js';
import { gobiernoEn } from './gobiernos.js';
import { predecirProbabilidades, aplicarPosturaDeclarada } from './modelo.js';
import { explicarConPlantilla } from './explicacion.js';

export const DIR_ARTEFACTOS = join(import.meta.dirname, '..', '..', 'data', 'modelo');
const leer = (archivo) => JSON.parse(gunzipSync(readFileSync(join(DIR_ARTEFACTOS, archivo))));

/** Umbrales de los niveles de confianza que ve el usuario. */
export const NIVELES = { alta: 0.75, media: 0.5 };
export const MIN_VOTACIONES = 20; // menos de esto en 2 años = "pocos datos"

export function nivelDeConfianza(confianza, pocosDatos) {
  if (pocosDatos) return 'baja';
  if (confianza >= NIVELES.alta) return 'alta';
  if (confianza >= NIVELES.media) return 'media';
  return 'baja';
}

const redondear = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export class MotorPrediccion {
  constructor({ historia, lsa, modelo }) {
    this.historia = historia;
    this.lsa = { ...lsa, proyeccion: Float32Array.from(lsa.proyeccion) };
    this.modelo = modelo;
    this.version = modelo.version;
  }

  static cargar() {
    return new MotorPrediccion({
      historia: new Historia(leer('historia.json.gz')),
      lsa: leer('lsa.json.gz'),
      modelo: leer('modelo.json.gz'),
    });
  }

  /** Rasgos del proyecto (tema, tipo…) detectados desde el texto; el usuario puede corregirlos. */
  analizar({ titulo, resumen, texto }) {
    const rasgos = analizarTitulo(titulo);
    return {
      tema: clasificarTema(titulo, resumen, String(texto ?? '').slice(0, 3000)),
      tipo: rasgos.tipo,
      dictamen: rasgos.dictamen,
      origenSenado: rasgos.origenSenado,
    };
  }

  representacion(entrada) {
    return representar(textoDeProyecto(entrada), this.lsa);
  }

  /** Votaciones históricas más parecidas a un texto (para mostrar antes de predecir). */
  similares(entrada, { k = K_VECINOS, fecha } = {}) {
    const dia = diaDe(fecha ?? new Date().toISOString());
    const rep = this.representacion(entrada);
    return buscarVecinos(this.historia, rep, dia, k).map(({ iv, sim }) =>
      this.#votacionDTO(iv, sim),
    );
  }

  #votacionDTO(iv, sim) {
    const v = this.historia.votaciones[iv];
    return {
      votacionId: v.id,
      titulo: v.titulo,
      nombreLey: v.nombreLey,
      fecha: v.fecha,
      tema: v.tema,
      resultado: v.resultado,
      conteo: {
        afirmativos: v.conteo[0],
        negativos: v.conteo[1],
        abstenciones: v.conteo[2],
        ausentes: v.conteo[3],
      },
      similitud: redondear(sim, 3),
      url: v.url,
    };
  }

  /**
   * @param {object} entrada { titulo, resumen?, texto?, fecha?, tema?, tipo?, dictamen?, origenSenado?,
   *   esGeneral?, solicitanteDiputadoId?, posturaOficialismo?, posturasBloque?: { [bloque]: voto } }
   * @param {Array<{id:number, personaId:number, bloque:string, nombreCompleto:string}>} diputados
   */
  predecir(entrada, diputados) {
    const h = this.historia;
    const fecha = (entrada.fecha ?? new Date().toISOString()).slice(0, 10);
    const dia = diaDe(fecha);
    const detectados = this.analizar(entrada);
    const proyecto = {
      tema: entrada.tema ?? detectados.tema,
      tipo: entrada.tipo ?? detectados.tipo,
      dictamen: entrada.dictamen !== undefined ? entrada.dictamen : detectados.dictamen,
      origenSenado: entrada.origenSenado ?? detectados.origenSenado,
      esGeneral: entrada.esGeneral ?? true,
    };
    const rep = this.representacion(entrada);
    const claveBloque = (nombre) => normalizarTexto(nombre) || 'sin bloque';

    const sujetos = diputados.map((d) => {
      const persona = h.indicePersona.get(d.personaId) ?? -1;
      return {
        persona,
        grupo: claveBloque(d.bloque),
        bloqueNombre: d.bloque ?? '',
        provincia: h.ultimaProvincia(persona),
      };
    });

    // Supuestos del escenario (opcionales)
    const posturasBloque = new Map();
    for (const [bloque, voto] of Object.entries(entrada.posturasBloque ?? {})) {
      if (voto in COD && COD[voto] <= 2) posturasBloque.set(claveBloque(bloque), COD[voto]);
    }
    let solicitante = null;
    if ((entrada.solicitanteDiputadoId ?? null) !== null) {
      const k = diputados.findIndex((d) => d.id === entrada.solicitanteDiputadoId);
      if (k >= 0) solicitante = { persona: sujetos[k].persona, grupo: sujetos[k].grupo };
    }
    const ofi = entrada.posturaOficialismo;
    const ctx = {
      dia,
      rep,
      ...proyecto,
      solicitante: proyecto.tipo === 'mocion' ? solicitante : null,
      posturaOficialismo: ofi === 'AFIRMATIVO' ? 0 : ofi === 'NEGATIVO' ? 1 : null,
      posturasBloque: posturasBloque.size ? posturasBloque : null,
    };
    const { X, detalles, vecinos, recientes } = calcularFeatures(h, ctx, sujetos);

    const predicciones = diputados.map((d, i) => {
      const det = detalles[i];
      // Supuesto del escenario: el del propio bloque o, para el bloque oficialista, el del oficialismo.
      let declarado = ctx.posturasBloque?.get(sujetos[i].grupo) ?? null;
      if (
        (declarado ?? null) === null &&
        det.oficialista &&
        (ctx.posturaOficialismo ?? null) !== null
      )
        declarado = ctx.posturaOficialismo;
      const p = aplicarPosturaDeclarada(
        predecirProbabilidades(this.modelo, X[i]),
        declarado,
        det.disciplina,
      );
      const probabilidades = Object.fromEntries(CLASES.map((c, k) => [c, redondear(p[k])]));
      let voto = CLASES[0];
      for (const c of CLASES) if (probabilidades[c] > probabilidades[voto]) voto = c;
      const pocosDatos = det.totalVentana < MIN_VOTACIONES;
      const confianza = redondear(probabilidades[voto], 3);
      const factores = this.#factores({
        d,
        det,
        voto,
        probabilidades,
        confianza,
        pocosDatos,
        entrada,
        sujeto: sujetos[i],
      });
      return {
        diputadoId: d.id,
        voto,
        probabilidades,
        confianza,
        nivelConfianza: nivelDeConfianza(confianza, pocosDatos),
        factores,
        explicacion: explicarConPlantilla(factores),
      };
    });

    const esperados = Object.fromEntries(
      CLASES.map((c) => [
        c,
        redondear(
          predicciones.reduce((s, x) => s + x.probabilidades[c], 0),
          1,
        ),
      ]),
    );
    const porVoto = Object.fromEntries(
      CLASES.map((c) => [c, predicciones.filter((x) => x.voto === c).length]),
    );
    const gobierno = gobiernoEn(fecha);
    return {
      versionModelo: this.version,
      fecha,
      proyecto: { ...proyecto, temaNombre: nombreTema(proyecto.tema), detectados },
      supuestos: {
        posturaOficialismo: ofi ?? null,
        posturasBloque: entrada.posturasBloque ?? {},
        solicitanteDiputadoId: ctx.solicitante ? entrada.solicitanteDiputadoId : null,
      },
      gobierno: gobierno ? { presidente: gobierno.presidente, partido: gobierno.partido } : null,
      similares: vecinos.map(({ iv, sim }) => this.#votacionDTO(iv, sim)),
      similaresRecientes: recientes.map(({ iv, sim }) => this.#votacionDTO(iv, sim)),
      resumen: {
        esperados,
        porVoto,
        nivelConfianza: Object.fromEntries(
          ['alta', 'media', 'baja'].map((n) => [
            n,
            predicciones.filter((x) => x.nivelConfianza === n).length,
          ]),
        ),
      },
      predicciones,
    };
  }

  #factores({ d, det, voto, probabilidades, confianza, pocosDatos, entrada, sujeto }) {
    const h = this.historia;
    const nombreVoto = (c) => ((c ?? null) === null ? null : CLASES[c]);
    const similar = (x) => {
      const v = h.votaciones[x.iv];
      return {
        votacionId: v.id,
        titulo: v.titulo,
        fecha: v.fecha,
        similitud: redondear(x.sim, 3),
        voto: nombreVoto(x.voto),
        mayoriaBloque: nombreVoto(x.bloque),
        url: v.url,
      };
    };
    // Unión de vecinos (todas las épocas + recientes), sin repetir, ordenada por similitud.
    const vistos = new Set();
    const similares = [...det.votosEnSimilares, ...det.votosEnRecientes]
      .sort((a, b) => b.sim - a.sim)
      .filter((x) => !vistos.has(x.iv) && vistos.add(x.iv))
      .map(similar);
    const distribucion = (arr) =>
      Object.fromEntries(CLASES.map((c, k) => [c, redondear(arr[k], 3)]));
    const posturaBloque = entrada.posturasBloque
      ? (Object.entries(entrada.posturasBloque).find(
          ([b]) => normalizarTexto(b) === sujeto.grupo,
        )?.[1] ?? null)
      : null;
    return {
      prediccion: { voto, probabilidades, confianza },
      similares,
      bloque: {
        nombre: d.bloque,
        integrantes: det.bloqueTam,
        enSimilares: distribucion(det.bloqueSim),
        enSimilaresRecientes: distribucion(det.bloqueRecientes),
        cobertura: redondear(det.bloqueCobertura, 3),
        cohesion: redondear(det.bloqueCohesion, 3),
      },
      provincia: { enSimilares: distribucion(det.provinciaSim) },
      disciplina: { porcentaje: redondear(det.disciplina, 3), base: det.disciplinaBase },
      oficialismo: {
        alineacion: redondear(det.alineacionOficialismo, 3),
        base: det.alineacionOficialismoBase,
        esBloqueOficialista: Boolean(det.oficialista),
      },
      ausentismo: {
        ultimas10: det.ausentesUltimas10,
        registradas: det.ultimasRegistradas,
        ultimos6Meses: redondear(det.ausentismoReciente, 3),
      },
      historial: {
        ultimosDosAnios: Object.fromEntries(CLASES.map((c, k) => [c, det.conteoVentana[k]])),
      },
      datos: { votacionesUltimosDosAnios: det.totalVentana, pocosDatos },
      supuestos: {
        oficialismo: entrada.posturaOficialismo ?? null,
        bloque: posturaBloque,
      },
      fuentes: similares.slice(0, 5).map((s) => s.votacionId),
      ventanas: {
        similaresTodasLasEpocas: K_VECINOS,
        recientesDias: VENTANA_RECIENTES,
        historialDias: 730,
      },
    };
  }
}
