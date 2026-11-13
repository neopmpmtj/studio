import { mkdir, rm, writeFile } from 'node:fs/promises'

// server/src/services -> repo root is three levels up. cwd is server/, so don't use it.
const clipsDir = new URL('../../../clips/audio/', import.meta.url)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(uuid: string) {
  return UUID_RE.test(uuid)
}

export function clipRelative(uuid: string) {
  return `clips/audio/${uuid}/${uuid}.wav`
}

export async function writeClip(uuid: string, bytes: Buffer) {
  const id = uuid.toLowerCase()
  if (!isUuid(id)) throw new Error('invalid uuid')
  const dir = new URL(`${id}/`, clipsDir)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(new URL(`${id}.wav`, dir), bytes)
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  return clipRelative(id)
}

export async function removeClip(uuid: string) {
  const id = uuid.toLowerCase()
  if (!isUuid(id)) return
  await rm(new URL(`${id}/`, clipsDir), { recursive: true, force: true })
}
