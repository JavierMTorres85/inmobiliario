# inmobiliario — Mercado de vivienda de la Comunidad de Madrid

Análisis del mercado inmobiliario de la Comunidad de Madrid cruzando **demanda** (población), **precio** (€/m² venta), **rentabilidad** (alquiler÷venta) y **esfuerzo** (precio÷renta), por municipio, distrito y barrio. Datos públicos (INE, Ayuntamiento de Madrid, informe de precios de idealista, IGN).

El panel utiliza MapLibre GL JS y sirve desde el propio repositorio los límites
de municipios, distritos y barrios. El mapa base oscuro procede de CARTO; los
datos temáticos no dependen de una API de geometrías durante la consulta.

## 🗺️ Panel interactivo (en vivo)

**https://javiermtorres85.github.io/inmobiliario/**

Cinco métricas conmutables (pestañas arriba a la izquierda), tres niveles por zoom (municipios → distritos → **131 barrios oficiales** de Madrid):

| Métrica | Qué muestra |
|---|---|
| **Población** | Crecimiento anual equivalente (vista inicial) o cambio total. Municipios 2020-2025; distritos y barrios 2020-2024. |
| **Precio €/m²** | Venta jun-2026 (informe idealista) con **serie 2021-2026** en la ficha (sparkline, Δ5a, CAGR) para los 44 nodos. |
| **Rentabilidad** | Bruta anual = alquiler×12 ÷ venta. Municipios, distritos y ~86 barrios con ambos datos. |
| **Esfuerzo** | Años de renta neta del hogar medio (INE Atlas de Renta 2023) para comprar 80 m². |
| **Demanda-precio** | Cuadrante de 44 nodos basado en crecimiento poblacional y precio (Caliente / Recorrido / Precio↑ sin demanda / Frío). Todavía no incorpora oferta. |

En todas: **pincha** un polígono → ficha con rankings ("Nº más caro", "Nº donde más renta el alquiler"…) e insights; botón **"20 similares"** que resalta en verde los más parecidos en la métrica activa. Gris = sin dato público suficiente.

El panel permite copiar un **enlace reproducible** que conserva métrica, unidad, encuadre, zona seleccionada y comparación. La ficha diferencia siempre el inicio (azul) y el final (naranja) y reúne todos los indicadores disponibles de la zona, omitiendo campos vacíos. El comparador admite dos zonas, indica si la comparación es alta, media o baja y exporta CSV o una imagen SVG. La interfaz incorpora búsqueda por municipio, distrito o barrio, adapta sus controles a móvil y admite navegación por teclado.

En móvil los controles permanecen plegados bajo **Opciones**, la métrica se elige desde un selector táctil y la ficha se abre como panel inferior reducido o ampliable. La leyenda permanece visible y los controles principales respetan un área táctil mínima de 44 px.

La leyenda divide las zonas con datos en cinco grupos cuantiles, evitando
intervalos vacíos o un único grupo dominante. Se pueden acumular varios rangos:
los elegidos conservan el color exacto de su barra y su relieve 3D, mientras el
resto queda blanco y plano. La selección se conserva en el enlace y cada rango
se elimina pulsándolo de nuevo.

La perspectiva **Población 3D** conserva el color de la métrica activa y eleva
cada municipio o distrito según su población actual. La altura usa una raíz
cuadrada declarada para que Madrid no aplaste visualmente al resto. Los barrios
permanecen planos porque el corte actual no contiene población total oficial a
ese nivel. Al entrar se encuadra Madrid en primer plano y la cámara admite giro
horizontal e inclinación vertical con el ratón, además del control de brújula.

El control **Tiempo observado** reproduce únicamente años respaldados por los
campos del corte actual: municipios 2020, 2024 y 2025; distritos 2020, 2023 y
2024. La altura representa la población exacta del corte y el color la tasa
anual equivalente desde la observación anterior. No se interpolan 2021–2023 ni
se presenta una animación anual falsa; completar esos años requerirá incorporar
una serie oficial adicional.

La comparación temporal aparece directamente en la ficha: **azul = inicio** y **naranja = final**, siempre con los años visibles. Los cortes completos se conservan bajo `data/history/`.

## Estructura del panel

- `index.html`: interfaz y estilos.
- `js/dashboard.mjs`: mapa, controles, enlace compartible y comparador.
- `data/municipalities.json`, `districts.json`, `neighborhoods.json` y `zones.json`: datos por nivel geográfico.
- `data/manifest.json`: procedencia, periodo, tipo y cobertura de cada métrica.
- `data/geo/`: límites locales de 179 municipios, 21 distritos y 131 barrios; la visita ya no consulta APIs geográficas externas.
- `data/releases.json` y `data/history/`: índice y copias inmutables de cada corte.

Cada cambio propuesto en una rama o en `main` ejecuta validación automática de Python, pruebas, JSON/GeoJSON, cobertura, credenciales y JavaScript mediante GitHub Actions. Tras publicar, una segunda automatización abre GitHub Pages con Chromium y prueba los flujos esenciales. El mantenimiento está documentado en [`docs/DATA_MAINTENANCE.md`](docs/DATA_MAINTENANCE.md).

La cadena de puntos de restauración y el procedimiento sin `push --force` se
documentan en [`docs/ROLLBACK.md`](docs/ROLLBACK.md).

## 📄 Documentos

| Fichero | Qué contiene |
|---|---|
| `Estudio_poblacion_CdM_2020_2025.xlsx` / `.md` | Estudio poblacional y de migración 2020-2025 (Padrón INE): crecimiento por municipio, rankings, agregados por eje metropolitano y patrón espacial. |
| `Madrid_granularidad_densidad_FINAL.xlsx` | 179 municipios + árbol 21 distritos › 131 barrios con población, superficie y **densidad**. |
| `Tension_oferta_demanda_CdM.xlsx` | Dashboard de **demanda-precio** por nodo con serie de precios 2021-2026; **barrios** (122 zonas idealista); y hoja de **rentabilidad bruta y esfuerzo de compra**. La oferta de anuncios queda pendiente de la API de idealista. |

## Preparación para la API de idealista

Se ha añadido una base Python inactiva para recoger en el futuro totales agregados de anuncios de venta y alquiler, sin publicar credenciales ni anuncios individuales. Incluye OAuth, renovación del token, timeouts, reintentos, paginación, plantilla de localizaciones, pruebas, normalización opcional por 1.000 habitantes o viviendas y un workflow mensual desactivado. La activación está documentada en [`docs/IDEALISTA_API.md`](docs/IDEALISTA_API.md).

Hasta disponer de acceso y datos de oferta, la quinta métrica se denomina **demanda-precio** y no oferta-demanda.

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
