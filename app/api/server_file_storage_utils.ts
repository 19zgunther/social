const MAIN_BUCKET_NAME = "main";

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

export const buildMainBucketObjectPath = (userId: string, imageId: string): string =>
  `${userId}/${imageId}`;

const buildThreadImageObjectPath = (threadId: string, imageId: string): string =>
  `thread/${threadId}/${imageId}`;

export const uploadImageToMainBucket = async (input: {
  userId: string;
  imageId: string;
  base64Data: string;
  mimeType: string;
}): Promise<void> => {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  const objectBytes = Buffer.from(input.base64Data, "base64");

  const uploadResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/${MAIN_BUCKET_NAME}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": input.mimeType,
        "x-upsert": "true",
      },
      body: objectBytes,
    },
  );

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text();
    throw new Error(`Supabase upload failed (${uploadResponse.status}): ${errorBody}`);
  }
};

export const uploadThreadImageToMainBucket = async (input: {
  threadId: string;
  imageId: string;
  base64Data: string;
  mimeType: string;
}): Promise<void> => {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const objectPath = buildThreadImageObjectPath(input.threadId, input.imageId);
  const objectBytes = Buffer.from(input.base64Data, "base64");

  const uploadResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/${MAIN_BUCKET_NAME}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": input.mimeType,
        "x-upsert": "true",
      },
      body: objectBytes,
    },
  );

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text();
    throw new Error(`Supabase upload failed (${uploadResponse.status}): ${errorBody}`);
  }
};

export const getSignedMainBucketImageUrl = async (input: {
  userId: string;
  imageId: string;
  expiresInSeconds?: number;
}): Promise<string> => {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const objectPath = buildMainBucketObjectPath(input.userId, input.imageId);
  const expiresIn = input.expiresInSeconds ?? 3600;

  const signResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${MAIN_BUCKET_NAME}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
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

export const getSignedMainBucketThreadImageUrl = async (input: {
  threadId: string;
  imageId: string;
  expiresInSeconds?: number;
}): Promise<string> => {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const objectPath = buildThreadImageObjectPath(input.threadId, input.imageId);
  const expiresIn = input.expiresInSeconds ?? 3600;

  const signResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${MAIN_BUCKET_NAME}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
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
