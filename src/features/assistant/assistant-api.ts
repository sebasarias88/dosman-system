import { apiJson } from '@/lib/api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function askAssistant(input: {
  messages: ChatMessage[]
  screen: string
  branchId: string | null
}): Promise<{ reply: string; remaining: number }> {
  return apiJson('/api/assistant', {
    method: 'POST',
    body: { messages: input.messages.slice(-10), screen: input.screen, branch_id: input.branchId },
  })
}

/** Quick questions per role, so nobody has to think how to start. */
export const SUGGESTIONS: Record<string, string[]> = {
  owner: ['¿Cómo creo un empleado?', '¿Cómo veo la ganancia del mes?', '¿Cómo descargo un respaldo?'],
  admin: ['¿Cómo agrego un producto nuevo?', '¿Cómo registro un gasto fijo?', '¿Dónde veo las anulaciones?'],
  cashier: ['¿Cómo cobro con dos medios de pago?', '¿Cómo anulo un producto?', '¿Cómo cierro la caja?'],
  waiter: [
    '¿Cómo tomo un pedido de mesa?',
    '¿Cómo cambio un pedido de mesa?',
    '¿Cómo agrego algo a una mesa?',
  ],
  kitchen: ['¿Cómo marco un pedido como listo?', '¿Cómo activo el sonido?'],
}
