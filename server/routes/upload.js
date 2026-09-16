import cloudinary from '../config/cloudinary.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';

export default async function uploadRoutes(fastify, opts) {

  // 1. MODERN FAST PATH: Generate signed credentials for direct client-side upload
  fastify.get('/sign', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { type = 'video' } = request.query;
      const timestamp = Math.round(new Date().getTime() / 1000);
      const folder = type === 'image' ? 'afrostory/images' : 'afrostory/videos';

      // Parameters signed for Cloudinary
      const paramsToSign = {
        timestamp,
        folder,
      };

      const signature = cloudinary.utils.api_sign_request(
        paramsToSign,
        process.env.CLOUDINARY_API_SECRET
      );

      sendSuccess(reply, {
        signature,
        timestamp,
        folder,
        apiKey: process.env.CLOUDINARY_API_KEY,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      }, 'Signature generated successfully');

    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to generate upload signature', 500, error.message);
    }
  });

  // 2. SERVER FALLBACK: Upload image through server (if direct upload is not used)
  fastify.post('/image', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const data = await request.file();
      if (!data) return sendError(reply, 'No file provided', 400);

      const buffer = await data.toBuffer();
      const base64 = `data:${data.mimetype};base64,${buffer.toString('base64')}`;

      const result = await cloudinary.uploader.upload(base64, {
        resource_type: 'image',
        folder: 'afrostory/images',
        secure: true,
      });

      sendSuccess(reply, {
        url: result.secure_url,
        publicId: result.public_id,
      }, 'Image uploaded successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Image upload failed', 500, error.message);
    }
  });

  // 3. SERVER FALLBACK: Upload video through server (Fixed with proper resource_type & HTTPS)
  fastify.post('/video', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const data = await request.file();
      if (!data) return sendError(reply, 'No file provided', 400);

      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_chunked_stream(
          {
            resource_type: 'video',
            folder: 'afrostory/videos',
            secure: true,
          },
          (error, uploadResult) => {
            if (error) reject(error);
            else resolve(uploadResult);
          }
        );

        data.file.pipe(uploadStream);
      });

      // FIXED: Strictly specify resource_type: 'video' and secure: true
      const mediaUrl = result.secure_url || cloudinary.url(result.public_id, {
        resource_type: 'video',
        secure: true,
      });

      sendSuccess(reply, {
        url: mediaUrl,
        mediaUrl,
        secure_url: mediaUrl,
        publicId: result.public_id,
        duration: result.duration || 0,
      }, 'Video uploaded successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Video upload failed', 500, error.message);
    }
  });

  // 4. Delete asset
  fastify.delete('/asset/:publicId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      await cloudinary.uploader.destroy(request.params.publicId);
      sendSuccess(reply, null, 'Asset deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete asset', 500, error.message);
    }
  });
}
