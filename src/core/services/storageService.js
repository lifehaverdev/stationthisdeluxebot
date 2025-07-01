const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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
    }
  }

  /**
   * Generates a pre-signed URL for a client-side upload.
   * @param {string} userId - The ID of the user uploading the file.
   * @param {string} fileName - The original name of the file.
   * @param {string} contentType - The MIME type of the file.
   * @returns {Promise<{signedUrl: string, permanentUrl: string}>}
   */
  async generateSignedUploadUrl(userId, fileName, contentType) {
    if (!this.s3Client) {
      throw new Error('StorageService is not configured.');
    }

    const key = `uploads/${userId}/${uuidv4()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    try {
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour
      const permanentUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
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
   * @returns {Promise<{permanentUrl: string}>}
   */
  async uploadFromStream(stream, key, contentType) {
    if (!this.s3Client) {
      throw new Error('StorageService is not configured.');
    }

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: stream,
          ContentType: contentType,
        },
      });

      await upload.done();
      const permanentUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
      this.logger.info(`Successfully uploaded stream to ${permanentUrl}`);
      return { permanentUrl };
    } catch (error) {
      this.logger.error('Failed to upload stream to R2:', error);
      throw new Error('Could not upload file stream.');
    }
  }
}

module.exports = StorageService; 