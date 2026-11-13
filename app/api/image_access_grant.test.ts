import { beforeAll, describe, expect, it } from "vitest";
import {
  createMainBucketImageAccessGrant,
  createThreadBucketImageAccessGrant,
  verifyMainBucketImageAccessGrant,
  verifyThreadBucketImageAccessGrant,
} from "@/app/api/image_access_grant";

describe("image access grants storage backend", () => {
  beforeAll(() => {
    process.env.IMAGE_ACCESS_GRANT_KEY ??= "test-image-access-grant-key";
  });

  it("encodes and verifies s3 backend on main grants", () => {
    const token = createMainBucketImageAccessGrant({
      imageId: "11111111-1111-4111-8111-111111111111",
      storageUserId: "22222222-2222-4222-8222-222222222222",
      viewerUserId: "33333333-3333-4333-8333-333333333333",
      backend: "s3",
    });
    const payload = verifyMainBucketImageAccessGrant(token);
    expect(payload?.backend).toBe("s3");
    expect(payload?.b).toBe("s3");
  });

  it("defaults omitted backend to supabase", () => {
    const token = createMainBucketImageAccessGrant({
      imageId: "11111111-1111-4111-8111-111111111111",
      storageUserId: "22222222-2222-4222-8222-222222222222",
      viewerUserId: "33333333-3333-4333-8333-333333333333",
    });
    const payload = verifyMainBucketImageAccessGrant(token);
    expect(payload?.backend).toBe("supabase");
    expect(payload?.b).toBe("supabase");
  });

  it("encodes and verifies s3 backend on thread grants", () => {
    const token = createThreadBucketImageAccessGrant({
      imageId: "11111111-1111-4111-8111-111111111111",
      threadId: "44444444-4444-4444-8444-444444444444",
      viewerUserId: "33333333-3333-4333-8333-333333333333",
      backend: "s3",
    });
    const payload = verifyThreadBucketImageAccessGrant(token);
    expect(payload?.backend).toBe("s3");
    expect(payload?.b).toBe("s3");
  });
});
