import prisma from '../config/db';

export type ModelName =
  | 'employee'
  | 'customer'
  | 'supplier'
  | 'product'
  | 'saleRecord'
  | 'orderLine'
  | 'payment'
  | 'shoppingCart'
  | 'shoppingCartItem'
  | 'promotionSale'
  | 'inventoryLog'
  | 'delivery'
  | 'deliveryItem';

const prefixMap: Record<ModelName, string> = {
  employee:         'EMP',
  customer:         'CUS',
  supplier:         'SUP',
  product:          'PRD',
  saleRecord:       'SAL',
  orderLine:        'ORL',
  payment:          'PAY',
  shoppingCart:     'CRT',
  shoppingCartItem: 'ITM',
  promotionSale:    'PRO',
  inventoryLog:     'LOG',
  delivery:         'DEL',
  deliveryItem:     'DLI',
};

const getLastNumber = async (model: ModelName): Promise<number> => {
  let lastId: string | null = null;

  switch (model) {
    case 'employee':         { const r = await prisma.employee.findMany({ select: { id: true } });         lastId = getMaxId(r); break; }
    case 'customer':         { const r = await prisma.customer.findMany({ select: { id: true } });         lastId = getMaxId(r); break; }
    case 'supplier':         { const r = await prisma.supplier.findMany({ select: { id: true } });         lastId = getMaxId(r); break; }
    case 'product':          { const r = await prisma.product.findMany({ select: { id: true } });          lastId = getMaxId(r); break; }
    case 'saleRecord':       { const r = await prisma.saleRecord.findMany({ select: { id: true } });       lastId = getMaxId(r); break; }
    case 'orderLine':        { const r = await prisma.orderLine.findMany({ select: { id: true } });        lastId = getMaxId(r); break; }
    case 'payment':          { const r = await prisma.payment.findMany({ select: { id: true } });          lastId = getMaxId(r); break; }
    case 'shoppingCart':     { const r = await prisma.shoppingCart.findMany({ select: { id: true } });     lastId = getMaxId(r); break; }
    case 'shoppingCartItem': { const r = await prisma.shoppingCartItem.findMany({ select: { id: true } }); lastId = getMaxId(r); break; }
    case 'promotionSale':    { const r = await prisma.promotionSale.findMany({ select: { id: true } });    lastId = getMaxId(r); break; }
    case 'inventoryLog':     { const r = await prisma.inventoryLog.findMany({ select: { id: true } });     lastId = getMaxId(r); break; }
    case 'delivery':         { const r = await prisma.delivery.findMany({ select: { id: true } });         lastId = getMaxId(r); break; }
    case 'deliveryItem':     { const r = await prisma.deliveryItem.findMany({ select: { id: true } });     lastId = getMaxId(r); break; }
  }

  if (!lastId) return 1000;
  const parts = lastId.split('-');
  const num = parseInt(parts[parts.length - 1]);
  return isNaN(num) ? 1000 : num;
};

// Finds the record with the highest numeric suffix — avoids lexicographic
// ordering bugs where "LOG-1009" sorts after "LOG-10010" as a string.
const getMaxId = (records: { id: string }[]): string | null => {
  if (records.length === 0) return null;
  return records.reduce((max, r) => {
    const maxNum = parseInt(max.id.split('-').pop() || '0');
    const rNum   = parseInt(r.id.split('-').pop()   || '0');
    return rNum > maxNum ? r : max;
  }).id;
};

// Generate `count` sequential IDs at once — safe for use before a transaction
// because all reads happen in a single moment, then numbers are incremented locally.
export const generateIds = async (model: ModelName, count: number): Promise<string[]> => {
  const prefix  = prefixMap[model];
  const lastNum = await getLastNumber(model);
  return Array.from({ length: count }, (_, i) => `${prefix}-${lastNum + 1 + i}`);
};

// Single ID — backward compatible with all existing call sites
export const generateId = async (model: ModelName): Promise<string> => {
  const ids = await generateIds(model, 1);
  return ids[0];
};