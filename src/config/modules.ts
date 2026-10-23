import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ChefHat,
  HardDrive,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  ScrollText,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  Table2,
  Tags,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'
import type { AppRole, Branch } from '@/types/app'

export type ModuleKey =
  | 'dashboard'
  | 'pos'
  | 'tables'
  | 'kitchen'
  | 'cash'
  | 'customers'
  | 'inventory'
  | 'transfers'
  | 'purchases'
  | 'products'
  | 'expenses'
  | 'reports'
  | 'activity'
  | 'staff'
  | 'storage'
  | 'settings'

export type ModuleGroup = 'operation' | 'stock' | 'management'

export interface AppModule {
  key: ModuleKey
  path: string
  label: string
  description: string
  icon: LucideIcon
  group: ModuleGroup
  roles: readonly AppRole[]
  /** Name and description waiters see (they use the module without charging). */
  waiterLabel?: string
  waiterDescription?: string
  /** Extra condition on the active branch (e.g. waiters only at the main branch). */
  branchRule?: (branch: Branch) => boolean
}

const MANAGERS = ['owner', 'admin'] as const
const FLOOR = ['owner', 'admin', 'cashier'] as const

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  operation: 'Operación',
  stock: 'Inventario',
  management: 'Administración',
}

export const MODULES: readonly AppModule[] = [
  {
    key: 'dashboard',
    path: '/',
    label: 'Inicio',
    description: 'Resumen del día de la sede.',
    icon: LayoutDashboard,
    group: 'operation',
    roles: ['owner', 'admin', 'cashier', 'waiter', 'kitchen'],
  },
  {
    key: 'pos',
    path: '/pos',
    label: 'Caja',
    description: 'Tomar pedidos de mostrador, para llevar, parque y domicilio, y cobrarlos.',
    waiterLabel: 'Tomar pedido',
    waiterDescription: 'Pedidos de mesa y de parque. El cobro se hace en caja.',
    icon: ShoppingCart,
    group: 'operation',
    roles: ['owner', 'admin', 'cashier', 'waiter'],
  },
  {
    key: 'tables',
    path: '/tables',
    label: 'Mesas',
    description: 'Mapa de mesas: libres, ocupadas y por cobrar.',
    icon: Table2,
    group: 'operation',
    roles: ['owner', 'admin', 'cashier', 'waiter'],
  },
  {
    key: 'kitchen',
    path: '/kitchen',
    label: 'Preparación',
    description: 'Pedidos por preparar en orden de llegada.',
    icon: ChefHat,
    group: 'operation',
    roles: ['owner', 'admin', 'cashier', 'kitchen'],
  },
  {
    key: 'cash',
    path: '/cash',
    label: 'Turno de caja',
    description: 'Apertura, entradas y salidas de efectivo, y cierre con cuadre.',
    icon: Wallet,
    group: 'operation',
    roles: FLOOR,
  },
  {
    key: 'customers',
    path: '/customers',
    label: 'Clientes y fiado',
    description: 'Clientes de domicilio y lo que deben.',
    icon: Users,
    group: 'operation',
    roles: FLOOR,
  },
  {
    key: 'inventory',
    path: '/inventory',
    label: 'Inventario',
    description: 'Existencias, alertas de stock bajo, mermas y conteos.',
    icon: Boxes,
    group: 'stock',
    roles: FLOOR,
  },
  {
    key: 'purchases',
    path: '/purchases',
    label: 'Compras',
    description: 'Registrar la mercancía que llega y repartirla entre sedes.',
    icon: ShoppingBasket,
    group: 'stock',
    roles: FLOOR,
    branchRule: (branch) => branch.is_main,
  },
  {
    key: 'transfers',
    path: '/transfers',
    label: 'Envíos entre sedes',
    description: 'Lo que la sede principal envía y lo que la otra sede confirma.',
    icon: ArrowLeftRight,
    group: 'stock',
    roles: FLOOR,
  },
  {
    key: 'products',
    path: '/products',
    label: 'Productos y recetas',
    description: 'Catálogo, tamaños, adiciones, recetas y costos.',
    icon: Tags,
    group: 'stock',
    roles: MANAGERS,
  },
  {
    key: 'expenses',
    path: '/expenses',
    label: 'Gastos',
    description: 'Arriendo, servicios, nómina y demás gastos del negocio.',
    icon: Receipt,
    group: 'management',
    roles: MANAGERS,
  },
  {
    key: 'reports',
    path: '/reports',
    label: 'Reportes',
    description: 'Ventas, ganancia real y comparación entre sedes.',
    icon: BarChart3,
    group: 'management',
    roles: MANAGERS,
  },
  {
    key: 'activity',
    path: '/activity',
    label: 'Actividad',
    description: 'Anulaciones, descuentos, ajustes y diferencias de caja.',
    icon: ScrollText,
    group: 'management',
    roles: MANAGERS,
  },
  {
    key: 'staff',
    path: '/staff',
    label: 'Empleados',
    description: 'Usuarios, roles, PIN y sede de cada persona.',
    icon: UserCog,
    group: 'management',
    roles: ['owner'],
  },
  {
    key: 'storage',
    path: '/storage',
    label: 'Espacio',
    description: 'Espacio usado, respaldo en Excel y limpieza de datos viejos.',
    icon: HardDrive,
    group: 'management',
    roles: ['owner'],
  },
  {
    key: 'settings',
    path: '/settings',
    label: 'Ajustes',
    description: 'Sedes, mesas, métodos de pago y notificaciones.',
    icon: Settings,
    group: 'management',
    roles: ['owner'],
  },
]

export function canUseModule(module: AppModule, role: AppRole, branch: Branch | undefined): boolean {
  if (!module.roles.includes(role)) return false
  if (module.branchRule && (!branch || !module.branchRule(branch))) return false
  return true
}

/** Modules this person can use in the active branch, with the names their role sees. */
export function modulesFor(role: AppRole, branch: Branch | undefined): AppModule[] {
  return MODULES.filter((m) => canUseModule(m, role, branch)).map((m) =>
    role === 'waiter' && m.waiterLabel
      ? { ...m, label: m.waiterLabel, description: m.waiterDescription ?? m.description }
      : m,
  )
}

export function getModule(key: ModuleKey): AppModule {
  const found = MODULES.find((m) => m.key === key)
  if (!found) throw new Error(`Unknown module: ${key}`)
  return found
}
