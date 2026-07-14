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
