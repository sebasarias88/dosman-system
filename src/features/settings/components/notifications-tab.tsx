import { useMutation, useQuery } from '@tanstack/react-query'
import { BellRing, CheckCircle2, MessageCircle, Search, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import {
  findTelegramChats,
  notificationSettingsQuery,
  notificationStatusQuery,
  sendTelegramTest,
  updateNotificationSettings,
  type NotificationSettings,
  type TelegramChat,
} from '../settings-api'
import { useSettingsMutation } from '../use-settings-mutation'

const TOGGLES: { key: keyof NotificationSettings; label: string; description: string }[] = [
  {
    key: 'notify_alerts',
    label: 'Alertas',
    description: 'Faltantes de caja, anulaciones, descuentos, mermas, cambios de precio y de empleados.',
  },
  {
    key: 'notify_cash_close',
    label: 'Cierres de caja',
    description: 'Ventas del turno y si cuadró la caja.',
  },
  { key: 'notify_low_stock', label: 'Inventario bajo', description: 'Cuando un insumo baja de su mínimo.' },
  {
    key: 'notify_daily_summary',
    label: 'Resumen del día',
    description: 'Cada mañana a las 5:30: ventas de cada sede, ganancia y alertas del día anterior.',
  },
]

const showError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : 'No se pudo completar')

export function NotificationsTab() {
  const status = useQuery(notificationStatusQuery)
  const { data: settings, isPending } = useQuery(notificationSettingsQuery)
  const save = useSettingsMutation(updateNotificationSettings)
  const [chats, setChats] = useState<TelegramChat[] | null>(null)

  const search = useMutation({ mutationFn: findTelegramChats, onSuccess: setChats, onError: showError })
  const test = useMutation({
    mutationFn: sendTelegramTest,
    onSuccess: () => toast.success('Mensaje de prueba enviado. Revisa Telegram.'),
    onError: showError,
  })

  if (isPending || status.isPending) return <Spinner />
  if (!settings) return null

  function connect(chat: TelegramChat) {
    save.mutate(
      { telegram_chat_id: chat.id, telegram_chat_title: chat.title },
      {
        onSuccess: () => {
          setChats(null)
          toast.success(`Conectado a ${chat.title}`)
          test.mutate(chat.id)
        },
      },
    )
  }

  const bot = status.data?.bot

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <header className="flex items-center gap-3">
          <MessageCircle className="size-6 text-fg-subtle" aria-hidden />
          <div>
            <h2 className="font-semibold">Telegram</h2>
            <p className="text-sm text-fg-muted">
              Gratis y sin riesgo de bloqueo. Llega al celular como cualquier chat.
            </p>
          </div>
        </header>

        {status.isError || !status.data?.telegram ? (
          <div className="rounded-xl bg-warning-soft p-4 text-sm text-warning">
            {status.isError
              ? 'No se pudo consultar el servidor. Intenta de nuevo más tarde.'
              : 'El bot de Telegram todavía no está configurado en el servidor. Pídele a quien instaló el sistema que lo active (es un paso de una sola vez).'}
          </div>
        ) : settings.telegram_chat_id ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-success-soft p-4 text-sm">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            <span className="min-w-[10rem] flex-1">
              Llegan a <b>{settings.telegram_chat_title ?? 'el chat conectado'}</b> por medio de @{bot}
            </span>
            <Button
              variant="secondary"
              loading={test.isPending}
              onClick={() => settings.telegram_chat_id && test.mutate(settings.telegram_chat_id)}
            >
              <Send className="size-4" aria-hidden />
              Enviar prueba
            </Button>
            <Button
              variant="ghost"
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { telegram_chat_id: null, telegram_chat_title: null },
                  {
                    onSuccess: () => toast.success('Telegram desconectado'),
                  },
                )
              }
            >
              Desconectar
            </Button>
          </div>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg-muted">
            <li>
              En Telegram busca <b className="text-fg">@{bot}</b> y escríbele “hola”.
            </li>
            <li>
              Si quieren que les llegue a los dos dueños, creen un grupo y agreguen a{' '}
              <b className="text-fg">@{bot}</b>.
            </li>
            <li>Toca “Buscar chats” y elige el chat o el grupo.</li>
          </ol>
        )}

        {status.data?.telegram && (
          <div className="flex flex-col gap-3">
            <Button
              variant="secondary"
              className="self-start"
              loading={search.isPending}
              onClick={() => search.mutate()}
            >
              <Search className="size-4" aria-hidden />
              {settings.telegram_chat_id ? 'Cambiar de chat' : 'Buscar chats'}
            </Button>
            {chats && chats.length === 0 && (
              <p className="text-sm text-fg-subtle">
                No hay mensajes nuevos para el bot. Escríbele “hola” y vuelve a buscar (Telegram los guarda 24
                horas).
              </p>
            )}
            {chats && chats.length > 0 && (
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {chats.map((chat) => (
                  <li key={chat.id} className="flex items-center gap-3 p-3 text-sm">
                    <span className="flex-1">
                      {chat.title}
                      <span className="text-fg-subtle">
                        {' '}
                        · {chat.type === 'private' ? 'chat personal' : 'grupo'}
                      </span>
                    </span>
                    <Button loading={save.isPending} onClick={() => connect(chat)}>
                      Usar este
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <header className="flex items-center gap-3">
          <BellRing className="size-6 text-fg-subtle" aria-hidden />
          <h2 className="font-semibold">Qué avisar</h2>
        </header>
        {TOGGLES.map((toggle) => (
          <Switch
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={Boolean(settings[toggle.key])}
            onCheckedChange={(value) => save.mutate({ [toggle.key]: value })}
          />
        ))}
      </section>
    </div>
  )
}
