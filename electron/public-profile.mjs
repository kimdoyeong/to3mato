// Public profile requests from the main process: Supabase RPC, the public
// `profiles` bucket, photo processing and copying the link.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_SIZE = 400;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const SLUG = /^[a-hjkmnp-z2-9]{10}$/;
const DELIVERY_ID = /^[A-Za-z0-9_-]{1,80}$/;
const VIDEO_TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
const BUCKET = 'profiles';

// Copy approved 2026-11-08 (docs/microblog-design.md).
export const PHOTO_TYPE_ERROR =
  'JPEG, PNG, HEIC, WebP 파일만 추가할 수 있습니다.';
export const PHOTO_SIZE_ERROR = '10MB 이하 사진만 추가할 수 있습니다.';

const shape = (row) =>
  row && {
    slug: row.slug,
    name: row.name ?? row.display_name ?? null,
    photo: row.photo ?? null,
    visibility: row.visibility,
    active: row.active,
  };

/**
 * Crops the centre square, scales to 400px and re-encodes as JPEG. Re-encoding
 * from the bitmap drops EXIF, including the location.
 */
export function processPhoto(nativeImage, file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  if (!PHOTO_EXTENSIONS.includes(extension))
    throw Object.assign(new Error(PHOTO_TYPE_ERROR), { code: 'type' });
  if (fs.statSync(file).size > PHOTO_MAX_BYTES)
    throw Object.assign(new Error(PHOTO_SIZE_ERROR), { code: 'size' });
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw Object.assign(new Error('unreadable'), { code: 'read' });
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  });
  const sized = square.resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, quality: 'best' });
  // JPEG has no alpha, so transparent pixels are laid on white instead of black.
  // The bitmap is premultiplied BGRA, so each channel gains the missing coverage.
  const bitmap = sized.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4) {
    const gap = 255 - bitmap[i + 3];
    if (!gap) continue;
    bitmap[i] = Math.min(255, bitmap[i] + gap);
    bitmap[i + 1] = Math.min(255, bitmap[i + 1] + gap);
    bitmap[i + 2] = Math.min(255, bitmap[i + 2] + gap);
    bitmap[i + 3] = 255;
  }
  const size = sized.getSize();
  return nativeImage
    .createFromBitmap(bitmap, { width: size.width, height: size.height })
    .toJPEG(85);
}

/** @param {{ session: () => ({ client: any, userId: string } | null), nativeImage: any, clipboard: any, origin: string }} deps */
export function createPublicProfile({ session, nativeImage, clipboard, origin }) {
  const drafts = new Map();
  const need = () => {
    const value = session();
    if (!value) throw new Error('로그인하세요.');
    return value;
  };
  const unwrap = ({ data, error }) => {
    if (error) throw new Error(error.message || 'request failed');
    return data;
  };
  const bucket = () => need().client.storage.from(BUCKET);
  async function removeFiles(prefix, keep = null) {
    const { userId } = need();
    const listed = await bucket().list(userId, { limit: 100 });
    if (listed.error) return;
    const names = listed.data
      .map((file) => `${userId}/${file.name}`)
      .filter((name) => name.startsWith(`${userId}/${prefix}`) && name !== keep);
    if (names.length) await bucket().remove(names);
  }
  async function load() {
    const { client, userId } = need();
    return shape(
      unwrap(
        await client
          .from('public_profiles')
          .select('slug,display_name,photo,visibility,active')
          .eq('user_id', userId)
          .maybeSingle(),
      ),
    );
  }
  return {
    load,
    /** Keeps the processed photo in memory until save. Returns a preview. */
    preparePhoto(file) {
      const bytes = processPhoto(nativeImage, file);
      const token = crypto.randomUUID();
      drafts.clear();
      drafts.set(token, bytes);
      return { token, preview: `data:image/jpeg;base64,${bytes.toString('base64')}` };
    },
    async photoPreview(photoPath) {
      const { userId } = need();
      if (typeof photoPath !== 'string' || !photoPath.startsWith(`${userId}/photo-`))
        return '';
      const { data, error } = await bucket().download(photoPath);
      if (error || !data) return '';
      return `data:image/jpeg;base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`;
    },
    /**
     * photo: 'keep' | 'remove' | a token from preparePhoto.
     * snapshot is null to keep the stored one.
     */
    async save({ name, photo = 'keep', visibility, snapshot, activate = false }) {
      const { client, userId } = need();
      const current = await load();
      let photoPath = current?.photo ?? null;
      const previous = photoPath;
      if (photo === 'remove') photoPath = null;
      else if (photo !== 'keep') {
        const bytes = drafts.get(photo);
        if (!bytes) throw new Error('photo expired');
        photoPath = `${userId}/photo-${crypto.randomUUID()}.jpg`;
        unwrap(
          await bucket().upload(photoPath, bytes, {
            contentType: 'image/jpeg',
            upsert: false,
          }),
        );
        drafts.delete(photo);
      }
      const result = shape(
        unwrap(
          await client.rpc('profile_save', {
            p_name: name ?? null,
            p_photo: photoPath,
            p_visibility: visibility,
            p_snapshot: snapshot ?? null,
            p_activate: activate === true,
          }),
        ),
      );
      if (previous && previous !== photoPath)
        await bucket().remove([previous]).catch(() => {});
      return result;
    },
    async uploadVideo(deliveryId, mime, bytes) {
      const { userId } = need();
      const extension = VIDEO_TYPES[String(mime).split(';')[0]];
      if (
        !DELIVERY_ID.test(deliveryId) ||
        !extension ||
        !(bytes instanceof ArrayBuffer) ||
        bytes.byteLength > VIDEO_MAX_BYTES
      )
        throw new Error('잘못된 파일입니다.');
      const target = `${userId}/video-${deliveryId}.${extension}`;
      const { error } = await bucket().upload(target, Buffer.from(bytes), {
        contentType: `video/${extension}`,
        upsert: false,
      });
      // The same delivery uploaded earlier is already in place.
      if (error && !/exists|duplicate|409/i.test(`${error.message} ${error.statusCode}`))
        throw new Error(error.message);
      await removeFiles('video-', target);
      return target;
    },
    async removeVideos() {
      await removeFiles('video-');
    },
    async stop() {
      const { client } = need();
      const result = shape(unwrap(await client.rpc('profile_stop')));
      await removeFiles('video-').catch(() => {});
      return result;
    },
    copyLink(slug) {
      if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('잘못된 링크입니다.');
      clipboard.writeText(`${origin}/${slug}`);
      return true;
    },
  };
}
