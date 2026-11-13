import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import {
  clipIdFromPath,
  isAllowedCopyPath,
  isLegacyModifiedPath,
  isModifiedPath,
} from '../../../shared/clip-path'

export { clipIdFromPath, isAllowedCopyPath, isLegacyModifiedPath, isModifiedPath, modifiedCopyPath } from '../../../shared/clip-path'

// server/src/services -> repo root is three levels up. cwd is server/, so don't use it.
const clipsDir = new URL('../../../clips/audio/', import.meta.url)
const repoRoot = new URL('../../../', import.meta.url)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(uuid: string) {
  return UUID_RE.test(uuid)
}

export function clipFileUrl(audioPath: string | null): URL | null {
  if (!audioPath) return null
  if (isAllowedCopyPath(audioPath) || isLegacyModifiedPath(audioPath)) return new URL(audioPath, repoRoot)
  const id = clipIdFromPath(audioPath)
  if (!id || isModifiedPath(audioPath)) return null
  return new URL(`${id}/${id}.wav`, clipsDir)
}

export function clipRelative(uuid: string) {
  return `clips/audio/${uuid}/${uuid}.wav`
}

// Write the wav beside the real file, then rename it into place. A crash during
// the write leaves the previous wav untouched.
async function commitWav(dir: URL, id: string, bytes: Buffer) {
  await mkdir(dir, { recursive: true })
  const tmp = new URL(`${id}.wav.tmp`, dir)
  const dest = new URL(`${id}.wav`, dir)
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, dest)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export async function writeClip(uuid: string, bytes: Buffer) {
  const id = uuid.toLowerCase()
  if (!isUuid(id)) throw new Error('invalid uuid')
  const dir = new URL(`${id}/`, clipsDir)
  try {
    await commitWav(dir, id, bytes)
  } catch (err) {
    try {
      await stat(new URL(`${id}.wav`, dir))
    } catch {
      await rm(dir, { recursive: true, force: true })
    }
    throw err
  }
  return clipRelative(id)
}

export async function replaceClip(uuid: string, bytes: Buffer) {
  const id = uuid.toLowerCase()
  if (!isUuid(id)) throw new Error('invalid uuid')
  await commitWav(new URL(`${id}/`, clipsDir), id, bytes)
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
  if (!audioPath) return
  if (isAllowedCopyPath(audioPath) || isLegacyModifiedPath(audioPath)) {
    const fileUrl = clipFileUrl(audioPath)
    if (!fileUrl) return
    await rm(fileUrl, { force: true })
    await rm(new URL('./', fileUrl), { force: true }).catch(() => {})
    return
  }
  const id = clipIdFromPath(audioPath)
  if (!id || isModifiedPath(audioPath)) return
  await removeClip(id)
}
