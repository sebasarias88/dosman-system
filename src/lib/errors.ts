interface DatabaseError {
  code?: string
  message?: string
}

function isDatabaseError(value: unknown): value is DatabaseError {
  return typeof value === 'object' && value !== null && ('code' in value || 'message' in value)
}

/**
 * Turns Supabase / network errors into a sentence staff can understand.
 * Our database functions already raise messages in Spanish (codes 22023,
 * 23505, 42501, P0001, P0002); generic Postgres errors are translated here.
 */
export function toUserMessage(error: unknown): string {
  if (!navigator.onLine) return 'Sin conexión a internet. Intenta de nuevo cuando vuelva.'
  if (!isDatabaseError(error)) return 'Ocurrió un error inesperado. Intenta de nuevo.'

  switch (error.code) {
    case '23503':
      return 'No se puede borrar porque está en uso. Desactívalo en su lugar.'
    case '23505':
    case '22023':
    case 'P0001':
    case 'P0002':
      return error.message ?? 'Datos no válidos.'
    case '23514':
      return 'Revisa los datos: hay un valor que no es válido.'
    case '42501':
      return error.message?.startsWith('No tienes') ? error.message : 'No tienes permiso para hacer esto.'
    case 'PGRST301':
    case '401':
      return 'Tu sesión expiró. Vuelve a ingresar.'
    default:
      return 'No se pudo completar la operación. Intenta de nuevo.'
  }
}
