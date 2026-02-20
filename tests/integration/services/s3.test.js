/**
 * S3/R2 Storage Integration Test
 *
 * Verifies StorageService upload, presign, and download round-trip
 * against real Cloudflare R2. Requires R2_* env vars to be set.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Readable } = require('stream');

// Load env
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const StorageService = require('../../../src/core/services/storageService');

describe('S3/R2 storage round-trip', () => {
  let storage;
  let testKey;
  const testUserId = '_test_integration';

  before(() => {
    storage = new StorageService(console);

    if (!storage.s3Client) {
      console.log('⚠ R2 not configured — skipping S3 tests');
    }
  });

  after(async () => {
    // Clean up: try to delete the test object if it was created
    if (testKey && storage.s3Client) {
      try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await storage.s3Client.send(new DeleteObjectCommand({
          Bucket: storage.getBucketName(),
          Key: testKey,
        }));
      } catch {
        // best-effort cleanup
      }
    }
  });

  test('generates a signed upload URL', async (t) => {
    if (!storage.s3Client) return t.skip('R2 not configured');

    const result = await storage.generateSignedUploadUrl(
      testUserId,
      'test-file.txt',
      'text/plain'
    );

    assert.ok(result.signedUrl, 'should return a signedUrl');
    assert.ok(result.permanentUrl, 'should return a permanentUrl');
    assert.match(result.signedUrl, /X-Amz-Signature/, 'signed URL should contain signature');
    assert.match(result.permanentUrl, /test-file\.txt/, 'permanent URL should contain filename');
  });

  test('uploads a stream and returns a permanent URL', async (t) => {
    if (!storage.s3Client) return t.skip('R2 not configured');

    const content = 'integration test content ' + Date.now();
    const stream = Readable.from([Buffer.from(content)]);
    testKey = `${testUserId}/integration-test-${Date.now()}.txt`;

    const result = await storage.uploadFromStream(
      stream,
      testKey,
      'text/plain'
    );

    assert.ok(result.permanentUrl, 'should return permanentUrl');
    assert.ok(result.key, 'should return key');
    assert.equal(result.key, testKey);
  });

  test('generates a signed download URL for uploaded object', async (t) => {
    if (!storage.s3Client) return t.skip('R2 not configured');
    if (!testKey) return t.skip('upload test did not run');

    const downloadUrl = await storage.generateSignedDownloadUrl(testKey);
    assert.ok(downloadUrl, 'should return a download URL');
    assert.match(downloadUrl, /X-Amz-Signature/, 'download URL should be signed');
  });
});
