import cloudinary from '../config/cloudinary.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export default async function uploadRoutes(fastify, opts) {
  // Upload image
  fastify.post('/image', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const data = await request.file();

      if (!data) {
        return sendError(reply, 'No file provided', 400);
      }

      if (!data.mimetype.startsWith('image/')) {
        return sendError(reply, 'Only image files are allowed', 400);
      }
      const buffer = await data.toBuffer();
      const timestamp = Date.now();
      const filename = `${request.user._id}_${timestamp}.upload`;
      const filepath = path.join(uploadDir, filename);

      let result;
      try {
        fs.writeFileSync(filepath, buffer, { flag: 'wx' });
        result = await cloudinary.uploader.upload(filepath, {
          resource_type: 'image',
          folder: 'afrostory/images',
          public_id: `${request.user._id}_${timestamp}`,
        });
      } finally {
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      }

      sendSuccess(
        reply,
        {
          url: result.secure_url,
          publicId: result.public_id,
        },
        'Image uploaded successfully'
      );
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Image upload failed', 500, error.message);
    }
  });

  // Upload video
  fastify.post('/video', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const data = await request.file();

      if (!data) {
        return sendError(reply, 'No file provided', 400);
      }

      if (!data.mimetype.startsWith('video/')) {
        return sendError(reply, 'Only video files are allowed', 400);
      }
      const buffer = await data.toBuffer();
      const timestamp = Date.now();
      const filename = `${request.user._id}_${timestamp}.upload`;
      const filepath = path.join(uploadDir, filename);

      let result;
      try {
        fs.writeFileSync(filepath, buffer, { flag: 'wx' });
        result = await cloudinary.uploader.upload(filepath, {
          resource_type: 'video',
          folder: 'afrostory/videos',
          public_id: `${request.user._id}_${timestamp}`,
          eager: [{ streaming_profile: 'hd', format: 'm3u8' }],
          eager_async: true,
        });
      } finally {
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      }

      // Get HLS URL
      const hslUrl = cloudinary.url(result.public_id, {
        streaming_profile: 'hd',
        format: 'm3u8',
      });

      sendSuccess(
        reply,
        {
          url: result.secure_url,
          hlsUrl: hslUrl,
          publicId: result.public_id,
          duration: result.duration,
        },
        'Video uploaded successfully',
        201
      );
    } catch (error) {
      fastify.log.error(error);

      sendError(reply, 'Video upload failed', 500, error.message);
    }
  });

  // Delete asset from Cloudinary
  fastify.delete('/asset/:publicId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { publicId } = request.params;

      await cloudinary.uploader.destroy(publicId);

      sendSuccess(reply, null, 'Asset deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete asset', 500, error.message);
    }
  });

  // Get upload token (for client-side uploads)
  fastify.get('/token', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = cloudinary.utils.api_sign_request(
        {
          timestamp,
          folder: 'afrostory/uploads',
        },
        process.env.CLOUDINARY_API_SECRET
      );

      sendSuccess(reply, {
        timestamp,
        signature,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to generate upload token', 500, error.message);
    }
  });
}
