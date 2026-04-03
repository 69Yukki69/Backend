import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const authMiddleware = (roles?: string[]) => {
  return (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token provided" });

    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      req.user = decoded; // { id, role, status }

      // Role check
      if (roles && !roles.includes(decoded.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Status check
      if (decoded.status !== "ACTIVE") {
        return res.status(403).json({ message: "Account inactive" });
      }

      next();
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }
  };
};
