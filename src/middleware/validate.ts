import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: result.error.issues.map((e) => ({  // ← change .errors to .issues
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }

    req.body = result.data;
    next();
  };
};