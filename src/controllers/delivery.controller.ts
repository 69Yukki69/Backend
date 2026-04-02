import { Request, Response } from "express";
import {
  createDeliveryService,
  getAllDeliveriesService,
  getDeliveryByIdService,
  updateDeliveryService,
  deleteDeliveryService,
} from "../util/delivery";
import {
  createDeliverySchema,
  updateDeliverySchema,
} from "../dto/delivery.dto";

// Create a new delivery
export const createDeliveryController = async (req: Request, res: Response) => {
  try {
    const parsed = createDeliverySchema.parse(req.body);
    const delivery = await createDeliveryService(parsed);
    res.status(201).json(delivery);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ message: error.message });
    } else {
      res.status(400).json({ message: "Invalid request data" });
    }
  }
};

// Get all deliveries
export const getAllDeliveriesController = async (_req: Request, res: Response) => {
  try {
    const deliveries = await getAllDeliveriesService();
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch deliveries" });
  }
};

// Get delivery by ID
export const getDeliveryByIdController = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const delivery = await getDeliveryByIdService(id);

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }
    res.json(delivery);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch delivery" });
  }
};

export const updateDeliveryController = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = updateDeliverySchema.parse(req.body);
    const updated = await updateDeliveryService(id, parsed);
    res.json(updated);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ message: error.message });
    } else {
      res.status(400).json({ message: "Invalid request data" });
    }
  }
};

export const deleteDeliveryController = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteDeliveryService(id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete delivery" });
  }
};
