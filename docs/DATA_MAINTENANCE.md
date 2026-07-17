# Mantenimiento de datos y geometrías

## Antes de sustituir un corte

Archivar siempre los JSON actuales. El identificador debe ser estable y la fecha explícita:

```bash
python scripts/create_data_release.py 2026-07-14 \
  --date 2026-07-14 \
  --label "Corte inicial versionado"
```

Cada corte conserva municipios, distritos, barrios, zonas y el manifiesto en `data/history/<id>/`. `data/releases.json` mantiene el índice visible para el panel. El script se niega a sobrescribir una versión existente.

## Después de actualizar datos

Recalcular la cobertura y ejecutar las validaciones:

```bash
python scripts/build_manifest.py
python scripts/build_manifest.py --check
python scripts/validate_repository.py
node --check js/dashboard.mjs
node scripts/check_dashboard.mjs
```

La cobertura no se introduce manualmente: se cuenta desde los campos realmente presentes en cada JSON. GitHub Actions falla si el manifiesto queda desactualizado.

## Actualizar límites geográficos

El panel sirve copias locales para no depender de tres servicios externos durante cada visita:

```bash
python scripts/update_geometries.py
```

El proceso descarga, reduce propiedades, redondea coordenadas y exige exactamente 179 municipios, 21 distritos y 131 barrios. Las fuentes quedan identificadas en `scripts/update_geometries.py` y `THIRD_PARTY_NOTICES.md`.

## Comprobación publicada

`.github/workflows/smoke-pages.yml` se ejecuta tras un despliegue correcto, manualmente y cada lunes. Abre la web con Chromium y comprueba:

- carga de polígonos locales sin errores JavaScript;
- restauración de una zona y comparación desde la URL;
- ficha de calidad e historial por colores;
- cambio de métrica persistido;
- buscador de zonas;
- exportación CSV;
- anchura de controles en móvil.

La prueba manual equivalente requiere Node 22:

```bash
npm ci
npx playwright install chromium
npm run smoke:pages -- https://javiermtorres85.github.io/inmobiliario/
```


## Actualizar series de población

Ejecutar el workflow **Update population data** (Actions → Run workflow), que
descarga INE 2881 (municipios) y Ayto 300557 (distritos y barrios), añade la
serie anual `py` a cada registro, recalcula los campos derivados (resúmenes de
distritos y barrios anclados a 2020-2024) y abre una PR validada. En local:

```bash
python scripts/update_population.py --dry-run   # valida sin escribir
python scripts/update_population.py             # escribe data/*.json
python scripts/build_manifest.py && python scripts/validate_repository.py
```

## Versión de los assets del panel

`index.html` referencia `js/dashboard.mjs?v=<hash>` donde el hash son los 8
primeros caracteres del sha256 del módulo. Tras cualquier cambio en
`js/dashboard.mjs`:

```bash
npm run fix:asset   # reescribe la referencia con el hash actual
```

La validación de CI falla si la referencia queda obsoleta.


## Actualizar precios de idealista

El workflow **Update idealista prices** corre el día 3 de cada mes (y a mano
con Run workflow): reextrae el informe público de venta y alquiler
(municipios, distritos y barrios por zona `zi`), recalcula rentabilidad y
esfuerzo, actualiza los periodos del manifiesto y abre una PR. Las series
2021-2026 y los cuadrantes de demanda-precio no se tocan. En local:

```bash
python scripts/update_prices.py --dry-run
python scripts/update_prices.py
```

Si idealista bloquea a los runners de GitHub, ejecutar en local y abrir la PR
con los JSON resultantes. El job aborta sin escribir si la cobertura cae por
debajo de mínimos (60 municipios venta / 25 alquiler / 21 distritos).
