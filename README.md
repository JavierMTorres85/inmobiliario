# inmobiliario — Mercado de vivienda de la Comunidad de Madrid

Análisis del mercado inmobiliario de la Comunidad de Madrid cruzando **demanda** (población), **precio** (€/m² venta), **rentabilidad** (alquiler÷venta) y **esfuerzo** (precio÷renta), por municipio, distrito y barrio. Datos públicos (INE, Ayuntamiento de Madrid, informe de precios de idealista, IGN).

## 🗺️ Panel interactivo (en vivo)

**https://javiermtorres85.github.io/inmobiliario/**

Cinco métricas conmutables (pestañas arriba a la izquierda), tres niveles por zoom (municipios → distritos → **131 barrios oficiales** de Madrid):

| Métrica | Qué muestra |
|---|---|
| **Población** | Crecimiento 2020-2025 (padrón INE). Totales o %; alejando, agregado por 5 zonas. |
| **Precio €/m²** | Venta jun-2026 (informe idealista) con **serie 2021-2026** en la ficha (sparkline, Δ5a, CAGR) para los 44 nodos. |
| **Rentabilidad** | Bruta anual = alquiler×12 ÷ venta. Municipios, distritos y ~86 barrios con ambos datos. |
| **Esfuerzo** | Años de renta neta del hogar medio (INE Atlas de Renta 2023) para comprar 80 m². |
| **Tensión** | Cuadrante oferta-demanda de los 44 nodos (Caliente / Recorrido / Precio↑ sin demanda / Frío). |

En todas: **pincha** un polígono → ficha con rankings ("Nº más caro", "Nº donde más renta el alquiler"…) e insights; botón **"20 similares"** que resalta en verde los más parecidos en la métrica activa. Gris = sin dato público suficiente.

## 📄 Documentos

| Fichero | Qué contiene |
|---|---|
| `Estudio_poblacion_CdM_2020_2025.xlsx` / `.md` | Estudio poblacional y de migración 2020-2025 (Padrón INE): crecimiento por municipio, rankings, agregados por eje metropolitano y patrón espacial. |
| `Madrid_granularidad_densidad_FINAL.xlsx` | 179 municipios + árbol 21 distritos › 131 barrios con población, superficie y **densidad**. |
| `Tension_oferta_demanda_CdM.xlsx` | Dashboard: **tensión oferta-demanda** por nodo con serie de precios 2021-2026; **barrios** (122 zonas idealista); y hoja de **rentabilidad bruta y esfuerzo de compra** (municipios, distritos y barrios). La pata de **oferta** (nº de anuncios) queda pendiente de la API de idealista. |

## Método (resumen)

- **Rentabilidad bruta** = alquiler €/m²/mes × 12 ÷ venta €/m². Venta jun-2026; alquiler abr/jun-2026 (el informe de alquiler publica con algo de retardo). Sin gastos, impuestos ni vacancia.
- **Esfuerzo** = (venta €/m² × 80 m²) ÷ renta neta media por hogar (INE Atlas de Renta, 2023, último publicado). Mide asequibilidad para quien ya vive en la zona.
- **Cruce de barrios**: las *zonas* del informe idealista se casan con los 131 barrios oficiales por nombre (115/122 casadas); los PAU/subzonas (Sanchinarro, Las Tablas…) se integran en su barrio oficial (Valdefuentes, Valverde…).

## Fuentes

- **idealista** — informe público de precios de la vivienda, venta y alquiler (€/m² y series históricas).
- **INE** — Padrón municipal (tabla 2881) y **Atlas de Distribución de Renta de los Hogares** (tabla 31097, renta neta media por hogar 2023).
- **Ayuntamiento de Madrid** — datos abiertos y límites administrativos oficiales (131 barrios, servicio ArcGIS).
- **IGN** — superficies municipales.

*Datos públicos con fines de análisis. Última actualización: julio 2026.*
