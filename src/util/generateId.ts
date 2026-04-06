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

// A db client can be either the global prisma or a transaction (tx)
type DbClient = typeof prisma;

const getLastRecord = async (model: ModelName, db: DbClient) => {
  switch (model) {
    case 'employee':
      return db.employee.findFirst({ orderBy: { id: 'desc' } });
    case 'customer':
      return db.customer.findFirst({ orderBy: { id: 'desc' } });
    case 'supplier':
      return db.supplier.findFirst({ orderBy: { id: 'desc' } });
    case 'product':
      return db.product.findFirst({ orderBy: { id: 'desc' } });
    case 'saleRecord':
      return db.saleRecord.findFirst({ orderBy: { id: 'desc' } });
    case 'orderLine':
      return db.orderLine.findFirst({ orderBy: { id: 'desc' } });
    case 'payment':
      return db.payment.findFirst({ orderBy: { id: 'desc' } });
    case 'shoppingCart':
      return db.shoppingCart.findFirst({ orderBy: { id: 'desc' } });
    case 'shoppingCartItem':
      return db.shoppingCartItem.findFirst({ orderBy: { id: 'desc' } });
    case 'promotionSale':
      return db.promotionSale.findFirst({ orderBy: { id: 'desc' } });
    case 'inventoryLog':
      return db.inventoryLog.findFirst({ orderBy: { id: 'desc' } });
    case 'delivery':
      return db.delivery.findFirst({ orderBy: { id: 'desc' } });
    case 'deliveryItem':
      return db.deliveryItem.findFirst({ orderBy: { id: 'desc' } });
    default:
      return null;
  }
};

// Pass `tx` when calling inside a Prisma transaction so reads see
// the latest uncommitted records, preventing duplicate ID collisions.
export const generateId = async (
  model: ModelName,
  tx?: DbClient
): Promise<string> => {
  const db = tx ?? prisma;
  const prefix = prefixMap[model];
  const last = await getLastRecord(model, db);

  if (!last) return `${prefix}-1000`;

  const parts = last.id.split('-');
  const lastNumber = parseInt(parts[parts.length - 1]);

  if (isNaN(lastNumber)) {
    return `${prefix}-1000`;
  }

  return `${prefix}-${lastNumber + 1}`;
};