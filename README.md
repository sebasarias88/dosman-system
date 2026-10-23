# Dosman · Sistema de ventas, caja e inventario

Sistema interno de **Dosman Cholao & Coffee** para dos sedes: la principal surte a la pequeña.
Ventas por mesa, mostrador, para llevar, parque y domicilio; turnos de caja con cuadre; inventario
por recetas; envíos entre sedes; gastos; reportes y control anti-pérdidas para los dueños.

## Stack

| Parte                              | Tecnología                                                        | Costo              |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------ |
| App (PWA)                          | Vite + React 19 + TypeScript + Tailwind 4 + TanStack Router/Query | —                  |
| Base de datos, login y tiempo real | Supabase (plan Free, región São Paulo)                            | Gratis             |
| Hosting y API                      | Cloudflare Workers (archivos estáticos + `/api/*`)                | Gratis             |
| Fotos (productos y recibos)        | Cloudflare R2, solo a través del Worker                           | Gratis hasta 10 GB |
| Avisos al dueño                    | Bot de Telegram + Web Push                                        | Gratis             |

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
worker/              API en Cloudflare (subir y servir fotos desde R2)
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
yarn deploy
```

El sistema queda en `https://dosman-system.<cuenta>.workers.dev`.

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
