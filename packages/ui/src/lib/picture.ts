/**
 * A picture someone chose, made small enough to keep in a row: cropped to a centred square, scaled to
 * `size` pixels and encoded as a JPEG data: URL (a few tens of kilobytes). Done in the browser, so the
 * original — and whatever its metadata says about where it was taken — never leaves the device.
 */
export async function pictureDataUrl(file: File, size = 320, quality = 0.85): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|heic|heif|avif)$/.test(file.type)) throw new Error("choose a photo (JPEG, PNG or WebP)");
  if (file.size > 20 * 1024 * 1024) throw new Error("that photo is over 20 MB");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("that photo could not be read"); });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  const g = canvas.getContext("2d")!;
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
