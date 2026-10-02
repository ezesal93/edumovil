# EduMovil – Viajes del Gol

App sencilla para que cada integrante anote sus viajes al momento de hacerlos y sepa cuánto debe cuando le toca pagar.

- **La app** (`index.html`) se publica en **GitHub Pages**.
- **Los datos** quedan en una **planilla de Google**. La app la lee y escribe a través de un **Apps Script** publicado como Web App.

| Archivo | Dónde va |
|---|---|
| `index.html` | GitHub (la app) |
| `logoedumovil.png` | GitHub (logo original) |
| `icono-192.png`, `icono-512.png`, `apple-touch-icon.png`, `manifest.json` | GitHub (logo de la app e ícono para "Agregar a pantalla de inicio", generados desde `logoedumovil.png`) |
| `Code.gs` | Apps Script, dentro de la planilla (en GitHub queda solo como respaldo) |

## Paso 1 – Planilla y Apps Script

1. Crea una hoja de cálculo vacía en [sheets.new](https://sheets.new) (por ejemplo "EduMovil").
2. En la hoja: **Extensiones → Apps Script**.
3. En `Código.gs`, borra lo que trae y pega todo **`Code.gs`**. Guarda.
4. En el selector de funciones elige **`setup`** → **Ejecutar** → acepta los permisos (*Configuración avanzada → Ir a … → Permitir*). Se crean las pestañas `Viajes`, `Pagos` y `Config`.
5. **Implementar → Nueva implementación** → engranaje → **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**. Tiene que ser esta opción; "con cuenta de Google" no funciona desde GitHub Pages.
6. Copia la URL que termina en **`/exec`**. Para probarla, ábrela en el navegador: debe mostrar un texto JSON que empieza con `{"ok":true`.

## Paso 2 – Conectar la app

En `index.html`, busca esta línea al inicio del `<script>` y pega tu URL:

```js
const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

## Paso 3 – GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `edumovil`).
2. Sube todos los archivos a la raíz.
3. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. Después de 1 o 2 minutos, la app queda en `https://TU-USUARIO.github.io/edumovil/`.
5. Comparte ese link con el grupo. En el celular: **Agregar a pantalla de inicio**.

## Cambios posteriores

- **Cambié `index.html`:** súbelo de nuevo a GitHub y listo.
- **Cambié `Code.gs`:** **Implementar → Administrar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar**. Así la URL `/exec` no cambia y no hay que tocar `index.html`.
- **Tarifa o nombres:** se cambian en la pestaña `Config` (`costoViaje`, `usuarios`). No hace falta tocar el código.

## Cómo funciona

- Al registrar se elige el día y si fue **Ida**, **Vuelta** o **Ida y vuelta**. Cada tramo es un viaje (una fila en `Viajes`) y cuesta `costoViaje`.
- El pago se hace **fuera de la app**, entre ustedes. "Ya pagué" solo anota cuánto pagaste: **todo** u **otro monto**. Cada pago cubre primero los viajes más antiguos. Lo que no alcanza a completar un viaje queda como abono y se descuenta de la deuda.
- Cada cambio se guarda primero en el teléfono y se envía a la planilla. Si no hay señal, se envía solo cuando vuelve.

## Ojo con la privacidad

La URL `/exec` queda escrita dentro de `index.html`, y el repositorio es público. Con esa URL cualquiera podría ver los nombres y las deudas, o registrar viajes. La app no guarda datos bancarios ni nada más sensible. Aun así, comparte el link solo con el grupo.
