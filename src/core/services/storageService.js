const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const { v4: uuidv4 } = require('uuid');

class StorageService {
  constructor(logger) {
    this.logger = logger;

    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      this.logger.warn('R2 Storage Service not configured. Missing required environment variables. Service will be disabled.');
      this.s3Client = null;
    } else {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      this.logger.info('StorageService initialized for Cloudflare R2.');
      this._publicUrlCache = new Map();
      this._initBucketMap();
      // use only v3 client
    }
  }

  _initBucketMap() {
    const base = process.env.R2_BUCKET_NAME;
    this.bucketNames = {
      default: base,
      uploads: base,
      datasets: process.env.R2_DATASETS_BUCKET || 'datasets',
      exports: process.env.R2_EXPORTS_BUCKET || 'exports',
      gallery: process.env.R2_EXPORTS_BUCKET || 'exports'
    };
  }

  getBucketName(kind = 'default') {
    return this._resolveBucketConfig(kind).bucket;
  }

  getPublicBaseUrl(kind = 'default') {
    const { bucket, alias } = this._resolveBucketConfig(kind);
    return this._resolvePublicUrl(bucket, alias);
  }

  _resolveBucketName(input) {
    return this._resolveBucketConfig(input).bucket;
  }

  _resolveBucketConfig(input) {
    if (!this.bucketNames) this._initBucketMap();
    if (!input) {
      return { bucket: this.bucketNames.default, alias: 'default' };
    }
    if (this.bucketNames[input]) {
      return { bucket: this.bucketNames[input], alias: input };
    }
    return { bucket: input, alias: null };
  }

  /**
   * Generates a pre-signed URL for a client-side upload.
   * @param {string} userId - The ID of the user uploading the file.
   * @param {string} fileName - The original name of the file.
   * @param {string} contentType - The MIME type of the file.
   * @param {string} bucketName - Optional bucket name override (defaults to R2_BUCKET_NAME)
   * @returns {Promise<{signedUrl: string, permanentUrl: string}>}
   */
  async generateSignedUploadUrl(userId, fileName, contentType, bucketName = null) {
    if (!this.s3Client) {
      throw new Error('StorageService is not configured.');
    }

    const { bucket, alias } = this._resolveBucketConfig(bucketName);
    const publicBaseUrl = this._resolvePublicUrl(bucket, alias);
    const key = `${userId}/${uuidv4()}-${fileName}`;
    try {
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });

      let signedUrl = await getSignedUrl(this.s3Client, cmd, { expiresIn: 3600 });
      this.logger.debug('[StorageService] Presigned URL:', signedUrl);
      // Log signed headers for debugging
      const dbgObj=new URL(signedUrl);
      this.logger.debug('[StorageService] X-Amz-SignedHeaders:', dbgObj.searchParams.get('X-Amz-SignedHeaders'));
      const permanentUrl = `${publicBaseUrl}/${key}`;
      return { signedUrl, permanentUrl };
    } catch (error) {
      this.logger.error('Failed to generate signed URL:', error);
      throw new Error('Could not generate signed upload URL.');
    }
  }

  /**
   * Uploads a file from a readable stream to R2.
   * @param {ReadableStream} stream - The file stream to upload.
   * @param {string} key - The object key (path) in the bucket.
   * @param {string} contentType - The MIME type of the file.
   * @param {string} bucketName - Optional bucket name override (defaults to R2_BUCKET_NAME)
   * @returns {Promise<{permanentUrl: string}>}
   */
  async uploadFromStream(stream, key, contentType, bucketName = null) {
    if (!this.s3Client) {
      throw new Error('StorageService is not configured.');
    }

    const resolved = this._resolveBucketConfig(bucketName);
    const bucket = resolved.bucket;
    try {
      const uploadParams = {
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
      };
      const attemptUpload = async (params) => {
        const upload = new Upload({
        client: this.s3Client,
        params,
      });
        await upload.done();
        return params.Bucket;
      };

      let finalBucket = bucket;
      let finalAlias = resolved.alias;
      try {
        await attemptUpload(uploadParams);
      } catch (error) {
        if (error?.Code === 'NoSuchBucket' && bucket !== this.bucketNames.default) {
          this.logger.warn(`Bucket "${bucket}" missing; falling back to default bucket "${this.bucketNames.default}" for upload key ${key}.`);
          finalBucket = this.bucketNames.default;
          finalAlias = 'default';
          await attemptUpload({ ...uploadParams, Bucket: finalBucket });
        } else {
          throw error;
        }
      }

      const publicBase = this._resolvePublicUrl(finalBucket, finalAlias);
      const permanentUrl = `${publicBase}/${key}`;
      this.logger.info(`Successfully uploaded stream to ${permanentUrl}`);
      return { permanentUrl, key, bucket: finalBucket };
    } catch (error) {
      this.logger.error('Failed to upload stream to R2:', error);
      throw new Error('Could not upload file stream.');
    }
  }

  async generateSignedDownloadUrl(key, options = {}) {
    if (!this.s3Client) {
      throw new Error('StorageService is not configured.');
    }
    const bucket = this._resolveBucketName(options.bucketName);
    try {
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key
      });
      return await getSignedUrl(this.s3Client, cmd, { expiresIn: options.expiresIn || 3600 });
    } catch (error) {
      this.logger.error('Failed to generate signed download URL:', error);
      throw new Error('Could not generate signed download URL.');
    }
  }

  _resolvePublicUrl(bucket, alias = null) {
    if (!bucket) return process.env.R2_PUBLIC_URL;
    if (!this._publicUrlCache) this._publicUrlCache = new Map();
    const cacheKey = alias ? `${bucket}::${alias}` : bucket;
    if (this._publicUrlCache.has(cacheKey)) {
      return this._publicUrlCache.get(cacheKey);
    }

    const override = this._lookupBucketOverride(bucket, alias);
    if (override) {
      this._publicUrlCache.set(cacheKey, override);
      return override;
    }

    const derived = this._deriveUrlFromDefault(bucket);
    if (derived) {
      this._publicUrlCache.set(cacheKey, derived);
      return derived;
    }

    const fallback = process.env.R2_PUBLIC_URL || '';
    this._publicUrlCache.set(cacheKey, fallback);
    return process.env.R2_PUBLIC_URL || '';
  }

  _lookupBucketOverride(bucket, alias = null) {
    const defaultBucket = this.getBucketName('default');
    if ((alias === 'default' || alias === 'uploads' || (!alias && bucket === defaultBucket)) && process.env.R2_PUBLIC_URL) {
      return process.env.R2_PUBLIC_URL;
    }
    if (alias === 'datasets' && process.env.R2_DATASETS_PUBLIC_URL) {
      return process.env.R2_DATASETS_PUBLIC_URL;
    }
    if (alias === 'exports') {
      if (process.env.R2_EXPORTS_PUBLIC_URL) {
        return process.env.R2_EXPORTS_PUBLIC_URL;
      }
      return 'https://exports.miladystation2.net';
    }
    if (alias === 'gallery') {
      if (process.env.R2_GALLERY_PUBLIC_URL) {
        return process.env.R2_GALLERY_PUBLIC_URL;
      }
      return 'https://gallery.miladystation2.net';
    }
    return null;
  }

  _deriveUrlFromDefault(bucket) {
    const defaultUrl = process.env.R2_PUBLIC_URL;
    if (!defaultUrl) return null;
    try {
      const parsed = new URL(defaultUrl);
      const defaultBucket = process.env.R2_BUCKET_NAME;
      let hostname = parsed.hostname;
      if (defaultBucket && hostname.startsWith(`${defaultBucket}.`)) {
        const root = hostname.substring(defaultBucket.length + 1);
        hostname = `${bucket}.${root}`;
      } else if (!hostname.startsWith(`${bucket}.`)) {
        hostname = `${bucket}.${hostname}`;
      }
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      return `${parsed.protocol}//${hostname}${path}`;
    } catch (err) {
      this.logger.warn('Failed to derive public URL from default R2_PUBLIC_URL:', err.message);
      return null;
    }
  }
}

module.exports = StorageService; 
