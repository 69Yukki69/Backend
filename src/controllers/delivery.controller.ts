import { Request, Response } from "express";
import {
  createDeliveryService,
  getAllDeliveriesService,
  getDeliveryByIdService,
  updateDeliveryService,
  deleteDeliveryService,
  receiveDeliveryItemsService,
  getExpiringItemsService,
  getExpiredItemsService,
} from "../util/delivery";
import {
  createDeliverySchema,
  updateDeliverySchema,
  receiveDeliveryItemsSchema,
} from "../dto/delivery.dto";

const getId = (req: Request) =>
  Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

// POST /deliveries
export const createDeliveryController = async (req: Request, res: Response) => {
  try {
    const parsed = createDeliverySchema.parse(req.body);
    const delivery = await createDeliveryService(parsed);
    res.status(201).json(delivery);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Invalid request data" });
  }
};

// GET /deliveries
export const getAllDeliveriesController = async (_req: Request, res: Response) => {
  try {
    const deliveries = await getAllDeliveriesService();
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch deliveries" });
  }
};

// GET /deliveries/:id
export const getDeliveryByIdController = async (req: Request, res: Response) => {
  try {
    const delivery = await getDeliveryByIdService(getId(req));
    if (!delivery) return res.status(404).json({ message: "Delivery not found" });
    res.json(delivery);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch delivery" });
  }
};

// PATCH /deliveries/:id
export const updateDeliveryController = async (req: Request, res: Response) => {
  try {
    const parsed = updateDeliverySchema.parse(req.body);
    const updated = await updateDeliveryService(getId(req), parsed);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Invalid request data" });
  }
};

// PATCH /deliveries/:id/receive
// Body: { employeeId, items: [{ deliveryItemId, receivedQty, expiryDate? }] }
export const receiveDeliveryController = async (req: Request, res: Response) => {
  try {
    const parsed = receiveDeliveryItemsSchema.parse(req.body);

    const result = await receiveDeliveryItemsService(
      getId(req),
      parsed.employeeId,
      parsed.items
    );

    res.json(result);
  } catch (error) {
    console.error("RECEIVE ERROR:", error);
    res.status(400).json({
      message: error instanceof Error ? error.message : "Failed to receive delivery",
    });
  }
};

// GET /deliveries/expiring-soon?days=30
// Returns items expiring within the next N days (default 30)
export const getExpiringItemsController = async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const items = await getExpiringItemsService(days);
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expiring items" });
  }
};

// GET /deliveries/expired
// Returns items that are already past their expiry date
export const getExpiredItemsController = async (req: Request, res: Response) => {
  try {
    const items = await getExpiredItemsService();
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expired items" });
  }
};

// DELETE /deliveries/:id
export const deleteDeliveryController = async (req: Request, res: Response) => {
  try {
    await deleteDeliveryService(getId(req));
    res.json({ success: true, message: "Delivery deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete delivery" });
  }
};