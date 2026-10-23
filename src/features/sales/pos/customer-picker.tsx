import { useQuery } from '@tanstack/react-query'
import { UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { customersQuery, saveCustomer } from '../sales-api'
import type { Customer } from '../types'
import { useSalesMutation } from '../use-sales-mutation'

interface CustomerPickerProps {
  value: Customer | null
  onChange: (customer: Customer | null) => void
  label?: string
}

/** Search a customer by name or phone, or create one on the spot. */
export function CustomerPicker({ value, onChange, label = 'Cliente' }: CustomerPickerProps) {
  const { data: customers = [] } = useQuery(customersQuery)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', phone: '', address: '' })
  const create = useSalesMutation(saveCustomer, 'Cliente guardado')

  if (value) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{value.name}</p>
          {value.phone && <p className="text-fg-muted">{value.phone}</p>}
          {value.address && <p className="truncate text-fg-muted">{value.address}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label="Cambiar cliente" onClick={() => onChange(null)}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    )
  }

  if (creating) {
    const valid = draft.name.trim().length >= 2
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <Field label="Nombre">
          {(props) => (
            <TextInput
              {...props}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Teléfono">
          {(props) => (
            <TextInput
              {...props}
              inputMode="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          )}
        </Field>
        <Field label="Dirección">
          {(props) => (
            <TextInput
              {...props}
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(draft, {
                onSuccess: (id) => {
                  onChange({
                    id,
                    name: draft.name.trim(),
                    phone: draft.phone || null,
                    address: draft.address || null,
                  })
                  setCreating(false)
                },
              })
            }
          >
            Guardar cliente
          </Button>
        </div>
      </div>
    )
  }

  const term = search.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const matches = term
    ? customers
        .filter(
          (c) => c.name.toLowerCase().includes(term) || (digits.length >= 3 && c.phone?.includes(digits)),
        )
        .slice(0, 6)
    : []

  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        {(props) => (
          <TextInput
            {...props}
            placeholder="Buscar por nombre o teléfono"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </Field>
      {matches.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-line">
          {matches.map((c) => (
            <li key={c.id} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => onChange(c)}
                className="flex min-h-12 w-full flex-col justify-center px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-fg-subtle">{[c.phone, c.address].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => {
          setDraft({ name: /\d/.test(term) ? '' : search, phone: /\d/.test(term) ? search : '', address: '' })
          setCreating(true)
        }}
      >
        <UserPlus className="size-4" aria-hidden />
        Nuevo cliente
      </Button>
    </div>
  )
}
