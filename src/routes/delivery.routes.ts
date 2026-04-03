import { Router } from "express";
import {
  createDeliveryController,
  getAllDeliveriesController,
  getDeliveryByIdController,
  updateDeliveryController,
  deleteDeliveryController,
  receiveDeliveryController,
} from "../controllers/delivery.controller";

const router = Router();

// Create a new delivery
router.post("/", createDeliveryController);
router.get("/", getAllDeliveriesController);
router.get("/:id", getDeliveryByIdController);
router.put("/:id", updateDeliveryController);
router.delete("/:id", deleteDeliveryController);
router.patch("/:id/receive", receiveDeliveryController);

export default router;
