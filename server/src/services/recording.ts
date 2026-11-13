import { mkdir, rm, writeFile } from 'node:fs/promises'

// server/src/services -> repo root is three levels up. cwd is server/, so don't use it.
const clipsDir = new URL('../../../clips/audio/', import.meta.url)
const repoRoot = new URL('../../../', import.meta.url)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(uuid: string) {
  return UUID_RE.test(uuid)
}

const CLIP_PATH_RE =
  /^(modified\/)?clips\/audio\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/\2\.wav$/i

export function clipIdFromPath(audioPath: string | null): string | null {
  if (!audioPath) return null
  const m = CLIP_PATH_RE.exec(audioPath)
  if (!m || !isUuid(m[2])) return null
  return m[2].toLowerCase()
}

export function isModifiedPath(audioPath: string | null): boolean {
  return !!audioPath && audioPath.toLowerCase().startsWith('modified/')
}

// Save as keeps the source folders and filename, under a top-level modified/.
export function modifiedCopyPath(audioPath: string | null): string | null {
  const id = clipIdFromPath(audioPath)
  if (!id) return null
  return `modified/clips/audio/${id}/${id}.wav`
}

export function clipFileUrl(audioPath: string | null): URL | null {
  const id = clipIdFromPath(audioPath)
  if (!id || !audioPath) return null
  if (isModifiedPath(audioPath)) return new URL(`modified/clips/audio/${id}/${id}.wav`, repoRoot)
  return new URL(`${id}/${id}.wav`, clipsDir)
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

export async function writeStored(audioPath: string, bytes: Buffer) {
  const fileUrl = clipFileUrl(audioPath)
  if (!fileUrl) throw new Error('invalid path')
  await mkdir(new URL('./', fileUrl), { recursive: true })
  await writeFile(fileUrl, bytes)
}

export async function removeStored(audioPath: string | null) {
  const id = clipIdFromPath(audioPath)
  if (!id) return
  if (isModifiedPath(audioPath)) {
    await rm(new URL(`modified/clips/audio/${id}/`, repoRoot), { recursive: true, force: true })
    return
  }
  await removeClip(id)
}
