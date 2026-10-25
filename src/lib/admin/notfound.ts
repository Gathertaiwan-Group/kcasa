import { notFound } from 'next/navigation'
import { OpError } from './core'

/** Parse a route [id] param; non-numeric ids are a 404, not a DB error. */
export function idParam(id: string): number {
  if (!/^\d+$/.test(id)) notFound()
  return Number(id)
}

/** Await a loader and turn "row does not exist" (OpError 404) into the Next.js 404 page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof OpError && e.status === 404) notFound()
    throw e
  }
}
