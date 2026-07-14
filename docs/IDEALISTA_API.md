# Preparación para la API de Idealista

Esta integración queda **inactiva** hasta recibir acceso oficial a Idealista Search API. No hay credenciales, llamadas automáticas ni datos de anuncios en el repositorio.

Idealista exige solicitar una clave y describir el proyecto en <https://developers.idealista.com/access-request>. El formulario público no indica un plazo de respuesta ni un SLA. Si no hay contestación después de 7-10 días laborables, conviene responder al correo de confirmación o reenviar una consulta breve.

## Objetivo

Completar la métrica actual de demanda-precio con la pata de oferta:

- total de anuncios de venta por zona;
- total de anuncios de alquiler;
- oferta por 1.000 habitantes o por 1.000 viviendas;
- evolución mensual de esos totales;
- tensión real entre demanda, precio y oferta disponible.

Solo se publicarán **totales agregados por zona y fecha**. No se guardarán anuncios, direcciones, descripciones, imágenes ni credenciales.

## Componentes preparados

- `scripts/idealista_client.py`: OAuth, renovación preventiva del token, timeout, reintentos para 429/5xx, `Retry-After`, país dinámico y paginación.
- `scripts/update_supply.py`: consulta venta y alquiler y genera JSON agregado.
- `config/idealista_locations.example.json`: plantilla para relacionar códigos propios con `locationId` de Idealista.
- `tests/test_idealista_client.py`: pruebas sin llamadas de red.
- `docs/update-supply.workflow.yml`: plantilla desactivada para una futura ejecución programada.

## Activación cuando llegue la aprobación

1. Confirmar en la documentación recibida los límites, usos permitidos y versión del endpoint.
2. Copiar `config/idealista_locations.example.json` a `config/idealista_locations.json` y sustituir los marcadores por IDs reales. Los IDs no deben inventarse.
3. Instalar dependencias:

   ```bash
   python -m pip install -r requirements-api.txt
   ```

4. Definir las credenciales solo en el entorno local:

   ```bash
   export IDEALISTA_API_KEY="..."
   export IDEALISTA_API_SECRET="..."
   ```

5. Ejecutar una prueba con pocas localizaciones:

   ```bash
   python scripts/update_supply.py \
     --locations config/idealista_locations.json \
     --output data/idealista_supply.json \
     --snapshot-dir data/idealista_supply_history
   ```

6. Revisar los totales y los límites antes de activar cualquier programación.

## Seguridad

- Nunca copiar las credenciales en `index.html`, JSON, capturas, logs o commits.
- Para GitHub Actions, usar exclusivamente `Settings → Secrets and variables → Actions`.
- Mantener la automatización desactivada hasta validar los términos concedidos por Idealista.
- Publicar únicamente agregados necesarios para el análisis.

## Procedencia

El diseño toma como referencia las ideas útiles de `yagueto/idealista-api` (cliente OAuth, objeto de búsqueda y respuesta estructurada), pero incorpora controles adicionales y una salida limitada a agregados. Véase `THIRD_PARTY_NOTICES.md`.

