# Dosman · Sistema de ventas, caja e inventario

Sistema interno de **Dosman Cholao & Coffee** para dos sedes: la principal surte a la pequeña.
Ventas por mesa, mostrador, para llevar, parque y domicilio; turnos de caja con cuadre; inventario
por recetas; envíos entre sedes; gastos; reportes y control anti-pérdidas para los dueños.

## Stack

| Parte                              | Tecnología                                                        | Costo                |
| ---------------------------------- | ----------------------------------------------------------------- | -------------------- |
| App (PWA)                          | Vite + React 19 + TypeScript + Tailwind 4 + TanStack Router/Query | —                    |
| Base de datos, login y tiempo real | Supabase (plan Free, región São Paulo)                            | Gratis               |
| Hosting y API                      | Cloudflare Workers (archivos estáticos + `/api/*`)                | Gratis               |
| Fotos (productos y recibos)        | Cloudflare R2, solo a través del Worker                           | Gratis hasta 10 GB   |
| Avisos al dueño                    | Bot de Telegram (cron del Worker)                                 | Gratis               |
| Asistente de ayuda                 | Cloudflare Workers AI                                             | Gratis (cupo diario) |

## Estructura

```
src/
  routes/            Pantallas (rutas por archivo de TanStack Router)
    login.tsx        Ingreso con usuario + PIN de 6 dígitos
    _app.tsx         Área protegida (requiere sesión activa)
    _app/*.tsx       Un archivo por módulo
  config/modules.ts  Módulos, a qué roles se muestran y en qué sede
  features/auth/     Sesión, perfil del empleado y sede activa
  components/        UI base, marca y estructura (barra lateral, sin internet, actualización)
  styles/index.css   Colores y tipografía de la marca
worker/              API en Cloudflare: fotos (R2), empleados, avisos, asistente y crons
docs/                Guía de puesta en marcha (PUESTA-EN-MARCHA.md)
supabase/migrations/ Esquema completo de la base de datos, en orden
public/brand/        Logos oficiales en SVG (sacados del manual de marca)
```

## Desarrollo local

```bash
yarn install
cp .env.example .env.local        # datos de Supabase para la app
cp .dev.vars.example .dev.vars    # los mismos datos para el Worker en local
yarn dev                          # app + Worker en http://localhost:5173
```

Antes de cada commit: `yarn typecheck` y `yarn lint` deben quedar sin errores.

## Puesta en marcha (una sola vez)

La guía completa, con la verificación final y la configuración del primer día, está en
[`docs/PUESTA-EN-MARCHA.md`](docs/PUESTA-EN-MARCHA.md). Resumen:

### 1. Supabase

1. Crear el proyecto `dosman-system` en la región **South America (São Paulo)**.
2. **Authentication → Sign In / Providers → Email**: desactivar _Confirm email_.
3. **Authentication → Settings**: desactivar _Allow new users to sign up_ (solo el dueño crea usuarios).
4. Aplicar las migraciones de `supabase/migrations/` en orden (CLI: `npx supabase link` y luego
   `npx supabase db push`, o pegarlas una por una en el SQL Editor).
5. Crear el primer dueño en **Authentication → Users → Add user**:
   - Email: `<usuario>@dosman.internal` (ej. `carlos@dosman.internal`)
   - Password: su PIN de 6 dígitos, con _Auto Confirm User_ marcado.
6. Activarlo como dueño en el SQL Editor:

   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"role":"owner"}'
    where email = 'carlos@dosman.internal';

   update public.profiles
      set role = 'owner', is_active = true, full_name = 'Carlos ...'
    where username = 'carlos';
   ```

7. Copiar en `.env.local` y en `wrangler.jsonc` la URL del proyecto y la _publishable key_
   (**Project Settings → API Keys**).

### 2. Cloudflare

```bash
npx wrangler login
npx wrangler r2 bucket create dosman-media
# Clave secreta de Supabase (Project Settings → API Keys → Secret keys → sb_secret_...).
# Solo la usa el servidor para crear empleados y enviar avisos; nunca llega al navegador.
npx wrangler secret put SUPABASE_SECRET_KEY
yarn deploy
```

El sistema queda en `https://dosman-system.<cuenta>.workers.dev`. Los demás empleados los crea el
dueño desde **Empleados**.

### 3. Avisos por Telegram (opcional, gratis)

1. En Telegram, abrir **@BotFather**, enviar `/newbot` y ponerle nombre (ej. _Dosman Alertas_).
   BotFather entrega un token como `123456789:AA...`.
2. Guardarlo en el servidor: `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
3. El dueño le escribe "hola" al bot (o lo agrega al grupo de los dueños) y en
   **Ajustes → Notificaciones** toca _Buscar chats_ y elige el chat. Llega un mensaje de prueba.

Los avisos salen cada 5 minutos (alertas, cierres de caja, inventario bajo) y cada mañana a las
5:30 llega el resumen del día anterior. Los gastos fijos del día también se registran a esa hora.

### 4. Asistente de ayuda (incluido, gratis)

El botón **Ayuda** abre un chat con IA (Cloudflare Workers AI) que explica cómo usar el sistema según
el rol de quien pregunta. No hay que configurar nada: se activa solo al publicar en Cloudflare. El plan
gratis trae 10.000 "neuronas" al día (unas cuantas centenas de preguntas) y cada persona tiene un
límite de 40 preguntas diarias para que nadie gaste el cupo del negocio. Lo que sabe el asistente
está en `worker/assistant/manual.ts`: si cambia una pantalla, hay que actualizar ese manual.

En desarrollo local la IA no se conecta; con `ASSISTANT_FAKE=on` en `.dev.vars` responde un texto de prueba.

## PC de caja e impresora térmica (80 mm)

1. Instalar el driver de la impresora (compatible ESC/POS de Epson), dejarla como **predeterminada**,
   con papel de 80 mm y márgenes en cero.
2. Crear un acceso directo de Chrome en el escritorio con impresión silenciosa (imprime sin preguntar):

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://dosman-system.<cuenta>.workers.dev/pos
   ```

3. Si compran cajón monedero (puerto RJ11 de la impresora), activar en el driver la opción de
   **abrir el cajón al imprimir**: así solo se abre al imprimir un recibo de cobro.
4. En la caja, el botón de ajustes (arriba a la derecha) define si este equipo imprime el recibo al
   cobrar y la comanda al enviar el pedido.

## Seguridad (resumen)

- **RLS en todas las tablas.** Sin sesión no se ve nada. Cada empleado solo ve su sede.
- **Los empleados no escriben directo** en ventas, pagos, caja ni inventario: lo hacen mediante
  funciones del servidor que validan y dejan registro.
- **Lo que tiene que ver con dinero e inventario no se edita ni se borra.** La única excepción es la
  limpieza de datos viejos que hace el dueño desde la pantalla de Espacio, con respaldo previo.
- **Cambios de precio, anulaciones, descuentos y diferencias de caja** quedan en la auditoría y
  generan avisos al dueño.
- **Roles y sede** se guardan en `app_metadata`, que solo el servidor puede escribir; nadie puede
  subirse de rol a sí mismo.
- **La clave secreta de Supabase vive solo en el Worker** (secreto de Cloudflare). Se usa para crear
  y editar empleados (solo el dueño) y para entregar avisos; las reglas del negocio siguen en la base
  de datos (siempre queda al menos un dueño activo, nadie se quita su propio rol).
- **Empleados desactivados no pueden entrar**, pero su historial se conserva.
