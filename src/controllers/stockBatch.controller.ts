import { Request, Response } from "express";
import {
  getStockBatchesByProductService,
  getExpiringBatchesService,
  getExpiredBatchesService,
  writeOffExpiredBatchesService,
  writeOffBatchService,
  getAllActiveBatchesService,
  updateBatchExpiryService
} from "../util/stockBatch";

const getParam = (req: Request, key: string) => {
  const val = req.params[key];
  return Array.isArray(val) ? val[0] : val;
};

// GET /stock-batches/:productId
export const getStockBatchesByProductController = async (req: Request, res: Response) => {
  try {
    const data = await getStockBatchesByProductService(getParam(req, "productId"));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stock batches" });
  }
};

// GET /stock-batches/expiring?days=30
export const getExpiringBatchesController = async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await getExpiringBatchesService(days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expiring batches" });
  }
};

// GET /stock-batches/expired
export const getExpiredBatchesController = async (req: Request, res: Response) => {
  try {
    const data = await getExpiredBatchesService();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expired batches" });
  }
};

// POST /stock-batches/write-off
// Body: { employeeId }
export const writeOffExpiredBatchesController = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });
    const result = await writeOffExpiredBatchesService(employeeId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to write off expired batches" });
  }
};

// POST /stock-batches/:id/write-off
// Deducts ONE expired batch from inventory (employee comes from the auth token)
export const writeOffBatchController = async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).user?.id as string | undefined;
    if (!employeeId) return res.status(401).json({ message: "Not authenticated" });

    res.json(await writeOffBatchService(getParam(req, "id"), employeeId));
  } catch (error: any) {
    const map: Record<string, [number, string]> = {
      BATCH_NOT_FOUND:   [404, "Stock batch not found"],
      BATCH_EMPTY:       [400, "This batch has no stock left"],
      BATCH_NOT_EXPIRED: [400, "This batch is not expired yet"],
    };
    const hit = map[error?.message];
    if (hit) return res.status(hit[0]).json({ message: hit[1] });
    res.status(500).json({ message: "Failed to deduct the expired batch" });
  }
};

export const getAllActiveBatchesController = async (_req: Request, res: Response) => {
  try { res.json(await getAllActiveBatchesService()); }
  catch { res.status(500).json({ message: "Failed to fetch stock batches" }); }
};

export const updateBatchExpiryController = async (req: Request, res: Response) => {
  try {
    const id = getParam(req, "id");
    const { expiryDate } = req.body;
    if (expiryDate === undefined) return res.status(400).json({ message: "expiryDate is required (use null to clear)" });

    let value: Date | null = null;
    if (expiryDate !== null) {
      value = new Date(expiryDate);
      if (isNaN(value.getTime())) return res.status(400).json({ message: "Invalid expiryDate" });
    }

    res.json(await updateBatchExpiryService(id, value));
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ message: "Stock batch not found" });
    res.status(500).json({ message: "Failed to update expiry date" });
  }
};