import { Router } from "express";
import {
  createDeliveryController,
  getAllDeliveriesController,
  getDeliveryByIdController,
  updateDeliveryController,
  deleteDeliveryController,
  receiveDeliveryController,
  getExpiringItemsController,
  getExpiredItemsController,
  getProductExpiryStatusController, // ← ADD
} from "../controllers/delivery.controller";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/", authMiddleware(["ADMIN", "STOCK_MANAGER"]), createDeliveryController);
router.get("/", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getAllDeliveriesController);

// ⚠️ These must come BEFORE /:id to avoid being treated as an id param
router.get("/expiring-soon", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiringItemsController);
router.get("/expired", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getExpiredItemsController);
router.get("/expiry-status", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getProductExpiryStatusController); // ← ADD

router.get("/:id", authMiddleware(["ADMIN", "STOCK_MANAGER"]), getDeliveryByIdController);
router.put("/:id", authMiddleware(["ADMIN"]), updateDeliveryController);
router.delete("/:id", authMiddleware(["ADMIN"]), deleteDeliveryController);
router.patch("/:id/receive", authMiddleware(["ADMIN", "STOCK_MANAGER"]), receiveDeliveryController);

export default router;