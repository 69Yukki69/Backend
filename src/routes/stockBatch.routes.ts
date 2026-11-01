import { Router } from "express";
import {
  getStockBatchesByProductController,
  getExpiringBatchesController,
  getExpiredBatchesController,
  writeOffExpiredBatchesController,
  getAllActiveBatchesController,
  updateBatchExpiryController
} from "../controllers/stockBatch.controller";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// ⚠️ Static routes BEFORE /:productId
router.get("/expiring",   authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiringBatchesController);
router.get("/expired",    authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiredBatchesController);
router.post("/write-off", authMiddleware(["ADMIN", "STOCK_MANAGER"]), writeOffExpiredBatchesController);
router.get("/:productId", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getStockBatchesByProductController);
router.get("/", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getAllActiveBatchesController);
router.patch("/:id/expiry", authMiddleware(["ADMIN", "STOCK_MANAGER"]), updateBatchExpiryController);

export default router;