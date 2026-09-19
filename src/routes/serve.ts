// Resized variants served via `?size=`. Fixed presets (not arbitrary widths) keep the number of
// unique transformations bounded on the free tier.
export const SIZES: Record<string, number> = { thumb: 200, small: 400, medium: 800, large: 1600 };

const VARIANT_PREFIX = "thumbs/";
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const variantKey = (size: string, key: string) => `${VARIANT_PREFIX}${size}/${key}`;

// All R2 keys of generated variants for an original, for cleanup on delete.
export function variantKeys(key: string): string[] {
  return Object.keys(SIZES).map((size) => variantKey(size, key));
}

async function serveOriginal(key: string, bucket: R2Bucket): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", CACHE_CONTROL);
  return new Response(object.body, { headers });
}

export async function handleServeImage(
  key: string,
  size: string | null,
  bucket: R2Bucket,
  images: ImagesBinding | undefined
): Promise<Response> {
  if (key.includes("/")) return new Response("Not found", { status: 404 });

  const width = size ? SIZES[size] : undefined;
  if (!size || !width || !images) return serveOriginal(key, bucket);

  const cached = await bucket.get(variantKey(size, key));
  if (cached) {
    const headers = new Headers();
    cached.writeHttpMetadata(headers);
    headers.set("etag", cached.httpEtag);
    headers.set("Cache-Control", CACHE_CONTROL);
    return new Response(cached.body, { headers });
  }

  const original = await bucket.get(key);
  if (!original) return new Response("Not found", { status: 404 });
  // GIFs may be animated; serve them untouched.
  if (original.httpMetadata?.contentType === "image/gif") return serveOriginal(key, bucket);

  try {
    const result = await images
      .input(original.body)
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: 80 });
    const bytes = await result.response().arrayBuffer();
    const contentType = result.contentType();

    await bucket.put(variantKey(size, key), bytes, { httpMetadata: { contentType } });

    return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL } });
  } catch {
    return serveOriginal(key, bucket);
  }
}
