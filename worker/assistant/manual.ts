/*
 * User manual of the Dosman system, used by the help assistant. It is the
 * ONLY source the assistant may use, so it must match the real screens:
 * update it whenever a screen or a button name changes.
 *
 * Each section lists the roles that can use it. The assistant only receives
 * the sections of the person's role, so a cashier never gets instructions
 * for owner screens (and the prompt stays short, which keeps it free).
 */

export type Role = 'owner' | 'admin' | 'cashier' | 'waiter' | 'kitchen'

interface Section {
  title: string
  roles: Role[]
  body: string
}

const ALL: Role[] = ['owner', 'admin', 'cashier', 'waiter', 'kitchen']
const FLOOR: Role[] = ['owner', 'admin', 'cashier']
const MANAGERS: Role[] = ['owner', 'admin']

const SECTIONS: Section[] = [
  {
    title: 'Generalidades',
    roles: ALL,
    body: `
- El sistema es de Dosman Cholao & Coffee. Tiene dos sedes: la Sede principal (compra la mercancía y la reparte, tiene mesas y domicilios) y la sede pequeña (no compra; recibe lo que le envía la principal). Los precios son iguales en las dos.
- Se entra con un **usuario** y un **PIN de 6 números**. Si alguien olvidó su PIN, el dueño le pone uno nuevo en **Empleados**. Nadie más puede verlo ni cambiarlo.
- El menú está a la izquierda (en celular se abre con el botón ☰ de arriba). Cada persona solo ve las pantallas de su rol.
- Para salir: botón de la flecha junto al nombre, abajo en el menú (**Cerrar sesión**).
- Sin internet el sistema se bloquea con un aviso y vuelve solo cuando regresa la conexión. No se pierde nada de lo que ya se guardó.
- Cuando hay una versión nueva aparece un aviso para **Actualizar**.
- El día de ventas termina a las 5:00 a. m.: lo vendido de madrugada cuenta para el día anterior.
- Nada de dinero ni de inventario se puede borrar: los errores se **anulan** con un motivo y queda registrado quién lo hizo. El dueño ve todas las anulaciones.`,
  },
  {
    title: 'Caja: tomar un pedido y cobrarlo',
    roles: ['owner', 'admin', 'cashier'],
    body: `
Pantalla **Caja** (en el menú). Primero debe estar abierto el turno de caja (ver "Turno de caja").
1. Arriba del pedido elige el tipo: **Mostrador**, **Para llevar**, **Mesa** (solo sede principal), **Parque** o **Domicilio** (solo sede principal).
   - Mesa: elige la mesa. Parque: escribe una **seña del cliente** (ej. "señora de camisa azul, banca de la fuente"). Domicilio: elige o crea el cliente, la **dirección**, el **valor domicilio** y el domiciliario.
2. Toca los productos (puedes buscar o filtrar por categoría). Si el producto tiene tamaños o adiciones se abre una ventana para elegir **Tamaño**, **Adiciones**, cantidad y **Notas para preparación** (ej. "sin hielo", "poco dulce").
3. En el pedido puedes sumar o quitar unidades con + y −, o quitar el producto.
4. Para Mostrador y Para llevar: **Cobrar** (cobra de una vez) o **Guardar** (queda abierto para cobrar después). Para Mesa, Parque y Domicilio: **Enviar pedido** (se cobra después) o **Cobrar ya**.
5. Al cobrar: elige el medio de pago (Efectivo, Nequi, Daviplata, etc.). En efectivo escribe **¿Con cuánto paga?** y el sistema muestra el cambio. Se puede pagar con varios medios a la vez (agregar otro pago). **Propina** es opcional. Un **Descuento** necesita un motivo y el dueño lo ve.
6. **Fiado**: elige el medio de pago Fiado y **¿A quién se le fía?** (el cliente). Queda en Clientes y fiado.
7. Si este equipo tiene la impresora, el recibo sale solo al cobrar. En el botón de ajustes de la Caja (arriba) se decide si este equipo imprime el recibo y las comandas.`,
  },
  {
    title: 'Caja: pedidos abiertos, agregar, anular y reimprimir',
    roles: ['owner', 'admin', 'cashier'],
    body: `
- En Caja, la pestaña **Abiertos** muestra los pedidos sin cobrar y **Cobrados** los del turno.
- Toca un pedido para verlo: **Agregar** (le suma productos al mismo pedido) o **Cobrar**.
- **Anular un producto**: dentro del pedido, toca el botón de anular junto al producto y elige o escribe el motivo. Si el producto ya se estaba preparando, los insumos no vuelven al inventario.
- **Anular el pedido completo**: dentro del pedido, **Anular pedido** con su motivo.
- **Reimprimir un recibo**: en **Cobrados**, abre el pedido y usa reimprimir recibo.
- Las anulaciones quedan registradas con quién y por qué, y le llegan al dueño.`,
  },
  {
    title: 'Mesero: tomar pedidos',
    roles: ['waiter'],
    body: `
- El mesero usa **Tomar pedido** o **Mesas**. Solo puede hacer pedidos de **Mesa** o **Parque**; nunca cobra ni maneja dinero (eso lo hace la caja).
- En **Mesas**: toca una mesa libre (**Libre · tocar para pedir**), agrega los productos y **Enviar pedido**. El pedido llega a preparación y a la caja.
- Para agregar más a una mesa ocupada: toca la mesa y **Agregar**.
- Si el cliente se cambia de mesa: en la mesa, **Mover a otra mesa…**.
- Para cobrar, el cliente paga en la caja.`,
  },
  {
    title: 'Mesas',
    roles: ['owner', 'admin', 'cashier'],
    body: `
- Pantalla **Mesas** (solo en la sede con mesas): mapa de mesas libres, ocupadas y por cobrar, y los pedidos del parque.
- Toca una mesa libre para empezar un pedido; una ocupada para ver, agregar, cobrar o **Mover a otra mesa…**.
- Crear, renombrar u ocultar mesas y zonas: botón **Editar mesas** (dueño y administrador).`,
  },
  {
    title: 'Preparación (cocina / barra)',
    roles: ['owner', 'admin', 'cashier', 'kitchen'],
    body: `
- Pantalla **Preparación**: columnas **Por preparar**, **Preparando** y **Listo para entregar**, en orden de llegada.
- Toca **Empezar** cuando empiezas un pedido, luego **Listo** y al final **Entregado**.
- Botón **Activar sonido** para que suene cuando llega un pedido nuevo.
- Lo que no necesita preparación (ej. bebidas embotelladas) no aparece aquí.`,
  },
  {
    title: 'Turno de caja (abrir, entradas, salidas y cierre)',
    roles: FLOOR,
    body: `
Pantalla **Turno de caja**.
- **Abrir**: escribe la **Base de caja (efectivo inicial)** y abre el turno. Sin turno abierto no se puede cobrar.
- **Entrada**: dinero que entra y no es venta (ej. más sencillo).
- **Salida**: dinero que sale de la caja. Hay que elegir **¿En qué se gastó?**: si es un gasto del negocio (ej. hielo) elige la categoría (queda como gasto y se puede tomar foto del recibo); si no es gasto, elige **No es un gasto (retiro, cambio, otro)**. Siempre se escribe el motivo y el dueño lo ve.
- **Cerrar turno**: primero hay que cobrar o anular los pedidos abiertos. Cuenta todo el efectivo de la caja (incluida la base) y escribe el **Efectivo contado**. El sistema no muestra cuánto debería haber antes de contar (cierre ciego). Después muestra si **cuadró**, si **sobran** o **faltan**, y se puede imprimir el cierre. El resumen le llega al dueño.`,
  },
  {
    title: 'Clientes y fiado',
    roles: FLOOR,
    body: `
Pantalla **Clientes y fiado**.
- Muestra quién debe, cuánto y desde cuándo (los que deben hace más de 30 días salen en rojo).
- **Nuevo cliente**: nombre, teléfono (WhatsApp) y dirección. También se puede crear desde el pedido de domicilio.
- **Abonar**: botón **Abonar** en el cliente → valor, **Cómo pagó** y nota. Requiere el turno de caja abierto; el abono en efectivo suma a la caja. No deja abonar más de lo que debe. Se puede imprimir el **comprobante de abono**.
- Toca el cliente para ver su cuenta: cada fiado y cada abono con el saldo. **Recordar por WhatsApp** abre WhatsApp con un mensaje amable.
- Archivar un cliente (dueño/administrador) solo se puede si no debe nada.`,
  },
  {
    title: 'Inventario',
    roles: FLOOR,
    body: `
Pantalla **Inventario** (de la sede actual).
- **Existencias**: cuánto hay de cada insumo. Los que están bajos salen marcados. El inventario baja solo con cada venta según la receta.
- **Merma**: en el insumo, botón **Merma** → cantidad y motivo (se dañó, se venció, se cayó…). El dueño recibe aviso.
- **Aviso**: cambia el mínimo para que avise cuando quede poco.
- **Conteo físico**: se cuenta lo que hay de verdad sin ver lo que dice el sistema y se toca **Aplicar**. El sistema ajusta y muestra las diferencias; los faltantes le llegan al dueño.
- **Movimientos**: historial de entradas y salidas de cada insumo.`,
  },
  {
    title: 'Compras (solo sede principal)',
    roles: FLOOR,
    body: `
Pantalla **Compras** → **Nueva compra**.
1. Elige el **Proveedor** (o crea uno nuevo) o deja **Sin proveedor (compra suelta)**.
2. Agrega cada insumo con **Cantidad** (en kg, L o unidades) y **Valor pagado**.
3. Si parte va para la sede pequeña, escríbelo en la columna **Enviar a (la otra sede)**: se crea el envío automáticamente.
4. **Forma de pago**: **De la caja** (sale del turno abierto), **Pagado por fuera** (Nequi, transferencia o dinero del dueño) o **A crédito** (queda como deuda con el proveedor; hay que elegir proveedor).
5. Opcional: **Foto de la factura**. Luego **Registrar compra**.
- El costo de los insumos se actualiza solo con cada compra.
- **Historial** muestra las compras. **Proveedores** (dueño/administrador) muestra cuánto se le debe a cada uno y permite **Pagar**.`,
  },
  {
    title: 'Envíos entre sedes',
    roles: FLOOR,
    body: `
Pantalla **Envíos entre sedes**.
- La sede principal crea un **Nuevo envío**: elige los insumos y cantidades. Sale de su inventario.
- La otra sede lo ve **Por recibir**: si llegó todo, **Recibir todo**; si faltó algo, escribe lo que llegó y **Recibir con diferencias** explicando qué pasó (obligatorio). El dueño recibe aviso de las diferencias.
- Un envío no recibido se puede **Cancelar envío** con motivo: la mercancía vuelve al inventario.`,
  },
  {
    title: 'Productos y recetas',
    roles: MANAGERS,
    body: `
Pantalla **Productos y recetas**, pestañas **Productos**, **Adiciones**, **Insumos** y **Categorías**.
- **Insumos** primero: nombre, **Se mide por** (peso, volumen o unidades), precio de compra y **Avisar cuando queden menos de**.
- **Nuevo producto**: nombre, categoría, foto, tamaños con su precio, y para cada tamaño la **receta** (qué insumos y cuánto gasta). El sistema calcula el costo y el margen (verde bueno, amarillo regular, rojo bajo).
- **Va a preparación**: si el producto debe salir en la pantalla de preparación.
- **Disponible para vender**: para ocultarlo temporalmente de la caja.
- Un producto con ventas no se borra: queda archivado. Los cambios de precio le llegan al dueño.`,
  },
  {
    title: 'Gastos',
    roles: MANAGERS,
    body: `
Pantalla **Gastos**.
- **Nuevo gasto**: sede (o **Compartido** entre las dos), categoría, descripción, valor, fecha, proveedor opcional, foto del recibo y si **Se pagó con dinero de la caja**.
- **Gastos fijos**: arriendo, nómina, internet… Se registran solos cada mes el día indicado.
- Un gasto equivocado se **anula** con motivo (si salió de una caja abierta, el dinero vuelve a la caja).
- **Categorías**: crear o desactivar categorías de gasto.
- Las compras de insumos NO van aquí: van en Compras.`,
  },
  {
    title: 'Reportes y Actividad',
    roles: MANAGERS,
    body: `
- **Reportes**: elige periodo (Hoy, Ayer, Últimos 7 días, Este mes, Mes pasado o fechas) y sede. Muestra la **ganancia real** (ventas − costo de lo vendido − gastos − pérdidas), ventas por día, productos que más venden y más ganancia dejan, horas pico, medios de pago, comparación entre sedes y el panel de **Control** (faltantes de caja, anulaciones, mermas). Se exporta a **Excel** o **PDF**.
- **Actividad**: quién hizo qué y cuándo (anulaciones, descuentos, cierres de caja, cambios de precio, empleados…). Filtros por periodo, sede, importancia y tipo.`,
  },
  {
    title: 'Empleados, Ajustes y Espacio (solo dueño)',
    roles: ['owner'],
    body: `
- **Empleados**: **Nuevo empleado** con nombre, usuario, rol (Caja, Mesero, Preparación, Administrador, Dueño), sede y PIN. Editar para **Cambiar PIN**, rol, sede o desactivar (un desactivado no puede entrar, su historial se conserva).
- **Ajustes**: **Sedes** (nombre, mesas, domicilios, hora de cierre del día), **Medios de pago** (agregar, renombrar, ordenar, apagar; el efectivo no se apaga) y **Notificaciones** (Telegram: buscar el chat y elegir qué avisar).
- **Espacio**: cuánto ocupa el sistema, **Descargar respaldo completo** en Excel (recomendado una vez al mes) y **Limpiar datos viejos** (siempre se conservan los últimos 3 meses y pide respaldo antes).`,
  },
]

/** The manual for one role, ready to go into the prompt. */
export function manualFor(role: Role): string {
  return SECTIONS.filter((s) => s.roles.includes(role))
    .map((s) => `## ${s.title}\n${s.body.trim()}`)
    .join('\n\n')
}
