import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { assertSafeKey, type StorageDriver, type StoredObject } from './types.js';

type S3Module = typeof import('@aws-sdk/client-s3');

let clientPromise: Promise<{ mod: S3Module; client: InstanceType<S3Module['S3Client']> }> | null = null;

// Imported lazily so a local-storage deployment never loads the AWS SDK.
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await import('@aws-sdk/client-s3');
      const client = new mod.S3Client({
        region: env.S3_REGION,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        // Since v3.729 the SDK adds x-amz-sdk-checksum-algorithm and a CRC32
        // header to every upload. Real S3 accepts them; most S3-compatible
        // services (Supabase Storage, Cloudflare R2, Backblaze B2, MinIO) reject
        // the request outright. Sending them only when the operation actually
        // requires it keeps this driver portable, which is the whole point of
        // having one.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
        },
      });
      return { mod, client };
    })();
  }
  return clientPromise;
}

export const s3Storage: StorageDriver = {
  name: 's3',

  async put(key, body, contentType): Promise<StoredObject> {
    assertSafeKey(key);
    const { mod, client } = await getClient();
    await client.send(
      new mod.PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // The bucket must stay private; downloads are proxied through the API
        // so that every byte passes an authorization check.
        ACL: undefined,
      }),
    );
    return { key, size: body.byteLength };
  },

  async createReadStream(key): Promise<Readable> {
    assertSafeKey(key);
    const { mod, client } = await getClient();
    const result = await client.send(
      new mod.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    if (!result.Body) throw new Error('Empty object body');
    return result.Body as Readable;
  },

  async delete(key): Promise<void> {
    assertSafeKey(key);
    const { mod, client } = await getClient();
    await client.send(new mod.DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },

  async exists(key): Promise<boolean> {
    assertSafeKey(key);
    const { mod, client } = await getClient();
    try {
      await client.send(new mod.HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  },
};
