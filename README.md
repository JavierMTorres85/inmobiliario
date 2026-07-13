# inmobiliario — Mercado de vivienda de la Comunidad de Madrid

Análisis del mercado inmobiliario de la Comunidad de Madrid cruzando **demanda** (población y su crecimiento) y **precio** (€/m²), por municipio, distrito y barrio. Datos públicos (INE, Ayuntamiento de Madrid, informe de precios de idealista, IGN).

## 🗺️ Mapa interactivo (en vivo)

**https://javiermtorres85.github.io/inmobiliario/**

Coropleta de crecimiento poblacional 2020-2025:
- Alejas → **5 grandes zonas**; acercas → **municipios**; zoom sobre Madrid → **distritos**.
- Switch **Totales (personas)** / **Porcentaje (%)**.
- **Pincha** en un municipio o distrito para abrir su **ficha**: población y su ranking, crecimiento a 5 años y del último año, con rankings ("Nº que más creció", "Nº que más sumó", "Nº más poblado") e insights de tendencia.
- Botón **"20 con crecimiento similar"**: resalta en **verde** los 20 más parecidos según la métrica activa (totales o %), para comparar zonas.
- Escala de color divergente (rojo = gana población, azul = pierde) y resaltado de zona al pasar el ratón.

## 📄 Documentos

| Fichero | Qué contiene |
|---|---|
| `Estudio_poblacion_CdM_2020_2025.xlsx` / `.md` | Estudio poblacional y de migración 2020-2025 (Padrón INE): crecimiento por municipio, rankings, agregados por eje metropolitano y patrón espacial (contagio por corredores). |
| `Madrid_granularidad_densidad_FINAL.xlsx` | 179 municipios + árbol 21 distritos › 131 barrios con población, superficie y **densidad**, y criterio de relevancia por densidad. |
| `Tension_oferta_demanda_CdM.xlsx` | Dashboard **tensión oferta–demanda** por nodo (municipios tier-A + distritos + barrios): demanda (crecimiento poblacional) vs precio €/m² con **serie de 5 años** (informe público idealista) y cuadrantes (Caliente / Recorrido / …). La 3ª pata, **oferta** (nº de viviendas ≥100.000 €), queda pendiente de la API de idealista. |

## Fuentes
- **INE** — Cifras oficiales de población, Padrón municipal (tabla 2881).
- **Ayuntamiento de Madrid** — datos abiertos (población por distrito y barrio; límites administrativos).
- **idealista** — informe público de precios de la vivienda (€/m² y series históricas).
- **IGN** — superficies municipales.

*Datos públicos con fines de análisis. Última actualización: julio 2026.*
