import { Request, Response } from 'express';
import { UploadApiErrorResponse, UploadApiResponse } from 'cloudinary';
import cloudinary from '../util/cloudinary';          // FIX 1: matches your util/ folder
import prisma from '../config/db';

// ── Helper: upload buffer to Cloudinary ───────────────────────────────────────
const uploadToCloudinary = (
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id:     publicId,
        overwrite:     true,
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'auto' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      // FIX 2: explicit types for err and result
      (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
        if (err || !result) return reject(err ?? new Error('Upload failed'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
};

// FIX 3: extend Request to include multer's file property
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// PATCH /api/upload/product/:id
export const uploadProductImage = async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    const product = await prisma.product.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const imageUrl = await uploadToCloudinary(
      req.file.buffer,
      'products',
      `product_${product.id}`
    );

    const updated = await prisma.product.update({
      where: { id: product.id },
      data:  { image: imageUrl },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload product image', error: err });
  }
};

// PATCH /api/upload/employee/:id
export const uploadEmployeeImage = async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    const employee = await prisma.employee.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const imageUrl = await uploadToCloudinary(
      req.file.buffer,
      'employees',
      `employee_${employee.id}`
    );

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data:  { image: imageUrl },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload employee image', error: err });
  }
};

// PATCH /api/upload/customer/:id
export const uploadCustomerImage = async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    const customer = await prisma.customer.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const imageUrl = await uploadToCloudinary(
      req.file.buffer,
      'customers',
      `customer_${customer.id}`
    );

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data:  { image: imageUrl },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload customer image', error: err });
  }
};