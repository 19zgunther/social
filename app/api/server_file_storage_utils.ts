import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getStorageBackendForId,
  registerStorageObject,
  type StorageBackend,
} from "@/app/lib/storageObjects";

const MAIN_BUCKET_NAME = "main";
const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;

const getSupabaseUrl = (): string => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is not configured.");
  }
  return url.replace(/\/+$/, "");
};

const getSupabaseServiceRoleKey = (): string => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return key;
};

let supabaseServiceClient: SupabaseClient | null = null;

const getSupabaseServiceClient = (): SupabaseClient => {
  if (!supabaseServiceClient) {
    const url = getSupabaseUrl();
    const key = getSupabaseServiceRoleKey();
    supabaseServiceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseServiceClient;
};

const getS3BucketName = (): string => {
  const name = process.env.S3_BUCKET_NAME?.trim();
  if (!name) {
    throw new Error("S3_BUCKET_NAME is not configured.");
  }
  return name;
};

const getS3Region = (): string => {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new Error("AWS_REGION is not configured.");
  }
  return region;
};

let s3Client: S3Client | null = null;

const getS3Client = (): S3Client => {
  if (!s3Client) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required.");
    }
    s3Client = new S3Client({
      region: getS3Region(),
      credentials: { accessKeyId, secretAccessKey },
      // WHEN_SUPPORTED (SDK default) signs CRC32 headers into PutObject URLs;
      // browser fetch won't send them → 403. WHEN_REQUIRED keeps server Put/Get fine.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return s3Client;
};

export const buildMainBucketObjectPath = (userId: string, imageId: string): string =>
  `${userId}/${imageId}`;

const buildThreadImageObjectPath = (threadId: string, imageId: string): string =>
  `thread/${threadId}/${imageId}`;

/** New uploads always go to S3. Returns a browser-usable presigned PUT URL. */
export const createSignedMainBucketUploadUrl = async (input: {
  userId: string;
  imageId: string;
  mimeType: string;
  expiresInSeconds?: number;
}): Promise<{ signedUrl: string; token: string; path: string }> => {
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  const expiresIn = input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
  const command = new PutObjectCommand({
    Bucket: getS3BucketName(),
    Key: objectPath,
    ContentType: input.mimeType,
  });
  const signedUrl = await getSignedUrl(getS3Client(), command, { expiresIn });
  return {
    signedUrl,
    token: "",
    path: objectPath,
  };
};

const putObjectToS3 = async (input: {
  objectPath: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<void> => {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3BucketName(),
      Key: input.objectPath,
      Body: input.bytes,
      ContentType: input.mimeType,
    }),
  );
};

const getSignedS3GetUrl = async (objectPath: string, expiresInSeconds: number): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: getS3BucketName(),
    Key: objectPath,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
};

const isS3NotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (named.name === "NotFound" || named.name === "NoSuchKey") {
    return true;
  }
  return named.$metadata?.httpStatusCode === 404;
};

/** True when `{userId}/{imageId}` exists in the S3 bucket (caller-owned user path). */
export const mainBucketUserObjectExists = async (input: {
  userId: string;
  imageId: string;
}): Promise<boolean> => {
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  try {
    await getS3Client().send(
      new HeadObjectCommand({
        Bucket: getS3BucketName(),
        Key: objectPath,
      }),
    );
    return true;
  } catch (error) {
    if (isS3NotFoundError(error)) {
      return false;
    }
    throw error;
  }
};

const getSignedSupabaseUrl = async (
  objectPath: string,
  expiresInSeconds: number,
): Promise<string> => {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  const signResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${MAIN_BUCKET_NAME}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    },
  );

  if (!signResponse.ok) {
    const errorBody = await signResponse.text();
    throw new Error(`Supabase sign URL failed (${signResponse.status}): ${errorBody}`);
  }

  const signPayload = (await signResponse.json()) as { signedURL?: string };
  if (!signPayload.signedURL) {
    throw new Error("Supabase signed URL response missing signedURL.");
  }

  return `${supabaseUrl}/storage/v1${signPayload.signedURL}`;
};

/** Uploads to S3 and registers the object. New content never writes to Supabase Storage. */
export const uploadImageToMainBucket = async (input: {
  userId: string;
  imageId: string;
  base64Data: string;
  mimeType: string;
}): Promise<void> => {
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  const objectBytes = Buffer.from(input.base64Data, "base64");
  await putObjectToS3({
    objectPath,
    bytes: objectBytes,
    mimeType: input.mimeType,
  });
  await registerStorageObject({
    id: input.imageId,
    backend: "s3",
    pathKind: "user",
    ownerId: input.userId,
  });
};

export const uploadThreadImageToMainBucket = async (input: {
  threadId: string;
  imageId: string;
  base64Data: string;
  mimeType: string;
}): Promise<void> => {
  const objectPath = buildThreadImageObjectPath(input.threadId, input.imageId);
  const objectBytes = Buffer.from(input.base64Data, "base64");
  await putObjectToS3({
    objectPath,
    bytes: objectBytes,
    mimeType: input.mimeType,
  });
  await registerStorageObject({
    id: input.imageId,
    backend: "s3",
    pathKind: "thread",
    ownerId: input.threadId,
  });
};

export const getSignedMainBucketImageUrl = async (input: {
  userId: string;
  imageId: string;
  expiresInSeconds?: number;
  backend?: StorageBackend;
}): Promise<string> => {
  const expiresIn = input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
  const backend = input.backend ?? (await getStorageBackendForId(input.imageId));
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  if (backend === "s3") {
    return getSignedS3GetUrl(objectPath, expiresIn);
  }
  return getSignedSupabaseUrl(objectPath, expiresIn);
};

export const getSignedMainBucketThreadImageUrl = async (input: {
  threadId: string;
  imageId: string;
  expiresInSeconds?: number;
  backend?: StorageBackend;
}): Promise<string> => {
  const expiresIn = input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
  const backend = input.backend ?? (await getStorageBackendForId(input.imageId));
  const objectPath = buildThreadImageObjectPath(input.threadId, input.imageId);
  if (backend === "s3") {
    return getSignedS3GetUrl(objectPath, expiresIn);
  }
  return getSignedSupabaseUrl(objectPath, expiresIn);
};

/** Kept for callers that still use the Supabase service client elsewhere. */
export const getSupabaseStorageServiceClient = getSupabaseServiceClient;
