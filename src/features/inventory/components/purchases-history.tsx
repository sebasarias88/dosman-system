import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatStock } from '@/features/catalog/units'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { toast } from 'sonner'
import { openPrivateMedia } from '@/lib/media'
import { purchasesQuery } from '../inventory-api'

export function PurchasesHistory({ branchId }: { branchId: string }) {
  const { data: purchases = [], isPending } = useQuery(purchasesQuery(branchId))
  const [openId, setOpenId] = useState<string | null>(null)

  if (isPending) return <Spinner />
  if (purchases.length === 0)
    return <p className="p-8 text-center text-fg-muted">Aún no hay compras registradas.</p>

  return (
    <ul className="flex flex-col gap-2">
      {purchases.map((purchase) => {
        const open = openId === purchase.id
        return (
          <li key={purchase.id} className="rounded-card border border-line bg-surface">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : purchase.id)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{purchase.suppliers?.name ?? 'Compra suelta'}</span>
                <span className="text-sm text-fg-subtle">
                  {formatDateTime(purchase.created_at)}
                  {purchase.profiles && ` · ${purchase.profiles.full_name}`} ·{' '}
                  {purchase.purchase_items.length}{' '}
                  {purchase.purchase_items.length === 1 ? 'insumo' : 'insumos'}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{formatCurrency(purchase.total)}</span>
            </button>
            {open && (
              <div className="flex flex-col gap-3 border-t border-line p-4">
                <ul className="flex flex-col gap-1 text-sm">
                  {purchase.purchase_items.map((item, index) => (
                    <li key={index} className="flex justify-between gap-3">
                      <span>
                        {item.supplies.name} · {formatStock(item.supplies.unit, item.quantity)}
                      </span>
                      <span className="tabular-nums">{formatCurrency(item.line_total)}</span>
                    </li>
                  ))}
                </ul>
                {purchase.notes && <p className="text-sm text-fg-muted">{purchase.notes}</p>}
                {purchase.receipt_key && (
                  <Button
                    variant="secondary"
                    className="self-start"
                    onClick={() =>
                      openPrivateMedia(purchase.receipt_key ?? '').catch(() =>
                        toast.error('No se pudo abrir la factura'),
                      )
                    }
                  >
                    <Receipt className="size-4" aria-hidden />
                    Ver factura
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
