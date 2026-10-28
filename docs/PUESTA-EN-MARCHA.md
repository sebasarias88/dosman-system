# Puesta en marcha · Dosman

Guía paso a paso para el día que existan las cuentas del cliente. Todo el código ya está listo; aquí
solo se crean los servicios, se pegan las claves y se publica. Tiempo estimado: 1 a 2 horas.

> Regla de oro: las cuentas (Gmail, Supabase, Cloudflare, Telegram) quedan **a nombre del cliente**.
> Tú entras como colaborador. Nunca se mezclan con cuentas de otros clientes.

---

## 0. Antes de empezar

- [ ] Gmail del negocio creado (ej. `dosman.sistema@gmail.com`) con verificación en dos pasos.
- [ ] En tu Mac: rama `develop` actualizada, `yarn install` hecho y `yarn build` sin errores.
- [ ] Tener a mano el nombre y un PIN de 6 números para el primer dueño.

## 1. Supabase (base de datos, login y tiempo real)

1. Entrar a <https://supabase.com> con el Gmail del negocio → **New project**.
   - Nombre: `dosman-system` · Contraseña de la base de datos: generarla y guardarla en un gestor
     de contraseñas.
   - Región: abrir **Advanced configuration** → **Specific region** → **East US (North Virginia)**
     (`us-east-1`). Es la de menor latencia desde Colombia. La opción general "Americas" deja que
     Supabase elija y puede caer en Oregón (`us-west-2`), más lejos.
   - Dejar marcado **Automatically expose new tables**: las migraciones cuentan con eso para que
     la app pueda leer las tablas (el acceso real lo controlan las políticas RLS).
   - Dejar **sin marcar** "Enable automatic RLS": las migraciones ya activan RLS en cada tabla.
2. **Authentication → Sign In / Providers → Email**: desactivar **Confirm email**.
3. **Authentication → Settings**: desactivar **Allow new users to sign up** (solo el dueño crea
   usuarios desde la app).
4. Aplicar las migraciones (en orden, de `0100` a `1600`):

   ```bash
   npx supabase login
   npx supabase link --project-ref <REF-DEL-PROYECTO>
   npx supabase db push
   ```

   Alternativa sin CLI: abrir cada archivo de `supabase/migrations/` en orden y pegarlo en el
   **SQL Editor**.

5. Crear el primer dueño: **Authentication → Users → Add user → Create new user**
   - Email: `<usuario>@dosman.internal` (ej. `carlos@dosman.internal`)
   - Password: su PIN de 6 números · marcar **Auto Confirm User**.
6. Activarlo como dueño en el **SQL Editor**:

   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"role":"owner"}'
    where email = 'carlos@dosman.internal';

   update public.profiles
      set role = 'owner', is_active = true, full_name = 'Carlos Apellido'
    where username = 'carlos';
   ```

7. Copiar las claves (**Project Settings → API Keys**):
   - **Project URL** y **Publishable key** (`sb_publishable_…`): son públicas.
   - **Secret key** (`sb_secret_…`): es secreta, solo va al Worker (paso 2).
8. Pegar la URL y la publishable key en:
   - `.env.local` → `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `wrangler.jsonc` → `vars.SUPABASE_URL` y `vars.SUPABASE_PUBLISHABLE_KEY`
9. **Database → Publications → supabase_realtime**: confirmar que están `orders`, `order_items` y
   `transfers` (las migraciones las agregan solas; es solo verificar).

## 2. Cloudflare (hosting, API, fotos y asistente)

1. Crear la cuenta en <https://dash.cloudflare.com> con el Gmail del negocio (plan Free).
2. En tu Mac:

   ```bash
   npx wrangler login
   npx wrangler r2 bucket create dosman-media
   npx wrangler secret put SUPABASE_SECRET_KEY     # pegar el sb_secret_… del paso 1.7
   yarn deploy
   ```

3. El sistema queda en `https://dosman-system.<cuenta>.workers.dev`. Abrirlo y entrar con el
   dueño del paso 1.5.
4. El asistente **Ayuda** (Workers AI) no necesita nada más: funciona apenas se publica.
5. Los crons (avisos cada 5 minutos y tarea diaria de las 5:30 a. m.) se activan solos con el deploy.
   Se ven en **Workers → dosman-system → Settings → Triggers**.

## 3. Telegram (avisos al dueño, opcional)

1. En Telegram, abrir **@BotFather** → `/newbot` → nombre `Dosman Alertas` → usuario terminado en
   `bot` (ej. `dosman_alertas_bot`). Copiar el token.
2. `npx wrangler secret put TELEGRAM_BOT_TOKEN` y pegar el token (no hace falta volver a publicar).
3. Los dueños crean un grupo de Telegram y agregan el bot (o le escriben "hola" en privado).
4. En la app: **Ajustes → Notificaciones → Buscar chats** → elegir el grupo → llega un mensaje de
   prueba.

## 4. Primer día de configuración (con el dueño)

En este orden, porque cada paso usa el anterior:

1. **Ajustes → Sedes**: nombres reales, si tienen mesas y domicilios, hora de cierre del día.
2. **Ajustes → Medios de pago**: dejar solo los que usan (ej. agregar "Bancolombia QR").
3. **Productos y recetas → Insumos**: cada insumo con su unidad, precio de compra y mínimo.
4. **Productos y recetas → Categorías, Adiciones y Productos**: tamaños, precios y recetas.
   Revisar que ningún producto quede con margen en rojo o "Sin receta".
5. **Mesas → Editar mesas**: zonas y mesas reales de la sede principal.
6. **Inventario → Conteo físico** en cada sede: así arranca el inventario con lo que hay de verdad.
7. **Gastos → Gastos fijos**: arriendo, nómina, servicios, internet.
8. **Empleados**: crear a cada persona con su rol, sede y PIN.

## 5. Equipos del local

- **PC de caja (Jaltech)**: instalar el driver de la impresora de 80 mm, dejarla predeterminada y
  crear el acceso directo de Chrome con impresión silenciosa (ver README, sección "PC de caja").
  En **Caja → ajustes** activar "Imprimir recibo al cobrar" e "Imprimir comandas".
- **Tablet / celulares**: abrir la dirección en Chrome → menú → **Instalar app** (queda como una app).
- Cada persona entra con **su** usuario: así la actividad dice quién hizo qué.

## 6. Verificación final (marcar todo antes de entregar)

- [ ] Entrar como dueño, cajera, mesero y cocina en equipos distintos.
- [ ] **Tiempo real**: el mesero envía un pedido desde el celular y en menos de 2 segundos aparece en
      la Caja y en Preparación sin recargar.
- [ ] La comanda sale sola en la impresora de la caja cuando un mesero envía un pedido.
- [ ] Abrir turno, vender en efectivo y Nequi, hacer una salida de caja y cerrar: el cierre cuadra y
      llega el aviso a Telegram.
- [ ] Una compra en la sede principal con envío a la pequeña; recibirlo en la pequeña.
- [ ] Subir una foto de producto y una de recibo (R2).
- [ ] Preguntarle algo al asistente **Ayuda** (respuesta real de la IA).
- [ ] **Espacio**: descargar el respaldo completo y abrirlo en Excel.
- [ ] Probar sin internet: aparece el aviso y vuelve solo al reconectar.

## 7. Después de entregar: qué vigilar el primer mes

- **Supabase → Reports → Usage**: egress (salida de datos, 5 GB/mes gratis) y tamaño de la base
  (500 MB). Con el uso esperado debe quedar muy por debajo; si el egress pasa de 3 GB en el mes,
  avisar para revisar.
- **Cloudflare → Workers AI**: neuronas usadas por día (10.000 gratis).
- **Respaldo**: el dueño descarga el Excel de **Espacio** una vez al mes (el plan gratis de Supabase
  no tiene copias automáticas).
- Supabase pausa los proyectos gratis tras 7 días sin uso; con el uso diario y los crons no ocurre.
