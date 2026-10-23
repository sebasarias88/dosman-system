import { useSyncExternalStore } from 'react'
import type { Branch } from '@/types/app'

/**
 * Branch the person is working in right now. Branch staff are fixed to their
 * own branch; owners and admins can switch between both. The choice is a
 * per-device convenience, so localStorage is enough (and may be unavailable).
 */
const STORAGE_KEY = 'dosman.active-branch'
const listeners = new Set<() => void>()

function readStoredBranchId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setActiveBranchId(branchId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, branchId)
  } catch {
    // Storage blocked: the selection simply won't be remembered.
  }
  listeners.forEach((notify) => notify())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function pickBranch(branches: Branch[], storedId: string | null): Branch | undefined {
  return branches.find((b) => b.id === storedId) ?? branches[0]
}

/** Non-React access, used by route guards. */
export function getActiveBranch(branches: Branch[]): Branch | undefined {
  return pickBranch(branches, readStoredBranchId())
}

export function useActiveBranch(branches: Branch[]): Branch | undefined {
  const storedId = useSyncExternalStore(subscribe, readStoredBranchId, () => null)
  return pickBranch(branches, storedId)
}
