import { Router } from "express";
import {
  getStockBatchesByProductController,
  getExpiringBatchesController,
  getExpiredBatchesController,
  writeOffExpiredBatchesController,
} from "../controllers/stockBatch.controller";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// ⚠️ Static routes BEFORE /:productId
router.get("/expiring",   authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiringBatchesController);
router.get("/expired",    authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiredBatchesController);
router.post("/write-off", authMiddleware(["ADMIN", "STOCK_MANAGER"]), writeOffExpiredBatchesController);
router.get("/:productId", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getStockBatchesByProductController);

export default router;