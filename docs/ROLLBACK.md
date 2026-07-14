# Puntos de restauración y rollback

Cada fase se publicó solo después de validar el repositorio, desplegar GitHub
Pages y ejecutar el smoke test. Las ramas `backup/*` son referencias inmutables
al último estado aceptado antes de la fase siguiente.

| Rama | Estado recuperable |
|---|---|
| `backup/main-antes-mejoras-2026-07-14` | `main` original anterior a las mejoras |
| `backup/v1-current-functional-2026-07-14` | panel funcional anterior al rediseño semántico |
| `backup/v2-semantic-stable-2026-07-14` | escalas y comparación temporal corregidas |
| `backup/v3-mobile-stable-2026-07-14` | experiencia móvil validada, todavía con Leaflet |
| `backup/v4-maplibre-stable-2026-07-14` | MapLibre con paridad funcional, sin nueva leyenda |
| `backup/v5-exploration-stable-2026-07-14` | leyenda interactiva y etiquetas, todavía en 2D |
| `backup/v6-3d-stable-2026-07-14` | vista de población 3D, antes del tiempo observado |

## Procedimiento seguro

No se fuerza `main` ni se borra historial. Para volver a un punto:

1. Crear una rama desde el backup elegido.
2. Abrir un pull request contra `main` que revierta los cambios posteriores.
3. Esperar a que `Validate repository` termine correctamente.
4. Fusionar el PR.
5. Confirmar `pages build and deployment` y `Smoke test published dashboard`.

Ejemplo para recuperar la versión 3D estable anterior al timelapse:

```bash
git fetch origin
git switch -c rollback/v6-3d origin/backup/v6-3d-stable-2026-07-14
git push -u origin rollback/v6-3d
```

Después se abre el PR de restauración. Si el historial de `main` contiene
commits posteriores, se debe usar un PR de reversión o restaurar el árbol del
backup en una rama nueva; nunca `git push --force`.
