import { Router } from "express";
import {
  createDeliveryController,
  getAllDeliveriesController,
  getDeliveryByIdController,
  updateDeliveryController,
  deleteDeliveryController,
  receiveDeliveryController,
} from "../controllers/delivery.controller";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// Create a new delivery
router.post("/", authMiddleware(["ADMIN", "STOCK_MANAGER"]),createDeliveryController);
router.get("/", authMiddleware(["ADMIN", "STOCK_MANAGER"]),getAllDeliveriesController);
router.get("/:id", authMiddleware(["ADMIN", "STOCK_MANAGER"]),getDeliveryByIdController);
router.put("/:id", authMiddleware(["ADMIN"]),updateDeliveryController);
router.delete("/:id", authMiddleware(["ADMIN"]),deleteDeliveryController);
router.patch("/:id/receive", authMiddleware(["ADMIN", "STOCK_MANAGER"]),receiveDeliveryController);

export default router;
